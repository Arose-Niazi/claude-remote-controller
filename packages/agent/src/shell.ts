import { execSync } from 'child_process';

export function detectShell(preference: string): string {
  if (preference !== 'auto') return preference;

  if (process.platform === 'win32') {
    // Try PowerShell 7+ first
    try {
      execSync('where pwsh', { stdio: 'ignore' });
      return 'pwsh.exe';
    } catch {
      return 'powershell.exe';
    }
  }

  // macOS / Linux
  return process.env.SHELL || '/bin/bash';
}
