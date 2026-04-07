import path from 'path';
import { Service } from 'node-windows';

const scriptPath = path.resolve(__dirname, 'index.js');

const svc = new Service({
  name: 'CRC Agent',
  script: scriptPath,
});

svc.on('uninstall', () => {
  console.log('Service uninstalled successfully.');
});

svc.on('stop', () => {
  console.log('Service stopped.');
});

console.log('Uninstalling CRC Agent service...');
svc.uninstall();
