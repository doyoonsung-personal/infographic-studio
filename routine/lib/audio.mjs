// Mixes narration clips (placed at their scene times) with the music bed, ducking the music under the
// voice, plus sound effects at their event times. Returns the path of the mixed .m4a, or null when
// there is no audio at all.

import fs from 'node:fs';
import path from 'node:path';
import { ffmpeg } from './tools.mjs';

/** sfx: [{t, name, gain, file}] from the stage (transitions, pops, counters, data-sfx). */
export async function mixAudio({ dir, timeline: tl, project, sfx = [] }) {
  const D = tl.duration;
  const inputs = [];
  const voices = [];
  for (const s of tl.scenes) {
    const f = path.join(dir, 'audio', `voice_${s.id}.mp3`);
    if (s.voice && fs.existsSync(f)) {
      voices.push({ idx: inputs.length, at: s.voice.at, dur: s.voice.dur });
      inputs.push(f);
    }
  }
  const musicFile = path.join(dir, 'audio', 'music.mp3');
  const m = project.music || {};
  const hasMusic = m.enabled && fs.existsSync(musicFile);
  let musicIdx = -1;
  if (hasMusic) { musicIdx = inputs.length; inputs.push(musicFile); }
  // One input per sound file, split into one copy per use.
  const byFile = new Map();
  for (const e of sfx) {
    if (!e.file || !fs.existsSync(e.file) || !(e.t >= 0) || e.t >= D) continue;
    if (!byFile.has(e.file)) byFile.set(e.file, []);
    byFile.get(e.file).push(e);
  }
  const sfxInputs = [];
  for (const [file, evs] of byFile) { sfxInputs.push({ idx: inputs.length, evs }); inputs.push(file); }
  if (!inputs.length) return null;

  const f = [];
  voices.forEach((v, i) => {
    const ms = Math.max(0, Math.round(v.at * 1000));
    // Cut each clip just after its last spoken character (with a short fade): what follows is a breath.
    const trim = v.dur ? `atrim=0:${(v.dur + 0.18).toFixed(3)},afade=t=out:st=${(v.dur + 0.08).toFixed(3)}:d=0.1,` : '';
    f.push(`[${v.idx}:a]${trim}aresample=44100,aformat=channel_layouts=stereo,adelay=delays=${ms}:all=1[v${i}]`);
  });
  if (voices.length > 1) f.push(`${voices.map((_, i) => `[v${i}]`).join('')}amix=inputs=${voices.length}:normalize=0:dropout_transition=0[nar]`);
  else if (voices.length === 1) f.push('[v0]anull[nar]');

  // The bed: narration and/or music (music ducked under the voice).
  let bed = null;
  if (hasMusic) {
    const vol = Math.min(1, Math.max(0, Number(m.volume ?? 0.22)));
    const fadeOut = Math.max(0, D - 2.2);
    f.push(`[${musicIdx}:a]aresample=44100,aformat=channel_layouts=stereo,atrim=0:${D.toFixed(3)},asetpts=PTS-STARTPTS,volume=${vol.toFixed(3)},afade=t=in:st=0:d=0.8,afade=t=out:st=${fadeOut.toFixed(3)}:d=2.2[mus]`);
    if (voices.length) {
      // Pad the sidechain so the ducker keeps running after the last line of narration.
      f.push('[nar]asplit=2[narA][narSC0]');
      f.push('[narSC0]apad[narSC]');
      f.push('[mus][narSC]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[duck]');
      f.push('[narA][duck]amix=inputs=2:normalize=0:dropout_transition=0[bed]');
    } else {
      f.push('[mus]anull[bed]');
    }
    bed = '[bed]';
  } else if (voices.length) {
    bed = '[nar]';
  }

  // Sound effects, each delayed to its moment at its own gain.
  const fx = [];
  sfxInputs.forEach((s, i) => {
    const n = s.evs.length;
    const outs = s.evs.map((_, k) => `[x${i}_${k}]`).join('');
    f.push(`[${s.idx}:a]aresample=44100,aformat=channel_layouts=stereo${n > 1 ? `,asplit=${n}${outs}` : outs}`);
    s.evs.forEach((e, k) => {
      f.push(`[x${i}_${k}]volume=${Number(e.gain || 0.5).toFixed(3)},adelay=delays=${Math.max(0, Math.round(e.t * 1000))}:all=1[e${i}_${k}]`);
      fx.push(`[e${i}_${k}]`);
    });
  });
  let sfxOut = null;
  if (fx.length > 1) { f.push(`${fx.join('')}amix=inputs=${fx.length}:normalize=0:dropout_transition=0[sfx]`); sfxOut = '[sfx]'; }
  else if (fx.length === 1) sfxOut = fx[0];

  if (bed && sfxOut) f.push(`${bed}${sfxOut}amix=inputs=2:normalize=0:dropout_transition=0,alimiter=limit=0.95,apad[out]`);
  else f.push(`${bed || sfxOut}alimiter=limit=0.95,apad[out]`);

  const out = path.join(dir, 'out', 'mix.m4a');
  const args = [];
  for (const i of inputs) args.push('-i', i);
  args.push('-filter_complex', f.join(';'), '-map', '[out]', '-t', D.toFixed(3), '-c:a', 'aac', '-b:a', '192k', out);
  await ffmpeg(args);
  return out;
}
