import path from 'path';
import { Service } from 'node-windows';

const scriptPath = path.resolve(__dirname, 'index.js');

const svc = new Service({
  name: 'CRC Agent',
  description: 'Claude Remote Controller Agent — connects to cloud server for remote terminal access',
  script: scriptPath,
  env: [
    {
      name: 'NODE_ENV',
      value: 'production',
    },
  ],
});

svc.on('install', () => {
  console.log('Service installed. Starting...');
  svc.start();
});

svc.on('start', () => {
  console.log('Service started successfully.');
  console.log('The agent will now run on startup automatically.');
});

svc.on('alreadyinstalled', () => {
  console.log('Service is already installed. Starting...');
  svc.start();
});

svc.on('error', (err: unknown) => {
  console.error('Service error:', err);
});

console.log(`Installing CRC Agent service...`);
console.log(`Script: ${scriptPath}`);
svc.install();
