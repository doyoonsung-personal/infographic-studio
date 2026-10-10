// Local test of "Upload my photo": signs in to the dev server, makes a scratch project, uploads a photo
// through the Cut-outs panel and saves what each mode/look produces (free: the cut-out runs in the browser).
//   node test/local-upload.mjs <photo> [person|object|photo,...] [--look none,halftone,faded]
//   -> work/upload-test/<mode>-<look>.(webp|jpg) and timings
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from '../routine/lib/tools.mjs';

const BASE = process.env.STUDIO_URL || 'http://127.0.0.1:8788';
const args = process.argv.slice(2);
const photo = args[0];
if (!photo || !fs.existsSync(photo)) { console.log('usage: node test/local-upload.mjs <photo> [modes] [--look none|halftone|faded]'); process.exit(1); }
const modes = (args[1] && !args[1].startsWith('--') ? args[1] : 'person').split(',');
const looks = (args.includes('--look') ? args[args.indexOf('--look') + 1] : 'none').split(',');
const out = path.join('work', 'upload-test');
fs.mkdirSync(out, { recursive: true });
const pw = (fs.readFileSync('.dev.vars', 'utf8').match(/^APP_PASSWORD=(.*)$/m) || [])[1];

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
if (args.includes('--trace')) {
  page.on('requestfinished', (r) => {
    const tm = r.timing();
    if (/\/api\//.test(r.url())) console.log(`    ${r.method()} ${r.url().replace(BASE, '').slice(0, 60)} ${Math.round(tm.responseEnd)} ms`);
  });
}
await page.goto(BASE + '/');
await page.waitForSelector('input[type=password], .hero-new', { timeout: 15000 });
if (await page.$('input[type=password]')) {
  await page.fill('input[type=password]', pw);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.hero-new', { timeout: 15000 });
}

const project = await page.evaluate(async () => {
  const r = await fetch('/api/projects', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    title: 'upload test', brief: { topic: 'upload test', format: 'animated', ratio: '16:9', language: 'ko' },
    script: { scenes: [{ id: 's1', title: '인물', narration: '테스트', onscreen: '', visual: '' }] },
  }) });
  return r.json();
});
await page.goto(`${BASE}/#/p/${project.id}`);
await page.waitForSelector('.node.k-assets');
await page.click('.node.k-assets .node-head');
await page.waitForSelector('.insp-body.k-assets');

const waitIdle = () => page.waitForFunction(() => !document.querySelector('.insp-body.k-assets [data-progress]'), null, { timeout: 600000 });
const saveResult = async (name) => {
  const src = await page.getAttribute('.insp-body.k-assets .cut-row img.cut-thumb', 'src');
  if (!src) throw new Error('no picture: ' + ((await page.textContent('.insp-body.k-assets .err').catch(() => '')) || '?'));
  const res = await page.request.get(BASE + src);
  const ext = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' }[res.headers()['content-type']] || 'bin';
  const file = path.join(out, `${name}.${ext}`);
  fs.writeFileSync(file, await res.body());
  return file;
};

let t0 = Date.now();
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.insp-body.k-assets button:has(svg) >> text=/내 사진 올리기|Upload my photo/')]);
await chooser.setFiles(photo);
await page.waitForSelector('.insp-body.k-assets [data-progress]', { timeout: 20000 }).catch(() => {});
let progressSeen = new Set();
const watch = setInterval(async () => { const t = await page.textContent('.insp-body.k-assets [data-progress]').catch(() => null); if (t) progressSeen.add(t.replace(/\d+%/, 'N%')); }, 500);
await waitIdle();
console.log(`upload + first cut-out: ${((Date.now() - t0) / 1000).toFixed(1)} s  (${[...progressSeen].join(' | ')})`);

const labels = { person: /인물 컷아웃|Person cut-out/, object: /사물 컷아웃|Object cut-out/, photo: /사진 그대로|Photo as is/ };
const lookLabels = { none: /원본 색|Original colour/, halftone: /흑백 망점|B&W halftone/, faded: /빛바랜 컬러|Faded colour/ };
// click an option; returns the error message shown for the photo, if any
const pick = async (nth, re) => {
  await page.click(`.cut-row .own .seg:nth-child(${nth}) button >> text=/${re.source}/`);
  await page.waitForTimeout(300);
  await waitIdle();
  return page.evaluate(() => document.querySelector('.insp-body.k-assets .cut-row .err')?.textContent || null);
};
const selected = () => page.evaluate(() => [...document.querySelectorAll('.cut-row .own .seg button.on')].map((b) => b.textContent).join(' + '));
for (const m of modes) {
  for (const look of looks) {
    t0 = Date.now();
    progressSeen = new Set();
    const err = (await pick(1, labels[m])) || (await pick(2, lookLabels[look]));
    console.log(`${m} / ${look}: ${((Date.now() - t0) / 1000).toFixed(1)} s  (${[...progressSeen].join(' | ')})`);
    if (err) { console.log(`  message: ${err.trim()}\n  switches now: ${await selected()}`); break; }
    console.log('  saved', await saveResult(`${m}-${look}`));
  }
}
clearInterval(watch);
await page.screenshot({ path: path.join(out, 'panel.png') });
await page.evaluate(async (id) => { await fetch('/api/projects/' + id, { method: 'DELETE', credentials: 'same-origin' }); }, project.id);
console.log(errors.length ? 'errors:\n  ' + errors.join('\n  ') : 'no page errors');
await browser.close();
