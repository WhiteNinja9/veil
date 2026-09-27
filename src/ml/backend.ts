/**
 * Execution backend selection for TensorFlow.js.
 *
 * Order of preference: WebGPU → WebGL (hardware only) → WASM (SIMD) → CPU.
 * Each candidate must initialise *and* pass a numeric smoke test before it
 * is accepted, so a driver that "works" but returns garbage is skipped.
 * A software-rasterised WebGL context (SwiftShader, llvmpipe, WARP) is
 * slower than WASM SIMD on every machine we measured, so it is only used
 * when nothing else is available. See docs/BENCHMARKS.md.
 */
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-cpu';
import '@tensorflow/tfjs-backend-webgl';
import '@tensorflow/tfjs-backend-webgpu';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import type { BackendName } from './types';

export type HardwareBackend = Exclude<BackendName, 'test'>;
export const BACKEND_ORDER: readonly HardwareBackend[] = ['webgpu', 'webgl', 'wasm', 'cpu'];

export interface BackendSelection {
  name: HardwareBackend;
  /** Human-readable detail, e.g. GPU renderer or "SIMD". */
  detail: string;
  initMs: number;
  skipped: { name: HardwareBackend; reason: string }[];
}

let wasmConfigured = false;

export function configureWasm(baseUrl: string): void {
  if (wasmConfigured) return;
  // Explicit paths for every flavour: never fetched from a CDN.
  setWasmPaths({
    'tfjs-backend-wasm.wasm': `${baseUrl}tfjs-backend-wasm.wasm`,
    'tfjs-backend-wasm-simd.wasm': `${baseUrl}tfjs-backend-wasm-simd.wasm`,
    'tfjs-backend-wasm-threaded-simd.wasm': `${baseUrl}tfjs-backend-wasm-threaded-simd.wasm`,
  });
  wasmConfigured = true;
}

/** Renderer string of a WebGL context, used to detect software rasterisers. */
export function webglRenderer(): string {
  try {
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : null;
    const gl = canvas?.getContext('webgl2') as WebGL2RenderingContext | null;
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return renderer;
  } catch {
    return '';
  }
}

export function isSoftwareRenderer(renderer: string): boolean {
  return /swiftshader|llvmpipe|softpipe|software|basic render driver|microsoft basic/i.test(renderer);
}

async function smokeTest(): Promise<boolean> {
  const result = tf.tidy(() => tf.sum(tf.matMul(tf.ones([16, 16]), tf.ones([16, 16]))));
  const [value] = await result.data();
  result.dispose();
  return value === 16 * 16 * 16;
}

async function tryBackend(name: HardwareBackend): Promise<string | null> {
  if (name === 'webgpu' && !(typeof navigator !== 'undefined' && 'gpu' in navigator)) return 'WebGPU not exposed';
  try {
    const ok = await tf.setBackend(name);
    if (!ok) return 'initialisation failed';
    await tf.ready();
    if (!(await smokeTest())) return 'smoke test failed';
    return null;
  } catch (error) {
    return error instanceof Error ? error.message.slice(0, 120) : 'initialisation threw';
  }
}

/**
 * Selects the first working backend from `candidates`.
 * With `allowSoftwareGl` false, a software WebGL is deferred behind WASM.
 */
export async function selectBackend(
  candidates: readonly HardwareBackend[],
  options: { wasmBaseUrl: string; allowSoftwareGl?: boolean },
): Promise<BackendSelection> {
  configureWasm(options.wasmBaseUrl);
  const skipped: BackendSelection['skipped'] = [];
  const started = performance.now();
  const deferred: HardwareBackend[] = [];

  for (const name of candidates) {
    if (name === 'webgl' && !options.allowSoftwareGl) {
      const renderer = webglRenderer();
      if (!renderer) {
        skipped.push({ name, reason: 'WebGL2 unavailable' });
        continue;
      }
      if (isSoftwareRenderer(renderer)) {
        skipped.push({ name, reason: `software renderer (${renderer.slice(0, 60)})` });
        deferred.push(name);
        continue;
      }
    }
    const failure = await tryBackend(name);
    if (!failure) return { name, detail: describe(name), initMs: performance.now() - started, skipped };
    skipped.push({ name, reason: failure });
  }
  for (const name of deferred) {
    const failure = await tryBackend(name);
    if (!failure) return { name, detail: describe(name), initMs: performance.now() - started, skipped };
  }
  throw new Error(`No inference backend available: ${skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}`);
}

function describe(name: HardwareBackend): string {
  switch (name) {
    case 'webgl': {
      const renderer = webglRenderer();
      return renderer ? renderer.replace(/^ANGLE \((.*)\)$/, '$1').slice(0, 80) : 'WebGL 2';
    }
    case 'wasm':
      return 'WebAssembly SIMD';
    case 'webgpu':
      return 'WebGPU';
    default:
      return 'JavaScript';
  }
}

/** Candidate list honouring an explicit preference, then falling back in default order. */
export function candidateOrder(preference: HardwareBackend | 'auto', profileBest?: HardwareBackend): HardwareBackend[] {
  const first = preference !== 'auto' ? preference : profileBest;
  return first ? [first, ...BACKEND_ORDER.filter((b) => b !== first)] : [...BACKEND_ORDER];
}
