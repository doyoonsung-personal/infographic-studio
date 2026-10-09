// ElevenLabs: narration with character timings, instrumental music, and the account's voice list.

import { fail } from './http.js';
import { putBlob, MAX_BLOB } from './store.js';
import { TTS_MODELS, MUSIC_MODELS } from './config.js';

const API = 'https://api.elevenlabs.io';

function key(env) {
  if (!env.ELEVENLABS_API_KEY) fail(503, 'ElevenLabs is not configured (ELEVENLABS_API_KEY)');
  return env.ELEVENLABS_API_KEY;
}

async function elevenError(r) {
  let detail = '';
  try {
    const j = await r.json();
    detail = typeof j.detail === 'string' ? j.detail : (j.detail && (j.detail.message || JSON.stringify(j.detail))) || JSON.stringify(j);
  } catch { detail = r.statusText; }
  fail(r.status === 429 ? 429 : r.status === 401 ? 401 : 502, 'ElevenLabs ' + r.status + ': ' + String(detail).slice(0, 500));
}

/**
 * POST /api/tts  { text, voiceId, modelId?, speed?, stability?, languageCode?, previousText?, nextText? }
 * -> { blobId, duration, alignment: { chars, starts } }
 */
export async function tts(env, body, config) {
  const text = String(body.text || '').trim();
  if (!text) fail(400, 'text required');
  if (text.length > 2500) fail(400, 'text too long for one scene (2,500 characters max)');
  const voiceId = String(body.voiceId || '');
  if (!/^[\w-]{6,64}$/.test(voiceId)) fail(400, 'voiceId required');
  const modelId = TTS_MODELS.includes(body.modelId) ? body.modelId : config.models.tts;
  const payload = {
    text,
    model_id: modelId,
    voice_settings: {
      stability: clamp(body.stability, 0, 1, 0.5),
      similarity_boost: 0.75,
      style: clamp(body.style, 0, 1, 0),
      use_speaker_boost: true,
      speed: clamp(body.speed, 0.7, 1.2, 1),
    },
  };
  if (body.languageCode && modelId !== 'eleven_multilingual_v2') payload.language_code = String(body.languageCode).slice(0, 5);
  if (body.previousText) payload.previous_text = String(body.previousText).slice(0, 1000);
  if (body.nextText) payload.next_text = String(body.nextText).slice(0, 1000);

  const r = await fetch(`${API}/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key(env), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) await elevenError(r);
  const j = await r.json();
  const bin = atob(j.audio_base64 || '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blobId = await putBlob(env, bytes, 'audio/mpeg', { name: 'narration.mp3' });
  const al = j.alignment || j.normalized_alignment || { characters: [], character_start_times_seconds: [], character_end_times_seconds: [] };
  const ends = al.character_end_times_seconds || [];
  const duration = ends.length ? ends[ends.length - 1] : Math.max(1, bytes.length / 16000);
  return {
    blobId,
    duration: +duration.toFixed(3),
    modelId,
    alignment: {
      chars: al.characters || [],
      starts: (al.character_start_times_seconds || []).map((x) => +(+x).toFixed(3)),
    },
  };
}

/** POST /api/music { prompt, lengthMs, modelId? } -> { blobId, duration } */
export async function music(env, body, config) {
  const prompt = String(body.prompt || '').trim().slice(0, 2000);
  if (!prompt) fail(400, 'prompt required');
  const lengthMs = Math.round(Math.min(300000, Math.max(3000, Number(body.lengthMs) || 30000)));
  const modelId = MUSIC_MODELS.includes(body.modelId) ? body.modelId : config.models.music;
  const r = await fetch(`${API}/v1/music?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, music_length_ms: lengthMs, model_id: modelId, force_instrumental: true }),
  });
  if (!r.ok) await elevenError(r);
  const len = Number(r.headers.get('content-length')) || null;
  if (len && len > MAX_BLOB) fail(413, 'music file too large');
  const body2 = len ? r.body : await r.arrayBuffer();
  const blobId = await putBlob(env, body2, r.headers.get('content-type') || 'audio/mpeg', { name: 'music.mp3', size: len });
  return { blobId, duration: lengthMs / 1000, modelId };
}

/** GET /api/eleven/voices -> the voices in the owner's ElevenLabs account. */
export async function voices(env) {
  const out = [];
  let token = null;
  for (let page = 0; page < 5; page++) {
    const u = new URL(`${API}/v2/voices`);
    u.searchParams.set('page_size', '100');
    if (token) u.searchParams.set('next_page_token', token);
    const r = await fetch(u, { headers: { 'xi-api-key': key(env) } });
    if (!r.ok) await elevenError(r);
    const j = await r.json();
    for (const v of j.voices || []) {
      const labels = v.labels || {};
      const langs = (v.verified_languages || []).map((l) => l.language).filter(Boolean);
      out.push({
        voiceId: v.voice_id,
        name: v.name,
        category: v.category || '',
        gender: labels.gender || '',
        accent: labels.accent || '',
        age: labels.age || '',
        description: labels.description || labels.descriptive || v.description || '',
        useCase: labels.use_case || '',
        languages: [...new Set([labels.language, ...langs].filter(Boolean))],
        previewUrl: v.preview_url || '',
      });
    }
    if (!j.has_more || !j.next_page_token) break;
    token = j.next_page_token;
  }
  return { voices: out };
}

function clamp(v, lo, hi, d) {
  const n = Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.min(hi, Math.max(lo, n));
}
