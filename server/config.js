// Owner-managed options (voices, music styles, palettes, models). Stored in KV under "config".

import { getJSON, putJSON } from './store.js';
import { IMAGE_MODELS } from './images.js';

export const TTS_MODELS = ['eleven_multilingual_v2', 'eleven_v3', 'eleven_v4', 'eleven_flash_v2_5', 'eleven_turbo_v2_5'];
export const MUSIC_MODELS = ['music_v2_5', 'music_v2', 'music_v1'];

export const DEFAULT_CONFIG = {
  version: 1,
  voices: [],
  musicStyles: [
    { id: 'calm-corporate', name: '차분한 기업형 · Calm corporate', prompt: 'Calm, modern corporate background music, soft piano and warm pads, light percussion, steady 90 BPM, unobtrusive under narration, no vocals' },
    { id: 'upbeat-tech', name: '경쾌한 테크 · Upbeat tech', prompt: 'Upbeat electronic tech-explainer track, bright plucks, clean synth bass, crisp drums, 115 BPM, optimistic and modern, no vocals' },
    { id: 'news-brief', name: '뉴스 브리핑 · Data briefing', prompt: 'Modern news and data briefing bed, tight pulse, subtle synths, ticking percussion, 100 BPM, serious but energetic, no vocals' },
    { id: 'cinematic', name: '시네마틱 · Cinematic', prompt: 'Cinematic documentary underscore, gentle strings and felt piano, slow build, 80 BPM, hopeful, no vocals' },
    { id: 'lofi', name: '로파이 · Lo-fi', prompt: 'Lo-fi hip hop beat, mellow electric piano, soft vinyl texture, relaxed 85 BPM, no vocals' },
    { id: 'playful', name: '발랄한 · Playful', prompt: 'Playful quirky motion-graphics music, pizzicato strings, marimba, hand claps, light ukulele, 105 BPM, no vocals' },
  ],
  palettes: [
    { id: 'midnight-orange', name: 'Midnight Orange', colors: { bg: '#0f1420', surface: '#1a2133', text: '#f2f4f8', muted: '#9aa4b8', accent: '#ff7a1a', accent2: '#3ec6ff', accent3: '#9b7bff' } },
    { id: 'paper-ink', name: 'Paper & Ink', colors: { bg: '#f6f3ec', surface: '#ffffff', text: '#1b1d22', muted: '#6b6f7a', accent: '#e4572e', accent2: '#2a7de1', accent3: '#17a398' } },
    { id: 'ocean-data', name: 'Ocean Data', colors: { bg: '#06202b', surface: '#0d3342', text: '#eaf6f8', muted: '#8fb3bd', accent: '#2ee6c5', accent2: '#ffd166', accent3: '#ef476f' } },
    { id: 'clean-corporate', name: 'Clean Corporate', colors: { bg: '#f4f7fb', surface: '#ffffff', text: '#0e1a2b', muted: '#5d6b80', accent: '#0a66ff', accent2: '#00b3a4', accent3: '#ff8a00' } },
    { id: 'mono-neon', name: 'Mono Neon', colors: { bg: '#0b0b0f', surface: '#17171f', text: '#ffffff', muted: '#8a8a99', accent: '#c6ff3d', accent2: '#ff3dbb', accent3: '#3dd6ff' } },
    { id: 'warm-earth', name: 'Warm Earth', colors: { bg: '#2a1f1a', surface: '#3a2c24', text: '#fbf3ea', muted: '#c2ad9c', accent: '#f2a541', accent2: '#e76f51', accent3: '#8ab17d' } },
  ],
  models: {
    chat: 'qwen3.8-max',
    writer: 'qwen3.8-max',
    research: 'qwen3.8-flash',
    tts: 'eleven_multilingual_v2',
    music: 'music_v2_5',
    image: 'qwen-image-3.0',
  },
  defaults: { ratio: '16:9', language: 'ko', format: 'animated', length: 45, paletteId: 'midnight-orange', musicVolume: 0.22 },
};

export async function loadConfig(env) {
  const saved = await getJSON(env, 'config');
  if (!saved) return structuredClone(DEFAULT_CONFIG);
  return {
    ...structuredClone(DEFAULT_CONFIG),
    ...saved,
    models: { ...DEFAULT_CONFIG.models, ...(saved.models || {}) },
    defaults: { ...DEFAULT_CONFIG.defaults, ...(saved.defaults || {}) },
  };
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export function sanitizeConfig(c) {
  const out = { version: 1 };
  out.voices = (Array.isArray(c.voices) ? c.voices : []).slice(0, 60).map((v) => ({
    id: String(v.id || v.voiceId || '').slice(0, 80),
    name: String(v.name || '').slice(0, 80),
    voiceId: String(v.voiceId || '').slice(0, 80),
    modelId: TTS_MODELS.includes(v.modelId) ? v.modelId : '',
    language: String(v.language || '').slice(0, 12),
    note: String(v.note || '').slice(0, 200),
    previewUrl: /^https:\/\//.test(v.previewUrl || '') ? String(v.previewUrl).slice(0, 500) : '',
  })).filter((v) => v.id && v.voiceId);
  out.musicStyles = (Array.isArray(c.musicStyles) ? c.musicStyles : []).slice(0, 40).map((m) => ({
    id: String(m.id || '').slice(0, 60),
    name: String(m.name || '').slice(0, 80),
    prompt: String(m.prompt || '').slice(0, 1000),
  })).filter((m) => m.id && m.prompt);
  out.palettes = (Array.isArray(c.palettes) ? c.palettes : []).slice(0, 40).map((p) => {
    const colors = {};
    for (const k of ['bg', 'surface', 'text', 'muted', 'accent', 'accent2', 'accent3']) {
      colors[k] = HEX.test(p.colors && p.colors[k]) ? p.colors[k] : '#888888';
    }
    return { id: String(p.id || '').slice(0, 60), name: String(p.name || '').slice(0, 80), colors };
  }).filter((p) => p.id);
  const m = c.models || {};
  out.models = {
    chat: String(m.chat || DEFAULT_CONFIG.models.chat).slice(0, 60),
    writer: String(m.writer || DEFAULT_CONFIG.models.writer).slice(0, 60),
    research: String(m.research || DEFAULT_CONFIG.models.research).slice(0, 60),
    tts: TTS_MODELS.includes(m.tts) ? m.tts : DEFAULT_CONFIG.models.tts,
    music: MUSIC_MODELS.includes(m.music) ? m.music : DEFAULT_CONFIG.models.music,
    image: IMAGE_MODELS.includes(m.image) ? m.image : DEFAULT_CONFIG.models.image,
  };
  const d = c.defaults || {};
  out.defaults = {
    ratio: ['16:9', '9:16', '1:1', '4:5', 'a4'].includes(d.ratio) ? d.ratio : '16:9',
    language: ['ko', 'en'].includes(d.language) ? d.language : 'ko',
    format: d.format === 'static' ? 'static' : 'animated',
    length: Math.min(120, Math.max(10, Number(d.length) || 45)),
    paletteId: String(d.paletteId || '').slice(0, 60),
    musicVolume: Math.min(1, Math.max(0, Number(d.musicVolume) || 0.22)),
  };
  return out;
}

export async function saveConfig(env, c) {
  const clean = sanitizeConfig(c);
  await putJSON(env, 'config', clean);
  return clean;
}
