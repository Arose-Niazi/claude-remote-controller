import { exec } from 'child_process';
import { promisify } from 'util';
import type { VpnProfile, VpnStatus } from '@crc/shared';
import type { VpnProfileConfig } from './config.js';
import { logger } from './logger.js';

const execAsync = promisify(exec);
const isWindows = process.platform === 'win32';

async function runCommand(cmd: string): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execAsync(cmd, { timeout: 15000 });
  } catch (err: any) {
    return { stdout: err.stdout || '', stderr: err.stderr || err.message };
  }
}

// --- Status checking ---

async function getWireGuardStatus(tunnelName: string): Promise<VpnStatus> {
  if (isWindows) {
    const { stdout } = await runCommand(`sc query WireGuardTunnel$${tunnelName}`);
    if (stdout.includes('RUNNING')) return 'connected';
    if (stdout.includes('START_PENDING')) return 'connecting';
    if (stdout.includes('STOP_PENDING')) return 'disconnecting';
    return 'disconnected';
  }
  // macOS
  const { stdout } = await runCommand(`wg show ${tunnelName} 2>/dev/null`);
  return stdout.trim() ? 'connected' : 'disconnected';
}

async function getOpenVpnStatus(profileId: string): Promise<VpnStatus> {
  const exe = isWindows
    ? '"C:\\Program Files\\OpenVPN Connect\\OpenVPNConnect.exe"'
    : '"/Applications/OpenVPN Connect/OpenVPN Connect.app/Contents/MacOS/OpenVPN Connect"';
  const { stdout } = await runCommand(`${exe} --list-profiles 2>&1`);
  // Parse output for the profile's status
  for (const line of stdout.split('\n')) {
    if (line.includes(profileId)) {
      if (line.toLowerCase().includes('connected')) return 'connected';
      if (line.toLowerCase().includes('connecting')) return 'connecting';
    }
  }
  return 'disconnected';
}

async function getAzureStatus(connectionName: string): Promise<VpnStatus> {
  if (isWindows) {
    const { stdout } = await runCommand('rasdial');
    if (stdout.includes(connectionName)) return 'connected';
    return 'disconnected';
  }
  // macOS: check network interfaces for VPN
  const { stdout } = await runCommand('ifconfig | grep -c utun');
  const count = parseInt(stdout.trim(), 10);
  return count > 1 ? 'connected' : 'disconnected';
}

async function getStatus(profile: VpnProfileConfig): Promise<VpnStatus> {
  try {
    switch (profile.type) {
      case 'wireguard':
        return await getWireGuardStatus(profile.tunnelName || profile.id);
      case 'openvpn':
        return await getOpenVpnStatus(profile.profileId || profile.id);
      case 'azure':
        return await getAzureStatus(profile.connectionName || profile.id);
      default:
        return 'disconnected';
    }
  } catch (err: any) {
    logger.error({ profile: profile.id, error: err.message }, 'Status check failed');
    return 'disconnected';
  }
}

// --- Connect / Disconnect ---

async function connectWireGuard(tunnelName: string): Promise<string | null> {
  if (isWindows) {
    const { stderr } = await runCommand(`net start WireGuardTunnel$${tunnelName}`);
    if (stderr && !stderr.includes('already been started')) return stderr;
    return null;
  }
  const { stderr } = await runCommand(`sudo wg-quick up ${tunnelName}`);
  return stderr || null;
}

async function disconnectWireGuard(tunnelName: string): Promise<string | null> {
  if (isWindows) {
    const { stderr } = await runCommand(`net stop WireGuardTunnel$${tunnelName}`);
    if (stderr && !stderr.includes('is not started')) return stderr;
    return null;
  }
  const { stderr } = await runCommand(`sudo wg-quick down ${tunnelName}`);
  return stderr || null;
}

async function connectOpenVpn(profileId: string): Promise<string | null> {
  const exe = isWindows
    ? '"C:\\Program Files\\OpenVPN Connect\\OpenVPNConnect.exe"'
    : 'open -a "OpenVPN Connect" --args';
  const { stderr } = await runCommand(`${exe} --connect-shortcut=${profileId}`);
  return stderr || null;
}

async function disconnectOpenVpn(): Promise<string | null> {
  const exe = isWindows
    ? '"C:\\Program Files\\OpenVPN Connect\\OpenVPNConnect.exe"'
    : 'open -a "OpenVPN Connect" --args';
  const { stderr } = await runCommand(`${exe} --disconnect-shortcut`);
  return stderr || null;
}

async function connectAzure(connectionName: string): Promise<string | null> {
  if (isWindows) {
    const { stderr } = await runCommand(`rasdial "${connectionName}"`);
    return stderr || null;
  }
  return 'Azure VPN CLI not supported on macOS';
}

async function disconnectAzure(connectionName: string): Promise<string | null> {
  if (isWindows) {
    const { stderr } = await runCommand(`rasdial "${connectionName}" /disconnect`);
    return stderr || null;
  }
  return 'Azure VPN CLI not supported on macOS';
}

// --- Public API ---

export async function getProfiles(configs: VpnProfileConfig[]): Promise<VpnProfile[]> {
  const profiles: VpnProfile[] = [];
  for (const cfg of configs) {
    const status = await getStatus(cfg);
    profiles.push({
      id: cfg.id,
      name: cfg.name,
      type: cfg.type,
      status,
    });
  }
  return profiles;
}

export async function connectVpn(
  configs: VpnProfileConfig[],
  profileId: string
): Promise<VpnProfile[]> {
  const cfg = configs.find((c) => c.id === profileId);
  if (!cfg) return getProfiles(configs);

  logger.info({ profileId, type: cfg.type }, 'Connecting VPN');
  let error: string | null = null;

  switch (cfg.type) {
    case 'wireguard':
      error = await connectWireGuard(cfg.tunnelName || cfg.id);
      break;
    case 'openvpn':
      error = await connectOpenVpn(cfg.profileId || cfg.id);
      break;
    case 'azure':
      error = await connectAzure(cfg.connectionName || cfg.id);
      break;
  }

  if (error) {
    logger.error({ profileId, error }, 'VPN connect failed');
  }

  // Wait briefly for status to settle
  await new Promise((r) => setTimeout(r, 2000));
  const profiles = await getProfiles(configs);

  // Attach error to the relevant profile if connect failed
  if (error) {
    const p = profiles.find((p) => p.id === profileId);
    if (p) {
      p.status = 'error';
      p.error = error.slice(0, 200);
    }
  }

  return profiles;
}

export async function disconnectVpn(
  configs: VpnProfileConfig[],
  profileId: string
): Promise<VpnProfile[]> {
  const cfg = configs.find((c) => c.id === profileId);
  if (!cfg) return getProfiles(configs);

  logger.info({ profileId, type: cfg.type }, 'Disconnecting VPN');
  let error: string | null = null;

  switch (cfg.type) {
    case 'wireguard':
      error = await disconnectWireGuard(cfg.tunnelName || cfg.id);
      break;
    case 'openvpn':
      error = await disconnectOpenVpn();
      break;
    case 'azure':
      error = await disconnectAzure(cfg.connectionName || cfg.id);
      break;
  }

  if (error) {
    logger.error({ profileId, error }, 'VPN disconnect failed');
  }

  await new Promise((r) => setTimeout(r, 2000));
  const profiles = await getProfiles(configs);

  if (error) {
    const p = profiles.find((p) => p.id === profileId);
    if (p) {
      p.status = 'error';
      p.error = error.slice(0, 200);
    }
  }

  return profiles;
}
