import { defineConfig, type Plugin } from 'vite';
import { cp } from 'node:fs/promises';
import { createReadStream, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const WORLDS_DIR = resolve(ROOT, 'worlds');
const OUT_DIR = resolve(ROOT, 'dist');

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
 * in dev and copies it into `dist/` on build. No dependency required.
 */
function worldPacks(): Plugin {
  return {
    name: 'mainstreet:world-packs',
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
      await cp(WORLDS_DIR, resolve(OUT_DIR, 'worlds'), { recursive: true });
    }
  };
}

export default defineConfig({
  plugins: [worldPacks()],
  build: { outDir: 'dist', emptyOutDir: true }
});
