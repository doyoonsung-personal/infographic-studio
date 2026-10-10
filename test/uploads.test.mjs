// Owner photo uploads (brief + print looks) and the KV write savings in the job flow.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeBrief } from '../routine/lib/brief.mjs';
import { applyLook, plainKey } from '../public/js/cutout.js';
import { workerFile, workerComplete, workerStatus, fileBlobId } from '../server/jobs.js';

/** In-memory stand-in for the STUDIO_KV binding that counts writes. */
function fakeKV() {
  const m = new Map();
  const kv = {
    writes: 0,
    async get(key, type) { const e = m.get(key); if (!e) return null; return type === 'json' ? JSON.parse(e.value) : e.value; },
    async put(key, value, opts) {
      kv.writes++;
      if (value && typeof value.getReader === 'function') value = await new Response(value).arrayBuffer();
      m.set(key, { value, metadata: opts && opts.metadata });
    },
    async delete(key) { m.delete(key); },
    async list({ prefix = '' } = {}) {
      return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name, metadata: m.get(name).metadata })), list_complete: true };
    },
  };
  return kv;
}

const project = (items) => ({
  id: 'p_1', brief: { topic: 'T', format: 'animated', ratio: '16:9', language: 'ko' },
  facts: { items: [] }, script: { scenes: [{ id: 's1', title: 'A', narration: 'x' }] },
  style: { look: 'default' }, assets: { style: 'halftone', items },
});
const tl = { scenes: [{ id: 's1', start: 0, len: 5 }], duration: 5, width: 1920, height: 1080, fps: 30, static: false };

test('brief marks the owner\'s photos and says how to treat them', () => {
  const md = writeBrief({
    job: { id: 'j_1', kind: 'build' },
    project: project([
      { id: 'a_gen', sceneId: 's1', name: 'cup', subject: 'a coffee cup', blobId: 'b_1', w: 600, h: 600 },
      { id: 'a_me', sceneId: 's1', name: '대표', subject: 'CEO portrait', blobId: 'b_2', w: 800, h: 1000, upload: { blobId: 'b_o', mode: 'person', look: 'none' } },
      { id: 'a_box', sceneId: 's1', name: 'box', subject: '', blobId: 'b_3', w: 1200, h: 800, upload: { blobId: 'b_o2', mode: 'photo', look: 'none' } },
    ]),
    timeline: tl, hasPrevious: false,
  });
  assert.match(md, /\| a_gen \| s1 \| cup — a coffee cup \|/);
  assert.match(md, /\| a_me \| s1 \| \*\*owner's photo, cut out\*\* — 대표 — CEO portrait \|/);
  assert.match(md, /\| a_box \| s1 \| \*\*owner's photo, rectangular\*\* — box \|/);
  assert.match(md, /never cover a face/);
  assert.match(md, /rectangular ones are framed photos/);
});

test('brief has no owner-photo notes when every cut-out is generated', () => {
  const md = writeBrief({ job: { id: 'j_1', kind: 'build' }, project: project([{ id: 'a_gen', sceneId: 's1', name: 'cup', subject: 'cup', blobId: 'b_1' }]), timeline: tl, hasPrevious: false });
  assert.doesNotMatch(md, /owner's photo/);
});

test('applyLook leaves transparent pixels alone and prints the rest', () => {
  const px = new Uint8ClampedArray([200, 40, 40, 255, 10, 200, 10, 0]);
  const half = px.slice();
  applyLook(half, 2, 1, 'halftone');
  assert.deepEqual([...half.slice(4)], [10, 200, 10, 0]);            // transparent pixel untouched
  assert.ok(Math.abs(half[0] - half[1]) < 12 && Math.abs(half[1] - half[2]) < 14); // ink on paper: (near) grey
  const faded = px.slice();
  applyLook(faded, 2, 1, 'faded');
  assert.ok(faded[0] < 200 && faded[1] > 40);                        // softer, less saturated
  const none = px.slice();
  applyLook(none, 2, 1, 'none');
  assert.deepEqual([...none], [...px]);
});

/** W×H RGBA image filled by fn(x, y) -> [r, g, b]. */
function image(W, H, fn) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; [data[i], data[i + 1], data[i + 2]] = fn(x, y); data[i + 3] = 255; }
  return data;
}

test('object cut-out keys a plain background away but keeps light parts and enclosed labels', () => {
  const W = 80, H = 60;
  const noise = (x, y) => ((x * 7 + y * 13) % 5) - 2;
  // off-white backdrop with JPEG-ish noise; a light grey bottle (215) with a white label (250) inside
  const data = image(W, H, (x, y) => {
    if (x >= 30 && x < 50 && y >= 10 && y < 55) {
      if (x >= 34 && x < 46 && y >= 25 && y < 35) return [250, 250, 250];
      return [215, 213, 210];
    }
    const v = 246 + noise(x, y);
    return [v, v - 1, v - 3];
  });
  const { mask, ok, plain } = plainKey(data, W, H);
  const at = (x, y) => mask[y * W + x];
  assert.ok(ok && plain > 0.95, 'plain backdrop recognised');
  assert.equal(at(5, 5), 0, 'backdrop removed');
  assert.equal(at(70, 50), 0, 'backdrop removed');
  assert.equal(at(40, 15), 255, 'light grey bottle kept');
  assert.equal(at(40, 30), 255, 'white label inside the bottle kept');
});

test('object cut-out reports a busy background', () => {
  const data = image(60, 40, (x, y) => [(x * 37) % 256, (y * 53) % 256, ((x + y) * 29) % 256]);
  assert.equal(plainKey(data, 60, 40).ok, false);
  // dark, blurry scene: the border is "one colour" (dark) but the inside is soft light blobs
  const W = 90, H = 60;
  const bar = image(W, H, (x, y) => {
    const glow = Math.max(0, 1 - Math.hypot(x - 20, y - 20) / 22) + Math.max(0, 1 - Math.hypot(x - 70, y - 35) / 25);
    const v = 18 + Math.min(1, glow) * 200;
    return [v, v * 0.8, v * 0.5];
  });
  assert.equal(plainKey(bar, W, H).ok, false);
});

test('build files go under fixed ids and the job record is written once at the end', async () => {
  const kv = fakeKV();
  const env = { STUDIO_KV: kv };
  const now = Date.now();
  const job = { id: 'j_abc-1', kind: 'build', projectId: 'p_1', status: 'running', stage: 'rendering', log: [], files: {}, createdAt: now, updatedAt: now };
  const file = (name, body) => workerFile(env, job, name, new Request('http://x/', { method: 'PUT', body, headers: { 'content-length': String(body.length) } }));
  const r1 = await file('composition.html', '<div></div>');
  const r2 = await file('video.mp4', 'mp4bytes');
  assert.equal(r1.blobId, fileBlobId('j_abc-1', 'composition.html'));
  assert.equal(r2.blobId, 'b_j_abc-1_video_mp4');
  assert.equal(kv.writes, 2, 'one write per file, no job rewrite');
  const done = await workerComplete(env, job, { duration: 5 });
  assert.equal(done.version.v, 1);
  assert.deepEqual(done.version.files, { 'composition.html': r1.blobId, 'video.mp4': r2.blobId });
  assert.equal(kv.writes, 4, 'versions + job');
});

test('progress lines within a stage are thinned out; stage changes always save', async () => {
  const kv = fakeKV();
  const env = { STUDIO_KV: kv };
  const job = { id: 'j_s', kind: 'build', status: 'running', stage: 'rendering', log: [], files: {}, createdAt: Date.now(), updatedAt: Date.now() };
  await workerStatus(env, job, { message: 'Rendering… 20%', stage: 'rendering' });
  assert.equal(kv.writes, 0, 'same stage within 30 s: not stored');
  await workerStatus(env, job, { message: 'Uploading results', stage: 'uploading' });
  assert.equal(kv.writes, 1, 'new stage: stored');
  job.updatedAt = Date.now() - 31000;
  await workerStatus(env, job, { message: 'still uploading', stage: 'uploading' });
  assert.equal(kv.writes, 2, 'same stage after 30 s: stored');
});
