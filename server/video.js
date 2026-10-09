// Image-to-video clips via Alibaba Model Studio (HappyHorse / Wan): a scene's background image is
// animated into a short clip that plays behind the composition. Async: start a task, then poll.
// Request shape verified 2026-10-09: input.media [{type:'first_frame', url: data URI}].

import { fail } from './http.js';
import { getJSON, putJSON, putBlob, getBlob, MAX_BLOB } from './store.js';
import { isContentBlock } from './images.js';

export const VIDEO_MODELS = {
  'happyhorse-1.1-i2v': { min: 3, max: 15, res: ['480P', '720P', '1080P'] },
  'wan2.7-i2v': { min: 2, max: 15, res: ['720P', '1080P'] },
};

function base(env) {
  if (!env.DASHSCOPE_API_KEY || !env.DASHSCOPE_BASE_URL) fail(503, 'Model Studio is not configured');
  return env.DASHSCOPE_BASE_URL.replace(/\/+$/, '').replace(/\/compatible-mode\/v1$/, '');
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** POST /api/video { imageBlobId, prompt, model?, resolution?, duration } -> { taskId, model, duration } */
export async function start(env, body, config) {
  const root = base(env);
  const model = VIDEO_MODELS[body.model] ? body.model : (VIDEO_MODELS[config.models.video] ? config.models.video : 'happyhorse-1.1-i2v');
  const spec = VIDEO_MODELS[model];
  const duration = Math.min(spec.max, Math.max(spec.min, Math.round(Number(body.duration) || 5)));
  const resolution = spec.res.includes(body.resolution) ? body.resolution : (spec.res.includes('720P') ? '720P' : spec.res[0]);
  const prompt = String(body.prompt || '').trim().slice(0, 1500);
  if (!prompt) fail(400, 'prompt required');
  const img = await getBlob(env, String(body.imageBlobId || ''));
  if (!img) fail(404, 'image not found');
  if (img.size > 6 * 1024 * 1024) fail(413, 'image too large for a video request');
  const url = `data:${img.type || 'image/jpeg'};base64,${toBase64(img.data)}`;
  const r = await fetch(root + '/api/v1/services/aigc/video-generation/video-synthesis', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.DASHSCOPE_API_KEY, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable' },
    body: JSON.stringify({
      model,
      input: { prompt, media: [{ type: 'first_frame', url }] },
      parameters: { resolution, duration, watermark: false, prompt_extend: false },
    }),
  });
  const text = await r.text();
  let d = {};
  try { d = JSON.parse(text); } catch {}
  if (!r.ok || !d.output || !d.output.task_id) fail(r.status === 429 ? 429 : 502, `Video model ${r.status}: ${(d.message || d.code || text).toString().slice(0, 400)}`);
  return { taskId: d.output.task_id, model, duration, resolution };
}

/** GET /api/video/:taskId -> { status, blobId?, error? }. A finished clip is stored in KV once. */
export async function poll(env, taskId) {
  if (!/^[\w-]{8,80}$/.test(taskId)) fail(400, 'bad task id');
  const done = await getJSON(env, 'vtask:' + taskId);
  if (done) return done;
  const root = base(env);
  const r = await fetch(root + '/api/v1/tasks/' + taskId, { headers: { Authorization: 'Bearer ' + env.DASHSCOPE_API_KEY } });
  const d = await r.json().catch(() => ({}));
  const o = d.output || {};
  const status = o.task_status || (r.ok ? 'UNKNOWN' : 'FAILED');
  if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
    const msg = `${o.code || r.status}: ${o.message || d.message || 'video task failed'}`.slice(0, 400);
    return { status: 'FAILED', error: msg, code: isContentBlock(o, msg) ? 'content_blocked' : undefined };
  }
  if (status !== 'SUCCEEDED') return { status };
  if (!o.video_url) return { status: 'FAILED', error: 'the video model returned no video' };
  const v = await fetch(o.video_url);
  if (!v.ok) fail(502, 'Could not download the generated video (' + v.status + ')');
  const len = Number(v.headers.get('content-length')) || null;
  if (len && len > MAX_BLOB) fail(413, 'video too large');
  const blobId = await putBlob(env, len ? v.body : await v.arrayBuffer(), 'video/mp4', { name: 'clip.mp4', size: len });
  const out = { status: 'SUCCEEDED', blobId, duration: (d.usage && Number(d.usage.duration || d.usage.video_duration)) || null };
  await putJSON(env, 'vtask:' + taskId, out);
  return out;
}
