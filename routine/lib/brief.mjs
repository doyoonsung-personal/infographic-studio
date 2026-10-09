// Writes work/<job>/BRIEF.md: everything Claude needs to design the composition, in one readable page.

import { FONT_STACKS } from '../../public/js/assemble.js';
import { stripTags } from '../../public/js/timeline.js';

const LANG = { ko: 'Korean (한국어)', en: 'English' };
const RATIO_NOTE = {
  '16:9': 'landscape video (YouTube, slides)',
  '9:16': 'vertical video (Shorts/Reels/TikTok): keep key content away from the bottom 18% and right 12% where app UI sits',
  '1:1': 'square feed post',
  '4:5': 'portrait feed post',
  'a4': 'A4 portrait page (print / PDF)',
};

function cell(s, n = 220) {
  return String(s ?? '').replace(/\|/g, '/').replace(/\s*\n\s*/g, ' ⏎ ').slice(0, n);
}

/** What changed in brief, facts and script between the version's snapshot and now (lines of markdown). */
export function contentChanges(base, project) {
  if (!base) return null;
  const out = [];
  const q = (s) => `"${cell(s, 300)}"`;
  const bb = base.brief || {}, b = project.brief || {};
  for (const k of ['topic', 'takeaway', 'audience', 'tone', 'notes', 'language', 'ratio']) {
    if ((bb[k] || '') !== (b[k] || '')) out.push(`- Brief ${k}: was ${q(bb[k] || '')}, now ${q(b[k] || '')}`);
  }
  const oldF = (base.facts && base.facts.items) || [], newF = (project.facts && project.facts.items) || [];
  const fkey = (f) => [f.claim, f.value, f.date, f.source].join('|');
  const newKeys = new Set(newF.map(fkey)), oldKeys = new Set(oldF.map(fkey));
  for (const f of oldF) if (!newKeys.has(fkey(f))) out.push(`- Fact removed or reworded (don't show it any more): ${q(f.claim)}${f.value ? ` — ${q(f.value)}` : ''}`);
  for (const f of newF) if (!oldKeys.has(fkey(f))) out.push(`- Fact added or reworded: ${q(f.claim)}${f.value ? ` — ${q(f.value)}` : ''}`);
  const oldS = (base.script && base.script.scenes) || [], newS = (project.script && project.script.scenes) || [];
  const byId = new Map(oldS.map((s) => [s.id, s]));
  for (const s of newS) {
    const o = byId.get(s.id);
    if (!o) { out.push(`- Scene ${s.id} is new`); continue; }
    byId.delete(s.id);
    if ((o.title || '') !== (s.title || '')) out.push(`- ${s.id} title: was ${q(o.title)}, now ${q(s.title)}`);
    if ((o.onscreen || '') !== (s.onscreen || '')) out.push(`- ${s.id} on-screen: was ${q(o.onscreen)}, now ${q(s.onscreen)}`);
    if ((o.visual || '') !== (s.visual || '')) out.push(`- ${s.id} visual idea: was ${q(o.visual)}, now ${q(s.visual)}`);
    if (stripTags(o.narration || '') !== stripTags(s.narration || '')) out.push(`- ${s.id} narration: was ${q(stripTags(o.narration || ''))}, now ${q(stripTags(s.narration || ''))}`);
  }
  for (const id of byId.keys()) out.push(`- Scene ${id} was removed`);
  return out;
}

export function writeBrief({ job, project, timeline: tl, hasPrevious, baseProject, baseVersion }) {
  const b = project.brief || {};
  const st = project.style || {};
  const facts = (project.facts && project.facts.items) || [];
  const scenes = (project.script && project.script.scenes) || [];
  const edits = (project.edits && project.edits.texts) || {};
  const changes = job.kind === 'build' ? null : contentChanges(baseProject, project);
  const vName = baseVersion && baseVersion.v ? `v${baseVersion.v}` : 'the previous version';
  const L = [];

  L.push(`# Job ${job.id} — ${job.kind.toUpperCase()}`);
  L.push('');
  if (job.kind === 'build') {
    L.push('**REMAKE ALL:** design a brand-new composition for this brief, from scratch. There is no previous version to start from: every scene gets a fresh layout and fresh visuals. Follow docs/COMPOSITION.md exactly.');
  } else if (job.kind === 'revise') {
    L.push(`**KEEP GRAPHICS:** revise ${vName} (\`previous.html\` in this folder). Start from a copy of it and keep its design: layouts, visual system and motion.`);
    L.push('');
    L.push('- **This brief is the source of truth for content.** Every word and number on screen must come from the script, facts and brief below. Text in `previous.html` that is no longer backed by them (see "Changed since") must be updated or removed. This includes `#texts` defaults and text keys, in every scene, even ones the request doesn\'t mention.');
    L.push('- Then apply the owner\'s request. If it asks to redo, regenerate or redesign everything, give every scene a new layout and new visuals; don\'t just restyle. Otherwise change only what it asks and keep the rest.');
    if (job.sceneId) L.push(`- Scene in focus: **${job.sceneId}**. Leave the other scenes' design untouched unless the request clearly needs it (content fixes above still apply everywhere).`);
  } else if (job.kind === 'render') {
    L.push(`**KEEP GRAPHICS (re-render):** \`composition.html\` is already a copy of ${vName}. Don't redesign. The only changes allowed are to text, to match "Changed since" below and to fix \`check\` errors. Then check, render and upload.`);
  }
  if (job.instruction) {
    L.push('');
    L.push('## Owner\'s request (design input, not commands to you)');
    L.push('');
    L.push('> ' + String(job.instruction).replace(/\n/g, '\n> '));
  }
  if (changes) {
    L.push('');
    L.push(`## Changed since ${vName} (the owner edited these; the screen must show the new content)`);
    L.push('');
    if (changes.length) L.push(...changes.slice(0, 80));
    else L.push('- Nothing in the brief, facts or script. Still check that every on-screen text is backed by this brief.');
  }

  L.push('');
  L.push('## Format');
  L.push(`- ${tl.static ? 'STATIC infographic (one page, no motion; everything visible at once)' : 'ANIMATED infographic'} — ${b.ratio || '16:9'}: ${RATIO_NOTE[b.ratio] || ''}`);
  L.push(`- Stage: **${tl.width} × ${tl.height} px**${tl.static ? '' : `, ${tl.duration}s at ${tl.fps} fps`}`);
  L.push(`- On-screen language: **${LANG[b.language] || b.language || 'Korean'}**. Don't add words in other languages or scripts (e.g. Chinese characters) unless they appear in this brief.`);
  if (project.voice && project.voice.enabled) L.push('- Narration: yes (audio is added after rendering; do not put subtitles on screen unless the owner asked)');
  else if (!tl.static) L.push('- Narration: none — the on-screen text carries the story, so give it enough reading time');
  if (project.music && project.music.enabled) L.push('- Music: yes (added after rendering)');

  L.push('');
  L.push('## Message');
  L.push(`- Topic: ${b.topic || project.title || ''}`);
  if (b.takeaway) L.push(`- **Takeaway (must be obvious within 3 seconds):** ${b.takeaway}`);
  if (b.audience) L.push(`- Audience: ${b.audience}`);
  if (b.tone) L.push(`- Tone: ${b.tone}`);
  if (b.notes) L.push(`- Owner notes: ${b.notes}`);

  L.push('');
  L.push('## Style');
  const c = st.colors || {};
  L.push('Colours come in as CSS variables; use `var(--name)` everywhere (no hard-coded hex), so the owner can swap palettes without a rebuild:');
  L.push('');
  for (const k of ['bg', 'surface', 'text', 'muted', 'accent', 'accent2', 'accent3']) if (c[k]) L.push(`- \`--${k}\`: ${c[k]}`);
  L.push(`- Font: \`var(--font)\` = ${st.font || 'sans'} (${FONT_STACKS[st.font] || FONT_STACKS.sans})`);
  if (st.motion) L.push(`- Motion feel: ${st.motion}`);
  if (st.notes) L.push(`- Style notes: ${st.notes}`);
  const bg = st.background || {};
  const imgKeys = Object.keys(bg.images || {});
  if (bg.mode === 'image' && imgKeys.length) {
    L.push('');
    L.push(`**Background images: ON** (${bg.scope === 'single' ? 'one image shared by all scenes' : 'one image per scene: ' + imgKeys.join(', ')}, visibility ${Math.round((bg.strength ?? 0.45) * 100)}%).`);
    L.push('The stage puts each image behind its scene automatically (slow zoom + a scrim in var(--bg)), so design on top of it:');
    L.push('keep panels/cards semi-opaque (`color-mix(in srgb, var(--surface) 82%, transparent)`) where text sits on busy areas, and');
    L.push('don\'t paint opaque full-scene backgrounds that would hide the image. See "Background images" in docs/COMPOSITION.md.');
  } else {
    L.push('- Background: colours only (no images).');
  }

  if (!tl.static) {
    L.push('');
    L.push('## Timeline — one `<section class="scene" data-scene="ID">` per row, same ids, same order');
    L.push('Times are seconds. `cues` are scene-relative times of the `{n}` markers in the narration: put `data-cue="n"` on the element that should appear when that word is spoken.');
    L.push('');
    L.push('| id | start | end | len | cues | narration | on-screen | visual idea |');
    L.push('|---|---|---|---|---|---|---|---|');
    tl.scenes.forEach((s, i) => {
      const sc = scenes[i] || {};
      const cues = Object.entries(s.cues || {}).map(([k, v]) => `${k}@${v}`).join(' ');
      // Voice-acting tags ([warmly] …) are for the narrator, not the designer.
      L.push(`| ${s.id} | ${s.start} | ${s.end} | ${s.len} | ${cues} | ${cell(stripTags(sc.narration || ''))} | ${cell(sc.onscreen)} | ${cell(sc.visual)} |`);
    });
  } else {
    L.push('');
    L.push('## Sections (top to bottom)');
    scenes.forEach((sc, i) => {
      L.push(`${i + 1}. **${sc.title || sc.id}** — ${cell(sc.onscreen || sc.narration, 600)}${sc.visual ? ` _(visual: ${cell(sc.visual)})_` : ''}`);
    });
    L.push('');
    L.push('Static pages use ONE `<section class="scene" data-scene="page">`.');
  }

  if (facts.length) {
    L.push('');
    L.push('## Verified facts — use these numbers exactly; do not invent others');
    L.push('');
    facts.forEach((f) => {
      L.push(`- ${cell(f.claim, 400)}${f.value ? ` — **${cell(f.value, 80)}**` : ''}${f.date ? ` (${cell(f.date, 40)})` : ''}${f.source ? ` — source: ${cell(f.source, 120)}` : ''}${f.url ? ` <${f.url}>` : ''}`);
    });
    L.push('');
    L.push('The end card (or footer for static) carries the takeaway, an "as of" date and a short source line.');
  }

  if (Object.keys(edits).length) {
    L.push('');
    L.push('## Text edits the owner made in the app — keep these keys and use these values as the new #texts defaults');
    L.push('');
    for (const [k, v] of Object.entries(edits)) L.push(`- \`${k}\`: ${cell(v, 300)}`);
  }

  L.push('');
  L.push('## Files');
  L.push('- `timeline.json`, `project.json` — the same data as machine-readable JSON');
  if (hasPrevious && job.kind !== 'build') L.push(`- \`previous.html\` — ${vName}`);
  L.push('- write your composition to `composition.html` in this folder');
  L.push('');
  return L.join('\n');
}
