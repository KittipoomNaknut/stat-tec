import { fileURLToPath } from 'node:url';
import { defineConfig, searchForWorkspaceRoot, type Plugin } from 'vite';

/** The story lives in ../content (shared with docs and tooling), outside the app root. */
const contentDir = fileURLToPath(new URL('../content', import.meta.url));

/**
 * Vite does not watch files outside the root, so an edited story kept being served stale
 * (`?raw` import) until the dev server restarted. Watch content/ and reload on change.
 */
function contentReload(): Plugin {
  return {
    name: 'stat-tec-content-reload',
    configureServer(server) {
      server.watcher.add(contentDir);
      server.watcher.on('change', (file) => {
        if (!file.startsWith(contentDir)) return;
        server.moduleGraph.invalidateAll();
        server.ws.send({ type: 'full-reload' });
      });
    },
  };
}

export default defineConfig({
  plugins: [contentReload()],
  server: {
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd()), contentDir],
    },
  },
  worker: {
    format: 'es',
  },
});
