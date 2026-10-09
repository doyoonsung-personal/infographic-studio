// End-to-end check of the Qwen steps through the real UI (costs a few cents of Qwen):
// create project -> brief suggestion -> research -> script -> palette ideas. Screenshots in work/e2e.
import fs from 'node:fs';
import { launchBrowser } from '../routine/lib/tools.mjs';

const BASE = process.env.STUDIO_URL || 'http://127.0.0.1:8788';
const OUT = 'work/e2e';
fs.mkdirSync(OUT, { recursive: true });
const topic = process.argv[2] || '한국의 1인 가구는 얼마나 늘었나?';
const pw = (fs.readFileSync('.dev.vars', 'utf8').match(/^APP_PASSWORD=(.*)$/m) || [])[1];

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/401/.test(m.text())) errors.push('console: ' + m.text()); });
const shot = async (n) => page.screenshot({ path: `${OUT}/${n}.png` });
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);

await page.goto(BASE + '/');
await page.waitForSelector('input[type=password], .hero-new');
if (await page.$('input[type=password]')) {
  await page.fill('input[type=password]', pw);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.hero-new');
}
await page.fill('.hero-new textarea', topic);
await page.click('.hero-new .btn.primary');
await page.waitForSelector('.node.k-brief');
log('project created: ' + page.url());

// Brief suggestion runs automatically for a new project.
await page.waitForFunction(() => document.querySelector('.node.k-brief .pill')?.textContent && !document.querySelector('.node.k-brief.is-running'), null, { timeout: 120000 });
await page.waitForTimeout(500);
log('brief: ' + (await page.textContent('.node.k-brief .node-body')));
await shot('01-brief');

// Research
await page.click('.node.k-facts .node-foot .btn');
await page.waitForSelector('.node.k-facts.is-running', { timeout: 10000 }).catch(() => {});
await page.waitForFunction(() => !document.querySelector('.node.k-facts.is-running'), null, { timeout: 240000 });
log('facts: ' + (await page.textContent('.node.k-facts .node-body')));
await shot('02-facts');

// Script
await page.click('.node.k-script .node-foot .btn');
await page.waitForSelector('.node.k-script.is-running', { timeout: 10000 }).catch(() => {});
await page.waitForFunction(() => !document.querySelector('.node.k-script.is-running'), null, { timeout: 300000 });
log('script: ' + (await page.textContent('.node.k-script .node-body')));
await shot('03-script');

// Open script inspector
await page.click('.node.k-script .node-head');
await page.waitForTimeout(800);
await shot('04-script-inspector');

// Style inspector + palette ideas
await page.click('.node.k-style .node-head');
await page.waitForTimeout(500);
const btns = await page.$$('.insp .direction .btn.primary');
if (btns[0]) {
  await btns[0].click();
  await page.waitForFunction(() => document.querySelectorAll('.insp .direction .pal').length > 0, null, { timeout: 120000 }).catch(() => {});
}
log('palette ideas: ' + (await page.$$eval('.insp .direction .pal', (els) => els.map((e) => e.textContent.slice(0, 40)).join(' | '))));
await shot('05-style');

// Voice inspector (no generation)
await page.click('.node.k-voice .node-head');
await page.waitForTimeout(500);
await shot('06-voice');

const state = await page.evaluate(async () => {
  const id = location.hash.split('/').pop();
  const r = await fetch('/api/projects/' + id);
  return r.json();
});
fs.writeFileSync(`${OUT}/project.json`, JSON.stringify(state, null, 2));
log(`facts=${state.facts.items.length} scenes=${state.script.scenes.length} voice=${state.voice.voiceRef} enabled=${state.voice.enabled}`);
console.log(JSON.stringify({ errors }, null, 1));
await browser.close();
