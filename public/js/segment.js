// Talks to the person cut-out worker. One worker per page, created on first use.

let worker = null, seq = 0;
const pending = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./segment-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const d = e.data, job = pending.get(d.id);
      if (!job) return;
      if (d.progress || d.stage) { job.onProgress && job.onProgress(d); return; }
      pending.delete(d.id);
      if (d.error) job.reject(new Error(d.error)); else job.resolve(d);
    };
    worker.onerror = (e) => {
      for (const job of pending.values()) job.reject(new Error(e.message || 'background removal failed to load'));
      pending.clear();
      worker = null;
    };
  }
  return worker;
}

/**
 * Person mask for a photo (portrait matting model, 25 MB, downloaded on first use).
 * Resolves { mask: Uint8ClampedArray (0 = background), width, height }; onProgress gets
 * { progress: {file, done, total} } while the model downloads and { stage: 'running' } once it runs.
 */
export function segmentPerson(blob, onProgress) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ id, blob });
  });
}
