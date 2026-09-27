/**
 * Execution backend selection for TensorFlow.js.
 *
 * Order of preference: WebGPU → WebGL (hardware only) → WASM (SIMD) → CPU.
 * Each candidate must initialise *and* pass a numeric smoke test before it
 * is accepted, so a driver that "works" but returns garbage is skipped.
 * A software-rasterised WebGL context or CPU-emulated WebGPU adapter
 * (SwiftShader, llvmpipe, WARP) is far slower than WASM SIMD, so it is
 * tried only after WASM, though still before the plain-JS CPU backend.
 * See docs/BENCHMARKS.md.
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
  // Extension pages can expose SharedArrayBuffer, which makes TF.js choose the
  // multithreaded build; its pthread workers are created from blob: URLs that
  // the extension CSP (rightly) forbids, crashing the worker. Single-threaded
  // SIMD it is.
  tf.env().set('WASM_HAS_MULTITHREAD_SUPPORT', false);
  // Binaries are packaged with the extension and never fetched from a CDN.
  // Only the SIMD and baseline builds ship; the threaded one is unreachable.
  setWasmPaths(baseUrl);
  wasmConfigured = true;
}

/** Renderer string of a WebGL context, used to detect software rasterisers. */
export function webglRenderer(): string {
  try {
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : null;
    const gl = canvas?.getContext('webgl2') as WebGL2RenderingContext | null;
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(
      ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    );
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

/**
 * Asks for a WebGPU adapter with a deadline. On some headless/virtualised
 * systems requestAdapter() never settles; TF.js would then wait forever.
 */
export async function probeWebGpu(timeoutMs = 2500): Promise<GpuAdapterSummary | null> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return null;
  try {
    const adapter = (await Promise.race([
      gpu.requestAdapter(),
      new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
    ])) as WebGpuAdapterLike | null;
    if (!adapter) return null;
    const info = adapter.info ?? {};
    const description = [info.vendor, info.architecture, info.device, info.description]
      .filter(Boolean)
      .join(' ')
      .trim();
    return {
      description: description || 'WebGPU',
      software:
        Boolean(adapter.isFallbackAdapter || info.isFallbackAdapter) || isSoftwareRenderer(description),
    };
  } catch {
    return null;
  }
}

interface WebGpuAdapterLike {
  isFallbackAdapter?: boolean;
  info?: {
    vendor?: string;
    architecture?: string;
    device?: string;
    description?: string;
    isFallbackAdapter?: boolean;
  };
}

export interface GpuAdapterSummary {
  description: string;
  /** A CPU-emulated adapter (e.g. SwiftShader): slower than WASM SIMD. */
  software: boolean;
}

/**
 * Pre-flight for GPU backends: why to skip one, and whether it is merely
 * software (deferred behind WASM) rather than absent.
 */
async function gpuPreflight(name: HardwareBackend): Promise<{ reason: string; defer: boolean } | null> {
  if (name === 'webgl') {
    const renderer = webglRenderer();
    if (!renderer) return { reason: 'WebGL2 unavailable', defer: false };
    if (isSoftwareRenderer(renderer)) {
      return { reason: `software renderer (${renderer.slice(0, 60)})`, defer: true };
    }
  }
  if (name === 'webgpu') {
    const adapter = await probeWebGpu();
    if (!adapter) return { reason: 'no WebGPU adapter', defer: false };
    if (adapter.software)
      return { reason: `software adapter (${adapter.description.slice(0, 60)})`, defer: true };
  }
  return null;
}

const INIT_TIMEOUT_MS = 10_000;

async function tryBackend(name: HardwareBackend, probed = false): Promise<string | null> {
  if (name === 'webgpu' && !probed && !(await probeWebGpu())) return 'no WebGPU adapter';
  return Promise.race([
    tryBackendUnbounded(name),
    new Promise<string>((resolve) => setTimeout(() => resolve('initialisation timed out'), INIT_TIMEOUT_MS)),
  ]);
}

async function tryBackendUnbounded(name: HardwareBackend): Promise<string | null> {
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
 * With `allowSoftwareGpu` false, a software WebGL or WebGPU implementation
 * is deferred behind WASM (and CPU is still the very last resort).
 */
export async function selectBackend(
  candidates: readonly HardwareBackend[],
  options: { wasmBaseUrl: string; allowSoftwareGpu?: boolean; onAttempt?: (name: HardwareBackend) => void },
): Promise<BackendSelection> {
  configureWasm(options.wasmBaseUrl);
  const skipped: BackendSelection['skipped'] = [];
  const started = performance.now();
  const deferred: HardwareBackend[] = [];
  const tried = new Set<HardwareBackend>();
  const attempt = async (name: HardwareBackend, probed: boolean) => {
    tried.add(name);
    options.onAttempt?.(name);
    const failure = await tryBackend(name, probed);
    if (failure) skipped.push({ name, reason: failure });
    return failure === null;
  };
  const selected = (name: HardwareBackend): BackendSelection => ({
    name,
    detail: describe(name),
    initMs: performance.now() - started,
    skipped,
  });

  for (const name of candidates) {
    // Plain JS waits until deferred software GPUs have had their turn.
    if (name === 'cpu' && deferred.length) continue;
    let probed = false;
    if (!options.allowSoftwareGpu && (name === 'webgl' || name === 'webgpu')) {
      const preflight = await gpuPreflight(name);
      if (preflight) {
        skipped.push({ name, reason: preflight.reason });
        if (preflight.defer) deferred.push(name);
        continue;
      }
      probed = name === 'webgpu';
    }
    if (await attempt(name, probed)) return selected(name);
  }
  for (const name of [...deferred, 'cpu'] as HardwareBackend[]) {
    if (!candidates.includes(name) || tried.has(name)) continue;
    if (await attempt(name, false)) return selected(name);
  }
  throw new Error(
    `No inference backend available: ${skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}`,
  );
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

/**
 * Jobs per engine batch. GPU backends amortise dispatch and upload costs
 * over a batch. On CPU-bound backends a batch costs the same per image
 * (measured: WASM 89 ms/image in a batch of 4 vs 90 ms alone) but delays
 * every result until the whole batch is done, so jobs run one by one and
 * each image appears as soon as it is decided.
 */
export function preferredBatchSize(backend: HardwareBackend | undefined): number {
  return backend === 'webgl' || backend === 'webgpu' ? 8 : 1;
}

/** Candidate list honouring an explicit preference, then falling back in default order. */
export function candidateOrder(
  preference: HardwareBackend | 'auto',
  profileBest?: HardwareBackend,
  exclude: readonly HardwareBackend[] = [],
): HardwareBackend[] {
  const first = preference !== 'auto' ? preference : profileBest;
  const order = first ? [first, ...BACKEND_ORDER.filter((b) => b !== first)] : [...BACKEND_ORDER];
  const allowed = order.filter((b) => !exclude.includes(b));
  // The CPU backend is always available as the last resort.
  return allowed.length ? allowed : ['cpu'];
}
