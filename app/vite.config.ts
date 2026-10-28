import { fileURLToPath } from 'node:url';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

export default defineConfig({
  server: {
    fs: {
      // The story lives in ../content (shared with docs and tooling), outside the app root.
      allow: [
        searchForWorkspaceRoot(process.cwd()),
        fileURLToPath(new URL('../content', import.meta.url)),
      ],
    },
  },
  worker: {
    format: 'es',
  },
});
