#!/usr/bin/env node
// `crc-agent` entry point. Dispatches subcommands before the agent boots:
//   crc-agent setup [--token <t>]  -> enrollment flow (setup.ts)
//   crc-agent --version            -> print the installed version
//   crc-agent                      -> start the agent (index.ts)
// setup.ts and index.ts both run on import, so dispatching is just picking
// which module to load. Kept separate from index.ts so `crc-agent setup` never
// drags in socket/pty code paths before enrollment.
import { createRequire } from 'node:module';

function version(): string {
  try {
    return createRequire(__filename)('../package.json').version || 'unknown';
  } catch {
    return 'unknown';
  }
}

const cmd = process.argv[2];

if (cmd === 'setup') {
  // Drop the subcommand so setup's own arg parsing sees only its flags.
  process.argv.splice(2, 1);
  import('./setup.js');
} else if (cmd === '--version' || cmd === '-v') {
  console.log(version());
} else if (cmd === '--help' || cmd === '-h') {
  console.log(
    [
      `crc-agent ${version()}`,
      '',
      'Usage: crc-agent [command]',
      '',
      'Commands:',
      '  (none)                 Start the agent.',
      '  setup [--token <t>]    Enroll this machine (see: crc-agent setup --help).',
      '  -v, --version          Print the installed version.',
      '  -h, --help             Show this help.',
    ].join('\n')
  );
} else {
  import('./index.js');
}
