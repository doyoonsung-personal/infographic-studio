// Local render test of the collage look: synthetic cut-out, background images and a moving-background
// clip, through the real worker check + render (no app, no paid calls).
//   node test/local-collage.mjs        -> work/j_localcollage/out/{contact.jpg,video.mp4}
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { computeTimeline } from '../public/js/timeline.js';
import { ffmpeg } from '../routine/lib/tools.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const id = 'j_localcollage';
const dir = path.join(ROOT, 'work', id);
fs.rmSync(dir, { recursive: true, force: true });
for (const d of ['out', 'assets', 'images', 'clips/s1']) fs.mkdirSync(path.join(dir, d), { recursive: true });

const project = {
  id: 'p_local', title: 'Collage test',
  brief: { topic: '도시의 자전거', language: 'ko', format: 'animated', ratio: '16:9', length: 12 },
  facts: { items: [{ claim: '서울 공공자전거 대여는 2024년 4,500만 건이다', value: '4,500만 건' }] },
  script: { scenes: [
    { id: 's1', title: '도입', narration: '서울에서는 {1}공공자전거가 {2}일상이 됐습니다.', onscreen: '공공자전거', visual: 'bike', seconds: 6 },
    { id: 's2', title: '숫자', narration: '한 해 대여 {1}4,500만 건.', onscreen: '4,500만 건', visual: 'number', seconds: 6 },
  ] },
  style: {
    look: 'collage', font: 'sans',
    colors: { bg: '#efe7d8', surface: '#fbf6ec', text: '#1c1a17', muted: '#6e665b', accent: '#f6c915', accent2: '#e2422e', accent3: '#2f6db5' },
    background: { mode: 'image', scope: 'scene', strength: 0.35, images: { s1: { blobId: 'b_x1', clip: { blobId: 'b_c1', duration: 3 } }, s2: { blobId: 'b_x2' } } },
  },
  assets: { style: 'halftone', items: [{ id: 'a_bike1', sceneId: 's1', name: '자전거', subject: 'a bicycle', blobId: 'b_a1', w: 400, h: 300 }] },
  voice: { enabled: false, clips: {} }, music: { enabled: false }, edits: { texts: {} },
};
const tl = computeTimeline(project);
fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(project));
fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify(tl));
fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify({ id, kind: 'build' }));
fs.writeFileSync(path.join(dir, 'ticket.json'), JSON.stringify({ job_id: id, token: 'x' }));

// Synthetic media: a transparent "cut-out", two background images, a 3 s clip cut into frames.
await ffmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=0x00ff00:s=400x300', '-vf', 'drawbox=x=40:y=60:w=320:h=180:color=0x2f6db5:t=fill,drawbox=x=120:y=20:w=160:h=60:color=0xe2422e:t=fill,colorkey=0x00ff00:0.3:0,format=rgba', '-frames:v', '1', path.join(dir, 'assets', 'a_bike1.png')]);
await ffmpeg(['-y', '-f', 'lavfi', '-i', 'gradients=s=1664x928:c0=0xc9b48f:c1=0x6d8fb3:duration=1', '-frames:v', '1', path.join(dir, 'images', 's1.img.jpg')]);
fs.renameSync(path.join(dir, 'images', 's1.img.jpg'), path.join(dir, 'images', 's1.img'));
await ffmpeg(['-y', '-f', 'lavfi', '-i', 'gradients=s=1664x928:c0=0xe2c48f:c1=0x2f6db5:duration=1', '-frames:v', '1', path.join(dir, 'images', 's2.img.jpg')]);
fs.renameSync(path.join(dir, 'images', 's2.img.jpg'), path.join(dir, 'images', 's2.img'));
await ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=24:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(dir, 'clips', 's1.mp4')]);
await ffmpeg(['-y', '-i', path.join(dir, 'clips', 's1.mp4'), '-an', '-vf', `fps=${tl.fps},scale=${tl.width}:${tl.height}:force_original_aspect_ratio=increase,crop=${tl.width}:${tl.height}`, '-q:v', '3', path.join(dir, 'clips', 's1', '%05d.jpg')]);

fs.writeFileSync(path.join(dir, 'composition.html'), `
<style>
.s .torn-wrap{position:absolute}
.title{position:absolute;left:120px;top:110px;font-size:84px}
.clip{position:absolute;right:140px;bottom:160px;width:620px;font-size:40px;line-height:1.5;transform:rotate(1.5deg)}
.big{position:absolute;left:160px;top:330px;font-size:220px;font-weight:900;padding:10px 40px}
.cut{position:absolute;right:260px;top:180px;height:420px;transform:rotate(-5deg)}
</style>
<section class="scene s" data-scene="s1" data-transition="cut">
  <div class="c-shadow torn-wrap" style="left:90px;top:300px;width:900px;height:520px" data-drift="-20,0"><div class="c-paper c-torn" style="width:100%;height:100%"></div></div>
  <div class="title c-label" data-a="pop" data-cue="1" data-boil="0.8" data-text="t1">공공자전거</div>
  <img data-asset="a_bike1" class="c-cutout cut" alt="" data-a="pop" data-cue="2" data-boil="1">
  <div class="c-shadow clip" data-a="down" data-in="0.6"><div class="c-clipping c-tape"><span data-text="c1">서울에서는 </span><span data-hl data-cue="2" data-text="c2">공공자전거가 일상</span></div></div>
</section>
<section class="scene s" data-scene="s2" data-transition="cut">
  <div class="big c-label" data-a="pop" data-cue="1" data-boil="0.6"><span data-count="4500" data-suffix="만 건" data-sep=","></span></div>
  <svg style="position:absolute;left:120px;top:280px" width="1100" height="400"><ellipse class="c-marker" cx="560" cy="200" rx="520" ry="170" data-draw data-cue="1" data-delay="0.4"/></svg>
</section>
<script type="application/json" id="texts">{"t1":"공공자전거","c1":"서울에서는 ","c2":"공공자전거가 일상"}</script>
`);

const node = process.execPath;
const env = { ...process.env, STUDIO_API_BASE: 'http://127.0.0.1:9' };
for (const cmd of ['check', 'render']) {
  const r = spawnSync(node, [path.join(ROOT, 'routine', 'worker.mjs'), cmd, '--job', id], { env, encoding: 'utf8', cwd: ROOT });
  console.log(`--- ${cmd} (exit ${r.status})\n${(r.stdout || '').split('\n').filter((l) => !/status update failed/.test(l)).slice(0, 30).join('\n')}`);
  if (r.status && cmd === 'check') console.log(r.stderr.split('\n').filter((l) => !/status update failed/.test(l)).slice(0, 10).join('\n'));
}
