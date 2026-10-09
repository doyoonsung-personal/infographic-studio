// Local UI smoke test: signs in to the dev server with headless Edge/Chrome and screenshots views.
//   node test/ui-shot.mjs <outDir> [path] [--click selector ...] [--mobile]
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from '../routine/lib/tools.mjs';

const BASE = process.env.STUDIO_URL || 'http://127.0.0.1:8788';
const args = process.argv.slice(2);
const out = args[0] || 'work/ui';
const target = args[1] && !args[1].startsWith('--') ? args[1] : '/';
const clicks = [];
let mobile = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--click') clicks.push(args[++i]);
  if (args[i] === '--mobile') mobile = true;
}
fs.mkdirSync(out, { recursive: true });
const pw = (fs.readFileSync('.dev.vars', 'utf8').match(/^APP_PASSWORD=(.*)$/m) || [])[1];

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(BASE + '/');
await page.waitForSelector('input[type=password], .hero-new', { timeout: 15000 });
if (await page.$('input[type=password]')) {
  await page.fill('input[type=password]', pw);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.hero-new', { timeout: 15000 });
}
if (target !== '/') {
  await page.goto(BASE + '/#' + target.replace(/^#/, ''));
}
await page.waitForTimeout(2500);
let n = 0;
await page.screenshot({ path: path.join(out, `${String(n++).padStart(2, '0')}.png`) });
for (const sel of clicks) {
  try {
    await page.click(sel, { timeout: 5000 });
    await page.waitForTimeout(1500);
  } catch (e) { errors.push('click failed: ' + sel + ' ' + e.message.split('\n')[0]); }
  await page.screenshot({ path: path.join(out, `${String(n++).padStart(2, '0')}.png`) });
}
console.log(JSON.stringify({ shots: n, errors }, null, 1));
await browser.close();
