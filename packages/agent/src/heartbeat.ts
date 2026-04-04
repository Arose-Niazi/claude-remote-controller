import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import type { HeartbeatPayload } from '@crc/shared';
import { getActiveSessionCount } from './terminal-manager.js';

function getCpuUsage(): number {
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;
  for (const cpu of cpus) {
    for (const type of Object.values(cpu.times)) {
      totalTick += type;
    }
    totalIdle += cpu.times.idle;
  }
  return Math.round((1 - totalIdle / totalTick) * 100);
}

function getRootPaths(): string[] {
  if (process.platform === 'win32') {
    try {
      const output = execSync('wmic logicaldisk get name', { encoding: 'utf-8' });
      return output
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => /^[A-Z]:$/.test(l))
        .map((l) => l + '\\');
    } catch {
      return ['C:\\'];
    }
  }
  return ['/'];
}

export function buildHeartbeat(homeDir?: string): HeartbeatPayload {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  return {
    hostname: os.hostname(),
    platform: process.platform as 'win32' | 'darwin',
    arch: os.arch(),
    cpuUsage: getCpuUsage(),
    memoryUsage: Math.round(((totalMem - freeMem) / totalMem) * 100),
    uptime: Math.round(os.uptime()),
    activeSessions: getActiveSessionCount(),
    pathSeparator: path.sep as '\\' | '/',
    homeDirectory: homeDir || os.homedir(),
    rootPaths: getRootPaths(),
    capabilities: { terminal: true, fileTransfer: false },
  };
}
