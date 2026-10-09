// Mixes narration clips (placed at their scene times) with the music bed, ducking the music
// under the voice. Returns the path of the mixed .m4a, or null when there is no audio at all.

import fs from 'node:fs';
import path from 'node:path';
import { ffmpeg } from './tools.mjs';

export async function mixAudio({ dir, timeline: tl, project }) {
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

  if (hasMusic) {
    const vol = Math.min(1, Math.max(0, Number(m.volume ?? 0.22)));
    const fadeOut = Math.max(0, D - 2.2);
    f.push(`[${musicIdx}:a]aresample=44100,aformat=channel_layouts=stereo,atrim=0:${D.toFixed(3)},asetpts=PTS-STARTPTS,volume=${vol.toFixed(3)},afade=t=in:st=0:d=0.8,afade=t=out:st=${fadeOut.toFixed(3)}:d=2.2[mus]`);
    if (voices.length) {
      // Pad the sidechain so the ducker keeps running after the last line of narration.
      f.push('[nar]asplit=2[narA][narSC0]');
      f.push('[narSC0]apad[narSC]');
      f.push('[mus][narSC]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[duck]');
      f.push('[narA][duck]amix=inputs=2:normalize=0:dropout_transition=0,alimiter=limit=0.95,apad[out]');
    } else {
      f.push('[mus]alimiter=limit=0.95,apad[out]');
    }
  } else {
    f.push('[nar]alimiter=limit=0.95,apad[out]');
  }

  const out = path.join(dir, 'out', 'mix.m4a');
  const args = [];
  for (const i of inputs) args.push('-i', i);
  args.push('-filter_complex', f.join(';'), '-map', '[out]', '-t', D.toFixed(3), '-c:a', 'aac', '-b:a', '192k', out);
  await ffmpeg(args);
  return out;
}
