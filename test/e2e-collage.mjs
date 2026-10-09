// End-to-end (PAID, small): a collage project through the live app UI — plan + generate cut-outs,
// generate 2 background images, animate one of them into a clip.
//   node test/e2e-collage.mjs [projectId]     (creates a test project when no id is given)
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from '../routine/lib/tools.mjs';

const BASE = process.env.STUDIO_URL || 'https://infographic-studio.pages.dev';
const OUT = process.env.SHOT_DIR || 'work/e2e-collage';
fs.mkdirSync(OUT, { recursive: true });
const pw = (fs.readFileSync('.dev.vars', 'utf8').match(/^APP_PASSWORD=(.*)$/m) || [])[1];
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

await page.goto(BASE + '/?v=' + Date.now());
await page.waitForSelector('input[type=password], .hero-new');
if (await page.$('input[type=password]')) { await page.fill('input[type=password]', pw); await page.keyboard.press('Enter'); await page.waitForSelector('.hero-new'); }

let pid = process.argv[2];
if (!pid) {
  pid = await page.evaluate(async () => {
    const body = {
      title: '콜라주 테스트 · 서울 따릉이',
      brief: { topic: '서울 공공자전거 따릉이', takeaway: '따릉이는 서울 시민의 일상 교통수단이 됐다', language: 'ko', format: 'animated', ratio: '16:9', length: 15 },
      facts: { items: [] },
      script: { scenes: [
        { id: 's1', title: '도입', narration: '서울 어디서나 보이는 {1}초록 자전거, {2}따릉이입니다.', onscreen: '서울의 공공자전거 따릉이', visual: '서울 거리에 줄지어 선 공공자전거 대여소와 출근하는 시민', seconds: 6 },
        { id: 's2', title: '일상', narration: '출퇴근길 {1}지하철역 앞에서 가장 많이 빌립니다.', onscreen: '지하철역 앞 대여소', visual: '지하철 출구 앞 자전거 대여소, 아침 햇살', seconds: 6 },
      ] },
      style: {
        look: 'collage', font: 'sans', motion: 'lively',
        colors: { bg: '#efe7d8', surface: '#fbf6ec', text: '#1c1a17', muted: '#6e665b', accent: '#f6c915', accent2: '#e2422e', accent3: '#2f6db5' },
        paletteId: 'collage-paper', paletteName: 'Collage Paper',
        background: { mode: 'image', scope: 'scene', look: 'collage', notes: '', strength: 0.45, images: {} },
      },
      voice: { enabled: false, clips: {} }, music: { enabled: false },
    };
    const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return (await r.json()).id;
  });
  log('created project', pid);
}
await page.goto(`${BASE}/#/p/${pid}`);
await page.waitForSelector('.node.k-assets');
await page.waitForTimeout(1500);

// 1. Cut-outs: plan (Qwen), then generate the first two.
await page.click('.node.k-assets .node-head');
await page.waitForSelector('.insp-body.k-assets');
if (!(await page.$('.insp .cut-row'))) {
  log('planning cut-outs…');
  await page.click('.insp-body.k-assets .row.wrap button');
  await page.waitForSelector('.insp .cut-row', { timeout: 120000 });
}
const rows = await page.$$eval('.insp .cut-row', (rs) => rs.map((r) => ({ name: r.querySelector('input').value, subject: r.querySelector('textarea').value })));
log('plan:', JSON.stringify(rows));
const want = Math.min(2, rows.length);
for (let i = 0; i < want; i++) {
  const made = await page.$$eval('.insp img.cut-thumb', (x) => x.length);
  if (made > i) continue;
  log('generating cut-out', i + 1);
  const btns = await page.$$('.insp .cut-row');
  await (await btns[i].$('button.btn.xs.icon')).click();
  await page.waitForFunction((n) => document.querySelectorAll('.insp img.cut-thumb').length > n || document.querySelectorAll('.insp .cut-row .err').length > 0, i, { timeout: 180000 });
}
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(OUT, '1-cutouts.png') });
log('cut-outs made:', await page.$$eval('.insp img.cut-thumb', (x) => x.length), 'errors:', await page.$$eval('.insp .cut-row .err', (x) => x.map((e) => e.textContent)));

// 2. Background images for both scenes.
await page.click('.node.k-style .node-head');
await page.waitForSelector('.insp-body.k-style');
const haveBg = await page.$$eval('.insp-body.k-style .card img', (x) => x.length);
if (haveBg < 2) {
  log('generating backgrounds…');
  await page.click('.insp-body.k-style button.btn.primary');
  await page.waitForFunction(() => document.querySelectorAll('.insp-body.k-style .card img, .insp-body.k-style .card video').length >= 2, null, { timeout: 240000 });
}
log('backgrounds ready');

// 3. Animate the first background (image-to-video, ~1–4 minutes).
if (!(await page.$('.insp-body.k-style .card video'))) {
  log('animating s1…');
  const filmBtn = await page.$('.insp-body.k-style .card button[title]:has(svg)');
  const cards = await page.$$('.insp-body.k-style .card');
  const firstFilm = await cards[0].$$('button');
  await firstFilm[0].click();
  await page.waitForSelector('.insp-body.k-style .card video', { timeout: 900000 });
}
await page.waitForTimeout(2000);
await page.screenshot({ path: path.join(OUT, '2-style.png') });
const proj = await page.evaluate(async (id) => (await (await fetch('/api/projects/' + id)).json()), pid);
const clip = Object.entries(proj.style.background.images || {}).filter(([, v]) => v.clip).map(([k, v]) => `${k}: ${v.clip.model} ${v.clip.duration}s ${v.clip.blobId}`);
log('clips:', clip.join(' | '));
log('assets:', proj.assets.items.map((a) => `${a.id} ${a.sceneId} ${a.name} ${a.blobId || '-'} ${a.w || ''}x${a.h || ''}`).join(' | '));
console.log(JSON.stringify({ pid, errors }));
await browser.close();
