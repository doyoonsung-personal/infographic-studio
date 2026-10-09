// End-to-end part 2: a manual build job for a collage project, run through the real worker on this PC
// (fetch -> composition -> check -> render -> upload), then the app's preview is checked for the clip.
//   node test/e2e-collage-build.mjs <projectId>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launchBrowser } from '../routine/lib/tools.mjs';

const BASE = process.env.STUDIO_URL || 'https://infographic-studio.pages.dev';
const pid = process.argv[2];
if (!pid) { console.error('project id required'); process.exit(2); }
const pw = (fs.readFileSync('.dev.vars', 'utf8').match(/^APP_PASSWORD=(.*)$/m) || [])[1];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const login = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) });
const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
const api = async (p, opts = {}) => {
  const r = await fetch(BASE + '/api/' + p, { ...opts, headers: { cookie, 'content-type': 'application/json', ...(opts.headers || {}) } });
  const j = await r.json();
  if (!r.ok) throw new Error(p + ': ' + (j.error || r.status));
  return j;
};
const project = await api('projects/' + pid);
const job = await api('jobs', { method: 'POST', body: JSON.stringify({ kind: 'build', manual: true, instruction: 'E2E test of the collage look', project: { ...project, chat: [], history: {} } }) });
log('job', job.id);

const node = process.execPath;
const env = { ...process.env, STUDIO_API_BASE: BASE };
const run = (args) => {
  const r = spawnSync(node, ['routine/worker.mjs', ...args], { env, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  console.log(`--- ${args[0]} (exit ${r.status})\n` + out.split('\n').filter((l) => l.trim()).slice(0, 40).join('\n'));
  if (r.status) throw new Error(args[0] + ' failed');
};
run(['fetch', '--job', job.id, '--token', job.token]);
const dir = path.join('work', job.id);
const brief = fs.readFileSync(path.join(dir, 'BRIEF.md'), 'utf8');
console.log('--- BRIEF (look / cut-outs part)\n' + brief.slice(brief.indexOf('## Look'), brief.indexOf('## Timeline')).trim());

// A small composition using the toolkit and the real cut-outs.
const p = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
const cuts = (p.assets.items || []).filter((a) => a.blobId);
const pick = (sid, i) => (cuts.filter((a) => a.sceneId === sid)[i] || cuts[i] || cuts[0] || {}).id;
const a1 = pick('s1', 0), a2 = pick('s2', 0) === a1 ? pick('s1', 1) : pick('s2', 0);
fs.writeFileSync(path.join(dir, 'composition.html'), `
<style>
.sc .piece{position:absolute}
.title{position:absolute;left:110px;top:96px;font-size:76px;transform:rotate(-1.5deg)}
.clipbox{position:absolute;left:120px;bottom:120px;width:640px;font-size:38px;line-height:1.55;transform:rotate(-1deg)}
.cut1{position:absolute;right:170px;top:150px;height:620px;transform:rotate(4deg)}
.cut2{position:absolute;right:220px;top:200px;height:560px;transform:rotate(-4deg)}
.num{position:absolute;left:130px;top:300px;font-size:150px;padding:6px 34px}
</style>
<section class="scene sc" data-scene="s1" data-transition="cut">
  <div class="c-shadow piece" style="left:70px;top:250px;width:760px;height:640px" data-drift="-18,0"><div class="c-paper c-torn" style="width:100%;height:100%"></div></div>
  ${a1 ? `<img data-asset="${a1}" class="c-cutout cut1" alt="" data-a="pop" data-cue="1" data-boil="0.7" data-drift="12,0">` : ''}
  <div class="title c-label" data-a="pop" data-in="0.2" data-boil="0.6" data-text="t1">서울의 공공자전거</div>
  <div class="c-shadow clipbox" data-a="down" data-cue="2" data-dist="30"><div class="c-clipping c-tape"><span data-text="c1">어디서나 보이는 </span><span data-hl data-cue="2" data-delay="0.3" data-text="c2">초록 자전거, 따릉이</span></div></div>
</section>
<section class="scene sc" data-scene="s2" data-transition="cut">
  ${a2 ? `<img data-asset="${a2}" class="c-cutout cut2" alt="" data-a="pop" data-in="0.3" data-boil="0.7">` : ''}
  <div class="num c-label" data-a="pop" data-cue="1" data-boil="0.5" data-text="n1">지하철역 앞</div>
  <svg style="position:absolute;left:90px;top:250px" width="900" height="320"><ellipse class="c-marker" cx="430" cy="160" rx="400" ry="130" data-draw data-cue="1" data-delay="0.5"/></svg>
  <div class="c-shadow clipbox" data-a="down" data-in="1.2" data-dist="30"><div class="c-clipping"><span data-text="c3">출퇴근길 </span><span data-hl data-cue="1" data-delay="0.6" data-text="c4">가장 많이 빌리는 곳</span></div></div>
</section>
<script type="application/json" id="texts">{"t1":"서울의 공공자전거","c1":"어디서나 보이는 ","c2":"초록 자전거, 따릉이","n1":"지하철역 앞","c3":"출퇴근길 ","c4":"가장 많이 빌리는 곳"}</script>
`);
run(['check', '--job', job.id]);
run(['render', '--job', job.id]);
run(['upload', '--job', job.id, '--notes', 'E2E test: collage look with real cut-outs and a moving background (s1).']);

// The app's preview: the clip layer should get the video and play it.
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
await page.goto(BASE + '/?v=' + Date.now());
await page.waitForSelector('input[type=password], .hero-new');
if (await page.$('input[type=password]')) { await page.fill('input[type=password]', pw); await page.keyboard.press('Enter'); await page.waitForSelector('.hero-new'); }
await page.goto(`${BASE}/#/p/${pid}`);
await page.waitForSelector('.node.k-preview .controls .btn');
await page.waitForTimeout(4000);
const frame = page.frames().find((f) => f !== page.mainFrame());
const before = await frame.evaluate(() => [...document.querySelectorAll('.__clip video')].map((v) => ({ src: v.src.slice(0, 5), t: v.currentTime, ready: v.readyState })));
await page.click('.node.k-preview .controls .btn');
await page.waitForTimeout(2500);
const during = await frame.evaluate(() => [...document.querySelectorAll('.__clip video')].map((v) => ({ t: +v.currentTime.toFixed(2), paused: v.paused })));
await page.screenshot({ path: path.join('work', 'e2e-collage', '3-preview.png') });
const assetsShown = await frame.evaluate(() => [...document.querySelectorAll('img[data-asset]')].map((i) => i.naturalWidth));
console.log(JSON.stringify({ job: job.id, before, during, assetsShown }));
await browser.close();
