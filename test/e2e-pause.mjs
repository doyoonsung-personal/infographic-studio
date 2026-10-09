// Preview play/pause (node + inspector) and the music play/pause toggle.
//   node test/e2e-pause.mjs <projectId>
import fs from 'node:fs';
import { launchBrowser } from '../routine/lib/tools.mjs';

const BASE = process.env.STUDIO_URL || 'http://127.0.0.1:8788';
const pid = process.argv[2];
const pw = (fs.readFileSync('.dev.vars', 'utf8').match(/^APP_PASSWORD=(.*)$/m) || [])[1];
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(BASE + '/');
await page.waitForSelector('input[type=password], .hero-new');
if (await page.$('input[type=password]')) {
  await page.fill('input[type=password]', pw);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.hero-new');
}
await page.goto(`${BASE}/#/p/${pid}`);
await page.waitForSelector('.node.k-preview .controls .btn');
await page.waitForTimeout(2500);
const tc = (sel) => page.textContent(sel);

async function check(scope, name) {
  const btn = `${scope} .controls .btn`;
  await page.click(btn);
  await page.waitForTimeout(1500);
  const a = await tc(`${scope} .tc`);
  await page.click(btn); // pause while playing (icon must not swallow the click)
  await page.waitForTimeout(300);
  const b = await tc(`${scope} .tc`);
  await page.waitForTimeout(1200);
  const c = await tc(`${scope} .tc`);
  console.log(`${name}: playing ${a} -> paused ${b} -> 1.2s later ${c} => ${b === c ? 'PAUSED OK' : 'STILL RUNNING'}`);
}
await check('.node.k-preview', 'node preview');
await page.click('.node.k-preview .node-head');
await page.waitForSelector('.insp .controls .btn');
await page.waitForTimeout(2000);
await check('.insp', 'inspector preview');

// Music toggle
await page.click('.node.k-music .node-head');
await page.waitForTimeout(600);
const music = page.locator('.insp button:has([data-lbl])');
if (await music.count()) {
  await music.first().click();
  await page.waitForTimeout(1200);
  const s1 = await music.first().textContent();
  await music.first().click();
  await page.waitForTimeout(400);
  const s2 = await music.first().textContent();
  console.log(`music toggle: after play "${s1.trim()}" -> after second click "${s2.trim()}"`);
} else console.log('music: no track on this project');
console.log(JSON.stringify({ errors }));
await browser.close();
