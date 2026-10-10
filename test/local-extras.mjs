// Local render test of the extra features: ambient backgrounds, camera keyframes, camera transitions
// (push, zoom-in, whip, circle, morph, zoom-out), a GSAP SplitText timeline and sound effects (synthetic
// tones), through the real worker check + render. s7 is deliberately frozen: check must flag it.
//   node test/local-extras.mjs        -> work/j_localextras/out/{contact.jpg,video.mp4}
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { computeTimeline } from '../public/js/timeline.js';
import { ffmpeg } from '../routine/lib/tools.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const id = 'j_localextras';
const dir = path.join(ROOT, 'work', id);
fs.rmSync(dir, { recursive: true, force: true });
for (const d of ['out', 'sfx']) fs.mkdirSync(path.join(dir, d), { recursive: true });

const sc = (id, narration) => ({ id, title: id, narration, onscreen: id, visual: '' });
const project = {
  id: 'p_local', title: 'Extras test',
  brief: { topic: 'extras', language: 'ko', format: 'animated', ratio: '16:9', length: 20 },
  facts: { items: [] },
  script: { scenes: [
    sc('s1', '첫 장면입니다. {1}숫자가 올라갑니다.'), sc('s2', '숫자 속으로 {1}들어가 봅니다.'), sc('s3', '옆으로 밀어 {1}넘어갑니다.'),
    sc('s4', '빠르게 {1}휙 넘깁니다.'), sc('s5', '원으로 {1}열립니다.'), sc('s6', '로고가 {1}미끄러집니다.'), sc('s7', '마지막은 멈춘 장면입니다.'),
  ] },
  style: { font: 'sans', colors: { bg: '#0f1420', surface: '#1a2133', text: '#f2f4f8', muted: '#9aa4b8', accent: '#ff7a1a', accent2: '#3ec6ff', accent3: '#9b7bff' }, background: { mode: 'color' } },
  extras: { sfx: { enabled: true, auto: true, volume: 1 }, ambient: { enabled: true }, camera: { enabled: true }, gsap: { enabled: true } },
  voice: { enabled: false, clips: {} }, music: { enabled: false }, edits: { texts: {} },
};
const tl = computeTimeline(project);
fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(project));
fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify(tl));
fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify({ id, kind: 'build' }));
fs.writeFileSync(path.join(dir, 'ticket.json'), JSON.stringify({ job_id: id, token: 'x' }));
console.log('timeline:', tl.scenes.map((s) => `${s.id} ${s.start}-${s.end}`).join(' | '));

// Synthetic "sound effects": short tones at different pitches.
const tones = { whoosh: 300, swoosh: 420, pop: 880, tick: 1200, marker: 660, ding: 1500 };
for (const [name, hz] of Object.entries(tones)) {
  await ffmpeg(['-y', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=0.4`, '-af', 'afade=t=out:st=0.25:d=0.15', '-c:a', 'libmp3lame', '-q:a', '4', path.join(dir, 'sfx', name + '.mp3')]);
}

fs.writeFileSync(path.join(dir, 'composition.html'), `
<style>
.sc{display:grid;place-items:center}
.h{font-size:96px;font-weight:900;letter-spacing:-.02em}
.num{font-size:180px;font-weight:900;color:var(--accent)}
.card{position:absolute;padding:28px 36px;border-radius:24px;background:color-mix(in srgb,var(--surface) 85%,transparent);font-size:44px}
.logo{position:absolute;width:160px;height:160px;border-radius:40px;background:var(--accent2);display:grid;place-items:center;font-size:64px;font-weight:900;color:var(--bg)}
</style>
<section class="scene sc" data-scene="s1" data-focus="#num">
  <div data-ambient="glow" style="z-index:-1"></div>
  <div data-ambient="particles" style="z-index:-1"></div>
  <div style="text-align:center">
    <div class="h s1-title" data-text="t1">숫자가 올라갑니다</div>
    <div id="num" class="num" data-count="4500" data-cue="1" data-suffix="만"></div>
  </div>
</section>
<section class="scene sc" data-scene="s2" data-transition="zoom-in" data-cam="0: 1 960 540; c1: #detail 1.8; c1+1.4: 1 960 540">
  <div data-ambient="grid" data-tilt style="z-index:-1"></div>
  <div class="card" style="left:200px;top:220px" data-a="pop" data-in="0.2">왼쪽 카드</div>
  <div id="detail" class="card" style="right:220px;bottom:220px" data-a="pop" data-cue="1" data-sfx="ding">확대할 부분</div>
</section>
<section class="scene sc" data-scene="s3" data-transition="push">
  <div data-ambient="waves" style="z-index:-1"></div>
  <div class="card" style="left:160px;top:160px" data-depth="0.5">먼 레이어</div>
  <div class="card" style="right:180px;bottom:180px;font-size:64px" data-depth="1.4" data-loop="float">가까운 레이어</div>
  <div class="logo" data-share="logo" style="left:860px;top:460px">L</div>
</section>
<section class="scene sc" data-scene="s4" data-transition="whip">
  <div data-ambient="gradient" style="z-index:-1"></div>
  <div class="h" data-a="pop" data-in="0.3" data-loop="pulse">휙!</div>
</section>
<section class="scene sc" data-scene="s5" data-transition="circle" data-focus="#c5">
  <div data-ambient="particles" data-n="30" style="z-index:-1"></div>
  <div id="c5" class="h" data-a="up" data-in="0.2"><span data-hl data-cue="1">원으로 열림</span></div>
  <div class="logo" data-share="logo" style="left:880px;top:700px">L</div>
</section>
<section class="scene sc" data-scene="s6" data-transition="morph">
  <div data-ambient="glow" style="z-index:-1"></div>
  <div class="logo" data-share="logo" style="left:120px;top:120px;width:320px;height:320px;font-size:120px">L</div>
  <div class="h" style="position:absolute;right:200px;top:430px" data-a="right" data-in="0.6">모프 완료</div>
</section>
<section class="scene sc" data-scene="s7" data-transition="zoom-out">
  <div class="h">멈춘 장면</div>
</section>
<script type="application/json" id="texts">{"t1":"숫자가 올라갑니다"}</script>
<script>
window.STAGE_TIMELINES = {
  s1: (tl, c) => {
    const split = SplitText.create(c.q('.s1-title')[0], { type: 'chars' });
    tl.from(split.chars, { yPercent: 120, opacity: 0, duration: 0.6, ease: 'back.out(1.7)', stagger: 0.04 }, 0.2);
  },
};
</script>
`);

const node = process.execPath;
const env = { ...process.env, STUDIO_API_BASE: 'http://127.0.0.1:9' };
for (const cmd of ['check', 'render']) {
  const r = spawnSync(node, [path.join(ROOT, 'routine', 'worker.mjs'), cmd, '--job', id], { env, encoding: 'utf8', cwd: ROOT });
  console.log(`--- ${cmd} (exit ${r.status})\n${(r.stdout || '').split('\n').filter((l) => l.trim()).slice(0, 30).join('\n')}`);
  const err = (r.stderr || '').split('\n').filter((l) => l.trim() && !/status update failed/.test(l));
  if (err.length) console.log(err.slice(0, 10).join('\n'));
}
const rep = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'report.json'), 'utf8'));
console.log(JSON.stringify({ frozen: rep.frozen, sfx: rep.sfx, errors: rep.errors, warnings: rep.warnings.slice(0, 8) }, null, 1));
