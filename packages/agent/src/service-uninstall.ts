import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const TASK_NAME = 'CRC Agent';
const regKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

async function uninstall() {
  console.log(`Removing "${TASK_NAME}"...`);

  // Kill node processes running our agent script. taskkill /fi WINDOWTITLE and
  // wmic are unreliable/removed on modern Windows, so query Win32_Process via
  // CIM and match the agent's command line (built or source index.js path).
  try {
    const psScript = [
      "$procs = Get-CimInstance Win32_Process |",
      "  Where-Object {",
      "    $_.Name -match 'node' -and $_.CommandLine -and",
      "    $_.CommandLine -match 'index\\.js' -and",
      "    ($_.CommandLine -match 'packages[\\\\/]agent' -or $_.CommandLine -match '[\\\\/]agent[\\\\/](dist|src)[\\\\/]index\\.js')",
      "  };",
      "foreach ($p in $procs) {",
      "  try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; Write-Output $p.ProcessId }",
      "  catch { Write-Error $_ }",
      "}",
    ].join(' ');
    const { stdout } = await execAsync(
      `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${psScript.replace(/"/g, '\\"')}"`,
      { shell: 'powershell.exe' }
    );
    const killed = stdout.trim();
    if (killed) {
      console.log('Stopped running agent.');
    }
  } catch (err: any) {
    // No matching processes, or kill failed — log and continue with cleanup.
    console.error('Could not stop running agent (it may not be running):', err.stderr || err.message);
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
