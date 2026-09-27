import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// TF.js is replaced by a stub whose backends succeed or fail on demand; the
// smoke test (sum of a 16×16 ones matmul) returns the expected 4096.
const tfState = vi.hoisted(() => ({ working: new Set<string>(), attempts: [] as string[] }));
vi.mock('@tensorflow/tfjs-core', () => {
  const tensor = { data: async () => [16 * 16 * 16], dispose: () => {} };
  return {
    env: () => ({ set: () => {} }),
    setBackend: async (name: string) => {
      tfState.attempts.push(name);
      return tfState.working.has(name);
    },
    ready: async () => {},
    tidy: (fn: () => unknown) => fn(),
    sum: () => tensor,
    matMul: () => tensor,
    ones: () => tensor,
  };
});
vi.mock('@tensorflow/tfjs-backend-cpu', () => ({}));
vi.mock('@tensorflow/tfjs-backend-webgl', () => ({}));
vi.mock('@tensorflow/tfjs-backend-webgpu', () => ({}));
vi.mock('@tensorflow/tfjs-backend-wasm', () => ({ setWasmPaths: () => {} }));

const { candidateOrder, isSoftwareRenderer, probeWebGpu, selectBackend } =
  await import('../../src/ml/backend');

function stubGpu(adapter: object | null) {
  const requestAdapter = vi.fn(async () => adapter);
  vi.stubGlobal('navigator', { gpu: { requestAdapter } });
  return requestAdapter;
}

function stubWebGl(renderer: string | null) {
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      getContext() {
        if (renderer === null) return null;
        return {
          RENDERER: 0x1f01,
          getExtension: (name: string) =>
            name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null,
          getParameter: () => renderer,
        };
      }
    },
  );
}

const HARDWARE_GL = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)';
const SOFTWARE_GL = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)';
const ALL = ['webgpu', 'webgl', 'wasm', 'cpu'] as const;
const options = { wasmBaseUrl: 'chrome-extension://id/wasm/' };

beforeEach(() => {
  tfState.working = new Set();
  tfState.attempts = [];
});
afterEach(() => vi.unstubAllGlobals());

describe('backend selection', () => {
  it('prefers a hardware WebGPU adapter and probes it only once', async () => {
    const requestAdapter = stubGpu({ info: { vendor: 'nvidia', architecture: 'ampere' } });
    stubWebGl(HARDWARE_GL);
    tfState.working = new Set(ALL);
    const selection = await selectBackend(ALL, options);
    expect(selection.name).toBe('webgpu');
    expect(requestAdapter).toHaveBeenCalledTimes(1);
  });

  it('defers software WebGPU and WebGL behind WASM', async () => {
    stubGpu({ info: { vendor: 'google', architecture: 'swiftshader' } });
    stubWebGl(SOFTWARE_GL);
    tfState.working = new Set(ALL);
    const selection = await selectBackend(ALL, options);
    expect(selection.name).toBe('wasm');
    expect(tfState.attempts).toEqual(['wasm']);
    expect(selection.skipped.map((s) => s.reason)).toEqual([
      expect.stringContaining('software adapter'),
      expect.stringContaining('software renderer'),
    ]);
  });

  it('treats fallback adapters as software', async () => {
    expect(await probeWebGpu(50)).toBeNull(); // Node has navigator, but no navigator.gpu
    stubGpu({ isFallbackAdapter: true, info: {} });
    expect(await probeWebGpu()).toMatchObject({ software: true });
    stubGpu({ info: { isFallbackAdapter: true, vendor: 'intel' } });
    expect(await probeWebGpu()).toMatchObject({ software: true });
  });

  it('uses a deferred software GPU before plain-JS CPU when WASM fails', async () => {
    stubGpu({ info: { architecture: 'swiftshader' } });
    stubWebGl(SOFTWARE_GL);
    tfState.working = new Set(['webgpu', 'webgl', 'cpu']);
    const selection = await selectBackend(ALL, options);
    expect(selection.name).toBe('webgpu');
    expect(tfState.attempts).toEqual(['wasm', 'webgpu']);
  });

  it('falls back to CPU last and tries it once', async () => {
    stubGpu(null);
    stubWebGl(null);
    tfState.working = new Set(['cpu']);
    const selection = await selectBackend(ALL, options);
    expect(selection.name).toBe('cpu');
    expect(tfState.attempts).toEqual(['wasm', 'cpu']);
  });

  it('reports every reason when nothing works', async () => {
    stubGpu(null);
    stubWebGl(null);
    await expect(selectBackend(ALL, options)).rejects.toThrow(
      /webgpu \(no WebGPU adapter\).*webgl \(WebGL2 unavailable\).*wasm.*cpu/,
    );
  });

  it('lets the benchmark measure software implementations when asked', async () => {
    stubGpu({ info: { architecture: 'swiftshader' } });
    stubWebGl(SOFTWARE_GL);
    tfState.working = new Set(ALL);
    const selection = await selectBackend(['webgpu'], { ...options, allowSoftwareGpu: true });
    expect(selection.name).toBe('webgpu');
  });

  it('recognises common software rasterisers', () => {
    for (const renderer of [
      SOFTWARE_GL,
      'llvmpipe (LLVM 15.0.7, 256 bits)',
      'Microsoft Basic Render Driver',
    ]) {
      expect(isSoftwareRenderer(renderer)).toBe(true);
    }
    expect(isSoftwareRenderer(HARDWARE_GL)).toBe(false);
  });
});

describe('candidate order', () => {
  it('puts an explicit preference or benchmark winner first and honours exclusions', () => {
    expect(candidateOrder('auto')).toEqual(['webgpu', 'webgl', 'wasm', 'cpu']);
    expect(candidateOrder('auto', 'wasm')).toEqual(['wasm', 'webgpu', 'webgl', 'cpu']);
    expect(candidateOrder('webgl', 'wasm')).toEqual(['webgl', 'webgpu', 'wasm', 'cpu']);
    expect(candidateOrder('auto', undefined, ['webgpu'])).toEqual(['webgl', 'wasm', 'cpu']);
    expect(candidateOrder('auto', undefined, ['webgpu', 'webgl', 'wasm', 'cpu'])).toEqual(['cpu']);
  });
});
