import { defineConfig, loadEnv, type Plugin } from 'vite';
import { cp } from 'node:fs/promises';
import { createReadStream, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const WORLDS_DIR = resolve(ROOT, 'worlds');

const MIME: Record<string, string> = {
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.txt': 'text/plain'
};

/**
 * World packs live at `worlds/` (DESIGN.md §2), outside the Vite root's module
 * graph, because they are content rather than code — the engine fetches them at
 * runtime and must never import them. This serves that directory at `/worlds/`
 * in dev and copies it into `<outDir>/worlds` on build. No dependency required.
 *
 * The dev server always serves every world pack (a dev session may switch
 * worlds without a restart). A production build, though, ships one world per
 * site (scripts/build-site.mjs builds each world into its own `dist/<id>/`
 * with `VITE_WORLD=<id>`), so the build only copies that world's pack —
 * otherwise every per-world bundle would carry every other world's assets too.
 */
function worldPacks(worldId: string | undefined): Plugin {
  let outDir = WORLDS_DIR; // placeholder; replaced in configResolved
  return {
    name: 'mainstreet:world-packs',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0]);
        if (!path.startsWith('/worlds/')) return next();

        const file = resolve(WORLDS_DIR, '.' + path.slice('/worlds'.length));
        if (file !== WORLDS_DIR && !file.startsWith(WORLDS_DIR + '/')) {
          res.statusCode = 403;
          res.end('Forbidden');
          return;
        }

        let size: number;
        try {
          const stat = statSync(file);
          if (!stat.isFile()) throw new Error('not a file');
          size = stat.size;
        } catch {
          // Expected for unpainted buildings and missing portraits — the engine
          // treats a 404 here as "use the placeholder".
          res.statusCode = 404;
          res.end('Not found');
          return;
        }

        res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
        res.setHeader('Content-Length', String(size));
        res.setHeader('Cache-Control', 'no-cache');
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        createReadStream(file).pipe(res);
      });
    },
    async closeBundle() {
      const dest = resolve(outDir, 'worlds');
      if (worldId) {
        await cp(resolve(WORLDS_DIR, worldId), resolve(dest, worldId), { recursive: true });
      } else {
        await cp(WORLDS_DIR, dest, { recursive: true });
      }
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ROOT, 'VITE_');
  return {
    plugins: [worldPacks(env.VITE_WORLD)],
    build: { outDir: 'dist', emptyOutDir: true }
  };
});
