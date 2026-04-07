import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const TASK_NAME = 'CRC Agent';
const regKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

async function uninstall() {
  console.log(`Removing "${TASK_NAME}"...`);

  // Kill running agent processes
  try {
    await execAsync('taskkill /f /fi "WINDOWTITLE eq CRC Agent" 2>nul', { shell: 'cmd.exe' });
  } catch {
    // Not running — fine
  }

  // Also kill node processes running our script
  try {
    const { stdout } = await execAsync('wmic process where "CommandLine like \'%crc%agent%index.js%\'" get ProcessId /format:list', { shell: 'cmd.exe' });
    const pids = stdout.match(/ProcessId=(\d+)/g);
    if (pids) {
      for (const match of pids) {
        const pid = match.split('=')[1];
        try { await execAsync(`taskkill /f /pid ${pid}`, { shell: 'cmd.exe' }); } catch {}
      }
      console.log('Stopped running agent.');
    }
  } catch {
    // No processes found
  }

  // Remove registry entry
  try {
    await execAsync(`reg delete "${regKey}" /v "${TASK_NAME}" /f`);
    console.log('Startup entry removed.');
  } catch (err: any) {
    if (err.stderr?.includes('unable to find')) {
      console.log('Startup entry was not installed.');
    } else {
      console.error('Failed to remove startup entry:', err.stderr || err.message);
    }
  }
}

uninstall();
