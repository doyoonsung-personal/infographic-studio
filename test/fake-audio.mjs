// Audio pipeline check without ElevenLabs: synthetic narration clips + music bed are uploaded to the
// local app, attached to a project, then a "render" job is created for the worker to mix.
//   node test/fake-audio.mjs <projectId>     (prints the job id + dev token)
import fs from 'node:fs';
import path from 'node:path';
import { ffmpeg } from '../routine/lib/tools.mjs';
import { spokenText, clipKey } from '../public/js/timeline.js';

const BASE = process.env.STUDIO_URL || 'http://127.0.0.1:8788';
const pid = process.argv[2];
const pw = (fs.readFileSync('.dev.vars', 'utf8').match(/^APP_PASSWORD=(.*)$/m) || [])[1];
const tmp = 'work/fake-audio';
fs.mkdirSync(tmp, { recursive: true });

const login = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) });
const cookie = login.headers.get('set-cookie').split(';')[0];
const api = async (p, opts = {}) => {
  const r = await fetch(BASE + '/api/' + p, { ...opts, headers: { cookie, ...(opts.headers || {}) } });
  if (!r.ok) throw new Error(p + ' ' + r.status + ' ' + (await r.text()));
  return r.json();
};

const p = await api('projects/' + pid);
p.voice = { ...(p.voice || {}), enabled: true, voiceRef: 'kkc-hq', speed: 1, clips: {} };
let i = 0;
for (const s of p.script.scenes) {
  const text = spokenText(s.narration);
  const dur = Math.max(1.2, text.length / 7);
  const f = path.join(tmp, `v_${s.id}.mp3`);
  // A voice-like stand-in: a pitched tone with a slow tremolo.
  await ffmpeg(['-f', 'lavfi', '-i', `sine=frequency=${300 + 60 * i++}:duration=${dur.toFixed(2)}`, '-af', 'tremolo=f=4:d=0.6,volume=0.6', '-ar', '44100', '-b:a', '96k', f]);
  const up = await api('blobs', { method: 'POST', headers: { 'content-type': 'audio/mpeg' }, body: fs.readFileSync(f) });
  const starts = text.split('').map((_, k) => +(k * (dur / text.length)).toFixed(3));
  p.voice.clips[s.id] = { blobId: up.blobId, duration: +dur.toFixed(3), key: clipKey(s.narration, 'kkc-hq', 1), alignment: { chars: text.split(''), starts } };
}
const total = p.script.scenes.reduce((a, s) => a + Math.max(1.2, spokenText(s.narration).length / 7) + 0.85, 2);
const mf = path.join(tmp, 'music.mp3');
await ffmpeg(['-f', 'lavfi', '-i', `sine=frequency=110:duration=${Math.ceil(total + 2)}`, '-f', 'lavfi', '-i', `sine=frequency=165:duration=${Math.ceil(total + 2)}`, '-filter_complex', 'amix=inputs=2,volume=0.8', '-ar', '44100', '-b:a', '128k', mf]);
const mu = await api('blobs', { method: 'POST', headers: { 'content-type': 'audio/mpeg' }, body: fs.readFileSync(mf) });
p.music = { ...(p.music || {}), enabled: true, volume: 0.3, track: { blobId: mu.blobId, duration: Math.ceil(total + 2), prompt: 'test' } };
const put = await api('projects/' + pid, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) });
const job = await api('jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'render', project: { ...p, rev: put.rev } }) });
console.log(JSON.stringify({ job: job.id, token: job.devToken, clips: Object.keys(p.voice.clips).length }));
