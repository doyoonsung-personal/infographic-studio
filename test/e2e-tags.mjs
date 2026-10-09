// Voice model switch -> tag dialog -> tags inserted; switch back -> tags removed. (One Qwen call.)
//   node test/e2e-tags.mjs <projectId>
import fs from 'node:fs';
import { launchBrowser } from '../routine/lib/tools.mjs';

const BASE = process.env.STUDIO_URL || 'http://127.0.0.1:8788';
const OUT = 'work/e2e-tags';
fs.mkdirSync(OUT, { recursive: true });
const pid = process.argv[2];
const pw = (fs.readFileSync('.dev.vars', 'utf8').match(/^APP_PASSWORD=(.*)$/m) || [])[1];
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const narr = () => page.evaluate(async (id) => (await (await fetch('/api/projects/' + id)).json()).script.scenes.map((s) => s.narration), pid);

await page.goto(BASE + '/');
await page.waitForSelector('input[type=password], .hero-new');
if (await page.$('input[type=password]')) {
  await page.fill('input[type=password]', pw);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.hero-new');
}
await page.goto(`${BASE}/#/p/${pid}`);
await page.waitForSelector('.node.k-voice');
await page.click('.node.k-voice .node-head');
await page.waitForTimeout(600);
// Make sure we start from a non-tag model.
const sel = '.insp select >> nth=1';
await page.selectOption(sel, 'eleven_multilingual_v2');
await page.waitForTimeout(1200);
console.log('before:', (await narr()).slice(0, 2));

await page.selectOption(sel, 'eleven_v4');
await page.waitForSelector('.modal textarea', { timeout: 5000 });
await page.screenshot({ path: `${OUT}/01-dialog.png` });
await page.fill('.modal textarea', '차분하고 신뢰감 있게, 숫자에서만 살짝 힘주기');
await page.click('.modal .btn.primary');
await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /태그|tags/i.test(t.textContent)), null, { timeout: 120000 });
await page.waitForTimeout(1500);
console.log('toast:', await page.$$eval('.toast', (els) => els.map((e) => e.textContent).join(' | ')));
const tagged = await narr();
console.log('after v4:', tagged);
await page.screenshot({ path: `${OUT}/02-tagged.png` });

await page.selectOption(sel, 'eleven_multilingual_v2');
await page.waitForTimeout(2000);
const cleaned = await narr();
console.log('after v2:', cleaned.slice(0, 2));
console.log(JSON.stringify({ errors, tagsRemoved: cleaned.every((n) => !/\[[^\]]+\]/.test(n)) }));
await browser.close();
