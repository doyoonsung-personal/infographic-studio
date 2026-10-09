// Live preview: the composition runs in a sandboxed iframe; this player drives seek(t) and plays
// the narration clips and music with Web Audio, ducking the music under the voice.

import { assembleDocument } from './assemble.js';
import { h, icon, fmtTime } from './util.js';
import { t as tr } from './i18n.js';

let runtimeSrc = null;
async function runtime() {
  if (!runtimeSrc) runtimeSrc = await (await fetch('/runtime/stage.js')).text();
  return runtimeSrc;
}

const bufferCache = new Map();
let actx = null;
function audioCtx() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  return actx;
}
async function loadBuffer(url) {
  if (!url) return null;
  if (!bufferCache.has(url)) {
    bufferCache.set(url, (async () => {
      const r = await fetch(url, { credentials: 'same-origin' });
      if (!r.ok) throw new Error('audio ' + r.status);
      return audioCtx().decodeAudioData(await r.arrayBuffer());
    })().catch((e) => { bufferCache.delete(url); console.warn(e); return null; }));
  }
  return bufferCache.get(url);
}

export class Player {
  constructor({ maxHeight = 0.62 } = {}) {
    this.maxHeight = maxHeight;
    this.t = 0;
    this.duration = 0;
    this.playing = false;
    this.static = false;
    this.listeners = new Set();
    this.el = h('div', { class: 'player' });
    this.screen = h('div', { class: 'screen' });
    this.empty = h('div', { class: 'empty' });
    this.screen.append(this.empty);
    this.playBtn = h('button', { class: 'btn sm icon', title: tr('play'), onclick: () => (this.playing ? this.pause() : this.play()) }, icon('play'));
    this.scrub = h('div', { class: 'scrub' }, h('div', { class: 'track' }), h('div', { class: 'fill' }), h('div', { class: 'knob' }));
    this.tc = h('div', { class: 'tc' }, '0:00.0 / 0:00.0');
    this.controls = h('div', { class: 'controls' }, this.playBtn, this.scrub, this.tc);
    this.el.append(this.screen, this.controls);
    this.bindScrub();
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(this.screen);
    this.onMsg = (e) => {
      if (!this.frame || e.source !== this.frame.contentWindow) return;
      const m = e.data || {};
      if (m.type === 'stage-ready') {
        this.info = m.info;
        this.ready = true;
        this.post({ type: 'seek', t: this.t });
        this.emit('ready', m.info);
      } else if (m.type === 'stage-error') {
        this.emit('error', m.message);
      }
    };
    window.addEventListener('message', this.onMsg);
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, data) { for (const fn of this.listeners) fn(type, data); }

  showEmpty(text) {
    this.clearFrame();
    this.empty.textContent = text;
    this.empty.hidden = false;
    this.controls.hidden = true;
    this.W = 1920; this.H = 1080;
    this.layout();
  }

  clearFrame() {
    this.pause();
    if (this.frame) this.frame.remove();
    this.frame = null;
    this.ready = false;
  }

  /** opts: { fragment, timeline, colors, font, texts, voices: [{url, at}], music: {url, volume} } */
  async load(opts) {
    this.clearFrame();
    this.empty.hidden = true;
    const tl = opts.timeline;
    this.W = tl.width; this.H = tl.height;
    this.static = !!tl.static;
    this.duration = tl.duration || 0;
    this.scenes = tl.scenes || [];
    // Until the first play, show the opening scene at its fullest instead of the empty first frame.
    if (!this.hasPlayed && this.scenes.length && this.duration) {
      const s = this.scenes[0];
      this.t = Math.max(0, s.end - Math.min(0.6, s.len * 0.15));
    }
    this.t = Math.min(this.t, this.duration);
    this.audio = { voices: opts.voices || [], music: opts.music || null };
    const doc = assembleDocument(opts.fragment, {
      runtime: await runtime(), timeline: tl, colors: opts.colors, font: opts.font, texts: opts.texts,
    });
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts');
    f.setAttribute('title', 'preview');
    f.srcdoc = doc;
    this.frame = f;
    this.screen.append(f);
    this.controls.hidden = this.static;
    this.layout();
    this.drawMarks();
    this.updateUi();
    // Warm the audio so the first play starts on time.
    for (const v of this.audio.voices) loadBuffer(v.url);
    if (this.audio.music) loadBuffer(this.audio.music.url);
  }

  apply(patch) { this.post({ type: 'apply', ...patch }); }

  post(m) { if (this.frame && this.frame.contentWindow) this.frame.contentWindow.postMessage(m, '*'); }

  layout() {
    const W = this.W || 1920, H = this.H || 1080;
    const cw = this.screen.clientWidth || 1;
    const maxH = Math.max(200, window.innerHeight * this.maxHeight);
    let s = cw / W;
    if (H * s > maxH) s = maxH / H;
    this.screen.style.height = Math.round(H * s) + 'px';
    if (this.frame) {
      this.frame.style.width = W + 'px';
      this.frame.style.height = H + 'px';
      this.frame.style.transform = `scale(${s})`;
      this.frame.style.left = Math.max(0, (cw - W * s) / 2) + 'px';
    }
  }

  drawMarks() {
    this.scrub.querySelectorAll('.mark').forEach((m) => m.remove());
    if (!this.duration) return;
    for (const s of this.scenes.slice(1)) {
      this.scrub.insertBefore(h('div', { class: 'mark', style: { left: (s.start / this.duration * 100) + '%' } }), this.scrub.querySelector('.knob'));
    }
  }

  bindScrub() {
    const at = (e) => {
      const r = this.scrub.getBoundingClientRect();
      return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * this.duration;
    };
    let dragging = false;
    let resume = false;
    this.scrub.addEventListener('pointerdown', (e) => {
      dragging = true;
      this.hasPlayed = true;
      resume = this.playing;
      this.pause();
      this.scrub.setPointerCapture(e.pointerId);
      this.seek(at(e));
    });
    this.scrub.addEventListener('pointermove', (e) => { if (dragging) this.seek(at(e)); });
    this.scrub.addEventListener('pointerup', () => { dragging = false; if (resume) this.play(); });
  }

  seek(t) {
    this.t = Math.max(0, Math.min(this.duration, t));
    this.post({ type: 'seek', t: this.t });
    this.updateUi();
  }

  updateUi() {
    const p = this.duration ? this.t / this.duration : 0;
    this.scrub.querySelector('.fill').style.width = (p * 100) + '%';
    this.scrub.querySelector('.knob').style.left = (p * 100) + '%';
    this.tc.textContent = `${fmtTime(this.t)} / ${fmtTime(this.duration)}`;
    this.playBtn.replaceChildren(icon(this.playing ? 'pause' : 'play'));
    this.emit('time', this.t);
  }

  async play() {
    if (this.static || !this.duration || this.playing) return;
    if (!this.hasPlayed) { this.hasPlayed = true; this.t = 0; }
    if (this.t >= this.duration - 0.05) this.t = 0;
    this.playing = true;
    this.updateUi();
    const hasAudio = this.audio.voices.length || this.audio.music;
    if (hasAudio) {
      const ctx = audioCtx();
      await ctx.resume();
      const [voiceBufs, musicBuf] = await Promise.all([
        Promise.all(this.audio.voices.map((v) => loadBuffer(v.url))),
        this.audio.music ? loadBuffer(this.audio.music.url) : null,
      ]);
      if (!this.playing) return;
      const now = ctx.currentTime + 0.05;
      const t0 = this.t;
      this.sources = [];
      this.audio.voices.forEach((v, i) => {
        const b = voiceBufs[i];
        if (!b || v.at + b.duration <= t0) return;
        const src = ctx.createBufferSource();
        src.buffer = b;
        src.connect(ctx.destination);
        src.start(now + Math.max(0, v.at - t0), Math.max(0, t0 - v.at));
        this.sources.push(src);
      });
      if (musicBuf) {
        const vol = this.audio.music.volume ?? 0.22;
        const g = ctx.createGain();
        g.gain.setValueAtTime(vol, now);
        // Duck under each narration clip.
        this.audio.voices.forEach((v, i) => {
          const b = voiceBufs[i];
          if (!b) return;
          const a = now + (v.at - t0), e = now + (v.at + b.duration - t0);
          if (e < now) return;
          g.gain.setValueAtTime(vol, Math.max(now, a - 0.25));
          g.gain.linearRampToValueAtTime(vol * 0.35, Math.max(now, a));
          g.gain.setValueAtTime(vol * 0.35, Math.max(now, e));
          g.gain.linearRampToValueAtTime(vol, Math.max(now, e + 0.35));
        });
        g.connect(ctx.destination);
        const src = ctx.createBufferSource();
        src.buffer = musicBuf;
        src.connect(g);
        if (t0 < musicBuf.duration) src.start(now, t0);
        this.sources.push(src);
      }
      this.clock = () => t0 + (ctx.currentTime - now);
    } else {
      const start = performance.now();
      const t0 = this.t;
      this.clock = () => t0 + (performance.now() - start) / 1000;
    }
    const tick = () => {
      if (!this.playing) return;
      const t = this.clock();
      if (t >= this.duration) { this.seek(this.duration); this.pause(); return; }
      this.t = Math.max(0, t);
      this.post({ type: 'seek', t: this.t });
      this.updateUi();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  pause() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    for (const s of this.sources || []) { try { s.stop(); } catch {} }
    this.sources = [];
    if (this.playBtn) this.updateUi();
  }

  destroy() {
    this.pause();
    this.ro.disconnect();
    window.removeEventListener('message', this.onMsg);
    this.el.remove();
  }
}

/** Play one audio blob (voice preview etc.); returns a stop function. */
let current = null;
export function playOne(url, onEnd) {
  if (current) { current.pause(); current = null; }
  const a = new Audio(url);
  a.onended = () => { current = null; onEnd && onEnd(); };
  a.play().catch(() => onEnd && onEnd());
  current = a;
  return () => { a.pause(); current = null; onEnd && onEnd(); };
}
