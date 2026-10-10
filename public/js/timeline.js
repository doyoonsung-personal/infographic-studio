// Timeline math shared by the browser app and the routine worker (plain ES module, no DOM).
// A project's scenes become a list of [start, end) windows; narration clips and cue points
// (the {1}, {2} markers in a scene's narration) are placed inside them.

export const FPS = 30;
export const LEAD_IN = 0.35;   // silence before a scene's narration starts
export const TAIL = 0.5;       // breathing room after the narration ends
export const END_HOLD = 1.5;   // extra hold on the final scene (end card)

export const STAGES = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
  'a4': { width: 1240, height: 1754 },
};

export function stageSize(ratio) {
  return STAGES[ratio] || STAGES['16:9'];
}

const CUE_AT = /^\{(\d+)\}/;

/**
 * Split narration into the text the voice reads and the cue positions inside it.
 * Markers are removed, runs of spaces collapse to one, and the ends are trimmed;
 * each cue records the index of the character that follows it in the spoken text.
 */
export function parseNarration(narration = '') {
  const src = String(narration);
  let text = '';
  const cues = {};
  let i = 0;
  while (i < src.length) {
    const m = CUE_AT.exec(src.slice(i, i + 8));
    if (m) { cues[m[1]] = text.length; i += m[0].length; continue; }
    const ch = src[i++];
    if (/\s/.test(ch)) {
      if (text.length && !/\s$/.test(text)) text += ch === '\n' ? '\n' : ' ';
      continue;
    }
    text += ch;
  }
  text = text.replace(/\s+$/, '');
  for (const k of Object.keys(cues)) cues[k] = Math.min(cues[k], Math.max(0, text.length - 1));
  return { text, cues };
}

/** Narration with cue markers removed: what is sent to the voice (audio tags included). */
export function spokenText(narration = '') {
  return parseNarration(narration).text;
}

/* ---------- ElevenLabs audio tags ([excited], [short pause] …) ---------- */

/** Models that perform audio tags; every other model would read the brackets aloud. */
export const TAG_MODELS = ['eleven_v4', 'eleven_v3'];
const TAG_RE = /\[[^\[\]{}\n]{1,40}\]\s*/g;

export function hasTags(narration = '') {
  return /\[[^\[\]{}\n]{1,40}\]/.test(String(narration));
}

/** Remove audio tags, keeping words, punctuation and {n} cue markers. */
export function stripTags(narration = '') {
  return String(narration).replace(TAG_RE, '').replace(/[ \t]{2,}/g, ' ').replace(/^[ \t]+|[ \t]+$/gm, '');
}

/** Cue markers as {n: charIndex} positions inside spokenText(narration). */
export function cueOffsets(narration = '') {
  return parseNarration(narration).cues;
}

/** Rough reading time when there is no narration audio. */
export function estimateSeconds(text = '', lang = 'ko') {
  const t = spokenText(stripTags(text));
  if (!t) return 0;
  if (lang === 'ko' || /[가-힣]/.test(t)) {
    const syllables = (t.match(/[가-힣]/g) || []).length + (t.match(/[A-Za-z0-9]+/g) || []).length;
    return syllables / 6.2;
  }
  return t.split(/\s+/).filter(Boolean).length / 2.6;
}

/** Map cue char offsets to seconds using ElevenLabs character alignment. */
export function cueTimes(narration, alignment) {
  const out = {};
  if (!alignment || !alignment.starts || !alignment.starts.length) return out;
  const n = alignment.starts.length;
  // The alignment may or may not include audio-tag characters; use whichever text it matches.
  let offsets = cueOffsets(narration);
  let spoken = spokenText(narration);
  if (n !== spoken.length && hasTags(narration)) {
    const bare = stripTags(narration);
    if (spokenText(bare).length === n) { offsets = cueOffsets(bare); spoken = spokenText(bare); }
  }
  for (const [k, idx] of Object.entries(offsets)) {
    // Alignment characters should match the spoken text 1:1; fall back to proportional mapping.
    let i = n === spoken.length ? idx : Math.round((idx / Math.max(1, spoken.length)) * n);
    i = Math.min(n - 1, Math.max(0, i));
    // Skip forward over whitespace so the cue lands on the word, not the gap.
    while (i < n - 1 && alignment.chars && /\s/.test(alignment.chars[i] || '')) i++;
    out[k] = alignment.starts[i];
  }
  return out;
}

/** Hash of what a clip was generated from, to tell when narration changed. */
export function clipKey(narration, voiceRef, speed = 1) {
  const s = `${spokenText(narration)}|${voiceRef || ''}|${speed}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/**
 * Fingerprint of everything a composition's content is made from (brief, facts, script words and
 * visual ideas; not voice tags). A version stores it, so the app can tell when the content moved on.
 */
export function contentKey(project) {
  const p = project || {};
  const b = p.brief || {};
  const parts = [
    [b.topic, b.takeaway, b.audience, b.tone, b.notes, b.language, b.format, b.ratio],
    ((p.facts && p.facts.items) || []).map((f) => [f.claim, f.value, f.date, f.source]),
    ((p.script && p.script.scenes) || []).map((s) => [s.id, s.title, s.onscreen, s.visual, stripTags(s.narration || '')]),
  ];
  // The look and the set of cut-outs are design inputs too (a re-render can't place new cut-outs).
  if (p.style && p.style.look && p.style.look !== 'default') parts.push(['look', p.style.look]);
  const cut = ((p.assets && p.assets.items) || []).filter((a) => a.blobId);
  if (cut.length) parts.push(cut.map((a) => [a.id, a.sceneId, a.name]));
  // Extra features that change the design (only when they differ from the defaults, so older versions
  // keep their keys): camera on, GSAP off, background motion off.
  const ex = p.extras || {};
  const on = (k) => Boolean(ex[k] && ex[k].enabled);
  if (on('camera') || (ex.gsap && !on('gsap')) || (ex.ambient && !on('ambient'))) parts.push(['extras', on('camera'), on('gsap'), on('ambient')]);
  const s = JSON.stringify(parts);
  let h1 = 2166136261, h2 = 5381;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = (Math.imul(h2, 33) + c) | 0;
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

/** Is a narration clip still valid for this scene's text, voice, speed and (if chosen) model? */
export function clipFresh(clip, narration, voice) {
  if (!clip) return false;
  if (clip.key !== clipKey(narration, voice.voiceRef, voice.speed || 1)) return false;
  if (voice.modelId && clip.modelId && clip.modelId !== voice.modelId) return false;
  return true;
}

/**
 * Build the timeline for a project.
 * Returns { duration, fps, width, height, static, scenes: [{ id, start, end, len, voice, cues }] }.
 * voice: { blobId, at (absolute seconds), dur } when a current narration clip exists.
 * cues:  { n: seconds relative to scene start }.
 */
export function computeTimeline(project) {
  const brief = project.brief || {};
  const { width, height } = stageSize(brief.ratio);
  const isStatic = brief.format === 'static';
  const scenes = (project.script && project.script.scenes) || [];
  const lang = brief.language || 'ko';
  const voice = project.voice || {};
  const useVoice = !isStatic && voice.enabled !== false && voice.enabled;
  const out = [];
  let t = 0;

  if (isStatic) {
    // A static infographic is one page; the script's scenes are its sections.
    return { duration: 0, fps: FPS, width, height, static: true, scenes: [{ id: 'page', start: 0, end: 0, len: 0, voice: null, cues: {} }] };
  }

  scenes.forEach((sc, i) => {
    const clip = useVoice && voice.clips ? voice.clips[sc.id] : null;
    const fresh = clipFresh(clip, sc.narration, voice);
    let len;
    let cues = {};
    let v = null;
    if (fresh && clip.duration) {
      len = LEAD_IN + clip.duration + TAIL;
      const ct = cueTimes(sc.narration, clip.alignment);
      for (const [k, s] of Object.entries(ct)) cues[k] = +(LEAD_IN + s).toFixed(3);
      v = { blobId: clip.blobId, at: +(t + LEAD_IN).toFixed(3), dur: clip.duration };
    } else {
      const est = estimateSeconds(sc.narration || sc.onscreen || '', lang);
      len = Math.max(Number(sc.seconds) || 0, est + 1.2, 3);
      // Spread cues evenly through the estimated reading time.
      const offs = cueOffsets(sc.narration || '');
      const spokenLen = Math.max(1, spokenText(sc.narration || '').length);
      for (const [k, idx] of Object.entries(offs)) cues[k] = +(0.4 + (idx / spokenLen) * est).toFixed(3);
    }
    if (i === scenes.length - 1) len += END_HOLD;
    len = +Math.min(len, 30).toFixed(3);
    out.push({ id: sc.id, start: +t.toFixed(3), end: +(t + len).toFixed(3), len, voice: v, cues });
    t += len;
  });

  return {
    duration: isStatic ? 0 : +t.toFixed(3),
    fps: FPS,
    width,
    height,
    static: isStatic,
    scenes: out,
  };
}

/** Time to grab a still of a scene where everything is on screen. */
export function peakTime(scene) {
  return +(scene.end - Math.min(0.6, scene.len * 0.15)).toFixed(3);
}
