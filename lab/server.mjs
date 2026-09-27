#!/usr/bin/env node
/**
 * Veil compatibility lab — representative pages for manual and automated
 * testing. Serves the same content on two origins so cross-origin paths
 * (canvas tainting, CORS, private-network guard) are exercised.
 *
 *   npm run lab              # http://127.0.0.1:4700 and http://localhost:4701
 *
 * Fixture media:
 *   /img/<marker>/<w>x<h>.png[?seed=n][&cors=1][&delay=ms]
 *   /video/<pattern>.webm    pattern: neutral | switch (neutral → explicit after 2 s)
 */
import http from 'node:http';
import { readFile, readdir, mkdir, writeFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { fixturePixels, fixturePng } from './png.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cacheDir = path.join(here, '..', '.cache', 'lab');
const FFMPEG = process.env.VEIL_FFMPEG ?? '/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux';

async function ensureVideo(pattern) {
  const file = path.join(cacheDir, `${pattern}.webm`);
  try {
    await stat(file);
    return file;
  } catch {
    // generate below
  }
  await mkdir(cacheDir, { recursive: true });
  const fps = 10;
  const seconds = 6;
  // JPEG frames concatenated into one MJPEG stream on disk: the minimal
  // ffmpeg bundled with Playwright has neither a PNG decoder nor stdin input.
  const framesFile = path.join(cacheDir, `${pattern}.mjpeg`);
  const frames = [];
  for (let i = 0; i < fps * seconds; i++) {
    const marker = pattern === 'switch' && i >= fps * 2 ? 'explicit' : 'neutral';
    frames.push(
      jpeg.encode({ data: fixturePixels(320, 180, marker, i % 5), width: 320, height: 180 }, 92).data,
    );
  }
  await writeFile(framesFile, Buffer.concat(frames));
  await new Promise((resolve, reject) => {
    const ff = spawn(
      FFMPEG,
      [
        '-y',
        '-f',
        'image2pipe',
        '-c:v',
        'mjpeg',
        '-framerate',
        String(fps),
        '-i',
        framesFile,
        '-c:v',
        'libvpx',
        '-b:v',
        '400k',
        '-pix_fmt',
        'yuv420p',
        '-auto-alt-ref',
        '0',
        file,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let err = '';
    ff.stderr.on('data', (d) => (err += d));
    ff.on('error', reject);
    ff.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${err.slice(-400)}`)),
    );
  });
  return file;
}

function send(res, status, type, body, headers = {}) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers });
  res.end(body);
}

export function createLabServer({ otherOrigin }) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://lab');
    try {
      const img = /^\/img\/(\w+)\/(\d+)x(\d+)\.png$/.exec(url.pathname);
      if (img) {
        const [, marker, w, h] = img;
        const delay = Number(url.searchParams.get('delay') ?? 0);
        if (delay) await new Promise((r) => setTimeout(r, Math.min(delay, 5000)));
        const headers = url.searchParams.get('cors') ? { 'access-control-allow-origin': '*' } : {};
        send(
          res,
          200,
          'image/png',
          fixturePng(
            Math.min(+w, 2000),
            Math.min(+h, 2000),
            marker,
            Number(url.searchParams.get('seed') ?? 0),
          ),
          headers,
        );
        return;
      }
      const video = /^\/video\/(neutral|switch)\.webm$/.exec(url.pathname);
      if (video) {
        const file = await ensureVideo(video[1]);
        const headers = url.searchParams.get('cors') ? { 'access-control-allow-origin': '*' } : {};
        send(res, 200, 'video/webm', await readFile(file), { ...headers, 'accept-ranges': 'none' });
        return;
      }
      // Real-model smoke test: safe sample images fetched by scripts/fetch-eval-images.mjs.
      const evalFile = /^\/eval\/([\w.-]+\.(?:jpe?g|png))$/.exec(url.pathname);
      if (evalFile) {
        const body = await readFile(path.join(here, '..', '.cache', 'eval', evalFile[1]));
        send(res, 200, evalFile[1].endsWith('.png') ? 'image/png' : 'image/jpeg', body);
        return;
      }
      if (url.pathname === '/eval.html') {
        const files = (await readdir(path.join(here, '..', '.cache', 'eval')).catch(() => [])).filter((f) =>
          /\.(jpe?g|png)$/.test(f),
        );
        const cards = files
          .map(
            (f) =>
              `<div class="card"><img id="${f.replace(/\W/g, '-')}" src="/eval/${f}" alt=""><div class="meta">${f}</div></div>`,
          )
          .join('');
        send(
          res,
          200,
          'text/html; charset=utf-8',
          `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Eval</title><link rel="stylesheet" href="/lab.css"></head><body><h1>Evaluation images</h1><div class="grid">${cards}</div></body></html>`,
        );
        return;
      }
      const page = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (!/^[\w-]+\.(html|js|css)$/.test(page)) {
        send(res, 404, 'text/plain', 'not found');
        return;
      }
      let body = await readFile(path.join(here, 'pages', page), 'utf8');
      body = body.replaceAll('__OTHER_ORIGIN__', otherOrigin);
      const type = page.endsWith('.html')
        ? 'text/html; charset=utf-8'
        : page.endsWith('.js')
          ? 'text/javascript'
          : 'text/css';
      send(res, 200, type, body);
    } catch (error) {
      send(res, 500, 'text/plain', String(error));
    }
  });
}

export async function startLab(portA = 4700, portB = 4701) {
  const a = createLabServer({ otherOrigin: `http://localhost:${portB}` });
  const b = createLabServer({ otherOrigin: `http://127.0.0.1:${portA}` });
  await new Promise((r) => a.listen(portA, '127.0.0.1', r));
  await new Promise((r) => b.listen(portB, r));
  return {
    originA: `http://127.0.0.1:${portA}`,
    originB: `http://localhost:${portB}`,
    close: () => Promise.all([new Promise((r) => a.close(r)), new Promise((r) => b.close(r))]),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const lab = await startLab(Number(process.env.LAB_PORT ?? 4700), Number(process.env.LAB_PORT_B ?? 4701));
  console.log(`Veil lab running:\n  ${lab.originA}\n  ${lab.originB} (cross-origin twin)`);
}
