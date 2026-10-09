// The project workspace: node canvas in the middle, chat on the left, inspector on the right.
// Holds the project state, saves it, and exposes the actions the inspector and chat use.

import { api, blobUrl, blobText, ApiError } from './api.js';
import { h, icon, debounce, clone, fmtTime, fmtDate, uid } from './util.js';
import { t, getLang } from './i18n.js';
import { computeTimeline, spokenText, clipKey, clipFresh, TAG_MODELS, hasTags, stripTags, contentKey } from './timeline.js';
import { styleKey, FONT_STACKS, backgroundKeys } from './assemble.js';
import { extractTexts } from './lint.js';
import * as ai from './ai.js';
import { Player } from './player.js';
import { renderInspector } from './inspector.js';
import { mountChat } from './chat.js';
import { makeCutout } from './cutout.js';

export const NODES = [
  { key: 'brief', icon: 'brief' },
  { key: 'facts', icon: 'facts' },
  { key: 'script', icon: 'script' },
  { key: 'style', icon: 'style' },
  { key: 'assets', icon: 'scissors' },
  { key: 'voice', icon: 'voice' },
  { key: 'music', icon: 'music' },
  { key: 'build', icon: 'build' },
  { key: 'preview', icon: 'preview', wide: true },
];

// The collage look's paper palette: warm paper, ink, highlighter yellow, marker red, print blue.
const COLLAGE_PALETTE = { id: 'collage-paper', name: 'Collage Paper', colors: { bg: '#efe7d8', surface: '#fbf6ec', text: '#1c1a17', muted: '#6e665b', accent: '#f6c915', accent2: '#e2422e', accent3: '#2f6db5' } };

export function normalize(p, config) {
  const d = config.defaults || {};
  const pal = (config.palettes || []).find((x) => x.id === d.paletteId) || (config.palettes || [])[0];
  p.brief = { topic: '', takeaway: '', audience: '', tone: '', notes: '', format: d.format || 'animated', ratio: d.ratio || '16:9', length: d.length || 45, language: d.language || getLang(), ...(p.brief || {}) };
  p.facts = { items: [], sources: [], summary: '', ...(p.facts || {}) };
  p.script = { scenes: [], ...(p.script || {}) };
  p.style = { paletteId: pal ? pal.id : null, colors: pal ? clone(pal.colors) : null, font: 'sans', motion: 'lively', notes: '', ...(p.style || {}) };
  p.style.background = { mode: 'color', scope: 'scene', look: 'photo', notes: '', strength: 0.45, images: {}, ...(p.style.background || {}) };
  p.style.look = p.style.look === 'collage' ? 'collage' : 'default';
  p.assets = { style: 'halftone', items: [], ...(p.assets || {}) };
  const firstVoice = (config.voices || []).find((v) => !v.language || v.language === p.brief.language) || (config.voices || [])[0];
  p.voice = { enabled: Boolean(firstVoice) && p.brief.format !== 'static', voiceRef: firstVoice ? firstVoice.id : null, speed: 1, clips: {}, ...(p.voice || {}) };
  const ms = (config.musicStyles || [])[0];
  p.music = { enabled: false, styleId: ms ? ms.id : null, prompt: '', volume: d.musicVolume ?? 0.22, track: null, ...(p.music || {}) };
  p.edits = { texts: {}, ...(p.edits || {}) };
  p.build = { current: null, activeJobId: null, lastJob: null, ...(p.build || {}) };
  p.history = p.history || {};
  p.chat = p.chat || [];
  return p;
}

export async function openStudio(root, projectId, app) {
  const S = {
    p: null, config: app.config, me: app.me, versions: [], job: null,
    sel: null, busy: {}, progress: {}, comp: null, nodeEls: {}, destroyed: false,
  };
  S.p = normalize(await api('projects/' + projectId), S.config);

  /* ---------- layout ---------- */
  const chatEl = h('aside', { class: 'chat' });
  const inner = h('div', { class: 'canvas-inner' });
  const wires = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  wires.setAttribute('class', 'wires');
  inner.append(wires);
  const canvas = h('main', { class: 'canvas' }, inner);
  const insp = h('aside', { class: 'insp' });
  const studio = h('div', { class: 'studio no-insp', 'data-tab': 'nodes' }, chatEl, canvas, insp);
  const tabs = h('nav', { class: 'mtabs' },
    h('button', { 'data-t': 'chat', onclick: () => setTab('chat') }, t('tab_chat')),
    h('button', { 'data-t': 'nodes', class: 'on', onclick: () => setTab('nodes') }, t('tab_nodes')));
  root.replaceChildren(studio, tabs);
  function setTab(x) {
    if (S.sel) A.select(null); // the inspector is a full-screen sheet on phones
    studio.dataset.tab = x;
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.t === x));
  }

  /* ---------- saving ---------- */
  const saveNow = async () => {
    if (S.destroyed) return;
    app.setSaveState('saving');
    try {
      const body = { ...S.p, chat: S.p.chat.slice(-40) };
      const r = await api('projects/' + S.p.id, { method: 'PUT', body });
      S.p.rev = r.rev;
      S.dirty = false;
      app.setSaveState('saved');
    } catch (e) {
      app.setSaveState('error');
      if (e instanceof ApiError && e.status === 409) {
        app.toast(e.message, 'err');
      } else app.toast(t('save_failed') + ': ' + e.message, 'err');
    }
  };
  const save = debounce(saveNow, 900);
  function changed({ canvas: c = true, inspector = false, preview = false } = {}) {
    S.dirty = true;
    app.setSaveState('dirty');
    save();
    if (c) renderCanvas();
    if (inspector) renderInsp();
    if (preview) refreshPreview();
  }

  /* ---------- derived state ---------- */
  const timeline = () => computeTimeline(S.p);
  const voiceDef = () => (S.config.voices || []).find((v) => v.id === S.p.voice.voiceRef) || null;

  function voiceStatus() {
    const scenes = S.p.script.scenes.filter((s) => spokenText(s.narration));
    const missing = [], stale = [];
    for (const s of scenes) {
      const c = S.p.voice.clips[s.id];
      if (!c) missing.push(s.id);
      else if (!clipFresh(c, s.narration, S.p.voice)) stale.push(s.id);
    }
    return { total: scenes.length, fresh: scenes.length - missing.length - stale.length, missing, stale };
  }

  function musicTarget() { return Math.max(10, +(timeline().duration + 0.5).toFixed(1)); }
  function musicPrompt() {
    const st = (S.config.musicStyles || []).find((m) => m.id === S.p.music.styleId);
    return (S.p.music.prompt || (st && st.prompt) || '').trim();
  }
  function musicStatus() {
    const tr = S.p.music.track;
    if (!tr) return 'missing';
    if (Math.abs(tr.duration - musicTarget()) > 1.5 || tr.prompt !== musicPrompt()) return 'stale';
    return 'ok';
  }

  function bgStatus() {
    const keys = backgroundKeys(S.p);
    const im = S.p.style.background.images || {};
    const missing = keys.filter((k) => !im[k]);
    return { keys, have: keys.length - missing.length, missing };
  }

  function currentVersion() {
    if (!S.versions.length) return null;
    return S.versions.find((v) => v.v === S.p.build.current) || S.versions[S.versions.length - 1];
  }

  function versionStale(v) {
    if (!v) return false;
    const tl = timeline();
    const textsNow = JSON.stringify(S.p.edits.texts || {});
    const textsThen = JSON.stringify(v.textsUsed || {});
    if (textsNow !== textsThen) return true;
    if (v.styleKey) {
      // Versions made before 2026-10-09 stored the key cut to 200 characters.
      const now = styleKey(S.p.style, S.p.assets);
      if (v.styleKey !== now && !(v.styleKey.length === 200 && now.startsWith(v.styleKey))) return true;
    }
    if (!tl.static && v.duration && Math.abs(v.duration - tl.duration) > 0.05) return true;
    return false;
  }

  /** Brief, facts or script changed after this version was made (older versions don't know). */
  function contentStale(v) {
    return Boolean(v && v.contentKey && v.contentKey !== contentKey(S.p));
  }

  function nodeStatus(key) {
    const p = S.p;
    if (S.busy[key]) return 'running';
    switch (key) {
      case 'brief': return p.brief.topic && p.brief.takeaway ? 'done' : p.brief.topic ? 'ready' : 'empty';
      case 'facts': return p.facts.items.length ? 'done' : p.facts.skipped ? 'off' : 'empty';
      case 'script': return p.script.scenes.length ? 'done' : 'empty';
      case 'style': {
        if (!p.style.colors) return 'empty';
        const bs = bgStatus();
        return bs.missing.length && bs.keys.length ? 'stale' : 'done';
      }
      case 'assets': {
        const items = p.assets.items;
        if (!items.length) return p.style.look === 'collage' ? 'empty' : 'off';
        const made = items.filter((a) => a.blobId).length;
        return made === items.length ? 'done' : made ? 'stale' : 'ready';
      }
      case 'voice': {
        if (!p.voice.enabled || p.brief.format === 'static') return 'off';
        const vs = voiceStatus();
        if (!vs.total) return 'empty';
        if (vs.fresh === vs.total) return 'done';
        return vs.fresh ? 'stale' : 'ready';
      }
      case 'music': {
        if (!p.music.enabled || p.brief.format === 'static') return 'off';
        const ms = musicStatus();
        return ms === 'ok' ? 'done' : ms === 'stale' ? 'stale' : 'ready';
      }
      case 'build': {
        if (S.job && ['queued', 'fired', 'running'].includes(S.job.status)) return 'running';
        if (S.job && S.job.status === 'failed' && S.job.id === p.build.lastJob) return 'error';
        return S.versions.length ? 'done' : p.script.scenes.length ? 'ready' : 'empty';
      }
      case 'preview': {
        const v = currentVersion();
        if (!v) return 'empty';
        return versionStale(v) || contentStale(v) ? 'stale' : 'done';
      }
    }
    return 'empty';
  }

  let progressRaf = 0;
  function progress(key, msg) {
    S.progress[key] = msg;
    cancelAnimationFrame(progressRaf);
    progressRaf = requestAnimationFrame(() => renderNode(key));
  }

  /**
   * Generate one image from a description. When Model Studio's content filter blocks the picture, the
   * description is rewritten without what the filter refuses (maps showing Asia, yuan notes, flags…) and
   * tried once more. Returns the image plus the description actually used.
   */
  async function genImage(text, ratio, toPrompt = (x) => x) {
    try {
      return { ...(await api('image', { method: 'POST', body: { prompt: toPrompt(text), ratio } })), text };
    } catch (e) {
      if (!(e.data && e.data.code === 'content_blocked')) throw e;
      const safer = await ai.safeSubject(text).catch(() => text);
      try {
        return { ...(await api('image', { method: 'POST', body: { prompt: toPrompt(safer) + ' ' + ai.SAFE_RETRY, ratio } })), text: safer, rewritten: safer !== text };
      } catch (e2) {
        if (e2.data && e2.data.code === 'content_blocked') throw new Error(t('content_blocked'));
        throw e2;
      }
    }
  }

  /* ---------- history ---------- */
  function pushHistory(key, value) {
    const list = S.p.history[key] || (S.p.history[key] = []);
    list.push({ at: Date.now(), value: clone(value) });
    S.p.history[key] = list.slice(-8);
  }

  /* ---------- actions (used by inspector + chat) ---------- */
  const A = {
    S, timeline, voiceDef, voiceStatus, musicStatus, musicTarget, musicPrompt, currentVersion, versionStale, contentStale, nodeStatus, bgStatus,
    changed, pushHistory,
    select(key) { S.sel = key; studio.classList.toggle('no-insp', !key); renderCanvas(); renderInsp(); },

    async busy(key, fn) {
      if (S.busy[key]) return;
      S.busy[key] = true;
      renderCanvas();
      if (S.sel === key) renderInsp();
      try { return await fn(); } catch (e) {
        app.toast(e.message || String(e), 'err');
        throw e;
      } finally {
        S.busy[key] = false;
        S.progress[key] = null;
        renderCanvas();
        if (S.sel === key) renderInsp();
      }
    },

    updateBrief(fields) {
      const allowed = ['topic', 'takeaway', 'audience', 'tone', 'notes', 'format', 'ratio', 'length', 'language'];
      for (const k of allowed) if (fields[k] !== undefined) S.p.brief[k] = k === 'length' ? Math.max(10, Math.min(120, Number(fields[k]) || 45)) : fields[k];
      if (fields.topic && !S.p.title) S.p.title = fields.topic;
      app.setTitle(S.p.title || S.p.brief.topic);
      changed({ inspector: S.sel === 'brief', preview: true });
    },

    async suggestBrief(direction) {
      return A.busy('brief', async () => {
        const r = await ai.suggestBrief(S.p, direction);
        pushHistory('brief', S.p.brief);
        if (r.title) { S.p.title = r.title; app.setTitle(r.title); }
        for (const k of ['takeaway', 'audience', 'tone']) if (r[k]) S.p.brief[k] = r[k];
        changed({ inspector: S.sel === 'brief' });
        return r;
      });
    },

    async research(focus) {
      return A.busy('facts', async () => {
        const r = await ai.researchFacts(S.p, focus, { onProgress: (m) => progress('facts', m) });
        if (!r.items.length) throw new Error(r.summary || 'No facts found');
        if (S.p.facts.items.length) pushHistory('facts', S.p.facts);
        S.p.facts = { ...S.p.facts, ...r, skipped: false };
        changed({ inspector: S.sel === 'facts' });
        return r;
      });
    },

    async writeScript(direction, sceneId) {
      return A.busy('script', async () => {
        const r = await ai.writeScript(S.p, { direction, sceneId, onDelta: ({ content, reasoning }) => progress('script', content ? '✍ ' + content.length : '🧠 ' + reasoning.length) });
        if (S.p.script.scenes.length) pushHistory('script', S.p.script.scenes);
        if (r.scene) {
          const i = S.p.script.scenes.findIndex((s) => s.id === sceneId);
          if (i >= 0) S.p.script.scenes[i] = r.scene;
        } else {
          S.p.script.scenes = r.scenes;
        }
        changed({ inspector: S.sel === 'script', preview: true });
        return r;
      });
    },

    editScene(id, fields) {
      const s = S.p.script.scenes.find((x) => x.id === id);
      if (!s) throw new Error('no scene ' + id);
      for (const k of ['title', 'narration', 'onscreen', 'visual', 'seconds']) if (fields[k] !== undefined) s[k] = k === 'seconds' ? Number(fields[k]) || 0 : String(fields[k]);
      changed({ inspector: S.sel === 'script', preview: true });
    },
    addScene() {
      const ids = new Set(S.p.script.scenes.map((s) => s.id));
      let n = S.p.script.scenes.length + 1;
      while (ids.has('s' + n)) n++;
      S.p.script.scenes.push({ id: 's' + n, title: '', narration: '', onscreen: '', visual: '', seconds: 5 });
      changed({ inspector: true, preview: true });
    },
    removeScene(id) {
      pushHistory('script', S.p.script.scenes);
      S.p.script.scenes = S.p.script.scenes.filter((s) => s.id !== id);
      changed({ inspector: true, preview: true });
    },
    moveScene(id, dir) {
      const a = S.p.script.scenes;
      const i = a.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= a.length) return;
      [a[i], a[j]] = [a[j], a[i]];
      changed({ inspector: true, preview: true });
    },

    setStyle(patch) {
      const st = S.p.style;
      if (patch.colors) st.colors = { ...(st.colors || {}), ...patch.colors };
      for (const k of ['paletteId', 'font', 'motion', 'notes']) if (patch[k] !== undefined) st[k] = patch[k];
      changed({ inspector: S.sel === 'style' && !patch._typing });
      A.applyLive();
    },
    applyPalette(pal) {
      pushHistory('style', S.p.style);
      S.p.style.colors = clone(pal.colors);
      S.p.style.paletteId = pal.id || null;
      S.p.style.paletteName = pal.name || null;
      changed({ inspector: S.sel === 'style' });
      A.applyLive();
    },
    async suggestPalettes(direction) {
      return A.busy('style', async () => {
        const list = await ai.suggestPalettes(S.p, direction);
        S.paletteIdeas = list;
        return list;
      });
    },
    async paletteFromSite(url) {
      return A.busy('style', async () => {
        const pal = await ai.paletteFromSite(S.p, url);
        A.applyPalette(pal);
        return pal;
      });
    },

    setBackground(patch) {
      const bg = S.p.style.background;
      for (const k of ['mode', 'scope', 'look', 'notes', 'strength']) {
        if (patch[k] !== undefined) bg[k] = k === 'strength' ? Math.min(0.9, Math.max(0.1, Number(patch[k]) || 0.45)) : patch[k];
      }
      changed({ inspector: S.sel === 'style' && !patch._typing, preview: !patch._typing });
    },

    /** Generate background images (paid: one image per scene, or one shared image). */
    async generateBackgrounds(keys) {
      const bg = S.p.style.background;
      const all = backgroundKeys(S.p);
      const targets = keys && keys.length ? keys.filter((k) => all.includes(k)) : all;
      if (!targets.length) return { generated: 0 };
      return A.busy('style', async () => {
        progress('style', '✍ prompts…');
        const prompts = await ai.backgroundPrompts(S.p, targets);
        let n = 0;
        for (const k of targets) {
          progress('style', `🖼 ${n + 1}/${targets.length}`);
          const prompt = prompts[k];
          if (!prompt) continue;
          const r = await genImage(prompt, S.p.brief.ratio);
          const small = await compressImage(r.blobId).catch(() => null);
          bg.images = bg.images || {};
          bg.images[k] = { blobId: small || r.blobId, original: r.blobId, prompt: r.text, model: r.model, at: Date.now() };
          n++;
          changed({ inspector: S.sel === 'style', preview: true });
        }
        return { generated: n };
      });
    },

    removeBackground(key) {
      if (S.p.style.background.images) delete S.p.style.background.images[key];
      changed({ inspector: true, preview: true });
    },

    /** 'default' or 'collage' (Vox-style paper collage). Switching to collage brings its paper palette. */
    setLook(look) {
      const st = S.p.style;
      const next = look === 'collage' ? 'collage' : 'default';
      if (st.look === next) return;
      pushHistory('style', st);
      st.look = next;
      if (next === 'collage') {
        st.colors = clone(COLLAGE_PALETTE.colors);
        st.paletteId = COLLAGE_PALETTE.id;
        st.paletteName = COLLAGE_PALETTE.name;
        if (st.background.look !== 'collage') st.background.look = 'collage';
      }
      changed({ inspector: S.sel === 'style' || S.sel === 'assets', preview: true });
      A.applyLive();
    },

    /** Ask the writer model which cut-outs each scene needs; keeps cut-outs that already have a picture. */
    async planAssets() {
      if (!S.p.script.scenes.length) throw new Error(t('assets_need_script'));
      return A.busy('assets', async () => {
        const plan = await ai.planCutouts(S.p);
        const kept = S.p.assets.items.filter((a) => a.blobId);
        S.p.assets.items = [...kept, ...plan.map((x) => ({ id: uid('a_'), ...x }))];
        changed({ inspector: S.sel === 'assets' });
        return { planned: plan.length };
      });
    },
    addAsset(fields) {
      const a = { id: uid('a_'), sceneId: fields.sceneId || (S.p.script.scenes[0] || {}).id || 's1', name: fields.name || '', subject: fields.subject || '' };
      S.p.assets.items.push(a);
      changed({ inspector: S.sel === 'assets' });
      return a;
    },
    updateAsset(id, patch) {
      const a = S.p.assets.items.find((x) => x.id === id);
      if (!a) return;
      for (const k of ['sceneId', 'name', 'subject']) if (patch[k] !== undefined) a[k] = String(patch[k]);
      changed({ inspector: S.sel === 'assets' && !patch._typing });
    },
    removeAsset(id) {
      S.p.assets.items = S.p.assets.items.filter((x) => x.id !== id);
      changed({ inspector: S.sel === 'assets', preview: true });
    },
    setAssetStyle(style) {
      S.p.assets.style = ai.CUTOUT_STYLES[style] ? style : 'halftone';
      changed({ inspector: S.sel === 'assets' });
    },

    /** Generate cut-out pictures (paid: one image each), remove their green background, store them. */
    async generateAssets(ids) {
      const items = S.p.assets.items.filter((a) => a.subject && (ids && ids.length ? ids.includes(a.id) : !a.blobId));
      if (!items.length) return { generated: 0 };
      return A.busy('assets', async () => {
        let n = 0;
        const failed = [];
        for (const a of items) {
          progress('assets', `✂ ${n + failed.length + 1}/${items.length}`);
          try {
            const r = await genImage(a.subject, '1:1', (s) => ai.cutoutPrompt(s, S.p.assets.style));
            if (r.rewritten) { a.subject = r.text; app.toast(t('content_rewritten', { name: a.name || a.id }), 'ok'); }
            const src = await (await fetch(blobUrl(r.blobId), { credentials: 'same-origin' })).blob();
            const cut = await makeCutout(src);
            if (!cut.blob || cut.coverage < 0.01 || cut.coverage > 0.95) throw new Error(t('cutout_failed'));
            const up = await api('blobs', { method: 'POST', raw: true, body: cut.blob, headers: { 'content-type': cut.blob.type, 'x-file-name': a.id + (cut.blob.type === 'image/webp' ? '.webp' : '.png') } });
            Object.assign(a, { blobId: up.blobId, source: r.blobId, w: cut.width, h: cut.height, style: S.p.assets.style, at: Date.now() });
            delete a.error;
            n++;
          } catch (e) {
            a.error = String(e.message || e).slice(0, 200);
            failed.push(a.name || a.id);
          }
          changed({ inspector: S.sel === 'assets', preview: true });
        }
        if (failed.length) app.toast(t('cutouts_failed', { n: failed.length }) + ': ' + failed.join(', '), 'err');
        return { generated: n, failed: failed.length };
      });
    },

    /** Animate background images into short clips (paid: image-to-video, a few seconds each). */
    async generateClips(keys) {
      const bg = S.p.style.background;
      const im = bg.images || {};
      if (bg.mode !== 'image') throw new Error(t('clip_need_bg'));
      const targets = (keys && keys.length ? keys : Object.keys(im)).filter((k) => im[k] && im[k].blobId);
      if (!targets.length) throw new Error(t('clip_need_bg'));
      // Progress lives on the style node and inspector, which A.busy('clips') doesn't redraw on its own.
      const redraw = () => { renderNode('style'); if (S.sel === 'style') renderInsp(); };
      return A.busy('clips', async () => {
        const tl = timeline();
        const lenOf = (k) => k === 'all' ? Math.max(...tl.scenes.map((s) => s.len), 5) : ((tl.scenes.find((s) => s.id === k) || {}).len || 5);
        const prompt = ai.clipPrompt(S.p.style.look, bg.clipNotes);
        let done = 0;
        const errors = [];
        const show = () => { S.progress.clips = `${t('clip_making')} ${done}/${targets.length}`; redraw(); };
        show();
        await Promise.all(targets.map(async (k) => {
          try {
            const s = await api('video', { method: 'POST', body: { imageBlobId: im[k].blobId, prompt, duration: Math.ceil(Math.min(lenOf(k), 10)) } });
            for (let i = 0; i < 160; i++) {   // up to ~13 minutes
              await new Promise((r) => setTimeout(r, 5000));
              const r = await api('video/' + s.taskId);
              if (r.status === 'SUCCEEDED') {
                if (im[k]) im[k].clip = { blobId: r.blobId, model: s.model, duration: s.duration, prompt, at: Date.now() };
                done++;
                show();
                changed({ inspector: S.sel === 'style', preview: true });
                return;
              }
              if (r.status === 'FAILED') throw new Error(r.code === 'content_blocked' ? t('content_blocked') : (r.error || 'failed'));
            }
            throw new Error('timed out');
          } catch (e) {
            errors.push(`${k}: ${e.message || e}`);
          }
        }));
        if (errors.length) app.toast(t('clips_failed') + '\n' + errors.join('\n'), 'err');
        return { generated: done, errors };
      }).finally(() => setTimeout(redraw, 0));
    },
    removeClip(key) {
      const im = S.p.style.background.images || {};
      if (im[key]) delete im[key].clip;
      changed({ inspector: S.sel === 'style', preview: true });
    },

    setVoice(patch) {
      for (const k of ['enabled', 'voiceRef', 'speed']) if (patch[k] !== undefined) S.p.voice[k] = k === 'speed' ? Math.min(1.2, Math.max(0.7, Number(patch[k]) || 1)) : patch[k];
      changed({ inspector: S.sel === 'voice' && !patch._typing, preview: true });
      if (patch.modelId !== undefined) return A.setVoiceModel(patch.modelId);
    },

    /** The TTS model in use: the project's choice, else the voice's, else the admin default. */
    ttsModel() {
      const v = voiceDef();
      return S.p.voice.modelId || (v && v.modelId) || S.config.models.tts;
    },
    tagsInScript() {
      return S.p.script.scenes.some((s) => hasTags(s.narration));
    },

    /**
     * Switch the TTS model. Tag-capable models (v4, v3) offer to add emotion/tone tags;
     * other models would read the brackets aloud, so their tags are removed.
     */
    async setVoiceModel(modelId) {
      S.p.voice.modelId = modelId || null;
      changed({ inspector: S.sel === 'voice', preview: true });
      const tagModel = TAG_MODELS.includes(A.ttsModel());
      const hasNarration = S.p.script.scenes.some((s) => spokenText(s.narration));
      if (tagModel && hasNarration && !A.tagsInScript()) {
        const r = await app.dialog({
          title: t('tags_title'),
          body: t('tags_body'),
          input: t('tags_dir_ph'),
          ok: t('tags_apply'),
          cancel: t('tags_skip'),
        });
        if (r) await A.addAudioTags(r.value);
      } else if (!tagModel && A.tagsInScript()) {
        A.removeAudioTags();
        app.toast(t('tags_removed'), 'ok');
      }
    },

    async addAudioTags(direction) {
      return A.busy('voice', async () => {
        const res = await ai.addAudioTags(S.p, direction);
        pushHistory('script', S.p.script.scenes);
        let n = 0;
        for (const s of S.p.script.scenes) {
          const tagged = res[s.id];
          if (typeof tagged !== 'string' || tagged === s.narration) continue;
          // Accept only pure insertions: the words and {n} cues must be unchanged.
          const same = (x) => stripTags(x).replace(/\s+/g, '');
          if (same(tagged) !== same(s.narration)) continue;
          s.narration = tagged.replace(/(\[[^\[\]{}\n]{1,40}\])(?=\S)/g, '$1 ').trim();
          n++;
        }
        changed({ inspector: true, preview: true });
        app.toast(t('tags_added', { n }), n ? 'ok' : 'err');
        return { tagged: n };
      });
    },

    removeAudioTags() {
      if (!A.tagsInScript()) return;
      pushHistory('script', S.p.script.scenes);
      for (const s of S.p.script.scenes) s.narration = stripTags(s.narration);
      changed({ inspector: true, preview: true });
    },

    async generateVoice(sceneIds, { onlyMissing = false } = {}) {
      const v = voiceDef();
      if (!v) throw new Error(t('no_voices'));
      const scenes = S.p.script.scenes;
      const vs = voiceStatus();
      let targets = sceneIds && sceneIds.length ? sceneIds : scenes.map((s) => s.id);
      if (onlyMissing) targets = targets.filter((id) => vs.missing.includes(id) || vs.stale.includes(id));
      targets = targets.filter((id) => spokenText((scenes.find((s) => s.id === id) || {}).narration));
      if (!targets.length) return { generated: 0 };
      return A.busy('voice', async () => {
        let n = 0;
        for (const id of targets) {
          const i = scenes.findIndex((s) => s.id === id);
          const s = scenes[i];
          S.busy.voiceScene = id;
          if (S.sel === 'voice') renderInsp();
          const model = A.ttsModel();
          // Never send tags to a model that would read them aloud.
          const say = (x) => (TAG_MODELS.includes(model) ? spokenText(x) : spokenText(stripTags(x)));
          const r = await api('tts', {
            method: 'POST',
            body: {
              text: say(s.narration),
              voiceId: v.voiceId,
              modelId: model,
              speed: S.p.voice.speed || 1,
              languageCode: S.p.brief.language,
              // Only the previous line is sent for continuity. Sending the next line made the voice
              // treat each clip as mid-speech and take a breath (a "gasp") at the end.
              previousText: i > 0 ? spokenText(stripTags(scenes[i - 1].narration)) : undefined,
            },
          });
          S.p.voice.clips[id] = { blobId: r.blobId, duration: r.duration, alignment: r.alignment, key: clipKey(s.narration, S.p.voice.voiceRef, S.p.voice.speed || 1), at: Date.now(), modelId: r.modelId };
          n++;
          changed({ inspector: S.sel === 'voice', preview: true });
        }
        S.busy.voiceScene = null;
        return { generated: n };
      });
    },

    setMusic(patch) {
      for (const k of ['enabled', 'styleId', 'prompt', 'volume']) if (patch[k] !== undefined) S.p.music[k] = k === 'volume' ? Math.min(1, Math.max(0, Number(patch[k]))) : patch[k];
      changed({ inspector: S.sel === 'music' && !patch._typing, preview: k_vol(patch) });
    },

    async generateMusic() {
      const prompt = musicPrompt();
      if (!prompt) throw new Error('No music style or prompt');
      return A.busy('music', async () => {
        const len = musicTarget();
        const tone = S.p.brief.tone ? ` Mood: ${S.p.brief.tone}.` : '';
        const r = await api('music', { method: 'POST', body: { prompt: prompt + tone + ` Instrumental, about ${Math.round(len)} seconds, clean ending.`, lengthMs: Math.round(len * 1000) } });
        S.p.music.track = { blobId: r.blobId, duration: len, prompt, at: Date.now() };
        changed({ inspector: S.sel === 'music', preview: true });
        return r;
      });
    },

    async cancelJob() {
      const id = (S.job && S.job.id) || S.p.build.activeJobId;
      if (!id) return;
      const job = await api(`jobs/${id}/cancel`, { method: 'POST' });
      clearTimeout(pollTimer);
      S.job = job;
      S.p.build.activeJobId = null;
      changed({ inspector: S.sel === 'build' });
      app.toast(t('job_cancelled'), 'ok');
    },

    async startJob(kind, { instruction = '', sceneId = null, confirmed = false, manual = false } = {}) {
      // A job that has been silent for an hour is dead (the server expires it too), so it doesn't block.
      if (S.job && ['queued', 'fired', 'running'].includes(S.job.status) && Date.now() - (S.job.updatedAt || S.job.createdAt) < 60 * 60 * 1000) {
        throw new Error(t('job_running'));
      }
      if (!confirmed && !manual) {
        const vs = voiceStatus();
        const extra = S.p.voice.enabled && S.p.brief.format !== 'static' && vs.fresh < vs.total ? t('voice_not_ready', { n: vs.total - vs.fresh }) : '';
        const ok = await app.confirm(t('confirm_build'), [t('confirm_build_body'), extra, !S.me.configured.routine ? t('routine_off') : ''].filter(Boolean).join('\n\n'));
        if (!ok) return null;
      }
      const snapshot = { ...clone(S.p), chat: [], history: {} };
      const job = await api('jobs', { method: 'POST', body: { kind, instruction, sceneId, project: snapshot, manual, contentKey: contentKey(S.p) } });
      S.manualTicket = manual ? { id: job.id, token: job.token } : null;
      delete job.token;
      S.job = job;
      S.p.build.activeJobId = job.id;
      S.p.build.lastJob = job.id;
      changed({ inspector: S.sel === 'build' });
      if (job.status === 'failed') app.toast(job.error || t('job_failed'), 'err');
      else pollJob();
      return job;
    },

    /**
     * The two ways to make the next version: 'keep' the current graphics (re-render, or revise when
     * there is a request or the content changed) or 'remake' every scene from scratch.
     */
    makeVersion(mode, { instruction = '', sceneId = null, confirmed = false, manual = false } = {}) {
      const req = String(instruction || '').trim();
      const cur = currentVersion();
      if (mode === 'remake' || !cur) return A.startJob('build', { instruction: req, confirmed, manual });
      if (!req && !contentStale(cur) && cur.contentKey) return A.startJob('render', { confirmed, manual });
      return A.startJob('revise', { instruction: req || t('keep_apply_content'), sceneId, confirmed, manual });
    },

    useVersion(v) {
      S.p.build.current = v;
      changed({ inspector: true, preview: true });
      loadCurrent();
    },

    editText(key, value) {
      S.p.edits.texts = S.p.edits.texts || {};
      const def = S.comp && S.comp.defaults ? S.comp.defaults[key] : undefined;
      if (value === def || value == null) delete S.p.edits.texts[key];
      else S.p.edits.texts[key] = String(value);
      changed({ canvas: true });
      A.applyLive();
    },
    resetTexts() {
      S.p.edits.texts = {};
      changed({ inspector: true });
      A.applyLive();
    },

    restoreHistory(key, idx) {
      const item = (S.p.history[key] || [])[idx];
      if (!item) return;
      const cur = key === 'script' ? S.p.script.scenes : S.p[key];
      pushHistory(key, cur);
      if (key === 'script') S.p.script.scenes = clone(item.value);
      else S.p[key] = clone(item.value);
      changed({ inspector: true, preview: true });
      if (key === 'style') A.applyLive();
    },

    /** Push text + colour edits into the open previews without reloading them. */
    applyLive() {
      const patch = { texts: S.p.edits.texts || {}, colors: S.p.style.colors, font: fontStack(S.p.style.font) };
      for (const pl of players()) pl.apply(patch);
    },

    projectSummary,
    app,
  };
  function k_vol(patch) { return patch.volume !== undefined || patch.enabled !== undefined; }

  /* ---------- job polling ---------- */
  let pollTimer = null;
  async function pollJob() {
    clearTimeout(pollTimer);
    if (!S.p.build.activeJobId || S.destroyed) return;
    try {
      const job = await api('jobs/' + S.p.build.activeJobId);
      S.job = job;
      if (job.status === 'done') {
        S.p.build.activeJobId = null;
        await loadVersions();
        if (job.version) S.p.build.current = job.version;
        changed({ inspector: S.sel === 'build' || S.sel === 'preview' });
        await loadCurrent();
        app.toast(t('job_done', { v: job.version || '' }), 'ok');
        return;
      }
      if (job.status === 'failed' || job.status === 'cancelled') {
        S.p.build.activeJobId = null;
        changed({ inspector: S.sel === 'build' });
        if (job.status === 'failed') app.toast(t('job_failed') + ': ' + (job.error || ''), 'err');
        return;
      }
      renderNode('build');
      if (S.sel === 'build') renderInsp();
    } catch (e) {
      console.warn('poll', e);
    }
    pollTimer = setTimeout(pollJob, 5000);
  }

  async function loadVersions() {
    try { S.versions = (await api(`projects/${S.p.id}/versions`)).versions || []; } catch { S.versions = []; }
  }

  /* ---------- preview ---------- */
  const mainPlayer = new Player({ maxHeight: 0.42 });
  S.player = mainPlayer;
  S.inspPlayer = null;
  function players() { return [mainPlayer, S.inspPlayer].filter(Boolean); }

  async function loadCurrent() {
    const v = currentVersion();
    if (!v || !v.files || !v.files['composition.html']) { S.comp = null; refreshPreview(); return; }
    if (!S.comp || S.comp.blob !== v.files['composition.html']) {
      try {
        const fragment = await blobText(v.files['composition.html']);
        S.comp = { v: v.v, blob: v.files['composition.html'], fragment, defaults: extractTexts(fragment) };
      } catch (e) { app.toast(e.message, 'err'); S.comp = null; }
    }
    if (v.files['poster.jpg'] && S.p.poster !== v.files['poster.jpg']) {
      S.p.poster = v.files['poster.jpg'];
      changed({ canvas: false });
    }
    refreshPreview();
    renderCanvas();
    if (S.sel === 'preview' || S.sel === 'build') renderInsp();
  }

  // Background images go into the sandboxed preview as data: URIs (it can't fetch our cookie-protected blobs).
  const bgData = new Map();
  async function ensureBgData() {
    const bg = S.p.style.background;
    const ids = S.p.assets.items.map((a) => a.blobId).filter((id) => id && !bgData.has(id));
    if (bg.mode === 'image') ids.push(...Object.values(bg.images || {}).map((x) => x && x.blobId).filter((id) => id && !bgData.has(id)));
    await Promise.all(ids.map(async (id) => {
      try {
        const blob = await (await fetch(blobUrl(id), { credentials: 'same-origin' })).blob();
        bgData.set(id, await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); }));
      } catch (e) { console.warn('background', id, e); }
    }));
  }
  function bgImagesForPreview() {
    const bg = S.p.style.background;
    if (bg.mode !== 'image') return {};
    const out = {};
    for (const [k, v] of Object.entries(bg.images || {})) if (v && bgData.has(v.blobId)) out[k] = bgData.get(v.blobId);
    return out;
  }

  function assetsForPreview() {
    const out = {};
    for (const a of S.p.assets.items) if (a.blobId && bgData.has(a.blobId)) out[a.id] = bgData.get(a.blobId);
    return out;
  }

  // Clip videos go in as bytes after the stage loads (fetched once per clip, shared by both players).
  const clipBytes = new Map();
  function clipsForPreview() {
    const bg = S.p.style.background;
    const clips = {}, bytes = {};
    if (bg.mode !== 'image' || timeline().static) return { clips, bytes };
    for (const [k, v] of Object.entries(bg.images || {})) {
      const c = v && v.clip;
      if (!c || !c.blobId) continue;
      if (!clipBytes.has(c.blobId)) {
        clipBytes.set(c.blobId, fetch(blobUrl(c.blobId), { credentials: 'same-origin' }).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null));
      }
      clips[k] = { dur: c.duration || 5 };
      bytes[k] = clipBytes.get(c.blobId);
    }
    return { clips, bytes };
  }

  function playerOpts() {
    const tl = timeline();
    const voices = tl.scenes.filter((s) => s.voice).map((s) => ({ url: blobUrl(s.voice.blobId), at: s.voice.at, dur: s.voice.dur }));
    const m = S.p.music;
    const music = m.enabled && m.track && !tl.static ? { url: blobUrl(m.track.blobId), volume: m.volume } : null;
    const cl = clipsForPreview();
    return {
      fragment: S.comp.fragment, timeline: tl, colors: S.p.style.colors, font: fontStack(S.p.style.font), texts: S.p.edits.texts || {},
      images: bgImagesForPreview(), bgStrength: S.p.style.background.strength, voices, music,
      look: S.p.style.look, assets: assetsForPreview(), clips: cl.clips, clipBytes: cl.bytes,
    };
  }

  const refreshPreview = debounce(async () => {
    if (S.comp) await ensureBgData();
    for (const pl of players()) {
      if (!S.comp) pl.showEmpty(t('preview_empty'));
      else pl.load(playerOpts());
    }
  }, 250);
  A.refreshPreview = refreshPreview;
  A.makeInspectorPlayer = () => {
    if (S.inspPlayer) S.inspPlayer.destroy();
    const pl = new Player({ maxHeight: 0.5 });
    S.inspPlayer = pl;
    if (!S.comp) pl.showEmpty(t('preview_empty'));
    else ensureBgData().then(() => { if (S.inspPlayer === pl) pl.load(playerOpts()); });
    return pl;
  };
  A.dropInspectorPlayer = () => { if (S.inspPlayer) { S.inspPlayer.destroy(); S.inspPlayer = null; } };

  /* ---------- canvas ---------- */
  function statusPill(st) {
    return h('span', { class: 'pill s-' + st }, t('st_' + st));
  }

  function buildNodes() {
    inner.querySelectorAll('.node').forEach((n) => n.remove());
    NODES.forEach((n, i) => {
      const pill = h('span');
      const body = h('div', { class: 'node-body' });
      const foot = h('div', { class: 'node-foot' });
      const root = h('div', { class: `node k-${n.key}${n.wide ? ' wide' : ''}`, 'data-key': n.key, onclick: (e) => { if (!e.target.closest('button,a,input,.player')) A.select(n.key); } },
        i > 0 ? h('div', { class: 'port in' }) : null,
        i < NODES.length - 1 ? h('div', { class: 'port out' }) : null,
        h('div', { class: 'node-head' },
          h('div', { class: 'node-num' }, String(i + 1)),
          h('div', { class: 'node-icon' }, icon(n.icon)),
          h('div', { class: 'node-titles' }, h('div', { class: 'node-title' }, t('n_' + n.key)), h('div', { class: 'node-kind' }, t('k_' + n.key))),
          pill),
        body, foot);
      S.nodeEls[n.key] = { root, pill, body, foot };
      inner.append(root);
    });
    const pv = S.nodeEls.preview;
    pv.playerHost = h('div');
    pv.playerHost.append(mainPlayer.el);
    pv.info = h('div', { class: 'row wrap' });
    pv.body.append(pv.playerHost, pv.info);
  }

  function renderNode(key) {
    const el = S.nodeEls[key];
    if (!el) return;
    const st = nodeStatus(key);
    el.pill.replaceChildren(statusPill(st));
    el.root.classList.toggle('sel', S.sel === key);
    el.root.classList.toggle('done', st === 'done');
    el.root.classList.toggle('is-running', st === 'running');
    const p = S.p;
    const B = el.body, F = el.foot;
    const regen = (label, fn, dis) => h('button', { class: 'btn sm', disabled: dis || S.busy[key], onclick: async (e) => { e.stopPropagation(); try { await fn(); } catch {} } }, icon('refresh'), label);
    const openBtn = h('button', { class: 'btn sm ghost', onclick: (e) => { e.stopPropagation(); A.select(key); } }, t('open'));
    if (key === 'preview') {
      const v = currentVersion();
      const info = [];
      if (v) {
        info.push(h('span', { class: 'tag' }, 'v' + v.v));
        if (v.files['video.mp4']) info.push(h('a', { class: 'btn xs', href: blobUrl(v.files['video.mp4']), download: fileName(p, v, 'mp4'), onclick: (e) => e.stopPropagation() }, icon('download'), 'MP4'));
        if (v.files['image.png']) info.push(h('a', { class: 'btn xs', href: blobUrl(v.files['image.png']), download: fileName(p, v, 'png'), onclick: (e) => e.stopPropagation() }, icon('download'), 'PNG'));
        if (v.files['document.pdf']) info.push(h('a', { class: 'btn xs', href: blobUrl(v.files['document.pdf']), download: fileName(p, v, 'pdf'), onclick: (e) => e.stopPropagation() }, icon('download'), 'PDF'));
        if (contentStale(v)) info.push(h('span', { class: 'hint' }, t('content_changed', { v: v.v })));
        else if (versionStale(v)) info.push(h('span', { class: 'hint' }, t('out_of_date')));
      }
      info.push(h('span', { style: { flex: 1 } }), openBtn);
      el.info.replaceChildren(...info);
      F.replaceChildren();
      return;
    }
    let body = [];
    let foot = [];
    switch (key) {
      case 'brief':
        body = [h('div', { class: 'big' }, p.brief.takeaway || p.brief.topic || t('st_empty')),
          h('div', { class: 'line' }, [p.brief.format === 'static' ? t('static') : `${t('animated')} · ${p.brief.length}${t('sec')}`, p.brief.ratio, (p.brief.language || '').toUpperCase(), p.brief.audience].filter(Boolean).join(' · '))];
        foot = [regen(t('suggest'), () => A.suggestBrief(), !p.brief.topic), openBtn];
        break;
      case 'facts': {
        const n = p.facts.items.length;
        body = n ? [h('div', { class: 'big' }, p.facts.items[0].claim), h('div', { class: 'line' }, `${n} facts · ${t('sources_found', { n: (p.facts.sources || []).length })}`)] : [h('div', {}, t('facts_empty'))];
        foot = [regen(n ? t('regen') : t('research'), () => A.research()), openBtn];
        break;
      }
      case 'script': {
        const tl = timeline();
        const sc = p.script.scenes;
        body = sc.length ? [h('div', { class: 'big' }, sc.map((s) => s.title || s.onscreen).filter(Boolean).slice(0, 4).join(' → ')),
          h('div', { class: 'line' }, `${sc.length} ${t('scenes')} · ${tl.static ? t('static') : '≈' + fmtTime(tl.duration)}`),
          tl.static ? null : strip(tl)] : [h('div', {}, t('st_empty'))];
        foot = [regen(sc.length ? t('regen') : t('write_script'), () => A.writeScript()), openBtn];
        break;
      }
      case 'style': {
        const c = p.style.colors || {};
        body = [h('div', { class: 'mini-swatch' }, ['bg', 'surface', 'text', 'accent', 'accent2', 'accent3'].map((k) => h('i', { style: { background: c[k] || '#333' } }))),
          h('div', { class: 'line' }, [p.style.paletteName || (S.config.palettes.find((x) => x.id === p.style.paletteId) || {}).name || 'Custom', p.style.font, t(p.style.motion || 'lively')].join(' · ')),
          h('div', { class: 'line' }, p.style.background.mode === 'image' ? `${t('bg_title')}: ${t('bg_image')} ${bgStatus().have}/${bgStatus().keys.length}` : `${t('bg_title')}: ${t('bg_color')}`),
          p.style.look === 'collage' ? h('div', { class: 'line' }, t('look') + ': ' + t('look_collage')) : null,
          S.busy.clips ? h('div', { class: 'line mono' }, S.progress.clips || '🎬 …') : null];
        foot = [p.style.background.mode === 'image' && bgStatus().missing.length
          ? regen(t('bg_generate', { n: bgStatus().missing.length }), () => A.generateBackgrounds(bgStatus().missing)) : null, openBtn];
        break;
      }
      case 'assets': {
        const items = p.assets.items;
        const made = items.filter((a) => a.blobId);
        body = items.length
          ? [h('div', { class: 'cut-strip' }, made.slice(0, 8).map((a) => h('img', { src: blobUrl(a.blobId), alt: a.name, title: a.name }))),
            h('div', { class: 'line' }, t('assets_count', { made: made.length, n: items.length }))]
          : [h('div', {}, p.style.look === 'collage' ? t('assets_empty') : t('assets_off'))];
        foot = [items.length && made.length < items.length
          ? regen(t('assets_generate', { n: items.length - made.length }), () => A.generateAssets())
          : regen(t('assets_plan'), () => A.planAssets(), !p.script.scenes.length), openBtn];
        break;
      }
      case 'voice': {
        const vd = voiceDef();
        const vs = voiceStatus();
        body = p.voice.enabled && p.brief.format !== 'static'
          ? [h('div', { class: 'big' }, vd ? vd.name : t('no_voices')), h('div', { class: 'line' }, `${vs.fresh}/${vs.total} ${t('scenes')} · ×${p.voice.speed || 1}`)]
          : [h('div', {}, t('st_off'))];
        foot = [p.voice.enabled && p.brief.format !== 'static' ? regen(vs.fresh ? t('gen_missing_voice') : t('generate'), () => A.generateVoice(null, { onlyMissing: vs.fresh > 0 }), !vd || !vs.total || (vs.fresh === vs.total)) : null, openBtn];
        break;
      }
      case 'music': {
        const st = (S.config.musicStyles || []).find((m) => m.id === p.music.styleId);
        const ms = musicStatus();
        body = p.music.enabled && p.brief.format !== 'static'
          ? [h('div', { class: 'big' }, p.music.prompt ? t('music_custom') : st ? st.name : '—'), h('div', { class: 'line' }, ms === 'ok' ? `${p.music.track.duration}s · vol ${Math.round(p.music.volume * 100)}%` : ms === 'stale' ? t('music_stale') : t('st_empty'))]
          : [h('div', {}, t('st_off'))];
        foot = [p.music.enabled && p.brief.format !== 'static' ? regen(ms === 'missing' ? t('generate') : t('regen'), () => A.generateMusic()) : null, openBtn];
        break;
      }
      case 'build': {
        const j = S.job;
        const running = j && ['queued', 'fired', 'running'].includes(j.status);
        body = running
          ? [h('div', { class: 'big' }, (j.log && j.log.length ? j.log[j.log.length - 1].msg : t('job_running'))), h('div', { class: 'line' }, `${j.kind} · ${j.stage}`)]
          : S.versions.length ? [h('div', { class: 'big' }, `v${currentVersion().v} · ${fmtDate(currentVersion().createdAt)}`), h('div', { class: 'line' }, `${S.versions.length} ${t('versions')}`)]
            : [h('div', {}, t('build_hint'))];
        // Once a version exists the inspector asks which mode (keep graphics / remake all), so no quick button.
        foot = [running
          ? h('button', { class: 'btn sm danger', onclick: async (e) => { e.stopPropagation(); try { await A.cancelJob(); } catch (er) { app.toast(er.message, 'err'); } } }, icon('x'), t('job_cancel'))
          : S.versions.length ? null
            : h('button', { class: 'btn sm claude', disabled: !p.script.scenes.length, onclick: async (e) => { e.stopPropagation(); try { await A.startJob('build'); } catch (er) { app.toast(er.message, 'err'); } } }, icon('build'), t('build_new')), openBtn];
        break;
      }
    }
    if (S.busy[key] && S.progress[key]) body.push(h('div', { class: 'line mono' }, S.progress[key]));
    B.replaceChildren(...body.filter(Boolean));
    F.replaceChildren(...foot.filter(Boolean));
  }

  function strip(tl) {
    return h('div', { class: 'scene-strip' }, tl.scenes.map((s) => h('i', { class: s.voice ? 'v' : '', style: { flex: String(s.len) }, title: `${s.id} ${s.len}s` })));
  }

  function renderCanvas() {
    for (const n of NODES) renderNode(n.key);
    requestAnimationFrame(drawWires);
  }

  function drawWires() {
    const base = inner.getBoundingClientRect();
    if (!base.width) return;
    const paths = [];
    for (let i = 0; i < NODES.length - 1; i++) {
      const a = S.nodeEls[NODES[i].key].root.getBoundingClientRect();
      const b = S.nodeEls[NODES[i + 1].key].root.getBoundingClientRect();
      const x1 = a.right - base.left, y1 = a.top - base.top + 29;
      const x2 = b.left - base.left, y2 = b.top - base.top + 29;
      let d;
      if (Math.abs(y1 - y2) < 4) d = `M${x1},${y1} C${x1 + 30},${y1} ${x2 - 30},${y2} ${x2},${y2}`;
      else {
        // Next row: drop into the gap between the rows, run left, then come into the input port.
        const gy = (a.bottom - base.top + b.top - base.top) / 2;
        const r = 14;
        d = `M${x1},${y1} C${x1 + 22},${y1} ${x1 + 22},${y1} ${x1 + 22},${y1 + r}` +
          ` L${x1 + 22},${gy - r} Q${x1 + 22},${gy} ${x1 + 22 - r},${gy}` +
          ` L${x2 - 22 + r},${gy} Q${x2 - 22},${gy} ${x2 - 22},${gy + r}` +
          ` L${x2 - 22},${y2 - r} Q${x2 - 22},${y2} ${x2},${y2}`;
      }
      const from = nodeStatus(NODES[i].key);
      const to = nodeStatus(NODES[i + 1].key);
      const cls = to === 'running' ? 'wire run' : (from === 'done' || from === 'off') ? 'wire on' : 'wire';
      paths.push(`<path class="${cls}" d="${d}"/>`);
    }
    wires.setAttribute('width', inner.scrollWidth);
    wires.setAttribute('height', inner.scrollHeight);
    wires.innerHTML = paths.join('');
  }
  const ro = new ResizeObserver(() => drawWires());
  ro.observe(inner);

  /* ---------- inspector ---------- */
  function renderInsp() {
    if (!S.sel) { insp.replaceChildren(); A.dropInspectorPlayer(); return; }
    renderInspector(insp, S.sel, A);
  }

  /* ---------- summary for the chat model ---------- */
  function projectSummary() {
    const p = S.p;
    const tl = timeline();
    const vs = voiceStatus();
    const vd = voiceDef();
    const cur = currentVersion();
    const lines = [];
    lines.push(`Title: ${p.title || ''}`);
    lines.push(`Brief: ${JSON.stringify(p.brief)}`);
    lines.push(`Facts (${p.facts.items.length}): ${p.facts.items.slice(0, 8).map((f, i) => `${i + 1}) ${f.claim} [${f.value}]`).join(' | ')}`);
    lines.push(`Script (${p.script.scenes.length} scenes, ${tl.static ? 'static' : tl.duration + 's'}):`);
    for (const s of p.script.scenes) lines.push(`  ${s.id} "${s.title}" narration: ${s.narration.slice(0, 160)} | onscreen: ${s.onscreen.slice(0, 100)}`);
    lines.push(`Style: palette=${p.style.paletteName || p.style.paletteId || 'custom'} colors=${JSON.stringify(p.style.colors)} font=${p.style.font} motion=${p.style.motion}`);
    const bgs = bgStatus();
    lines.push(`Background: ${p.style.background.mode === 'image' ? `AI images (${p.style.background.scope}, look=${p.style.background.look}, strength=${p.style.background.strength}), ${bgs.have}/${bgs.keys.length} generated` : 'colours only'}`);
    const clipKeys = Object.entries(p.style.background.images || {}).filter(([, v]) => v && v.clip).map(([k]) => k);
    if (clipKeys.length) lines.push(`Moving backgrounds (AI clips): ${clipKeys.join(', ')}`);
    lines.push(`Look: ${p.style.look === 'collage' ? 'collage (Vox-style paper collage)' : 'default'}`);
    const cuts = p.assets.items;
    if (cuts.length) lines.push(`Cut-outs: ${cuts.filter((a) => a.blobId).length}/${cuts.length} made (${p.assets.style}); ${cuts.slice(0, 18).map((a) => `${a.id} ${a.sceneId} "${a.name}"${a.blobId ? '' : ' (no picture yet)'}`).join('; ')}`);
    lines.push(`Voice: ${p.voice.enabled ? `on, voice=${vd ? `${vd.id} (${vd.name})` : 'none'}, speed=${p.voice.speed}, clips ${vs.fresh}/${vs.total} up to date` : 'off'}`);
    lines.push(`Music: ${p.music.enabled ? `on, style=${p.music.styleId}${p.music.prompt ? ' custom prompt' : ''}, volume=${p.music.volume}, track=${musicStatus()}` : 'off'}`);
    lines.push(`Build: ${S.versions.length} versions${cur ? `, current v${cur.v}${contentStale(cur) ? ' (brief/facts/script changed since it was made)' : ''}${versionStale(cur) ? ' (video out of date with edits)' : ''}` : ''}${S.job ? `, last job ${S.job.kind} ${S.job.status}` : ''}`);
    if (S.comp && S.comp.defaults) {
      const keys = Object.entries(S.comp.defaults).slice(0, 50).map(([k, v]) => `${k}=${JSON.stringify((p.edits.texts || {})[k] ?? v)}`);
      lines.push(`Editable on-screen texts of the current version: ${keys.join('; ')}`);
    }
    lines.push(`Available voices: ${(S.config.voices || []).map((v) => `${v.id} (${v.name}${v.language ? ', ' + v.language : ''})`).join('; ') || 'none'}`);
    lines.push(`Music styles: ${(S.config.musicStyles || []).map((m) => `${m.id} (${m.name})`).join('; ')}`);
    lines.push(`Palettes: ${(S.config.palettes || []).map((x) => `${x.id} (${x.name})`).join('; ')}`);
    return lines.join('\n');
  }

  /* ---------- start ---------- */
  buildNodes();
  app.setTitle(S.p.title || S.p.brief.topic, (v) => { S.p.title = v; changed({ canvas: false }); });
  await loadVersions();
  renderCanvas();
  mountChat(chatEl, A);
  await loadCurrent();
  if (S.p.build.activeJobId) {
    try { S.job = await api('jobs/' + S.p.build.activeJobId); } catch {}
    pollJob();
  } else if (S.p.build.lastJob) {
    try { S.job = await api('jobs/' + S.p.build.lastJob); } catch {}
    renderCanvas();
  }
  // A brand-new project: fill in the brief right away.
  if (S.p.brief.topic && !S.p.brief.takeaway && !S.p.history.brief) {
    A.suggestBrief().catch(() => {});
  }
  const onResize = () => { drawWires(); for (const pl of players()) pl.layout(); };
  window.addEventListener('resize', onResize);

  return {
    destroy() {
      clearTimeout(pollTimer);
      if (S.dirty) saveNow();
      S.destroyed = true;
      ro.disconnect();
      window.removeEventListener('resize', onResize);
      mainPlayer.destroy();
      A.dropInspectorPlayer();
    },
  };
}

/**
 * Shrink a generated image (PNG, ~2 MB) to a JPEG of at most 1920 px on the long side and store it.
 * Smaller files keep the preview and the cloud render quick. Returns the new blob id.
 */
async function compressImage(blobId) {
  const src = await (await fetch(blobUrl(blobId), { credentials: 'same-origin' })).blob();
  const bmp = await createImageBitmap(src);
  const scale = Math.min(1, 1920 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const jpg = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.86));
  if (!jpg) return null;
  const r = await api('blobs', { method: 'POST', raw: true, body: jpg, headers: { 'content-type': 'image/jpeg', 'x-file-name': 'background.jpg' } });
  return r.blobId;
}

export function fontStack(key) {
  return FONT_STACKS[key] || FONT_STACKS.sans;
}

function fileName(p, v, ext) {
  const base = String(p.title || p.brief.topic || 'infographic').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'infographic';
  return `${base} v${v.v}.${ext}`;
}

export { uid };
