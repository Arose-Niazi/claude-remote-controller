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

// ========== macOS scutil helpers ==========

async function getScutilStatus(serviceName: string): Promise<VpnStatus> {
  const { stdout } = await runCmd(`scutil --nc status '${serviceName}'`);
  const firstLine = stdout.trim().split('\n')[0];
  if (firstLine === 'Connected') return 'connected';
  if (firstLine === 'Connecting') return 'connecting';
  if (firstLine === 'Disconnecting') return 'disconnecting';
  return 'disconnected';
}

async function scutilStart(serviceName: string): Promise<string | null> {
  const { stderr } = await runCmd(`scutil --nc start '${serviceName}'`);
  return stderr || null;
}

async function scutilStop(serviceName: string): Promise<string | null> {
  const { stderr } = await runCmd(`scutil --nc stop '${serviceName}'`);
  return stderr || null;
}

// ========== STATUS ==========

async function getWireGuardStatus(profile: VpnProfileConfig): Promise<VpnStatus> {
  if (isWindows) {
    const tunnelName = profile.tunnelName || profile.id;
    const { stdout } = await runCmd(
      `Get-Service -Name 'WireGuardTunnel$${tunnelName}' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Status`
    );
    const s = stdout.trim();
    if (s === 'Running') return 'connected';
    if (s === 'StartPending') return 'connecting';
    if (s === 'StopPending') return 'disconnecting';
    return 'disconnected';
  }
  // macOS: use scutil --nc if serviceName is configured
  if (profile.serviceName) {
    return getScutilStatus(profile.serviceName);
  }
  // Fallback: wg-quick CLI
  const tunnelName = profile.tunnelName || profile.id;
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
  // macOS: use scutil --nc if serviceName is configured
  if (profile.serviceName) {
    return getScutilStatus(profile.serviceName);
  }
  // Fallback: check if openvpn process is running
  const { stdout } = await runCmd('pgrep -f "openvpn.*\\.ovpn" | head -1');
  return stdout.trim() ? 'connected' : 'disconnected';
}

async function getAzureStatus(profile: VpnProfileConfig): Promise<VpnStatus> {
  if (isWindows) {
    // Windows: same as OpenVPN (ovpnconnector-based)
    return getOpenVpnStatus(profile);
  }
  // macOS: Azure VPN Client registers as a network extension
  if (profile.serviceName) {
    return getScutilStatus(profile.serviceName);
  }
  return 'disconnected';
}

async function getStatus(profile: VpnProfileConfig): Promise<VpnStatus> {
  try {
    if (profile.type === 'wireguard') {
      return await getWireGuardStatus(profile);
    }
    if (profile.type === 'azure') {
      return await getAzureStatus(profile);
    }
    return await getOpenVpnStatus(profile);
  } catch (err: any) {
    logger.error({ profile: profile.id, error: err.message }, 'Status check failed');
    return 'disconnected';
  }
}

// ========== CONNECT ==========

async function connectWireGuard(profile: VpnProfileConfig): Promise<string | null> {
  const tunnelName = profile.tunnelName || profile.id;

  if (isWindows) {
    const confPath = getConfigPath(profile);
    if (!fs.existsSync(confPath)) {
      return `Config file not found: ${confPath}`;
    }
    // Install tunnel service if not exists, then start
    await runCmd(`& 'C:\\Program Files\\WireGuard\\wireguard.exe' /installtunnelservice '${confPath}'`);
    await new Promise((r) => setTimeout(r, 1000));
    const { stderr } = await runCmd(`Start-Service -Name 'WireGuardTunnel$${tunnelName}' -ErrorAction Stop 2>&1`);
    if (stderr && !stderr.includes('running')) return stderr.trim();
    return null;
  }
  // macOS: use scutil --nc if serviceName is configured
  if (profile.serviceName) {
    return scutilStart(profile.serviceName);
  }
  // Fallback: wg-quick CLI (requires sudo + brew install wireguard-tools)
  const confPath = getConfigPath(profile);
  const { stderr } = await runCmd(`sudo wg-quick up ${confPath}`);
  return stderr || null;
}

async function connectOpenVpn(profile: VpnProfileConfig): Promise<string | null> {
  if (isWindows) {
    const confPath = getConfigPath(profile);
    if (!fs.existsSync(confPath)) {
      return `Config file not found: ${confPath}`;
    }
    const connector = 'C:\\Program Files\\OpenVPN Connect\\ovpnconnector.exe';
    // Kill GUI app if running (conflicts with ovpnconnector)
    await runCmd(`Stop-Process -Name 'OpenVPNConnect' -Force -ErrorAction SilentlyContinue`);
    // Install service if not present
    await runCmd(`& '${connector}' install 2>&1`);
    // Stop any existing connection
    await runCmd(`& '${connector}' stop 2>&1`);
    await new Promise((r) => setTimeout(r, 1000));
    // Set profile and start
    const { stdout: setOut, stderr: setErr } = await runCmd(`& '${connector}' set-config profile '${confPath}' 2>&1`);
    const setOutput = setOut + setErr;
    if (setOutput.toLowerCase().includes('failed')) {
      return `Failed to set profile: ${setOutput.trim()}`;
    }
    const { stdout: startOut, stderr: startErr } = await runCmd(`& '${connector}' start 2>&1`);
    const startOutput = startOut + startErr;
    if (startOutput.toLowerCase().includes('error') || startOutput.toLowerCase().includes('aborting')) {
      return startOutput.trim();
    }
    return null;
  }
  // macOS: use scutil --nc if serviceName is configured (OpenVPN Connect app)
  if (profile.serviceName) {
    return scutilStart(profile.serviceName);
  }
  // Fallback: openvpn CLI (requires sudo + brew install openvpn)
  const confPath = getConfigPath(profile);
  if (!fs.existsSync(confPath)) {
    return `Config file not found: ${confPath}`;
  }
  const { stderr } = await runCmd(`sudo openvpn --config '${confPath}' --daemon`);
  return stderr || null;
}

async function connectAzure(profile: VpnProfileConfig): Promise<string | null> {
  if (isWindows) {
    const confPath = getConfigPath(profile);
    if (!fs.existsSync(confPath)) {
      return `Config file not found: ${confPath}`;
    }
    // Import the XML config into Azure VPN Client and open the app
    await runCmd(`& 'AzureVpn.exe' -i '${confPath}' 2>&1`);
    await new Promise((r) => setTimeout(r, 2000));
    await runCmd(`Start-Process 'shell:AppsFolder\\Microsoft.AzureVpn_8wekyb3d8bbwe!App'`);
    return 'Azure VPN app opened — requires Azure AD sign-in to connect';
  }
  // macOS: Azure VPN Client registers as a network extension — use scutil
  if (profile.serviceName) {
    const err = await scutilStart(profile.serviceName);
    if (err) return err;
    // Azure VPN may need the app open for AAD auth if not cached
    await runCmd(`open -a 'Azure VPN Client'`);
    return null;
  }
  return 'Azure VPN: set serviceName in config (from scutil --nc list)';
}

async function disconnectAzure(profile: VpnProfileConfig): Promise<string | null> {
  if (isWindows) {
    await runCmd(`Start-Process 'shell:AppsFolder\\Microsoft.AzureVpn_8wekyb3d8bbwe!App'`);
    return 'Azure VPN app opened — disconnect from the app';
  }
  // macOS: use scutil to disconnect
  if (profile.serviceName) {
    return scutilStop(profile.serviceName);
  }
  return 'Azure VPN: set serviceName in config (from scutil --nc list)';
}

// ========== DISCONNECT ==========

async function disconnectWireGuard(profile: VpnProfileConfig): Promise<string | null> {
  const tunnelName = profile.tunnelName || profile.id;
  if (isWindows) {
    const { stderr } = await runCmd(`Stop-Service -Name 'WireGuardTunnel$${tunnelName}' -Force -ErrorAction Stop 2>&1`);
    if (stderr && !stderr.includes('running') && !stderr.includes('stopped')) return stderr.trim();
    return null;
  }
  // macOS: use scutil --nc if serviceName is configured
  if (profile.serviceName) {
    return scutilStop(profile.serviceName);
  }
  // Fallback: wg-quick CLI
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
  // macOS: use scutil --nc if serviceName is configured
  if (profile.serviceName) {
    return scutilStop(profile.serviceName);
  }
  // Fallback: kill openvpn process
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
  } else if (cfg.type === 'azure') {
    error = await connectAzure(cfg);
  } else {
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
  } else if (cfg.type === 'azure') {
    error = await disconnectAzure(cfg);
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
