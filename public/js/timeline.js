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

/** Narration with cue markers removed: what the voice actually reads. */
export function spokenText(narration = '') {
  return parseNarration(narration).text;
}

/** Cue markers as {n: charIndex} positions inside spokenText(narration). */
export function cueOffsets(narration = '') {
  return parseNarration(narration).cues;
}

/** Rough reading time when there is no narration audio. */
export function estimateSeconds(text = '', lang = 'ko') {
  const t = spokenText(text);
  if (!t) return 0;
  if (lang === 'ko' || /[가-힣]/.test(t)) {
    const syllables = (t.match(/[가-힣]/g) || []).length + (t.match(/[A-Za-z0-9]+/g) || []).length;
    return syllables / 6.2;
  }
  return t.split(/\s+/).filter(Boolean).length / 2.6;
}

/** Map cue char offsets to seconds using ElevenLabs character alignment. */
export function cueTimes(narration, alignment) {
  const offsets = cueOffsets(narration);
  const out = {};
  if (!alignment || !alignment.starts || !alignment.starts.length) return out;
  const spoken = spokenText(narration);
  const n = alignment.starts.length;
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
    const fresh = clip && clip.key === clipKey(sc.narration, voice.voiceRef, voice.speed || 1);
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
