// The project workspace: node canvas in the middle, chat on the left, inspector on the right.
// Holds the project state, saves it, and exposes the actions the inspector and chat use.

import { api, blobUrl, blobText, ApiError } from './api.js';
import { h, icon, debounce, clone, fmtTime, fmtDate, uid } from './util.js';
import { t, getLang } from './i18n.js';
import { computeTimeline, spokenText, clipKey } from './timeline.js';
import { styleKey, FONT_STACKS } from './assemble.js';
import { extractTexts } from './lint.js';
import * as ai from './ai.js';
import { Player } from './player.js';
import { renderInspector } from './inspector.js';
import { mountChat } from './chat.js';

export const NODES = [
  { key: 'brief', icon: 'brief' },
  { key: 'facts', icon: 'facts' },
  { key: 'script', icon: 'script' },
  { key: 'style', icon: 'style' },
  { key: 'voice', icon: 'voice' },
  { key: 'music', icon: 'music' },
  { key: 'build', icon: 'build' },
  { key: 'preview', icon: 'preview', wide: true },
];

export function normalize(p, config) {
  const d = config.defaults || {};
  const pal = (config.palettes || []).find((x) => x.id === d.paletteId) || (config.palettes || [])[0];
  p.brief = { topic: '', takeaway: '', audience: '', tone: '', notes: '', format: d.format || 'animated', ratio: d.ratio || '16:9', length: d.length || 45, language: d.language || getLang(), ...(p.brief || {}) };
  p.facts = { items: [], sources: [], summary: '', ...(p.facts || {}) };
  p.script = { scenes: [], ...(p.script || {}) };
  p.style = { paletteId: pal ? pal.id : null, colors: pal ? clone(pal.colors) : null, font: 'sans', motion: 'lively', notes: '', ...(p.style || {}) };
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
    sel: null, busy: {}, comp: null, nodeEls: {}, destroyed: false,
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
      else if (c.key !== clipKey(s.narration, S.p.voice.voiceRef, S.p.voice.speed || 1)) stale.push(s.id);
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
    if (v.styleKey && v.styleKey !== styleKey(S.p.style)) return true;
    if (!tl.static && v.duration && Math.abs(v.duration - tl.duration) > 0.05) return true;
    return false;
  }

  function nodeStatus(key) {
    const p = S.p;
    if (S.busy[key]) return 'running';
    switch (key) {
      case 'brief': return p.brief.topic && p.brief.takeaway ? 'done' : p.brief.topic ? 'ready' : 'empty';
      case 'facts': return p.facts.items.length ? 'done' : p.facts.skipped ? 'off' : 'empty';
      case 'script': return p.script.scenes.length ? 'done' : 'empty';
      case 'style': return p.style.colors ? 'done' : 'empty';
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
        return versionStale(v) ? 'stale' : 'done';
      }
    }
    return 'empty';
  }

  /* ---------- history ---------- */
  function pushHistory(key, value) {
    const list = S.p.history[key] || (S.p.history[key] = []);
    list.push({ at: Date.now(), value: clone(value) });
    S.p.history[key] = list.slice(-8);
  }

  /* ---------- actions (used by inspector + chat) ---------- */
  const A = {
    S, timeline, voiceDef, voiceStatus, musicStatus, musicTarget, musicPrompt, currentVersion, versionStale, nodeStatus,
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
        const r = await ai.researchFacts(S.p, focus);
        if (!r.items.length) throw new Error(r.summary || 'No facts found');
        if (S.p.facts.items.length) pushHistory('facts', S.p.facts);
        S.p.facts = { ...S.p.facts, ...r, skipped: false };
        changed({ inspector: S.sel === 'facts' });
        return r;
      });
    },

    async writeScript(direction, sceneId) {
      return A.busy('script', async () => {
        const r = await ai.writeScript(S.p, { direction, sceneId });
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
      return A.busy('style', () => ai.suggestPalettes(S.p, direction));
    },
    async paletteFromSite(url) {
      return A.busy('style', async () => {
        const pal = await ai.paletteFromSite(S.p, url);
        A.applyPalette(pal);
        return pal;
      });
    },

    setVoice(patch) {
      for (const k of ['enabled', 'voiceRef', 'speed']) if (patch[k] !== undefined) S.p.voice[k] = k === 'speed' ? Math.min(1.2, Math.max(0.7, Number(patch[k]) || 1)) : patch[k];
      changed({ inspector: S.sel === 'voice' && !patch._typing, preview: true });
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
          const r = await api('tts', {
            method: 'POST',
            body: {
              text: spokenText(s.narration),
              voiceId: v.voiceId,
              modelId: v.modelId || S.config.models.tts,
              speed: S.p.voice.speed || 1,
              languageCode: S.p.brief.language,
              previousText: i > 0 ? spokenText(scenes[i - 1].narration) : undefined,
              nextText: i < scenes.length - 1 ? spokenText(scenes[i + 1].narration) : undefined,
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

    async startJob(kind, { instruction = '', sceneId = null, confirmed = false } = {}) {
      if (S.job && ['queued', 'fired', 'running'].includes(S.job.status)) throw new Error(t('job_running'));
      if (!confirmed) {
        const vs = voiceStatus();
        const extra = S.p.voice.enabled && S.p.brief.format !== 'static' && vs.fresh < vs.total ? t('voice_not_ready', { n: vs.total - vs.fresh }) : '';
        const ok = await app.confirm(t('confirm_build'), [t('confirm_build_body'), extra, !S.me.configured.routine ? t('routine_off') : ''].filter(Boolean).join('\n\n'));
        if (!ok) return null;
      }
      const snapshot = { ...clone(S.p), chat: [], history: {} };
      const job = await api('jobs', { method: 'POST', body: { kind, instruction, sceneId, project: snapshot } });
      S.job = job;
      S.p.build.activeJobId = job.id;
      S.p.build.lastJob = job.id;
      changed({ inspector: S.sel === 'build' });
      if (job.status === 'failed') app.toast(job.error || t('job_failed'), 'err');
      else pollJob();
      return job;
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
      if (job.status === 'failed') {
        S.p.build.activeJobId = null;
        changed({ inspector: S.sel === 'build' });
        app.toast(t('job_failed') + ': ' + (job.error || ''), 'err');
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

  function playerOpts() {
    const tl = timeline();
    const voices = tl.scenes.filter((s) => s.voice).map((s) => ({ url: blobUrl(s.voice.blobId), at: s.voice.at }));
    const m = S.p.music;
    const music = m.enabled && m.track && !tl.static ? { url: blobUrl(m.track.blobId), volume: m.volume } : null;
    return { fragment: S.comp.fragment, timeline: tl, colors: S.p.style.colors, font: fontStack(S.p.style.font), texts: S.p.edits.texts || {}, voices, music };
  }

  const refreshPreview = debounce(() => {
    for (const pl of players()) {
      if (!S.comp) pl.showEmpty(t('preview_empty'));
      else pl.load(playerOpts());
    }
  }, 250);
  A.refreshPreview = refreshPreview;
  A.makeInspectorPlayer = () => {
    if (S.inspPlayer) S.inspPlayer.destroy();
    S.inspPlayer = new Player({ maxHeight: 0.5 });
    if (!S.comp) S.inspPlayer.showEmpty(t('preview_empty'));
    else S.inspPlayer.load(playerOpts());
    return S.inspPlayer;
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
        if (versionStale(v)) info.push(h('span', { class: 'hint' }, t('out_of_date')));
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
          h('div', { class: 'line' }, [p.style.paletteName || (S.config.palettes.find((x) => x.id === p.style.paletteId) || {}).name || 'Custom', p.style.font, t(p.style.motion || 'lively')].join(' · '))];
        foot = [openBtn];
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
        foot = [h('button', { class: 'btn sm claude', disabled: running || !p.script.scenes.length, onclick: async (e) => { e.stopPropagation(); try { await A.startJob('build'); } catch (er) { app.toast(er.message, 'err'); } } }, icon('build'), t('build_new')), openBtn];
        break;
      }
    }
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
    lines.push(`Voice: ${p.voice.enabled ? `on, voice=${vd ? `${vd.id} (${vd.name})` : 'none'}, speed=${p.voice.speed}, clips ${vs.fresh}/${vs.total} up to date` : 'off'}`);
    lines.push(`Music: ${p.music.enabled ? `on, style=${p.music.styleId}${p.music.prompt ? ' custom prompt' : ''}, volume=${p.music.volume}, track=${musicStatus()}` : 'off'}`);
    lines.push(`Build: ${S.versions.length} versions${cur ? `, current v${cur.v}${versionStale(cur) ? ' (video out of date with edits)' : ''}` : ''}${S.job ? `, last job ${S.job.kind} ${S.job.status}` : ''}`);
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

export function fontStack(key) {
  return FONT_STACKS[key] || FONT_STACKS.sans;
}

function fileName(p, v, ext) {
  const base = String(p.title || p.brief.topic || 'infographic').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'infographic';
  return `${base} v${v.v}.${ext}`;
}

export { uid };
