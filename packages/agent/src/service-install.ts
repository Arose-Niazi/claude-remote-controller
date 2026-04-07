import path from 'path';
import fs from 'fs';
import os from 'os';
import { exec } from 'child_process';

const TASK_NAME = 'CRC Agent';
const nodePath = process.execPath;
const scriptPath = path.resolve(__dirname, 'index.js');

// Build the command that will be stored in the registry
const startupCommand = `powershell -WindowStyle Hidden -Command "& '${nodePath}' '${scriptPath}'"`;

console.log(`Installing "${TASK_NAME}" startup entry...`);
console.log(`Node: ${nodePath}`);
console.log(`Script: ${scriptPath}`);

// Write a .reg file and import it — avoids all cmd.exe quoting issues
const regEscapedCmd = startupCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const regContent = `Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run]
"${TASK_NAME}"="${regEscapedCmd}"
`;

const regFile = path.join(os.tmpdir(), 'crc-agent-startup.reg');
fs.writeFileSync(regFile, regContent, 'utf-8');

try {
  const { execSync } = require('child_process');
  execSync(`reg import "${regFile}"`, { stdio: 'inherit' });
  fs.unlinkSync(regFile);
  console.log('Registry startup entry created.');
} catch (err: any) {
  console.error('Failed to create startup entry.');
  fs.unlinkSync(regFile);
  process.exit(1);
}

// Start the agent now in the background
console.log('Starting agent in background...');
const child = exec(`powershell -WindowStyle Hidden -Command "& '${nodePath}' '${scriptPath}'"`, {
  windowsHide: true,
});
child.unref();

setTimeout(() => {
  console.log('Agent started. It will also start automatically on logon.');
  process.exit(0);
}, 1500);
