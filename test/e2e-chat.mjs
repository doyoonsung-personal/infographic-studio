// Chat agent + palette ideas through the UI (a few Qwen calls).
//   node test/e2e-chat.mjs <projectId> "message 1" "message 2" ...
import fs from 'node:fs';
import { launchBrowser } from '../routine/lib/tools.mjs';

const BASE = process.env.STUDIO_URL || 'http://127.0.0.1:8788';
const OUT = 'work/e2e-chat';
fs.mkdirSync(OUT, { recursive: true });
const [pid, ...messages] = process.argv.slice(2);
const pw = (fs.readFileSync('.dev.vars', 'utf8').match(/^APP_PASSWORD=(.*)$/m) || [])[1];
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/401/.test(m.text())) errors.push('console: ' + m.text()); });
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);

await page.goto(BASE + '/');
await page.waitForSelector('input[type=password], .hero-new');
if (await page.$('input[type=password]')) {
  await page.fill('input[type=password]', pw);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.hero-new');
}
await page.goto(`${BASE}/#/p/${pid}`);
await page.waitForSelector('.node.k-style');
await page.waitForTimeout(1500);
log('title: ' + (await page.$eval('.crumb', (e) => e.textContent + ' | input=' + (e.querySelector('input')?.value || ''))));

// Palette ideas
await page.click('.node.k-style .node-head');
await page.waitForTimeout(400);
await page.click('.insp .direction .btn.primary');
await page.waitForFunction(() => document.querySelectorAll('.insp .direction .pal').length > 0, null, { timeout: 120000 });
log('palette ideas: ' + (await page.$$eval('.insp .direction .pal', (els) => els.map((e) => e.textContent.slice(0, 50)).join(' | '))));
await page.screenshot({ path: `${OUT}/01-palettes.png` });

for (const [i, m] of messages.entries()) {
  const before = await page.$$eval('.msgs .msg', (e) => e.length);
  await page.fill('.chat-in textarea', m);
  await page.keyboard.press('Enter');
  // Wait until the send button is back (not the stop icon) and no new bubbles for 2s.
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => !document.querySelector('.chat-in .btn svg path[d^="M6 6l12"]'), null, { timeout: 240000 });
  await page.waitForTimeout(1500);
  const after = await page.$$eval('.msgs .msg', (els) => els.map((e) => e.className.replace('msg ', '') + ': ' + e.textContent.slice(0, 160)));
  log(`chat ${i + 1} "${m}":\n   ` + after.slice(before).join('\n   '));
  await page.screenshot({ path: `${OUT}/0${i + 2}-chat.png` });
}
const state = await page.evaluate(async (id) => (await fetch('/api/projects/' + id)).json(), pid);
log(`brief.length=${state.brief.length} palette=${state.style.paletteName || state.style.paletteId} chat=${state.chat.length}`);
console.log(JSON.stringify({ errors }, null, 1));
await browser.close();
