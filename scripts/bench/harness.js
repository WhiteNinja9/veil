// Runs the real inference worker in a page so it can be measured headlessly.
function waitFor(worker, predicate, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('harness timeout')), timeoutMs);
    const onMessage = (event) => {
      if (predicate(event.data)) {
        clearTimeout(timer);
        worker.removeEventListener('message', onMessage);
        resolve(event.data);
      }
    };
    worker.addEventListener('message', onMessage);
  });
}

function config(backend, testModel) {
  return {
    modelBaseUrl: `${location.origin}/models/`,
    wasmBaseUrl: `${location.origin}/wasm/`,
    backend,
    testModel,
    animatedFrames: 3,
  };
}

window.runEngine = async ({ backend, images, signals, testModel = false, repeat = 1 }) => {
  const worker = new Worker('/engine-worker.js');
  const initStart = performance.now();
  worker.postMessage({ type: 'init', config: config(backend, testModel) });
  const ready = await waitFor(worker, (m) => m.type === 'ready' || m.type === 'fatal');
  const initMs = performance.now() - initStart;
  const results = [];
  for (let r = 0; r < repeat; r++) {
    for (const name of images) {
      const blob = await (await fetch(`/eval/${name}`)).blob();
      const id = `${name}#${r}`;
      const started = performance.now();
      worker.postMessage({ type: 'detect', job: { id, key: id, blob, signals, priority: 0, retainForRender: false } });
      const message = await waitFor(worker, (m) => m.type === 'detected' && m.id === id);
      results.push({ name, round: r, wallMs: performance.now() - started, ...message });
    }
  }
  // Concurrent burst: measures cross-request batching.
  const burstStart = performance.now();
  const burst = await Promise.all(
    images.map(async (name, i) => {
      const blob = await (await fetch(`/eval/${name}`)).blob();
      const id = `burst-${i}`;
      worker.postMessage({ type: 'detect', job: { id, key: id, blob, signals, priority: 0, retainForRender: false } });
      return waitFor(worker, (m) => m.type === 'detected' && m.id === id);
    }),
  );
  const burstMs = performance.now() - burstStart;
  worker.postMessage({ type: 'status', requestId: 'status' });
  const status = await waitFor(worker, (m) => m.type === 'status');
  worker.terminate();
  return { ready, initMs, results, burst: { count: burst.length, totalMs: burstMs }, status: status.status };
};

window.runBenchmark = async ({ backends, iterations, testModel = false }) => {
  const worker = new Worker('/engine-worker.js');
  worker.postMessage({ type: 'benchmark', requestId: 'bench', config: config('auto', testModel), backends, iterations });
  const message = await waitFor(worker, (m) => m.type === 'benchmark', 300000);
  worker.terminate();
  return message.results;
};

window.harnessReady = true;
