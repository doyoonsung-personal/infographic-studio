// Person cut-outs for uploaded photos, run off the main thread. Only a transparency mask is computed,
// so the photo keeps its own pixels (an image model redrawing it would change the face).
// The library and model load from the network on first use; the browser caches them afterwards.
// Runs on the CPU (WASM): on WebGPU the same model returned a broken matte on an Intel Arc laptop, and
// at 512×512 the CPU takes only a few seconds. (A general object model, BiRefNet, was tried and dropped:
// it needs a 1024×1024 input that runs out of WASM memory and exceeds common GPUs' shader limits.)

const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';
// portrait matting, Apache-2.0, 25 MB
const MODEL = { id: 'Xenova/modnet', input: 'input', output: 'output' };

let loading = null;

function load(report) {
  if (!loading) {
    loading = (async () => {
      const lib = await import(LIB);
      const progress_callback = (p) => { if (p && p.status === 'progress' && p.total) report(p.file, p.loaded, p.total); };
      const [model, processor] = await Promise.all([
        lib.AutoModel.from_pretrained(MODEL.id, { device: 'wasm', dtype: 'fp32', progress_callback }),
        lib.AutoProcessor.from_pretrained(MODEL.id),
      ]);
      return { lib, model, processor };
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}

self.onmessage = async (e) => {
  const { id, blob } = e.data;
  try {
    const { lib, model, processor } = await load((file, done, total) => self.postMessage({ id, progress: { file, done, total } }));
    self.postMessage({ id, stage: 'running' });
    const image = await lib.RawImage.fromBlob(blob);
    const { pixel_values } = await processor(image);
    const out = await model({ [MODEL.input]: pixel_values });
    const t = out[MODEL.output];
    const [h, w] = t.dims.slice(-2);
    const mask = new Uint8ClampedArray(w * h);
    for (let i = 0; i < mask.length; i++) mask[i] = t.data[i] * 255;
    self.postMessage({ id, mask, width: w, height: h }, [mask.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
