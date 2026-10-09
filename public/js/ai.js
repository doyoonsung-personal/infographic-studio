// Qwen-powered steps: brief suggestions, fact research, script writing, palettes.
// Each function returns plain data; the studio decides where to put it.

import { chatStream, researchStream, api } from './api.js';
import { extractJSON, validPalette, contrast, COLOR_KEYS } from './util.js';

const LANGNAME = { ko: 'Korean', en: 'English' };
const today = () => new Date().toISOString().slice(0, 10);

function langOf(p) { return LANGNAME[(p.brief && p.brief.language) || 'ko'] || 'Korean'; }

function briefBlock(p) {
  const b = p.brief || {};
  return [
    `Topic: ${b.topic || p.title || ''}`,
    b.takeaway && `Takeaway: ${b.takeaway}`,
    b.audience && `Audience: ${b.audience}`,
    b.tone && `Tone: ${b.tone}`,
    `Format: ${b.format === 'static' ? 'static one-page infographic' : `animated video, about ${b.length || 45} seconds`}, ratio ${b.ratio || '16:9'}`,
    `Language: ${langOf(p)}`,
    b.notes && `Owner notes: ${b.notes}`,
  ].filter(Boolean).join('\n');
}

function factsBlock(p) {
  const items = (p.facts && p.facts.items) || [];
  if (!items.length) return 'FACTS: none yet (do not invent numbers; stay qualitative).';
  return 'FACTS (the only numbers you may use):\n' + items.map((f, i) =>
    `${i + 1}. ${f.claim}${f.value ? ` [${f.value}]` : ''}${f.date ? ` (${f.date})` : ''}${f.source ? ` — ${f.source}` : ''}`).join('\n');
}

// Thinking stays off by default: with it on, Qwen3.8-max takes minutes per script for little gain.
async function json(messages, opts = {}) {
  const res = await chatStream({ messages, role: 'writer', thinking: opts.thinking ?? false, json: Boolean(opts.json) }, { signal: opts.signal, onDelta: opts.onDelta });
  return extractJSON(res.content);
}

/* ---------- brief ---------- */
export async function suggestBrief(p, direction, opts) {
  const sys = 'You are a senior infographic editor. Reply with JSON only.';
  const user = `${briefBlock(p)}\n${direction ? `Direction from the owner: ${direction}\n` : ''}
Sharpen this into a brief. Return JSON:
{"title": "short project title", "takeaway": "ONE sentence a viewer should remember", "audience": "who it is for", "tone": "2-4 words"}
Write the values in ${langOf(p)}. Keep the owner's topic; make the takeaway concrete and specific.
Do NOT put statistics or numbers in the takeaway unless the owner gave them: the facts are researched later, so phrase it as the point the numbers will prove.`;
  return json([{ role: 'system', content: sys }, { role: 'user', content: user }], { thinking: false, ...opts });
}

/* ---------- facts ---------- */
export async function researchFacts(p, focus, { onProgress, signal } = {}) {
  const input = `You are researching facts for an infographic.
${briefBlock(p)}
${focus ? `Research focus: ${focus}\n` : ''}Today is ${today()}. Search the web. Prefer primary and official sources (statistics agencies, company filings, central banks, reputable newsrooms) and the most recent figures.
Be efficient: use at most 3 rounds of web searches, then answer.

Return ONLY a JSON object, no prose:
{"facts":[{"claim":"one-sentence fact in ${langOf(p)}","value":"the key number with its unit","date":"the period or as-of date of the number","source":"publisher name","url":"the exact page you used"}],
 "summary":"two sentences in ${langOf(p)} on what the data says"}
Give 5 to 8 facts that together support (or correct) the takeaway. Every fact needs a real URL you used. Never invent or round numbers beyond what the source says.`;
  let searches = 0;
  const final = await researchStream(input, {
    signal,
    onSearch: (qs) => { searches++; if (onProgress) onProgress(`🔎 ${searches}: ${(qs || []).slice(0, 2).join(' · ')}`); },
    onText: (txt) => { if (onProgress) onProgress(`✍ ${txt.length}…`); },
  });
  const r = { text: '', sources: [], queries: [] };
  const seen = new Set();
  for (const item of final.output || []) {
    if (item.type === 'web_search_call' && item.action) {
      for (const q of item.action.queries || [item.action.query]) if (q) r.queries.push(q);
      for (const s of item.action.sources || []) if (s && s.url && !seen.has(s.url)) { seen.add(s.url); r.sources.push(s.url); }
    }
    if (item.type === 'message') for (const c of item.content || []) if (c.type === 'output_text') r.text += c.text;
  }
  let parsed;
  try { parsed = extractJSON(r.text); } catch { parsed = { facts: [], summary: r.text.slice(0, 600) }; }
  const items = (parsed.facts || []).filter((f) => f && f.claim).slice(0, 14).map((f, i) => ({
    id: 'f' + (i + 1) + Math.random().toString(36).slice(2, 5),
    claim: String(f.claim || ''),
    value: String(f.value || ''),
    date: String(f.date || ''),
    source: String(f.source || ''),
    url: /^https?:\/\//.test(f.url || '') ? f.url : '',
  }));
  return { items, summary: parsed.summary || '', sources: r.sources || [], queries: r.queries || [], at: Date.now() };
}

/* ---------- script ---------- */
function sceneCount(p) {
  const len = Number(p.brief && p.brief.length) || 45;
  return Math.max(4, Math.min(12, Math.round(len / 5)));
}

const SCRIPT_RULES = (p) => {
  const isStatic = p.brief && p.brief.format === 'static';
  const L = langOf(p);
  if (isStatic) {
    return `This is a STATIC one-page infographic. Write 4 to 7 SECTIONS, top to bottom.
- id: s1, s2, ... in order.
- title: short section heading in ${L}.
- narration: "" (empty — nothing is spoken).
- onscreen: the exact text for that section in ${L}: a headline, the hero number with its unit, and at most two short supporting lines. Use " / " between items.
- visual: a concrete drawable idea (chart type with the actual numbers, icon metaphor, layout).
- seconds: 0.
- Section 1 states the takeaway. The last section is a footer: takeaway, "as of ${today()}" and a one-line source.`;
  }
  return `This is an ANIMATED infographic of about ${(p.brief && p.brief.length) || 45} seconds: write ${sceneCount(p)} scenes (one idea per 3–6 seconds).
- id: s1, s2, ... in order.
- title: short label for the scene.
- narration: what the voice says, in ${L}: natural, short sentences. It must fit the scene: Korean ≈ 6 syllables per second, English ≈ 2.6 words per second.
- Put cue markers {1}, {2}, {3} (max 3 per scene, numbering restarts every scene) directly before the words a visual should land on, e.g. "원두값은 {1}1년 만에 {2}38% 올랐습니다".
- onscreen: only the few words shown on screen in ${L} — headline, hero number with unit, labels — much shorter than the narration. Use " / " between items.
- visual: a concrete drawable idea for the designer (chart type with the actual numbers, icon metaphor, layout, what each cue reveals).
- seconds: your estimate for the scene.
- Scene 1 hooks the viewer and states the takeaway in plain words. The last scene is the end card: takeaway, "as of ${today()}" and a one-line source.
- One hero element per scene. Use only numbers from FACTS.`;
};

export async function writeScript(p, { direction, sceneId, signal, onDelta } = {}) {
  const scenes = (p.script && p.script.scenes) || [];
  const sys = 'You are an award-winning motion-infographic scriptwriter. Reply with JSON only.';
  if (sceneId) {
    const idx = scenes.findIndex((s) => s.id === sceneId);
    const user = `${briefBlock(p)}\n\n${factsBlock(p)}\n\nCurrent script:\n${JSON.stringify(scenes, null, 1)}\n\n${SCRIPT_RULES(p)}\n\nRewrite ONLY scene "${sceneId}" (scene ${idx + 1} of ${scenes.length}) so it flows with its neighbours.${direction ? `\nOwner's direction: ${direction}` : ''}\nReturn JSON: {"scene": {"id":"${sceneId}","title":"...","narration":"...","onscreen":"...","visual":"...","seconds":5}}`;
    const r = await json([{ role: 'system', content: sys }, { role: 'user', content: user }], { signal, onDelta });
    const s = r.scene || r;
    return { scene: normScene(s, sceneId) };
  }
  const user = `${briefBlock(p)}\n\n${factsBlock(p)}\n\n${SCRIPT_RULES(p)}${scenes.length ? `\n\nThe current script (improve on it):\n${JSON.stringify(scenes, null, 1)}` : ''}${direction ? `\n\nOwner's direction: ${direction}` : ''}\n\nReturn JSON: {"scenes":[{"id":"s1","title":"...","narration":"...","onscreen":"...","visual":"...","seconds":5}]}`;
  const r = await json([{ role: 'system', content: sys }, { role: 'user', content: user }], { signal, onDelta });
  const list = (r.scenes || []).map((s, i) => normScene(s, 's' + (i + 1)));
  if (!list.length) throw new Error('The model returned no scenes');
  return { scenes: list };
}

function normScene(s, id) {
  return {
    id: String(s.id || id).replace(/[^\w-]/g, '').slice(0, 20) || id,
    title: String(s.title || '').slice(0, 120),
    narration: String(s.narration || '').slice(0, 1200),
    onscreen: String(s.onscreen || '').slice(0, 600),
    visual: String(s.visual || '').slice(0, 600),
    seconds: Math.max(0, Math.min(30, Number(s.seconds) || 0)),
  };
}

/* ---------- background images ---------- */

export const BG_LOOKS = {
  photo: 'cinematic editorial photography, natural soft light, shallow depth of field, subtle film grain',
  illustration: 'modern flat vector illustration, clean geometric shapes, gentle gradients, subtle paper grain',
  '3d': 'soft 3D clay render, rounded shapes, matte materials, soft studio lighting',
  abstract: 'abstract composition of soft gradients, light leaks and translucent shapes, minimal',
};

/**
 * Write one image prompt per key ('all' = one shared image, else a scene id).
 * Returns {key: prompt}. Prompts are English; images must carry no text.
 */
export async function backgroundPrompts(p, keys, opts) {
  const b = p.brief || {};
  const st = p.style || {};
  const bg = st.background || {};
  const c = st.colors || {};
  const scenes = (p.script && p.script.scenes) || [];
  const ratio = b.ratio === '9:16' || b.ratio === 'a4' || b.ratio === '4:5' ? 'tall portrait' : b.ratio === '1:1' ? 'square' : 'wide 16:9';
  const items = keys.map((k) => {
    if (k === 'all') return { id: 'all', for: 'one background shared by the whole piece', topic: b.topic };
    const s = scenes.find((x) => x.id === k) || {};
    return { id: k, for: s.title || k, onscreen: s.onscreen, visual: s.visual };
  });
  const user = `Write image-generation prompts for BACKGROUND PLATES of an infographic ${b.format === 'static' ? 'page' : 'video'}.
Topic: ${b.topic || ''}
Takeaway: ${b.takeaway || ''}
Audience: ${b.audience || ''} · Tone: ${b.tone || ''}
Look: ${BG_LOOKS[bg.look] || BG_LOOKS.photo}${bg.notes ? `\nOwner's notes: ${bg.notes}` : ''}
Palette (the image should sit naturally under it): background ${c.bg}, accent ${c.accent}, secondary ${c.accent2}.
Frame: ${ratio}.

Rules for every prompt:
- A concrete, evocative scene or subject that fits the item below (and the culture of the topic, e.g. Korean settings for Korean topics), described for the chosen look.
- It is a BACKGROUND: text and charts will be laid over it, mostly on the left/center. Keep a calm, low-detail area there; put the main subject toward the right or edges; no busy patterns everywhere.
- Colour grade toward the palette: dominant tones near the background colour, small touches of the accent.
- Absolutely NO text, letters, numbers, signs with writing, logos, watermarks, UI, charts or infographic elements.
- All prompts share one consistent visual style (same lens, lighting and grade) so the scenes feel like one piece.
- 40 to 80 English words each.

Items:
${items.map((x) => JSON.stringify(x)).join('\n')}

Return JSON: {"images":[{"id":"...","prompt":"..."}]}`;
  const r = await json([{ role: 'system', content: 'You are an art director writing prompts for an image model. Reply with JSON only.' }, { role: 'user', content: user }], { thinking: false, json: true, ...opts });
  const out = {};
  for (const x of (r.images || [])) {
    if (x && x.id && x.prompt) out[String(x.id)] = String(x.prompt).slice(0, 1200) + ' No text, no letters, no numbers, no logos, no watermark.';
  }
  return out;
}

/* ---------- audio tags (ElevenLabs v4 / v3) ---------- */

/**
 * Insert emotion / delivery tags into each scene's narration. Returns {sceneId: taggedNarration}.
 * The caller checks that only tags were inserted (words and {n} cue markers unchanged).
 */
export async function addAudioTags(p, direction, opts) {
  const scenes = ((p.script && p.script.scenes) || []).filter((s) => String(s.narration || '').trim());
  if (!scenes.length) return {};
  const b = p.brief || {};
  const user = `You direct a voice actor for an infographic narration (language: ${langOf(p)}).
Topic: ${b.topic || ''}
Takeaway: ${b.takeaway || ''}
Audience: ${b.audience || ''}
Tone: ${b.tone || ''}${direction ? `\nOwner's direction for the delivery: ${direction}` : ''}

Add ElevenLabs audio tags to the narration below. Rules:
- A tag is a few plain English words in square brackets placed right BEFORE the words it colours, e.g. [warmly], [excited], [curious], [confident], [softly], [slowly], [dramatically], [surprised], [short pause], [pause], [sighs], [chuckles].
- Tags describe HOW the line is spoken (emotion, delivery, pauses, small non-verbal sounds). No stage directions ([smiling], [pointing]), no sound effects, accents or singing.
- A tag holds until the next one, so add 1 to 3 tags per scene, only where the delivery should change. Keep it natural for a clear, trustworthy explainer; save stronger emotions for the hook, surprising numbers and the ending.
- A [short pause] before a key number or the takeaway works well.
- One idea per tag, no commas inside a tag. To combine, stack separate tags: [short pause] [warmly].
- When a tag belongs at a {n} cue marker, put the tag BEFORE the marker: "[short pause] {1}824만", not "{1}[short pause] 824만".
- Do NOT change, add, remove or reorder any word, number, punctuation, or the {1} {2} cue markers. Only insert tags. Tags are always in English, even in Korean text.

Scenes:
${scenes.map((s) => JSON.stringify({ id: s.id, narration: s.narration })).join('\n')}

Return JSON: {"scenes":[{"id":"s1","narration":"the same text with tags inserted"}]}`;
  const r = await json([{ role: 'system', content: 'You are an expert voice director. Reply with JSON only.' }, { role: 'user', content: user }], { thinking: false, json: true, ...opts });
  const out = {};
  for (const s of (r.scenes || [])) if (s && s.id && typeof s.narration === 'string') out[String(s.id)] = tidyTags(s.narration.slice(0, 1600));
  return out;
}

/** "[a, b]" -> "[a] [b]"; tags right after a {n} cue move in front of it so the cue stays on the word. */
export function tidyTags(text) {
  let s = String(text).replace(/\[([^\[\]{}\n]{1,60})\]/g, (m, inner) =>
    inner.includes(',') ? inner.split(',').map((x) => x.trim()).filter(Boolean).map((x) => `[${x}]`).join(' ') : m);
  s = s.replace(/(\{\d+\})\s*((?:\[[^\[\]{}\n]{1,40}\]\s*)+)/g, (m, cue, tags) => `${tags.trim()} ${cue}`);
  return s.replace(/(\[[^\[\]{}\n]{1,40}\])(?=[^\s\[])/g, '$1 ').replace(/[ \t]{2,}/g, ' ').trim();
}

/* ---------- palettes ---------- */
const PALETTE_RULES = `Each palette has colors {bg, surface, text, muted, accent, accent2, accent3} as #rrggbb:
- text on bg contrast at least 7:1; muted on bg at least 4.5:1; accent readable as large text on bg (at least 3:1)
- surface is a card colour slightly offset from bg; accent2 and accent3 are clearly different from accent and each other
- suited to a data/infographic video: calm background, 1 strong accent, 2 supporting accents`;

function hex6(v) {
  const s = String(v || '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + s.slice(1).split('').map((x) => x + x).join('');
  return null;
}
function mix(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return '#' + pa.map((x, i) => Math.round(x + (pb[i] - x) * t).toString(16).padStart(2, '0')).join('');
}
/** Accept short hex and fill in derivable colours; null if the core colours are missing. */
export function normalizePalette(colors) {
  const c = {};
  for (const k of COLOR_KEYS) c[k] = hex6(colors && colors[k]);
  if (!c.bg || !c.text || !c.accent) return null;
  c.surface = c.surface || mix(c.bg, c.text, 0.07);
  c.muted = c.muted || mix(c.text, c.bg, 0.4);
  c.accent2 = c.accent2 || mix(c.accent, c.text, 0.35);
  c.accent3 = c.accent3 || mix(c.accent, c.bg, 0.35);
  return c;
}

export function scorePalette(c) {
  return { text: +contrast(c.text, c.bg).toFixed(1), muted: +contrast(c.muted, c.bg).toFixed(1), accent: +contrast(c.accent, c.bg).toFixed(1) };
}

export async function suggestPalettes(p, direction, opts) {
  const user = `${briefBlock(p)}\n${direction ? `Owner's direction: ${direction}\n` : ''}\nPropose 3 distinct colour palettes for this infographic.\n${PALETTE_RULES}\nReturn JSON: {"palettes":[{"name":"short name","colors":{...},"why":"one short sentence in ${langOf(p)}"}]}`;
  const r = await json([{ role: 'system', content: 'You are a brand and data-visualisation colour designer. Reply with JSON only.' }, { role: 'user', content: user }], { thinking: false, json: true, ...opts });
  const list = (Array.isArray(r) ? r : r.palettes || []).map((x) => ({ x, colors: normalizePalette(x && (x.colors || x)) }))
    .filter((y) => y.colors).slice(0, 4).map(({ x, colors }) => ({
      name: String(x.name || 'Palette').slice(0, 40),
      colors,
      why: String(x.why || '').slice(0, 200),
    }));
  if (!list.length) throw new Error('The model returned no usable palettes. Try again.');
  return list;
}

export async function paletteFromSite(p, url, opts) {
  const site = await api('palette-from-url', { method: 'POST', body: { url } });
  if (!site.colors || !site.colors.length) throw new Error('No colours found on that page');
  const list = site.colors.map((c) => `${c.hex} (used ${c.n}x, chroma ${c.chroma})`).join('\n');
  const user = `Brand website: ${site.url} — "${site.title}"\nMost used colours on the site:\n${list}\n\n${briefBlock(p)}\n\nBuild ONE palette that clearly belongs to this brand (its main brand colour becomes accent; keep its light/dark feel unless it hurts readability).\n${PALETTE_RULES}\nReturn JSON: {"name":"short name","colors":{...},"why":"one short sentence in ${langOf(p)}"}`;
  const r = await json([{ role: 'system', content: 'You are a brand colour designer. Reply with JSON only.' }, { role: 'user', content: user }], { thinking: false, json: true, ...opts });
  const x = r.colors ? r : (r.palette || r);
  const colors = normalizePalette(x.colors || x);
  if (!colors) throw new Error('The model returned an invalid palette');
  return {
    name: String(x.name || site.title || 'Brand').slice(0, 40),
    colors,
    why: String(x.why || '').slice(0, 200),
    site: site.url,
  };
}
