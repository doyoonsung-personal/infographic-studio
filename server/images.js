// Background images via Alibaba Model Studio (Qwen-Image family), same request shape as the WonderClip demo.

import { fail } from './http.js';
import { putBlob, MAX_BLOB } from './store.js';

export const IMAGE_MODELS = ['qwen-image-3.0', 'qwen-image-3.0-pro', 'qwen-image-max', 'qwen-image-plus', 'z-image-turbo', 'wan2.7-image'];
// Close to each stage ratio, multiples of 16, inside both models' allowed pixel areas.
export const SIZE_FOR_RATIO = { '16:9': '1664*928', '9:16': '928*1664', '1:1': '1328*1328', '4:5': '1104*1376', 'a4': '1088*1536' };

/** A refusal by Model Studio's content moderation ("Green net" / DataInspectionFailed). */
export function isContentBlock(d, msg) {
  return /DataInspectionFailed|IPInfringement/i.test((d && d.code) || '') || /green net|inappropriate content|data inspection/i.test(msg || '');
}

function findImageUrl(d) {
  const content = d && d.output && d.output.choices && d.output.choices[0] && d.output.choices[0].message && d.output.choices[0].message.content;
  if (Array.isArray(content)) { const hit = content.find((c) => c.image); if (hit) return hit.image; }
  return (d && d.output && d.output.results && d.output.results[0] && d.output.results[0].url) || null;
}

/** POST /api/image { prompt, ratio, model? } -> { blobId, model, size } (the image is stored in KV). */
export async function generate(env, body, config) {
  if (!env.DASHSCOPE_API_KEY || !env.DASHSCOPE_BASE_URL) fail(503, 'Model Studio is not configured');
  const prompt = String(body.prompt || '').trim().slice(0, 1800);
  if (!prompt) fail(400, 'prompt required');
  const size = SIZE_FOR_RATIO[body.ratio] || SIZE_FOR_RATIO['16:9'];
  const model = IMAGE_MODELS.includes(body.model) ? body.model : (config.models.image || 'qwen-image-3.0');
  const r = await fetch(env.DASHSCOPE_BASE_URL.replace(/\/+$/, '') + '/api/v1/services/aigc/multimodal-generation/generation', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.DASHSCOPE_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      input: { messages: [{ role: 'user', content: [{ text: prompt }] }] },
      parameters: { size, n: 1, watermark: false, prompt_extend: false },
    }),
  });
  const text = await r.text();
  let d = {};
  try { d = JSON.parse(text); } catch {}
  const msg = (d.message || d.code || text).toString().slice(0, 400);
  // Alibaba's content filter ("Green net") checks the prompt and the finished picture.
  if (isContentBlock(d, msg)) fail(422, `Image model: content filter blocked the ${/output/i.test(msg) ? 'generated picture' : 'prompt'} (${msg})`, { code: 'content_blocked', stage: /output/i.test(msg) ? 'output' : 'input' });
  if (!r.ok) fail(r.status === 429 ? 429 : 502, `Image model ${r.status}: ${msg}`);
  const url = findImageUrl(d);
  if (!url) fail(502, 'The image model returned no image');
  const img = await fetch(url);
  if (!img.ok) fail(502, 'Could not download the generated image (' + img.status + ')');
  const len = Number(img.headers.get('content-length')) || null;
  if (len && len > MAX_BLOB) fail(413, 'image too large');
  const blobId = await putBlob(env, len ? img.body : await img.arrayBuffer(), img.headers.get('content-type') || 'image/png', { name: 'background.png', size: len });
  return { blobId, model, size };
}
