import { cpSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';

// assets/ sits next to index.html, so the dev server serves it as is. A build copies it into dist, with the
// licences and the credits file, which have to ship with the art.
function copyAssets(): Plugin {
  let outDir = '';
  let command = '';
  return {
    name: 'copy-assets',
    configResolved(config) {
      command = config.command;
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      if (command === 'build') cpSync('assets', join(outDir, 'assets'), { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [copyAssets()],
  // Vite's own files go in bundle/ so they do not mix with the art copied to assets/.
  build: { assetsDir: 'bundle' },
  test: { environment: 'node' },
});
