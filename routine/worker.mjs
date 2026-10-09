#!/usr/bin/env node
// Infographic Studio worker: the routine's toolbox. See routine/ROUTINE.md for the order of steps.
//
//   node routine/worker.mjs fetch    --job <id> --token <token>   download the job into work/<id>/
//   node routine/worker.mjs status   --job <id> --msg "..."        progress line shown in the app
//   node routine/worker.mjs check    --job <id>                    lint + frame checks + contact sheets
//   node routine/worker.mjs render   --job <id>                    final MP4 (or PNG/PDF for static)
//   node routine/worker.mjs upload   --job <id> [--notes "..."]    send results, finish the job
//   node routine/worker.mjs complete --job <id> --notes "..."      finish without files (ping jobs)
//   node routine/worker.mjs fail     --job <id> --reason "..."     report a failure to the app
//
// The app's address comes from STUDIO_API_BASE (never from the job payload).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { computeTimeline, peakTime, FPS } from '../public/js/timeline.js';
import { assembleDocument, styleKey } from '../public/js/assemble.js';
import { lintComposition, checkScenes } from '../public/js/lint.js';
import { launchBrowser, ffmpeg, ffmpegFrameSink, probeDuration } from './lib/tools.mjs';
import { writeBrief } from './lib/brief.mjs';
import { mixAudio } from './lib/audio.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME = fs.readFileSync(path.join(ROOT, 'public/runtime/stage.js'), 'utf8');
const MAX_UPLOAD = 24.5 * 1024 * 1024;

/* ---------- args ---------- */
const [cmd, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) {
    const k = rest[i].slice(2);
    const v = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
    args[k] = v;
  }
}

function die(msg) {
  console.error('ERROR: ' + msg);
  process.exit(1);
}

function apiBase() {
  const b = process.env.STUDIO_API_BASE;
  if (!b) die('STUDIO_API_BASE is not set. It must be the app address, e.g. https://infographic-studio.pages.dev');
  const u = new URL(b);
  if (u.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(u.hostname)) die('STUDIO_API_BASE must be https');
  return u.origin;
}

function jobDir(id) {
  if (!/^j_[\w-]+$/.test(id || '')) die('--job <id> is required (looks like j_xxxx)');
  return path.join(ROOT, 'work', id);
}

function ticket(id) {
  const f = path.join(jobDir(id), 'ticket.json');
  if (!fs.existsSync(f)) die(`job ${id} has not been fetched yet: run "fetch --job ${id} --token <token>" first`);
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

async function api(id, method, p, body, extraHeaders = {}) {
  const t = ticket(id);
  const r = await fetch(apiBase() + p, {
    method,
    headers: { 'x-job-token': t.token, ...(body && !(body instanceof Buffer) ? { 'content-type': 'application/json' } : {}), ...extraHeaders },
    body: body instanceof Buffer ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${p} -> ${r.status}: ${text.slice(0, 400)}`);
  try { return JSON.parse(text); } catch { return text; }
}

function sessionUrl() {
  const id = process.env.CLAUDE_CODE_REMOTE_SESSION_ID;
  return id ? 'https://claude.ai/code/' + id.replace(/^cse_/, 'session_') : null;
}

async function status(id, message, stage) {
  try {
    await api(id, 'POST', `/api/worker/jobs/${id}/status`, { message, stage, sessionUrl: sessionUrl() });
  } catch (e) {
    console.error('(status update failed: ' + e.message + ')');
  }
}

function readJSON(f) { return JSON.parse(fs.readFileSync(f, 'utf8')); }
function writeJSON(f, v) { fs.writeFileSync(f, JSON.stringify(v, null, 2)); }

/* ---------- fetch ---------- */
async function cmdFetch() {
  const id = args.job;
  const dir = jobDir(id);
  if (!args.token || typeof args.token !== 'string') die('--token is required');
  fs.mkdirSync(path.join(dir, 'audio'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'out'), { recursive: true });
  writeJSON(path.join(dir, 'ticket.json'), { job_id: id, token: args.token });

  const bundle = await api(id, 'GET', `/api/worker/jobs/${id}`);
  const job = bundle.job;
  writeJSON(path.join(dir, 'job.json'), job);
  if (job.kind === 'ping') {
    await status(id, 'Routine reached the app (ping)', 'running');
    console.log(`PING job ${id}. Finish with:\n  node routine/worker.mjs complete --job ${id} --notes "pong"`);
    return;
  }
  const project = bundle.project;
  if (!project) die('job has no project snapshot');
  writeJSON(path.join(dir, 'project.json'), project);
  const tl = computeTimeline(project);
  writeJSON(path.join(dir, 'timeline.json'), tl);
  if (bundle.baseComposition) fs.writeFileSync(path.join(dir, 'previous.html'), bundle.baseComposition);
  if (job.kind === 'render') {
    if (!bundle.baseComposition) die('render job has no previous composition');
    fs.writeFileSync(path.join(dir, 'composition.html'), bundle.baseComposition);
  }

  // Audio for the final mix.
  let n = 0;
  for (const s of tl.scenes) {
    if (s.voice && s.voice.blobId) {
      await download(id, s.voice.blobId, path.join(dir, 'audio', `voice_${s.id}.mp3`));
      n++;
    }
  }
  const m = project.music;
  if (m && m.enabled && m.track && m.track.blobId) {
    await download(id, m.track.blobId, path.join(dir, 'audio', 'music.mp3'));
  }

  const briefPath = path.join(dir, 'BRIEF.md');
  fs.writeFileSync(briefPath, writeBrief({ job, project, timeline: tl, hasPrevious: Boolean(bundle.baseComposition), dir }));
  await status(id, job.kind === 'render' ? 'Re-rendering with your edits' : 'Claude is designing the infographic', 'designing');

  console.log(`Fetched job ${id} (${job.kind}).`);
  console.log(`  brief:       ${rel(briefPath)}`);
  console.log(`  timeline:    ${rel(path.join(dir, 'timeline.json'))}  (${tl.scenes.length} scenes, ${tl.duration}s, ${tl.width}x${tl.height}${tl.static ? ', static' : ''})`);
  if (bundle.baseComposition) console.log(`  previous:    ${rel(path.join(dir, 'previous.html'))}`);
  console.log(`  narration:   ${n} clip(s)${m && m.enabled && m.track ? ', music: yes' : ''}`);
  console.log(`  write to:    ${rel(path.join(dir, 'composition.html'))}`);
  if (job.kind === 'render') console.log('  (render job: composition.html already copied from the previous version; go straight to check + render)');
}

async function download(id, blobId, file) {
  const t = ticket(id);
  const r = await fetch(`${apiBase()}/api/worker/blobs/${blobId}?job=${id}`, { headers: { 'x-job-token': t.token } });
  if (!r.ok) throw new Error(`download ${blobId} -> ${r.status}`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}

function rel(p) { return path.relative(process.cwd(), p) || p; }

/* ---------- shared: load + page ---------- */
function loadJob(id) {
  const dir = jobDir(id);
  const project = readJSON(path.join(dir, 'project.json'));
  const timeline = readJSON(path.join(dir, 'timeline.json'));
  const compFile = path.join(dir, 'composition.html');
  if (!fs.existsSync(compFile)) die(`write ${rel(compFile)} first`);
  const fragment = fs.readFileSync(compFile, 'utf8');
  return { dir, project, timeline, fragment, job: readJSON(path.join(dir, 'job.json')) };
}

function docFor(ctx) {
  const st = ctx.project.style || {};
  return assembleDocument(ctx.fragment, {
    runtime: RUNTIME,
    timeline: ctx.timeline,
    colors: st.colors,
    font: st.font,
    texts: (ctx.project.edits && ctx.project.edits.texts) || {},
  });
}

async function openStage(ctx, browser) {
  const html = docFor(ctx);
  const file = path.join(ctx.dir, 'render.html');
  fs.writeFileSync(file, html);
  const page = await browser.newPage({ viewport: { width: ctx.timeline.width, height: ctx.timeline.height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + file.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof window.seek === 'function', null, { timeout: 15000 });
  await page.evaluate(() => Promise.race([window.STAGE_READY, new Promise((r) => setTimeout(r, 20000))]));
  return { page, errors };
}

async function shot(page, t, type = 'jpeg') {
  await page.evaluate((x) => window.seek(x), t);
  return page.screenshot(type === 'png' ? { type: 'png' } : { type: 'jpeg', quality: 90 });
}

/* ---------- check ---------- */
async function cmdCheck() {
  const id = args.job;
  const ctx = loadJob(id);
  const { timeline: tl } = ctx;
  const report = { ok: true, errors: [], warnings: [], scenes: [], files: {} };
  await status(id, 'Checking frames', 'checking');

  const lint = lintComposition(ctx.fragment);
  report.errors.push(...lint.errors);
  report.warnings.push(...lint.warnings);
  const sc = checkScenes(lint.sceneIds, tl);
  if (sc.missing.length) report.errors.push('timeline scenes with no matching .scene[data-scene]: ' + sc.missing.join(', '));
  if (sc.extra.length) report.warnings.push('.scene ids not in the timeline (they get default timing): ' + sc.extra.join(', '));

  const browser = await launchBrowser();
  try {
    const { page, errors } = await openStage(ctx, browser);
    const info = await page.evaluate(() => window.stageInfo());
    report.duration = info.duration;
    if (info.errors.length) report.errors.push(...info.errors.map((e) => 'runtime: ' + e));

    const stillsDir = path.join(ctx.dir, 'stills');
    fs.rmSync(stillsDir, { recursive: true, force: true });
    fs.mkdirSync(stillsDir, { recursive: true });
    const W = tl.width, H = tl.height;
    const minFont = Math.round(Math.min(W, H) * 0.022);

    const times = tl.static ? [{ id: 'page', peak: 0, entry: 0 }] : tl.scenes.map((s) => ({ id: s.id, peak: peakTime(s), entry: +(s.start + 0.35).toFixed(2), start: s.start, len: s.len }));
    let i = 0;
    for (const s of times) {
      i++;
      await page.evaluate(({ label }) => {
        let d = document.getElementById('__dbg');
        if (!d) { d = document.createElement('div'); d.id = '__dbg'; document.body.appendChild(d); }
        d.style.cssText = 'position:fixed;left:10px;top:10px;z-index:99999;font:700 28px/1 monospace;background:#000c;color:#ff0;padding:6px 10px;border-radius:6px';
        d.textContent = label;
      }, { label: `${s.id}  peak t=${s.peak}s` });
      fs.writeFileSync(path.join(stillsDir, `peak_${String(i).padStart(2, '0')}.jpg`), await shot(page, s.peak));
      const issues = await page.evaluate(auditFrame, { W, H, minFont });
      if (!tl.static) {
        await page.evaluate(({ label }) => { document.getElementById('__dbg').textContent = label; }, { label: `${s.id}  entry t=${s.entry}s` });
        fs.writeFileSync(path.join(stillsDir, `entry_${String(i).padStart(2, '0')}.jpg`), await shot(page, s.entry));
      }
      report.scenes.push({ id: s.id, peak: s.peak, issues });
      for (const x of issues) report.warnings.push(`${s.id}: ${x}`);
    }
    await page.evaluate(() => { const d = document.getElementById('__dbg'); if (d) d.remove(); });

    // Determinism: the same t must give the same pixels regardless of what was drawn before.
    if (!tl.static && tl.duration > 0) {
      const t1 = +(tl.duration * 0.37).toFixed(3);
      const a = await shot(page, t1);
      await shot(page, tl.duration * 0.81);
      await shot(page, 0.1);
      const b = await shot(page, t1);
      if (sha(a) !== sha(b)) report.errors.push(`not deterministic: two renders of t=${t1}s differ (something reads real time, randomness or previous-frame state)`);
    }

    // Dead air: a scene whose first element appears late leaves an empty screen.
    if (!tl.static) {
      const late = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('#stage .scene')).map((s) => {
          const ins = Array.from(s.querySelectorAll('[data-in]')).map((e) => parseFloat(e.getAttribute('data-in'))).filter((n) => !isNaN(n));
          const cues = s.querySelectorAll('[data-cue]').length;
          return { id: s.getAttribute('data-scene'), firstIn: ins.length ? Math.min(...ins) : null, cues };
        });
      });
      for (const s of late) {
        if (s.firstIn != null && s.firstIn > 0.8 && !s.cues) report.warnings.push(`${s.id}: first element enters at ${s.firstIn}s; keep something on screen within ~0.6s`);
      }
    }

    if (errors.length) report.errors.push(...[...new Set(errors)].slice(0, 10).map((e) => 'page: ' + e));
    await page.close();

    report.files.contact = await contactSheet(stillsDir, 'peak_', path.join(ctx.dir, 'out', 'contact.jpg'), W, H);
    if (!tl.static) report.files.entries = await contactSheet(stillsDir, 'entry_', path.join(ctx.dir, 'out', 'entries.jpg'), W, H);
  } finally {
    await browser.close();
  }

  report.ok = report.errors.length === 0;
  writeJSON(path.join(ctx.dir, 'out', 'report.json'), report);
  console.log(report.ok ? 'CHECK PASSED' : 'CHECK FAILED');
  for (const e of report.errors) console.log('  error:   ' + e);
  for (const w of report.warnings.slice(0, 40)) console.log('  warning: ' + w);
  console.log(`  peak stills:  ${rel(report.files.contact || '')}   <- open this image and look at every scene`);
  if (report.files.entries) console.log(`  entry stills: ${rel(report.files.entries)}   <- scene openings (0.35s in): nothing should be blank`);
  console.log(`  single stills: ${rel(path.join(ctx.dir, 'stills'))}`);
  if (!report.ok) process.exitCode = 2;
}

function sha(buf) { return crypto.createHash('sha1').update(buf).digest('hex'); }

async function contactSheet(dir, prefix, out, W, H) {
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix)).sort();
  if (!files.length) return null;
  const portrait = H > W;
  const cols = Math.min(files.length, portrait ? 5 : 3);
  const rows = Math.ceil(files.length / cols);
  const cellW = portrait ? 360 : 640;
  await ffmpeg([
    '-framerate', '1', '-i', path.join(dir, `${prefix}%02d.jpg`),
    '-vf', `scale=${cellW}:-2,tile=${cols}x${rows}:padding=10:margin=10:color=0x202020`,
    '-frames:v', '1', '-q:v', '3', out,
  ]);
  return out;
}

/** Runs inside the page: flags clipped, off-stage, overlapping or tiny text at the current frame. */
function auditFrame({ W, H, minFont }) {
  const out = [];
  const stage = document.getElementById('stage');
  const visible = (el) => {
    let e = el;
    while (e && e !== stage) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return false;
      e = e.parentElement;
    }
    return true;
  };
  const label = (el) => {
    const t = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `<${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''}> "${t}"`;
  };
  const texts = [];
  for (const el of stage.querySelectorAll('.scene *')) {
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'text') continue;
    const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own || !visible(el)) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    texts.push({ el, r });
    const fs = parseFloat(cs.fontSize);
    if (fs < minFont) out.push(`small text ${Math.round(fs)}px (< ${minFont}px): ${label(el)}`);
    if (r.right > W + 2 || r.bottom > H + 2 || r.left < -2 || r.top < -2) out.push(`text outside the frame: ${label(el)}`);
    if ((cs.overflow !== 'visible' || cs.textOverflow === 'ellipsis') && (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2)) {
      out.push(`text clipped by its box: ${label(el)}`);
    }
  }
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      // Lines of the same paragraph share a parent; their inline boxes overlap by design.
      if (a.el.parentElement === b.el.parentElement && getComputedStyle(a.el).display === 'inline' && getComputedStyle(b.el).display === 'inline') continue;
      const x = Math.max(0, Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left));
      const y = Math.max(0, Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top));
      const overlap = x * y;
      const small = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
      if (overlap > small * 0.18) out.push(`overlapping text: ${label(a.el)} / ${label(b.el)}`);
    }
  }
  return [...new Set(out)].slice(0, 15);
}

/* ---------- render ---------- */
async function cmdRender() {
  const id = args.job;
  const ctx = loadJob(id);
  const { timeline: tl } = ctx;
  const lint = lintComposition(ctx.fragment);
  if (!lint.ok) die('composition has lint errors; run check first:\n  ' + lint.errors.join('\n  '));
  const outDir = path.join(ctx.dir, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await launchBrowser();
  try {
    const { page } = await openStage(ctx, browser);
    if (tl.static) {
      await status(id, 'Rendering image and PDF', 'rendering');
      fs.writeFileSync(path.join(outDir, 'image.png'), await shot(page, 0, 'png'));
      fs.writeFileSync(path.join(outDir, 'poster.jpg'), await shot(page, 0));
      await page.pdf({ path: path.join(outDir, 'document.pdf'), width: tl.width + 'px', height: tl.height + 'px', printBackground: true, pageRanges: '1' });
      console.log('Rendered image.png, document.pdf, poster.jpg');
      return;
    }
    const D = tl.duration;
    const frames = Math.round(D * FPS);
    await status(id, `Rendering ${frames} frames`, 'rendering');
    const silent = path.join(outDir, 'silent.mp4');
    const mbps = Math.max(1.2, Math.min(6, (22 * 8) / Math.max(1, D) - 0.25));
    const sink = ffmpegFrameSink([
      '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-maxrate', mbps.toFixed(2) + 'M', '-bufsize', (mbps * 2).toFixed(2) + 'M',
      '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', silent,
    ]);
    const t0 = Date.now();
    for (let f = 0; f < frames; f++) {
      await sink.write(await shot(page, f / FPS));
      if (f % (FPS * 10) === 0 && f) {
        const pct = Math.round((f / frames) * 100);
        console.log(`  frame ${f}/${frames} (${pct}%)`);
        if (f % (FPS * 20) === 0) await status(id, `Rendering… ${pct}%`, 'rendering');
      }
    }
    await sink.end();
    console.log(`  encoded ${frames} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    const poster = Math.min(D - 0.1, tl.scenes.length ? peakTime(tl.scenes[0]) : 1);
    fs.writeFileSync(path.join(outDir, 'poster.jpg'), await shot(page, Math.max(0.5, poster)));
    await page.close();

    const mix = await mixAudio({ dir: ctx.dir, timeline: tl, project: ctx.project });
    const final = path.join(outDir, 'video.mp4');
    if (mix) {
      await ffmpeg(['-i', silent, '-i', mix, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-t', D.toFixed(3), '-movflags', '+faststart', final]);
      fs.rmSync(silent);
    } else {
      fs.renameSync(silent, final);
    }
    let size = fs.statSync(final).size;
    if (size > MAX_UPLOAD) {
      console.log(`  ${(size / 1048576).toFixed(1)} MB is over the 24.5 MB upload limit; re-encoding smaller`);
      const smaller = path.join(outDir, 'video_small.mp4');
      await ffmpeg(['-i', final, '-c:v', 'libx264', '-preset', 'medium', '-crf', '27', '-maxrate', '2M', '-bufsize', '4M', '-c:a', 'copy', '-movflags', '+faststart', smaller]);
      fs.renameSync(smaller, final);
      size = fs.statSync(final).size;
    }
    const dur = await probeDuration(final);
    console.log(`Rendered ${rel(final)}: ${(size / 1048576).toFixed(1)} MB, ${dur ? dur.toFixed(2) : '?'}s (timeline ${D}s)${mix ? ', with audio' : ', silent'}`);
  } finally {
    await browser.close();
  }
}

/* ---------- upload / complete / fail ---------- */
async function cmdUpload() {
  const id = args.job;
  const ctx = loadJob(id);
  const outDir = path.join(ctx.dir, 'out');
  await status(id, 'Uploading results', 'uploading');
  const files = [
    ['composition.html', path.join(ctx.dir, 'composition.html')],
    ['video.mp4', path.join(outDir, 'video.mp4')],
    ['poster.jpg', path.join(outDir, 'poster.jpg')],
    ['contact.jpg', path.join(outDir, 'contact.jpg')],
    ['image.png', path.join(outDir, 'image.png')],
    ['document.pdf', path.join(outDir, 'document.pdf')],
    ['report.json', path.join(outDir, 'report.json')],
  ];
  if (!ctx.timeline.static && !fs.existsSync(path.join(outDir, 'video.mp4'))) die('no out/video.mp4: run render first');
  if (ctx.timeline.static && !fs.existsSync(path.join(outDir, 'image.png'))) die('no out/image.png: run render first');
  for (const [name, file] of files) {
    if (!fs.existsSync(file)) continue;
    const buf = fs.readFileSync(file);
    if (buf.length > MAX_UPLOAD) die(`${name} is ${(buf.length / 1048576).toFixed(1)} MB (limit 24.5 MB)`);
    await api(id, 'PUT', `/api/worker/jobs/${id}/files/${name}`, buf, { 'content-type': 'application/octet-stream' });
    console.log(`  uploaded ${name} (${(buf.length / 1024).toFixed(0)} KB)`);
  }
  const st = ctx.project.style || {};
  const notes = typeof args.notes === 'string' ? args.notes : '';
  let report = null;
  try { report = readJSON(path.join(outDir, 'report.json')); } catch {}
  const res = await api(id, 'POST', `/api/worker/jobs/${id}/complete`, {
    notes,
    duration: ctx.timeline.duration,
    textsUsed: (ctx.project.edits && ctx.project.edits.texts) || {},
    styleKey: styleKey(st),
    report: report ? { ok: report.ok, errors: report.errors.slice(0, 10), warnings: report.warnings.slice(0, 20) } : null,
  });
  console.log(`Done. Version v${res.version ? res.version.v : '?'} is in the app.`);
}

async function cmdComplete() {
  const id = args.job;
  ticket(id);
  const res = await api(id, 'POST', `/api/worker/jobs/${id}/complete`, { notes: typeof args.notes === 'string' ? args.notes : '' });
  console.log('Completed: ' + res.job.status);
}

async function cmdFail() {
  const id = args.job;
  ticket(id);
  await api(id, 'POST', `/api/worker/jobs/${id}/fail`, { reason: typeof args.reason === 'string' ? args.reason : 'unknown' });
  console.log('Reported failure.');
}

async function cmdStatus() {
  const id = args.job;
  ticket(id);
  await status(id, typeof args.msg === 'string' ? args.msg : '', typeof args.stage === 'string' ? args.stage : undefined);
  console.log('ok');
}

const COMMANDS = { fetch: cmdFetch, check: cmdCheck, render: cmdRender, upload: cmdUpload, complete: cmdComplete, fail: cmdFail, status: cmdStatus };
if (!COMMANDS[cmd]) {
  console.log('usage: node routine/worker.mjs <fetch|status|check|render|upload|complete|fail> --job <id> [...]');
  process.exit(cmd ? 1 : 0);
}
COMMANDS[cmd]().catch((e) => {
  console.error('ERROR: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
