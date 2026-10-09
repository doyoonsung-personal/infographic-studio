// Background-image pipeline check without the image model: synthetic images are uploaded and attached
// as per-scene backgrounds, then a "render" job is created for the worker.
//   node test/fake-bg.mjs <projectId>     (prints the job id + dev token)
import fs from 'node:fs';
import path from 'node:path';
import { ffmpeg } from '../routine/lib/tools.mjs';

const BASE = process.env.STUDIO_URL || 'http://127.0.0.1:8788';
const pid = process.argv[2];
const pw = (fs.readFileSync('.dev.vars', 'utf8').match(/^APP_PASSWORD=(.*)$/m) || [])[1];
const tmp = 'work/fake-bg';
fs.mkdirSync(tmp, { recursive: true });
const login = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) });
const cookie = login.headers.get('set-cookie').split(';')[0];
const api = async (p, opts = {}) => {
  const r = await fetch(BASE + '/api/' + p, { ...opts, headers: { cookie, ...(opts.headers || {}) } });
  if (!r.ok) throw new Error(p + ' ' + r.status + ' ' + (await r.text()));
  return r.json();
};

const p = await api('projects/' + pid);
const colors = [['0x1d3557', '0xe76f51'], ['0x264653', '0xf4a261'], ['0x3a0ca3', '0x4cc9f0'], ['0x2b2d42', '0xef233c']];
const images = {};
for (const [i, s] of p.script.scenes.entries()) {
  const [a, b] = colors[i % colors.length];
  const f = path.join(tmp, `bg_${s.id}.jpg`);
  await ffmpeg(['-f', 'lavfi', '-i', `gradients=s=1664x928:c0=${a}:c1=${b}:x0=0:y0=0:x1=1664:y1=928:d=1`, '-frames:v', '1', '-vf', 'noise=alls=18:allf=t', '-q:v', '3', f]);
  const up = await api('blobs', { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: fs.readFileSync(f) });
  images[s.id] = { blobId: up.blobId, prompt: 'synthetic test gradient' };
}
p.style.background = { mode: 'image', scope: 'scene', look: 'photo', notes: '', strength: 0.5, images };
const put = await api('projects/' + pid, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) });
const job = await api('jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'render', project: { ...p, rev: put.rev } }) });
console.log(JSON.stringify({ job: job.id, token: job.devToken, images: Object.keys(images).length }));
