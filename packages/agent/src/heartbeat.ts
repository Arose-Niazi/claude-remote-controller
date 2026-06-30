import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import type { HeartbeatPayload } from '@crc/shared';
import { getActiveSessionCount } from './terminal-manager.js';

// Previous { idle, total } CPU tick sample, used to compute usage as a delta
// between calls. os.cpus() reports cumulative-since-boot times, so summing
// them once yields a flat near-idle figure; the delta reflects recent load.
let prevCpu: { idle: number; total: number } | null = null;

function getCpuUsage(): number {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    for (const type of Object.values(cpu.times)) {
      total += type;
    }
    idle += cpu.times.idle;
  }

  const prev = prevCpu;
  prevCpu = { idle, total };

  if (!prev) return 0; // first sample has no baseline to diff against

  const idleDelta = idle - prev.idle;
  const totalDelta = total - prev.total;
  if (totalDelta <= 0) return 0;

  return Math.round((1 - idleDelta / totalDelta) * 100);
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
    platform: process.platform as 'win32' | 'darwin' | 'linux',
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
