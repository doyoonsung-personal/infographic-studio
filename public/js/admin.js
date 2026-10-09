// Owner admin: the option lists people pick from (voices, music styles, palettes), models, defaults,
// connection status and a routine ping test.

import { api } from './api.js';
import { h, icon, clone, COLOR_KEYS } from './util.js';
import { t } from './i18n.js';
import { audioButton } from './player.js';

const TTS_MODELS = ['', 'eleven_multilingual_v2', 'eleven_v3', 'eleven_v4', 'eleven_flash_v2_5', 'eleven_turbo_v2_5'];
const MUSIC_MODELS = ['music_v2_5', 'music_v2', 'music_v1'];
const IMAGE_MODELS = [
  ['qwen-image-3.0', 'qwen-image-3.0 · $0.03'], ['qwen-image-3.0-pro', 'qwen-image-3.0-pro'], ['qwen-image-max', 'qwen-image-max · $0.075'],
  ['z-image-turbo', 'z-image-turbo · $0.015'], ['wan2.7-image', 'wan2.7-image · $0.03'],
];
const QWEN = ['qwen3.8-flash', 'qwen3.8-max', 'qwen3.8-27b', 'qwen3.7-max', 'qwen3.7-plus', 'qwen3.7-flash'];

export async function openAdmin(root, app) {
  const cfg = clone(await api('config'));
  const me = await api('me');
  const wrap = h('div', { class: 'admin' });
  root.replaceChildren(h('div', { class: 'view' }, wrap));

  const saveBtn = h('button', { class: 'btn primary', onclick: save }, t('save'));
  async function save() {
    saveBtn.disabled = true;
    try {
      const clean = await api('config', { method: 'PUT', body: cfg });
      Object.assign(cfg, clean);
      app.config = clean;
      app.toast(t('saved_ok'), 'ok');
      render();
    } catch (e) { app.toast(e.message, 'err'); }
    finally { saveBtn.disabled = false; }
  }

  function render() {
    wrap.replaceChildren(
      h('div', { class: 'row' }, h('h1', { class: 'grow' }, t('admin_title')), saveBtn),
      services(), activeJobs(), voices(), music(), palettes(), models());
  }

  // Jobs still queued/running (e.g. a routine run that never reported back) with a way to stop them.
  function activeJobs() {
    const list = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, h('div', { class: 'hint' }, '…'));
    const cancelAll = h('button', { class: 'btn sm danger', hidden: true }, icon('x'), t('cancel_all'));
    const panel = h('section', { class: 'panel' },
      h('div', { class: 'row' }, h('h2', { class: 'grow' }, icon('build'), t('active_jobs')), cancelAll,
        h('button', { class: 'btn sm icon ghost', title: t('regen'), onclick: () => load() }, icon('refresh'))),
      h('div', { class: 'hint' }, t('active_jobs_hint')),
      list);
    const age = (ts) => {
      const m = Math.round((Date.now() - (ts || Date.now())) / 60000);
      return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
    };
    async function stop(id) {
      await api(`jobs/${id}/cancel`, { method: 'POST' });
    }
    async function load() {
      try {
        const { jobs } = await api('jobs');
        cancelAll.hidden = jobs.length < 2;
        cancelAll.onclick = async () => {
          if (!(await app.confirm(t('cancel_all'), `${jobs.length}`))) return;
          for (const j of jobs) await stop(j.id).catch(() => {});
          app.toast(t('job_cancelled'), 'ok');
          load();
        };
        list.replaceChildren(...(jobs.length ? jobs.map((j) => h('div', { class: 'clip' },
          h('span', { class: 'pill s-running' }, j.status),
          h('b', { style: { minWidth: '60px' } }, j.kind),
          h('span', { class: 'txt' }, `${j.title || j.id} · ${t('updated')} ${age(j.updatedAt)} ago`),
          j.projectId ? h('a', { class: 'btn xs ghost', href: '#/p/' + j.projectId }, t('open')) : null,
          h('button', { class: 'btn xs danger', onclick: async (e) => {
            e.currentTarget.disabled = true;
            try { await stop(j.id); app.toast(t('job_cancelled'), 'ok'); } catch (er) { app.toast(er.message, 'err'); }
            load();
          } }, icon('x'), t('job_cancel'))))
          : [h('div', { class: 'hint' }, t('no_active_jobs'))]));
      } catch (e) { list.replaceChildren(h('div', { class: 'err' }, e.message)); }
    }
    load();
    return panel;
  }

  function services() {
    const dot = (ok, label) => h('span', { class: 'tag' }, h('i', { style: { width: '8px', height: '8px', borderRadius: '50%', display: 'inline-block', background: ok ? 'var(--ok)' : 'var(--err)' } }), label);
    const out = h('div', { class: 'joblog', hidden: true });
    const btn = h('button', { class: 'btn', disabled: !me.configured.routine }, icon('build'), t('test_routine'));
    btn.onclick = async () => {
      btn.disabled = true;
      out.hidden = false;
      out.textContent = '…';
      try {
        let job = await api('jobs', { method: 'POST', body: { kind: 'ping' } });
        const show = () => {
          out.replaceChildren(
            h('div', {}, `status: ${job.status} · ${job.stage}`),
            job.sessionUrl ? h('div', {}, h('a', { href: job.sessionUrl, target: '_blank', rel: 'noopener', style: { color: 'var(--info)' } }, job.sessionUrl)) : null,
            ...(job.log || []).map((l) => h('div', {}, `${new Date(l.at).toLocaleTimeString()}  ${l.msg}`)));
        };
        show();
        for (let i = 0; i < 120 && !['done', 'failed'].includes(job.status); i++) {
          await new Promise((r) => setTimeout(r, 5000));
          job = await api('jobs/' + job.id);
          show();
        }
      } catch (e) { out.textContent = e.message; }
      finally { btn.disabled = false; }
    };
    return h('section', { class: 'panel' },
      h('h2', {}, t('services')),
      h('div', { class: 'row wrap' }, dot(me.configured.qwen, 'Qwen (Model Studio)'), dot(me.configured.eleven, 'ElevenLabs'), dot(me.configured.routine, 'Claude routine')),
      h('div', { class: 'row wrap' }, btn, h('span', { class: 'hint' }, t('test_routine_hint'))),
      out);
  }

  function voices() {
    const rows = cfg.voices.map((v, i) => h('tr', {},
      h('td', {}, inp(v, 'name')),
      h('td', {}, inp(v, 'voiceId', { class: 'mono' })),
      h('td', {}, h('select', { onchange: (e) => { v.modelId = e.target.value; } }, TTS_MODELS.map((m) => h('option', { value: m, selected: (v.modelId || '') === m }, m || '(default)')))),
      h('td', { style: { width: '70px' } }, inp(v, 'language', { placeholder: 'ko' })),
      h('td', {}, inp(v, 'note')),
      h('td', { style: { whiteSpace: 'nowrap' } },
        v.previewUrl ? audioButton(v.previewUrl) : null,
        h('button', { class: 'btn xs icon ghost', onclick: () => { cfg.voices.splice(i, 1); render(); } }, icon('trash')))));
    const importBox = h('div', { hidden: true, class: 'card' });
    const importBtn = h('button', { class: 'btn', disabled: !me.configured.eleven }, icon('download'), t('import_voices'));
    importBtn.onclick = async () => {
      importBtn.disabled = true;
      try {
        const r = await api('eleven/voices');
        importBox.hidden = false;
        const filter = h('input', { type: 'search', placeholder: 'filter (name, language, accent…)' });
        const list = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '420px', overflow: 'auto' } });
        const draw = () => {
          const q = filter.value.trim().toLowerCase();
          list.replaceChildren(...r.voices.filter((v) => !q || JSON.stringify(v).toLowerCase().includes(q)).map((v) => {
            const added = cfg.voices.some((x) => x.voiceId === v.voiceId);
            return h('div', { class: 'clip' },
              h('b', { style: { minWidth: '140px' } }, v.name),
              h('span', { class: 'txt' }, [v.category, v.gender, v.age, v.accent, v.languages.join('/'), v.description, v.useCase].filter(Boolean).join(' · ')),
              v.previewUrl ? audioButton(v.previewUrl) : null,
              h('button', { class: 'btn xs', disabled: added, onclick: () => {
                cfg.voices.push({ id: slugId(v.name, cfg.voices), name: v.name, voiceId: v.voiceId, modelId: '', language: v.languages[0] || '', note: [v.gender, v.description].filter(Boolean).join(', '), previewUrl: v.previewUrl });
                render();
              } }, added ? t('in_list') : t('add_to_list')));
          }));
        };
        filter.oninput = draw;
        importBox.replaceChildren(filter, list);
        draw();
      } catch (e) {
        app.toast(/voices_read/.test(e.message) ? t('voices_perm') : e.message, 'err');
      } finally { importBtn.disabled = false; }
    };
    return h('section', { class: 'panel' },
      h('h2', {}, icon('voice'), t('voices')),
      h('div', { class: 'hint' }, t('voices_hint')),
      h('table', {}, h('tr', {}, ['name', 'voice_id', 'model', 'lang', 'notes', ''].map((k) => h('th', {}, k ? t(k) : ''))), rows),
      h('div', { class: 'row wrap' }, importBtn,
        h('button', { class: 'btn', onclick: () => { cfg.voices.push({ id: 'v' + Date.now().toString(36), name: '', voiceId: '', modelId: '', language: 'ko', note: '' }); render(); } }, icon('plus'), t('add'))),
      importBox);
  }

  function music() {
    return h('section', { class: 'panel' },
      h('h2', {}, icon('music'), t('music_styles')),
      h('table', {}, h('tr', {}, h('th', {}, t('name')), h('th', {}, t('prompt')), h('th', {})),
        cfg.musicStyles.map((m, i) => h('tr', {},
          h('td', { style: { width: '220px' } }, inp(m, 'name')),
          h('td', {}, area(m, 'prompt')),
          h('td', {}, h('button', { class: 'btn xs icon ghost', onclick: () => { cfg.musicStyles.splice(i, 1); render(); } }, icon('trash')))))),
      h('div', {}, h('button', { class: 'btn', onclick: () => { cfg.musicStyles.push({ id: 'm' + Date.now().toString(36), name: '', prompt: '' }); render(); } }, icon('plus'), t('add'))));
  }

  function palettes() {
    return h('section', { class: 'panel' },
      h('h2', {}, icon('style'), t('palettes')),
      h('table', {}, h('tr', {}, h('th', {}, t('palette_name')), COLOR_KEYS.map((k) => h('th', {}, k)), h('th', {})),
        cfg.palettes.map((p, i) => h('tr', {},
          h('td', { style: { width: '200px' } }, inp(p, 'name')),
          COLOR_KEYS.map((k) => h('td', {}, h('input', { type: 'color', value: p.colors[k], oninput: (e) => { p.colors[k] = e.target.value; } }))),
          h('td', {}, h('button', { class: 'btn xs icon ghost', onclick: () => { cfg.palettes.splice(i, 1); render(); } }, icon('trash')))))),
      h('div', {}, h('button', { class: 'btn', onclick: () => { cfg.palettes.push({ id: 'p' + Date.now().toString(36), name: 'New palette', colors: clone((cfg.palettes[0] || {}).colors || { bg: '#0f1420', surface: '#1a2133', text: '#f2f4f8', muted: '#9aa4b8', accent: '#ff7a1a', accent2: '#3ec6ff', accent3: '#9b7bff' }) }); render(); } }, icon('plus'), t('add'))));
  }

  function models() {
    const m = cfg.models;
    const d = cfg.defaults;
    const dl = h('datalist', { id: 'qwen-models' }, QWEN.map((x) => h('option', { value: x })));
    const sel = (obj, k, opts) => h('select', { onchange: (e) => { obj[k] = e.target.value; } }, opts.map(([v, l]) => h('option', { value: v, selected: String(obj[k]) === String(v) }, l)));
    return h('section', { class: 'panel' },
      h('h2', {}, icon('gear'), t('models'), ' · ', t('defaults')),
      dl,
      h('div', { class: 'grid3' },
        lab(t('chat_model'), inp(m, 'chat', { list: 'qwen-models' })),
        lab(t('writer_model'), inp(m, 'writer', { list: 'qwen-models' })),
        lab(t('research_model'), inp(m, 'research', { list: 'qwen-models' })),
        lab(t('tts_model'), sel(m, 'tts', TTS_MODELS.filter(Boolean).map((x) => [x, x]))),
        lab(t('music_model'), sel(m, 'music', MUSIC_MODELS.map((x) => [x, x]))),
        lab(t('image_model'), sel(m, 'image', IMAGE_MODELS.map(([x, l]) => [x, l]))),
        lab(t('video_model'), sel(m, 'video', [['happyhorse-1.1-i2v', 'happyhorse-1.1-i2v · $0.14/s'], ['wan2.7-i2v', 'wan2.7-i2v · $0.10/s']]))),
      h('div', { class: 'grid3' },
        lab(t('ratio'), sel(d, 'ratio', [['16:9', '16:9'], ['9:16', '9:16'], ['1:1', '1:1'], ['4:5', '4:5'], ['a4', 'A4']])),
        lab(t('language'), sel(d, 'language', [['ko', '한국어'], ['en', 'English']])),
        lab(t('format'), sel(d, 'format', [['animated', t('animated')], ['static', t('static')]])),
        lab(`${t('length')} (${t('sec')})`, h('input', { type: 'number', min: 10, max: 120, value: d.length, oninput: (e) => { d.length = Number(e.target.value); } })),
        lab(t('palettes'), sel(d, 'paletteId', cfg.palettes.map((p) => [p.id, p.name]))),
        lab(t('volume'), h('input', { type: 'number', min: 0, max: 1, step: 0.02, value: d.musicVolume, oninput: (e) => { d.musicVolume = Number(e.target.value); } }))));
  }

  render();
}

function inp(obj, key, attrs = {}) {
  return h('input', { type: 'text', value: obj[key] || '', oninput: (e) => { obj[key] = e.target.value; }, ...attrs });
}
function area(obj, key) {
  const el = h('textarea', { rows: 2, oninput: (e) => { obj[key] = e.target.value; } });
  el.value = obj[key] || '';
  return el;
}
function lab(label, el) {
  return h('div', { class: 'field' }, h('label', {}, label), el);
}
function slugId(name, list) {
  let base = String(name || 'voice').toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'voice';
  let id = base;
  let n = 2;
  while (list.some((v) => v.id === id)) id = base + '-' + n++;
  return id;
}
