import { defineConfig } from 'tsup';
import path from 'path';

// Build the agent as self-contained CommonJS bundles.
// - @crc/shared is bundled from source (pure types + const values, zero runtime
//   deps) so an external `npm i -g cli-remote-agent` needs no workspace dep.
// - node-pty stays external (native addon; installed as a real dependency).
// - CommonJS is required: service-install.ts relies on __dirname.
export default defineConfig({
  entry: [
    'src/index.ts',
    'src/setup.ts',
    'src/service-install.ts',
    'src/service-uninstall.ts',
  ],
  format: ['cjs'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  shims: false,
  // node-pty is a native module and must be resolved at runtime, not bundled.
  external: ['node-pty'],
  // Bundle the workspace shared package (never treat it as external).
  noExternal: ['@crc/shared'],
  esbuildOptions(options) {
    // Resolve @crc/shared to its TypeScript source so the bundle is
    // self-contained even when packages/shared hasn't been compiled.
    options.alias = {
      ...(options.alias || {}),
      '@crc/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    };
  },
});
