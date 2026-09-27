/**
 * Shared by the benchmark (run.mjs) and calibration (../calibrate.mjs):
 * builds the production inference worker and serves it, the models and an
 * image directory from a loopback-only HTTP server for a headless browser.
 */
import http from 'node:http';
import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const cacheDir = path.join(root, '.cache', 'bench');

export const EXTENSION_CSP = "script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; base-uri 'none'";

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
};

export const IMAGE_FILE = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;

export function parseArgs(argv = process.argv.slice(2)) {
  return Object.fromEntries(
    argv.map((arg) => {
      const [key, ...rest] = arg.replace(/^--/, '').split('=');
      return [key, rest.length ? rest.join('=') : true];
    }),
  );
}

/** Bundles the same worker entry the extension ships (production defines). */
export async function buildWorker() {
  await mkdir(cacheDir, { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(root, 'src/ml/worker/index.ts')],
    bundle: true,
    format: 'iife',
    minify: true,
    outfile: path.join(cacheDir, 'engine-worker.js'),
    target: ['chrome116'],
    define: {
      __BROWSER__: '"chrome"',
      __DEV__: 'false',
      __TEST_MODEL__: 'false',
      __VERSION__: '"bench"',
      'process.env.NODE_ENV': '"production"',
    },
    logLevel: 'warning',
  });
}

/**
 * Serves the harness on 127.0.0.1 (never a public interface). Files are only
 * served from inside their route's directory.
 *
 * @param {{ imagesDir: string, csp?: boolean }} options  imagesDir is served at /eval/
 */
export function serve({ imagesDir, csp = false }) {
  const routes = [
    ['/models/', path.join(root, 'assets/models')],
    ['/wasm/', path.join(root, 'node_modules/@tensorflow/tfjs-backend-wasm/dist')],
    ['/eval/', path.resolve(imagesDir)],
  ];
  const fixed = {
    '/': path.join(root, 'scripts/bench/harness.html'),
    '/harness.html': path.join(root, 'scripts/bench/harness.html'),
    '/harness.js': path.join(root, 'scripts/bench/harness.js'),
    '/engine-worker.js': path.join(cacheDir, 'engine-worker.js'),
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let file = fixed[url.pathname];
    if (!file) {
      const route = routes.find(([prefix]) => url.pathname.startsWith(prefix));
      if (route) {
        const candidate = path.resolve(route[1], decodeURIComponent(url.pathname.slice(route[0].length)));
        if (candidate.startsWith(route[1] + path.sep)) file = candidate;
      }
    }
    if (!file) {
      res.writeHead(404).end();
      return;
    }
    try {
      const body = await readFile(file);
      const headers = {
        'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      };
      // --csp reproduces the extension-page policy (manifest content_security_policy).
      if (csp && /\.(html|js)$/.test(file)) headers['content-security-policy'] = EXTENSION_CSP;
      res.writeHead(200, headers).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}
