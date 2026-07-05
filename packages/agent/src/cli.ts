#!/usr/bin/env node
// `crc-agent` entry point. Dispatches subcommands before the agent boots:
//   crc-agent setup [--token <t>]  -> enrollment flow (setup.ts)
//   crc-agent                      -> start the agent (index.ts)
// setup.ts and index.ts both run on import, so dispatching is just picking
// which module to load. Kept separate from index.ts so `crc-agent setup` never
// drags in socket/pty code paths before enrollment.
const cmd = process.argv[2];

if (cmd === 'setup') {
  // Drop the subcommand so setup's own arg parsing sees only its flags.
  process.argv.splice(2, 1);
  import('./setup.js');
} else if (cmd === '--help' || cmd === '-h') {
  console.log(
    [
      'Usage: crc-agent [setup [--token <token>]]',
      '',
      'Run with no arguments to start the agent.',
      'Enroll this machine first with: crc-agent setup --help',
    ].join('\n')
  );
} else {
  import('./index.js');
}
