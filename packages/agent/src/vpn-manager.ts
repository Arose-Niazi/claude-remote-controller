import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { VpnProfile, VpnStatus } from '@crc/shared';
import type { VpnProfileConfig } from './config.js';
import { logger } from './logger.js';

const execAsync = promisify(exec);
const isWindows = process.platform === 'win32';
const VPN_DIR = path.join(os.homedir(), '.crc-agent', 'vpn');

async function runCmd(cmd: string, shell?: string): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execAsync(cmd, {
      timeout: 20000,
      shell: shell || (isWindows ? 'powershell.exe' : '/bin/sh'),
    });
  } catch (err: any) {
    return { stdout: err.stdout || '', stderr: err.stderr || err.message };
  }
}

function getConfigPath(profile: VpnProfileConfig): string {
  // configFile can be absolute or relative to ~/.crc-agent/vpn/
  const file = profile.configFile || `${profile.id}.conf`;
  if (path.isAbsolute(file)) return file;
  return path.join(VPN_DIR, file);
}

// ========== STATUS ==========

async function getWireGuardStatus(tunnelName: string): Promise<VpnStatus> {
  if (isWindows) {
    const { stdout } = await runCmd(
      `Get-Service -Name 'WireGuardTunnel$$${tunnelName}' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Status`
    );
    const s = stdout.trim();
    if (s === 'Running') return 'connected';
    if (s === 'StartPending') return 'connecting';
    if (s === 'StopPending') return 'disconnecting';
    return 'disconnected';
  }
  const { stdout } = await runCmd(`wg show ${tunnelName} 2>/dev/null`);
  return stdout.trim() ? 'connected' : 'disconnected';
}

async function getOpenVpnStatus(profile: VpnProfileConfig): Promise<VpnStatus> {
  if (isWindows) {
    // Check if ovpnconnector service is running for this profile
    const { stdout } = await runCmd(
      `Get-Service -Name 'ovpnconnector' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Status`
    );
    if (stdout.trim() === 'Running') {
      // Verify it's connected by checking for tun/tap adapter
      const { stdout: netOut } = await runCmd(
        `Get-NetAdapter | Where-Object { $_.InterfaceDescription -like '*OpenVPN*' -and $_.Status -eq 'Up' } | Measure-Object | Select-Object -ExpandProperty Count`
      );
      return parseInt(netOut.trim(), 10) > 0 ? 'connected' : 'connecting';
    }
    return 'disconnected';
  }
  // macOS: check if openvpn process is running
  const { stdout } = await runCmd('pgrep -f "openvpn.*\\.ovpn" | head -1');
  return stdout.trim() ? 'connected' : 'disconnected';
}

async function getStatus(profile: VpnProfileConfig): Promise<VpnStatus> {
  try {
    if (profile.type === 'wireguard') {
      return await getWireGuardStatus(profile.tunnelName || profile.id);
    }
    // Both openvpn and azure use the same ovpnconnector mechanism
    return await getOpenVpnStatus(profile);
  } catch (err: any) {
    logger.error({ profile: profile.id, error: err.message }, 'Status check failed');
    return 'disconnected';
  }
}

// ========== CONNECT ==========

async function connectWireGuard(profile: VpnProfileConfig): Promise<string | null> {
  const tunnelName = profile.tunnelName || profile.id;
  const confPath = getConfigPath(profile);

  if (isWindows) {
    if (!fs.existsSync(confPath)) {
      return `Config file not found: ${confPath}`;
    }
    // Install tunnel service if not exists, then start
    await runCmd(`& 'C:\\Program Files\\WireGuard\\wireguard.exe' /installtunnelservice '${confPath}'`);
    const { stdout, stderr } = await runCmd(`net start WireGuardTunnel$$${tunnelName} 2>&1`, 'cmd.exe');
    const output = stdout + stderr;
    if (output.includes('successfully') || output.includes('already been started')) return null;
    return output.trim() || null;
  }
  // macOS
  const { stderr } = await runCmd(`sudo wg-quick up ${confPath}`);
  return stderr || null;
}

async function connectOpenVpn(profile: VpnProfileConfig): Promise<string | null> {
  const confPath = getConfigPath(profile);
  if (!fs.existsSync(confPath)) {
    return `Config file not found: ${confPath}`;
  }

  if (isWindows) {
    // Use ovpnconnector: set profile path, then start
    const connector = 'C:\\Program Files\\OpenVPN Connect\\ovpnconnector.exe';
    await runCmd(`& '${connector}' stop 2>&1`);
    const { stderr: setErr } = await runCmd(`& '${connector}' set-config profile '${confPath}'`);
    if (setErr && !setErr.includes('success')) {
      return `Failed to set profile: ${setErr}`;
    }
    const { stderr: startErr, stdout } = await runCmd(`& '${connector}' start 2>&1`);
    const output = stdout + startErr;
    if (output.toLowerCase().includes('error')) return output.trim();
    return null;
  }
  // macOS: run openvpn in background
  const { stderr } = await runCmd(`sudo openvpn --config '${confPath}' --daemon`);
  return stderr || null;
}

// ========== DISCONNECT ==========

async function disconnectWireGuard(profile: VpnProfileConfig): Promise<string | null> {
  const tunnelName = profile.tunnelName || profile.id;
  if (isWindows) {
    const { stdout, stderr } = await runCmd(`net stop WireGuardTunnel$$${tunnelName} 2>&1`, 'cmd.exe');
    const output = stdout + stderr;
    if (output.includes('successfully') || output.includes('is not started')) return null;
    return output.trim() || null;
  }
  const confPath = getConfigPath(profile);
  const { stderr } = await runCmd(`sudo wg-quick down ${confPath}`);
  return stderr || null;
}

async function disconnectOpenVpn(profile: VpnProfileConfig): Promise<string | null> {
  if (isWindows) {
    const connector = 'C:\\Program Files\\OpenVPN Connect\\ovpnconnector.exe';
    const { stderr, stdout } = await runCmd(`& '${connector}' stop 2>&1`);
    const output = stdout + stderr;
    if (output.toLowerCase().includes('error')) return output.trim();
    return null;
  }
  // macOS: kill openvpn process
  await runCmd('sudo pkill -f "openvpn.*\\.ovpn"');
  return null;
}

// ========== PUBLIC API ==========

export async function getProfiles(configs: VpnProfileConfig[]): Promise<VpnProfile[]> {
  const profiles: VpnProfile[] = [];
  for (const cfg of configs) {
    const status = await getStatus(cfg);
    profiles.push({ id: cfg.id, name: cfg.name, type: cfg.type, status });
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

  if (cfg.type === 'wireguard') {
    error = await connectWireGuard(cfg);
  } else {
    // openvpn and azure both use .ovpn via ovpnconnector
    error = await connectOpenVpn(cfg);
  }

  if (error) logger.error({ profileId, error }, 'VPN connect failed');

  await new Promise((r) => setTimeout(r, 3000));
  const profiles = await getProfiles(configs);

  if (error) {
    const p = profiles.find((p) => p.id === profileId);
    if (p) { p.status = 'error'; p.error = error.slice(0, 200); }
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

  if (cfg.type === 'wireguard') {
    error = await disconnectWireGuard(cfg);
  } else {
    error = await disconnectOpenVpn(cfg);
  }

  if (error) logger.error({ profileId, error }, 'VPN disconnect failed');

  await new Promise((r) => setTimeout(r, 2000));
  const profiles = await getProfiles(configs);

  if (error) {
    const p = profiles.find((p) => p.id === profileId);
    if (p) { p.status = 'error'; p.error = error.slice(0, 200); }
  }
  return profiles;
}
