import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

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

export default defineConfig({
  plugins: [react(), coopCoepPlugin()],
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
