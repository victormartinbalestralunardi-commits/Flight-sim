import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';


/** Chemin de base (ex. « /Flight-sim/ » pour GitHub Pages), « / » par défaut. */
const base = process.env.VITE_BASE ?? '/';

/**
 * En-têtes d'isolation cross-origin : indispensables pour que
 * `SharedArrayBuffer` soit disponible (crossOriginIsolated === true).
 * Si l'hébergeur final ne les envoie pas, le pont physique bascule
 * automatiquement sur `postMessage` + Float64Array transférables.
 */
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function coopCoepPlugin(): Plugin {
  return {
    name: 'aerosim-coop-coep',
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        for (const [k, v] of Object.entries(crossOriginIsolation)) res.setHeader(k, v);
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((_req, res, next) => {
        for (const [k, v] of Object.entries(crossOriginIsolation)) res.setHeader(k, v);
        next();
      });
    },
  };
}

/** Liste récursive des fichiers d'un dossier (chemins relatifs, séparateurs « / »). */
function listFiles(dir: string, root = dir): string[] {
  let out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out = out.concat(listFiles(p, root));
    else out.push(relative(root, p).split('\\').join('/'));
  }
  return out;
}

/**
 * PWA : génère `sw.js` au build avec la liste exacte des fichiers (bundle + public) à pré-cacher
 * et une version dérivée de leur contenu (invalidation automatique du cache à chaque build).
 */
function pwaPlugin(): Plugin {
  return {
    name: 'aerosim-pwa',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const publicFiles = listFiles(join(process.cwd(), 'public')).filter((f) => !f.startsWith('_'));
      const files = ['./', 'index.html', ...Object.keys(bundle).filter((f) => !f.endsWith('.map')), ...publicFiles];
      const hash = createHash('sha256');
      for (const k of Object.keys(bundle).sort()) {
        const item = bundle[k];
        hash.update(k);
        hash.update(item.type === 'chunk' ? item.code : item.source);
      }
      const version = hash.digest('hex').slice(0, 12);
      const tpl = readFileSync(join(process.cwd(), 'pwa/sw-template.js'), 'utf8');
      const source = tpl.replace('__VERSION__', version).replace('__ASSETS__', JSON.stringify([...new Set(files)], null, 2));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  base,
  plugins: [react(), coopCoepPlugin(), pwaPlugin()],
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          pathtracer: ['three-gpu-pathtracer', 'three-mesh-bvh'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
