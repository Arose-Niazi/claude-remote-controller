import { exec } from 'child_process';
import { promisify } from 'util';
import type { VpnProfile, VpnStatus } from '@crc/shared';
import type { VpnProfileConfig } from './config.js';
import { logger } from './logger.js';

const execAsync = promisify(exec);
const isWindows = process.platform === 'win32';

async function runCommand(cmd: string): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execAsync(cmd, { timeout: 15000, shell: isWindows ? 'powershell.exe' : '/bin/sh' });
  } catch (err: any) {
    return { stdout: err.stdout || '', stderr: err.stderr || err.message };
  }
}

// --- Status checking ---

async function getWireGuardStatus(tunnelName: string): Promise<VpnStatus> {
  if (isWindows) {
    // Check if the tunnel service exists and is running
    const { stdout } = await runCommand(`Get-Service -Name 'WireGuardTunnel$$${tunnelName}' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Status`);
    const status = stdout.trim();
    if (status === 'Running') return 'connected';
    if (status === 'StartPending') return 'connecting';
    if (status === 'StopPending') return 'disconnecting';
    if (status === 'Stopped') return 'disconnected';
    // Service doesn't exist — check if WireGuard interface is up via wg show
    const { stdout: wgOut } = await runCommand(`& 'C:\\Program Files\\WireGuard\\wg.exe' show '${tunnelName}' 2>&1`);
    return wgOut.includes('interface:') ? 'connected' : 'disconnected';
  }
  // macOS
  const { stdout } = await runCommand(`wg show ${tunnelName} 2>/dev/null`);
  return stdout.trim() ? 'connected' : 'disconnected';
}

async function getOpenVpnStatus(profileId: string): Promise<VpnStatus> {
  const exe = isWindows
    ? '& "C:\\Program Files\\OpenVPN Connect\\OpenVPNConnect.exe"'
    : '"/Applications/OpenVPN Connect/OpenVPN Connect.app/Contents/MacOS/OpenVPN Connect"';
  const { stdout } = await runCommand(`${exe} --list-profiles 2>&1`);
  try {
    const profiles = JSON.parse(stdout);
    if (Array.isArray(profiles)) {
      const profile = profiles.find((p: any) => p.id === profileId);
      if (profile) {
        const status = (profile.status || profile.connection_status || '').toLowerCase();
        if (status.includes('connected') && !status.includes('disconnected')) return 'connected';
        if (status.includes('connecting')) return 'connecting';
      }
    }
  } catch {
    // Output wasn't JSON — try line-based parsing
    for (const line of stdout.split('\n')) {
      if (line.includes(profileId) && line.toLowerCase().includes('connected')) {
        return 'connected';
      }
    }
  }
  return 'disconnected';
}

async function getAzureStatus(connectionName: string): Promise<VpnStatus> {
  if (isWindows) {
    // Check for active VPN adapter related to Azure
    const { stdout } = await runCommand(
      `Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and ($_.InterfaceDescription -like '*Aadds*' -or $_.InterfaceDescription -like '*Azure*' -or $_.Name -like '*${connectionName}*') } | Measure-Object | Select-Object -ExpandProperty Count`
    );
    if (parseInt(stdout.trim(), 10) > 0) return 'connected';
    // Also check ipconfig for the connection name
    const { stdout: ipOut } = await runCommand(`ipconfig | Select-String '${connectionName}'`);
    if (ipOut.trim()) return 'connected';
    return 'disconnected';
  }
  // macOS
  const { stdout } = await runCommand('ifconfig | grep -c utun');
  return parseInt(stdout.trim(), 10) > 1 ? 'connected' : 'disconnected';
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
    // Try starting the service first
    const { stderr, stdout } = await runCommand(`net start WireGuardTunnel$$${tunnelName} 2>&1`);
    const output = stdout + stderr;
    if (output.includes('successfully') || output.includes('already been started')) return null;
    // If service doesn't exist, try installing it
    const { stderr: installErr } = await runCommand(
      `& 'C:\\Program Files\\WireGuard\\wireguard.exe' /installtunnelservice '${tunnelName}' 2>&1`
    );
    if (installErr) return installErr;
    return null;
  }
  const { stderr } = await runCommand(`sudo wg-quick up ${tunnelName}`);
  return stderr || null;
}

async function disconnectWireGuard(tunnelName: string): Promise<string | null> {
  if (isWindows) {
    const { stderr, stdout } = await runCommand(`net stop WireGuardTunnel$$${tunnelName} 2>&1`);
    const output = stdout + stderr;
    if (output.includes('successfully') || output.includes('is not started')) return null;
    return output || null;
  }
  const { stderr } = await runCommand(`sudo wg-quick down ${tunnelName}`);
  return stderr || null;
}

async function connectOpenVpn(profileId: string): Promise<string | null> {
  const exe = isWindows
    ? '& "C:\\Program Files\\OpenVPN Connect\\OpenVPNConnect.exe"'
    : 'open -a "OpenVPN Connect" --args';
  const { stderr } = await runCommand(`${exe} --connect-shortcut=${profileId} 2>&1`);
  return stderr || null;
}

async function disconnectOpenVpn(): Promise<string | null> {
  const exe = isWindows
    ? '& "C:\\Program Files\\OpenVPN Connect\\OpenVPNConnect.exe"'
    : 'open -a "OpenVPN Connect" --args';
  const { stderr } = await runCommand(`${exe} --disconnect-shortcut 2>&1`);
  return stderr || null;
}

async function connectAzure(connectionName: string): Promise<string | null> {
  if (isWindows) {
    // Use ms-azurevpn: URI scheme — works with UWP Azure VPN Client
    const { stderr } = await runCommand(`Start-Process "ms-azurevpn:connect?name=${connectionName}"`);
    return stderr || null;
  }
  return 'Azure VPN CLI not supported on macOS — use the app directly';
}

async function disconnectAzure(connectionName: string): Promise<string | null> {
  if (isWindows) {
    const { stderr } = await runCommand(`Start-Process "ms-azurevpn:disconnect?name=${connectionName}"`);
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

  if (error) logger.error({ profileId, error }, 'VPN connect failed');

  // Wait for connection to establish
  await new Promise((r) => setTimeout(r, 3000));
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

  if (error) logger.error({ profileId, error }, 'VPN disconnect failed');

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
