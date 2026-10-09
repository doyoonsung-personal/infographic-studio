// Right-hand panel: the full editor for the selected node.

import { h, icon, fmtTime, fmtDate, contrast, COLOR_KEYS } from './util.js';
import { t } from './i18n.js';
import { blobUrl } from './api.js';
import { spokenText, TAG_MODELS } from './timeline.js';

const TTS_CHOICES = [
  ['eleven_v4', 'Eleven v4'],
  ['eleven_v3', 'Eleven v3'],
  ['eleven_multilingual_v2', 'Multilingual v2'],
  ['eleven_flash_v2_5', 'Flash v2.5'],
  ['eleven_turbo_v2_5', 'Turbo v2.5'],
];
import { playOne } from './player.js';
import { NODES } from './studio.js';
import { scorePalette } from './ai.js';

export function renderInspector(root, key, A) {
  const S = A.S;
  const i = NODES.findIndex((n) => n.key === key);
  const hist = S.p.history[key === 'script' ? 'script' : key] || [];
  const head = h('div', { class: 'insp-head k-' + key },
    h('div', { class: 'node-num' }, String(i + 1)),
    h('div', { class: 'node-icon', style: { color: 'var(--kc)' } }, icon(NODES[i].icon)),
    h('b', {}, t('n_' + key)),
    hist.length ? historyMenu(key, hist, A) : null,
    h('button', { class: 'btn sm icon ghost', title: t('close'), onclick: () => A.select(null) }, icon('x')));
  const body = h('div', { class: 'insp-body k-' + key });
  const R = RENDER[key];
  if (key !== 'preview') A.dropInspectorPlayer();
  if (R) R(body, A);
  root.replaceChildren(head, body);
}

function historyMenu(key, hist, A) {
  const sel = h('select', { style: { width: 'auto', height: '28px', padding: '2px 26px 2px 8px', fontSize: '12px' }, title: t('history'), onchange: (e) => {
    const idx = Number(e.target.value);
    if (!Number.isNaN(idx)) A.restoreHistory(key, idx);
  } }, h('option', { value: '' }, '↺ ' + t('history')),
  hist.map((x, i) => h('option', { value: String(i) }, fmtDate(x.at))).reverse());
  return sel;
}

/* ---------- small builders ---------- */
function field(label, input, hint) {
  return h('div', { class: 'field' }, h('label', {}, label), input, hint ? h('div', { class: 'hint' }, hint) : null);
}
function text(value, oninput, attrs = {}) {
  return h('input', { type: 'text', value: value || '', oninput: (e) => oninput(e.target.value), ...attrs });
}
function area(value, oninput, attrs = {}) {
  const el = h('textarea', { oninput: (e) => oninput(e.target.value), ...attrs });
  el.value = value || '';
  return el;
}
function seg(options, value, onpick) {
  return h('div', { class: 'seg' }, options.map(([v, label]) =>
    h('button', { class: v === value ? 'on' : '', onclick: (e) => { e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); onpick(v); } }, label)));
}
function busyBtn(A, key, label, fn, cls = 'btn primary', ic = 'wand') {
  const running = A.S.busy[key];
  return h('button', { class: cls, disabled: running, onclick: async () => { try { await fn(); } catch {} } },
    running ? h('span', { class: 'spin' }) : icon(ic), label);
}
function direction(A, key, label, fn, ph) {
  const ta = h('textarea', { placeholder: ph || t('direction_ph') });
  return h('div', { class: 'direction' },
    h('div', { class: 'lbl' }, t('direction')),
    ta,
    h('div', { class: 'row' }, h('span', { class: 'grow' }), busyBtn(A, key, label, () => fn(ta.value.trim()))));
}
function swatch(c) {
  return h('div', { class: 'mini-swatch' }, ['bg', 'surface', 'text', 'muted', 'accent', 'accent2', 'accent3'].map((k) => h('i', { style: { background: c[k] } })));
}

/* ---------- renderers ---------- */
const RENDER = {
  brief(body, A) {
    const b = A.S.p.brief;
    const up = (k) => (v) => { A.S.p.brief[k] = v; if (k === 'topic' && !A.S.p.title) A.S.p.title = v; A.changed({ preview: ['format', 'ratio', 'language'].includes(k) }); };
    body.append(
      field(t('topic'), area(b.topic, up('topic'), { rows: 2 })),
      field(t('takeaway'), area(b.takeaway, up('takeaway'), { rows: 2 })),
      h('div', { class: 'grid2' }, field(t('audience'), text(b.audience, up('audience'))), field(t('tone'), text(b.tone, up('tone')))),
      h('div', { class: 'row wrap' },
        field(t('format'), seg([['animated', t('animated')], ['static', t('static')]], b.format, (v) => { A.updateBrief({ format: v, ratio: v === 'static' && b.ratio === '16:9' ? 'a4' : b.ratio }); })),
        field(t('language'), seg([['ko', '한국어'], ['en', 'English']], b.language, (v) => A.updateBrief({ language: v })))),
      h('div', { class: 'grid2' },
        field(t('ratio'), h('select', { onchange: (e) => A.updateBrief({ ratio: e.target.value }) },
          [['16:9', '16:9'], ['9:16', '9:16'], ['1:1', '1:1'], ['4:5', '4:5'], ['a4', 'A4']].map(([v, l]) => h('option', { value: v, selected: b.ratio === v }, l)))),
        b.format === 'static' ? h('div') : field(`${t('length')} (${t('sec')})`, h('input', { type: 'number', min: 10, max: 120, step: 5, value: b.length, onchange: (e) => A.updateBrief({ length: e.target.value }) }))),
      field(t('notes'), area(b.notes, up('notes'), { rows: 3 })),
      direction(A, 'brief', t('suggest'), (d) => A.suggestBrief(d)),
    );
  },

  facts(body, A) {
    const f = A.S.p.facts;
    const focus = h('input', { type: 'text', placeholder: t('research_focus') });
    body.append(h('div', { class: 'direction' },
      h('div', { class: 'lbl' }, t('research'), ' ', h('small', {}, '· Qwen3.8 web search')),
      focus,
      h('div', { class: 'row' }, h('label', { class: 'check grow' }, h('input', { type: 'checkbox', checked: !!f.skipped, onchange: (e) => { f.skipped = e.target.checked; A.changed(); } }), t('st_off')),
        busyBtn(A, 'facts', f.items.length ? t('regen') : t('research'), () => A.research(focus.value.trim()), 'btn primary', 'facts'))));
    if (f.summary) body.append(h('div', { class: 'okbox' }, f.summary));
    if (!f.items.length) body.append(h('div', { class: 'hint' }, t('facts_empty')));
    f.items.forEach((x, idx) => {
      const up = (k) => (v) => { x[k] = v; A.changed(); };
      body.append(h('div', { class: 'card' },
        h('div', { class: 'card-h' }, h('span', { class: 'tag' }, '#' + (idx + 1)), h('span', { style: { flex: 1 } }),
          x.url ? h('a', { class: 'btn xs ghost', href: x.url, target: '_blank', rel: 'noopener' }, icon('link')) : null,
          h('button', { class: 'btn xs ghost', title: t('remove'), onclick: () => { f.items.splice(idx, 1); A.changed({ inspector: true }); } }, icon('trash'))),
        area(x.claim, up('claim'), { rows: 2, placeholder: t('claim') }),
        h('div', { class: 'grid3' }, text(x.value, up('value'), { placeholder: t('value') }), text(x.date, up('date'), { placeholder: t('date') }), text(x.source, up('source'), { placeholder: t('source') })),
        text(x.url, up('url'), { placeholder: 'https://…' })));
    });
    body.append(h('button', { class: 'btn', onclick: () => { f.items.push({ id: 'f' + Date.now(), claim: '', value: '', date: '', source: '', url: '' }); A.changed({ inspector: true }); } }, icon('plus'), t('add')));
    if ((f.sources || []).length) {
      body.append(h('details', { class: 'card' }, h('summary', { class: 'lbl', style: { cursor: 'pointer' } }, t('sources_found', { n: f.sources.length })),
        h('div', { class: 'fact', style: { display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '8px' } }, f.sources.slice(0, 40).map((u) => h('a', { href: u, target: '_blank', rel: 'noopener' }, u)))));
    }
  },

  script(body, A) {
    const p = A.S.p;
    const tl = A.timeline();
    const lenOf = Object.fromEntries(tl.scenes.map((s) => [s.id, s.len]));
    const dir = h('textarea', { placeholder: t('direction_ph') });
    body.append(h('div', { class: 'direction' },
      h('div', { class: 'lbl' }, t('direction')),
      dir,
      h('div', { class: 'row' }, h('span', { class: 'hint grow' }, tl.static ? t('static') : t('total', { d: fmtTime(tl.duration) })),
        busyBtn(A, 'script', p.script.scenes.length ? t('regen') : t('write_script'), () => A.writeScript(dir.value.trim())))));
    if (!tl.static) body.append(h('div', { class: 'hint' }, t('cue_hint')));
    p.script.scenes.forEach((s, idx) => {
      const up = (k) => (v) => { s[k] = v; A.changed({ preview: k === 'narration' }); };
      body.append(h('div', { class: 'card scene-card k-script' },
        h('div', { class: 'card-h' },
          h('span', { class: 'sid' }, s.id),
          h('input', { type: 'text', value: s.title, placeholder: 'title', style: { flex: 1, padding: '5px 8px' }, oninput: (e) => up('title')(e.target.value) }),
          tl.static ? null : h('span', { class: 'tag', title: 'timeline' }, (lenOf[s.id] || 0).toFixed(1) + 's'),
          h('button', { class: 'btn xs ghost', disabled: idx === 0, onclick: () => A.moveScene(s.id, -1) }, icon('up')),
          h('button', { class: 'btn xs ghost', disabled: idx === p.script.scenes.length - 1, onclick: () => A.moveScene(s.id, 1) }, icon('down')),
          h('button', { class: 'btn xs ghost', title: t('remove'), onclick: () => A.removeScene(s.id) }, icon('trash'))),
        tl.static ? null : field(t('narration'), area(s.narration, up('narration'), { rows: 3 })),
        field(t('onscreen'), area(s.onscreen, up('onscreen'), { rows: 2 })),
        field(t('visual'), area(s.visual, up('visual'), { rows: 2 })),
        h('div', { class: 'row' }, h('span', { class: 'grow' }),
          h('button', { class: 'btn xs', disabled: A.S.busy.script, onclick: () => A.writeScript(dir.value.trim(), s.id).catch(() => {}) }, icon('refresh'), t('rewrite_scene')))));
    });
    body.append(h('button', { class: 'btn', onclick: () => A.addScene() }, icon('plus'), t('scene_add')));
  },

  style(body, A) {
    const st = A.S.p.style;
    const c = st.colors || {};
    const cr = c.text && c.bg ? contrast(c.text, c.bg) : 21;
    backgroundSection(body, A);
    body.append(h('div', { class: 'sec' }, t('palettes')));
    for (const pal of A.S.config.palettes || []) {
      body.append(h('div', { class: 'pal' + (st.paletteId === pal.id && !st.paletteName ? ' on' : ''), onclick: () => A.applyPalette({ ...pal, name: null }) }, h('span', {}, pal.name), swatch(pal.colors)));
    }
    // Ideas live in state: the inspector re-renders while the request runs.
    const ideas = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, (A.S.paletteIdeas || []).map((pal) => paletteIdea(pal, A)));
    const dir = h('input', { type: 'text', placeholder: t('direction_ph') });
    body.append(h('div', { class: 'direction' },
      h('div', { class: 'lbl' }, t('suggest_palettes')),
      dir,
      h('div', { class: 'row' }, h('span', { class: 'grow' }), busyBtn(A, 'style', t('suggest_palettes'), () => A.suggestPalettes(dir.value.trim()))),
      ideas));
    const url = h('input', { type: 'url', placeholder: 'https://brand.example.com' });
    body.append(h('div', { class: 'direction' },
      h('div', { class: 'lbl' }, t('from_site')),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, url), busyBtn(A, 'style', t('apply'), () => A.paletteFromSite(url.value.trim()), 'btn', 'globe'))));
    body.append(h('div', { class: 'sec' }, t('colors')));
    if (cr < 4.5) body.append(h('div', { class: 'warnbox' }, t('contrast_low', { r: cr.toFixed(1) })));
    body.append(h('div', { class: 'colors' }, COLOR_KEYS.map((k) =>
      h('label', {}, h('input', { type: 'color', value: c[k] || '#888888', oninput: (e) => { A.S.p.style.paletteName = 'Custom'; A.setStyle({ colors: { [k]: e.target.value }, _typing: true }); } }), '--' + k))));
    body.append(h('div', { class: 'row wrap' },
      field(t('font'), seg([['sans', 'Sans'], ['serif', 'Serif'], ['display', 'Display']], st.font, (v) => A.setStyle({ font: v }))),
      field(t('motion'), seg([['calm', t('calm')], ['lively', t('lively')]], st.motion, (v) => A.setStyle({ motion: v })))));
    body.append(field(t('notes'), area(st.notes, (v) => { st.notes = v; A.changed(); }, { rows: 2 })));
  },

  voice(body, A) {
    const p = A.S.p;
    const v = p.voice;
    const voices = A.S.config.voices || [];
    if (p.brief.format === 'static') { body.append(h('div', { class: 'hint' }, t('st_off'))); return; }
    body.append(h('label', { class: 'check' }, h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!v.enabled, onchange: (e) => A.setVoice({ enabled: e.target.checked }) }), h('span')), t('voice_on')));
    if (!voices.length) { body.append(h('div', { class: 'warnbox' }, t('no_voices'), ' ', h('a', { href: '#/admin' }, t('admin')))); return; }
    const vd = A.voiceDef();
    body.append(field(t('voice_pick'), h('div', { class: 'row' },
      h('select', { class: 'grow', onchange: (e) => A.setVoice({ voiceRef: e.target.value }) },
        voices.map((x) => h('option', { value: x.id, selected: x.id === v.voiceRef }, `${x.name}${x.language ? ' · ' + x.language : ''}${x.note ? ' — ' + x.note : ''}`))),
      vd && vd.previewUrl ? h('button', { class: 'btn sm', onclick: () => playOne(vd.previewUrl) }, icon('play'), t('preview')) : null)));
    const model = A.ttsModel();
    const tagModel = TAG_MODELS.includes(model);
    body.append(field(t('tts_model_pick'), h('select', { onchange: (e) => A.setVoiceModel(e.target.value).catch(() => {}) },
      TTS_CHOICES.map(([id, label]) => h('option', { value: id, selected: id === model }, label + (TAG_MODELS.includes(id) ? ' · ' + t('tags_short') : ''))))));
    if (tagModel) {
      const tagged = A.tagsInScript();
      body.append(h('div', { class: 'card' },
        h('div', { class: 'hint' }, tagged ? t('tags_on') : t('tags_available')),
        h('div', { class: 'row wrap' }, h('span', { class: 'grow' }),
          tagged ? h('button', { class: 'btn sm ghost', disabled: A.S.busy.voice, onclick: () => A.removeAudioTags() }, icon('trash'), t('tags_clear')) : null,
          busyBtn(A, 'voice', tagged ? t('tags_redo') : t('tags_apply'), async () => {
            const r = await A.app.dialog({ title: t('tags_title'), body: t('tags_body'), input: t('tags_dir_ph'), ok: t('tags_apply'), cancel: t('cancel') });
            if (!r) return;
            if (tagged) A.removeAudioTags();
            await A.addAudioTags(r.value);
          }, 'btn sm', 'wand'))));
    }
    const sp = h('span', { class: 'tag' }, '×' + (v.speed || 1));
    body.append(field(t('speed'), h('div', { class: 'row' }, h('input', { type: 'range', min: 0.7, max: 1.2, step: 0.05, value: v.speed || 1, class: 'grow', oninput: (e) => { sp.textContent = '×' + e.target.value; }, onchange: (e) => A.setVoice({ speed: e.target.value }) }), sp)));
    const vs = A.voiceStatus();
    body.append(h('div', { class: 'row wrap' },
      busyBtn(A, 'voice', t('gen_all_voice'), () => A.generateVoice(null), 'btn primary', 'voice'),
      vs.fresh && vs.fresh < vs.total ? busyBtn(A, 'voice', t('gen_missing_voice'), () => A.generateVoice(null, { onlyMissing: true }), 'btn', 'voice') : null));
    body.append(h('div', { class: 'hint' }, t('paid_note')));
    for (const s of p.script.scenes) {
      const said = spokenText(s.narration);
      if (!said) continue;
      const c = v.clips[s.id];
      const fresh = c && !vs.stale.includes(s.id);
      const running = A.S.busy.voice && A.S.busy.voiceScene === s.id;
      body.append(h('div', { class: 'clip' },
        h('span', { class: 'sid' }, s.id),
        h('span', { class: 'txt', title: said }, said),
        running ? h('span', { class: 'pill s-running' }, '…') : h('span', { class: 'pill ' + (fresh ? 's-done' : c ? 's-stale' : '') }, fresh ? t('clip_ok', { d: c.duration.toFixed(1) }) : c ? t('clip_stale') : t('clip_missing')),
        c ? h('button', { class: 'btn xs icon', title: t('play'), onclick: () => playOne(blobUrl(c.blobId)) }, icon('play')) : null,
        h('button', { class: 'btn xs icon', title: t('regen'), disabled: A.S.busy.voice, onclick: () => A.generateVoice([s.id]).catch(() => {}) }, icon('refresh'))));
    }
  },

  music(body, A) {
    const p = A.S.p;
    const m = p.music;
    if (p.brief.format === 'static') { body.append(h('div', { class: 'hint' }, t('st_off'))); return; }
    body.append(h('label', { class: 'check' }, h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!m.enabled, onchange: (e) => A.setMusic({ enabled: e.target.checked }) }), h('span')), t('music_on')));
    body.append(field(t('music_style'), h('select', { onchange: (e) => A.setMusic({ styleId: e.target.value }) },
      (A.S.config.musicStyles || []).map((x) => h('option', { value: x.id, selected: x.id === m.styleId }, x.name)))));
    const st = (A.S.config.musicStyles || []).find((x) => x.id === m.styleId);
    body.append(field(t('music_custom'), area(m.prompt, (v) => A.setMusic({ prompt: v, _typing: true }), { rows: 3, placeholder: st ? st.prompt : '' })));
    const vl = h('span', { class: 'tag' }, Math.round((m.volume ?? 0.22) * 100) + '%');
    body.append(field(t('volume'), h('div', { class: 'row' }, h('input', { type: 'range', min: 0, max: 1, step: 0.02, value: m.volume ?? 0.22, class: 'grow', oninput: (e) => { vl.textContent = Math.round(e.target.value * 100) + '%'; }, onchange: (e) => A.setMusic({ volume: e.target.value }) }), vl)));
    body.append(h('div', { class: 'hint' }, t('music_len', { d: A.musicTarget() })));
    const ms = A.musicStatus();
    if (ms === 'stale') body.append(h('div', { class: 'warnbox' }, t('music_stale')));
    body.append(h('div', { class: 'row wrap' },
      busyBtn(A, 'music', ms === 'missing' ? t('gen_music') : t('regen'), () => A.generateMusic(), 'btn primary', 'music'),
      m.track ? h('button', { class: 'btn', onclick: () => playOne(blobUrl(m.track.blobId)) }, icon('play'), t('play')) : null));
    body.append(h('div', { class: 'hint' }, t('paid_note')));
  },

  build(body, A) {
    const S = A.S;
    const j = S.job;
    const running = j && ['queued', 'fired', 'running'].includes(j.status);
    if (!S.me.configured.routine) body.append(h('div', { class: 'warnbox' }, t('routine_off')));
    body.append(h('div', { class: 'card' },
      h('div', { class: 'hint' }, t('build_hint')),
      h('div', { class: 'row' }, h('span', { class: 'grow' }),
        h('button', { class: 'btn claude', disabled: running || !S.p.script.scenes.length, onclick: () => A.startJob('build').catch((e) => A.app.toast(e.message, 'err')) }, icon('build'), t('build_new')))));
    if (j) {
      const label = j.status === 'done' ? t('job_done', { v: j.version || '' }) : j.status === 'failed' ? t('job_failed') : j.status === 'cancelled' ? t('job_cancelled_short') : j.status === 'queued' ? t('job_queued') : t('job_running');
      body.append(h('div', { class: 'card' },
        h('div', { class: 'card-h' }, h('span', { class: 'pill s-' + (j.status === 'done' ? 'done' : j.status === 'failed' || j.status === 'cancelled' ? 'error' : 'running') }, label), h('b', {}, j.kind), h('span', { class: 'grow', style: { flex: 1 } }),
          j.sessionUrl ? h('a', { class: 'btn xs', href: j.sessionUrl, target: '_blank', rel: 'noopener' }, icon('link'), t('job_watch')) : null,
          running ? h('button', { class: 'btn xs danger', onclick: () => A.cancelJob().catch((e) => A.app.toast(e.message, 'err')) }, icon('x'), t('job_cancel')) : null),
        j.error ? h('div', { class: 'err' }, j.error) : null,
        j.status === 'fired' && Date.now() - j.createdAt > 12 * 60 * 1000 ? h('div', { class: 'warnbox' }, t('job_stalled')) : null,
        h('div', { class: 'joblog' }, (j.log || []).slice().reverse().map((l) => h('div', {}, `${new Date(l.at).toLocaleTimeString()}  ${l.msg}`)))));
    }
    const tk = S.manualTicket && S.job && S.job.id === S.manualTicket.id ? S.manualTicket : null;
    body.append(h('details', { class: 'card', open: Boolean(tk) },
      h('summary', { class: 'lbl', style: { cursor: 'pointer' } }, t('manual_title')),
      h('div', { class: 'hint' }, t('manual_hint')),
      tk ? h('pre', { class: 'mono', style: { whiteSpace: 'pre-wrap', userSelect: 'all', background: '#0c0f15', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px' } },
        t('manual_prompt', { id: tk.id, token: tk.token })) : null,
      h('div', { class: 'row' }, h('span', { class: 'grow' }),
        h('button', { class: 'btn sm', disabled: running || !S.p.script.scenes.length, onclick: () => A.startJob('build', { manual: true }).catch((e) => A.app.toast(e.message, 'err')) }, icon('build'), t('manual_make')))));
    if (S.versions.length) {
      const instr = h('textarea', { placeholder: t('revise_ph') });
      const sceneSel = h('select', {}, h('option', { value: '' }, t('all_scenes')), S.p.script.scenes.map((s) => h('option', { value: s.id }, `${s.id} ${s.title || ''}`)));
      body.append(h('div', { class: 'direction' },
        h('div', { class: 'lbl' }, t('revise')),
        instr,
        h('div', { class: 'row' }, field(t('revise_scene'), sceneSel), h('span', { class: 'grow' }),
          h('button', { class: 'btn claude', disabled: running, onclick: () => { if (!instr.value.trim()) { instr.focus(); return; } A.startJob('revise', { instruction: instr.value.trim(), sceneId: sceneSel.value || null }).catch((e) => A.app.toast(e.message, 'err')); } }, icon('build'), t('revise')))));
      const cur = A.currentVersion();
      if (cur && A.versionStale(cur)) {
        body.append(h('div', { class: 'warnbox' }, t('out_of_date'), h('div', { class: 'row', style: { marginTop: '8px' } },
          h('span', { class: 'hint grow' }, t('rerender_hint')),
          h('button', { class: 'btn', disabled: running, onclick: () => A.startJob('render').catch((e) => A.app.toast(e.message, 'err')) }, icon('refresh'), t('rerender')))));
      }
      body.append(h('div', { class: 'sec' }, t('versions')));
      for (const v of S.versions.slice().reverse()) {
        body.append(h('div', { class: 'ver' + (cur && cur.v === v.v ? ' on' : ''), onclick: () => A.useVersion(v.v) },
          v.files['poster.jpg'] ? h('img', { src: blobUrl(v.files['poster.jpg']), alt: '' }) : h('img', { alt: '' }),
          h('div', { class: 'vt' }, h('b', {}, `v${v.v}`), ' · ', v.kind, ' · ', fmtDate(v.createdAt),
            v.instruction ? h('small', {}, v.instruction) : null,
            v.notes ? h('small', { title: v.notes }, v.notes) : null),
          v.files['contact.jpg'] ? h('a', { class: 'btn xs ghost', href: blobUrl(v.files['contact.jpg']), target: '_blank', onclick: (e) => e.stopPropagation(), title: 'contact sheet' }, icon('preview')) : null));
      }
    } else {
      body.append(h('div', { class: 'hint' }, t('no_versions')));
    }
  },

  preview(body, A) {
    const S = A.S;
    const pl = A.makeInspectorPlayer();
    body.append(pl.el);
    requestAnimationFrame(() => pl.layout());
    const cur = A.currentVersion();
    if (!cur) return;
    const dl = [];
    const p = S.p;
    const name = (ext) => `${(p.title || 'infographic').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 60)} v${cur.v}.${ext}`;
    if (cur.files['video.mp4']) dl.push(h('a', { class: 'btn primary', href: blobUrl(cur.files['video.mp4']), download: name('mp4') }, icon('download'), 'MP4'));
    if (cur.files['image.png']) dl.push(h('a', { class: 'btn primary', href: blobUrl(cur.files['image.png']), download: name('png') }, icon('download'), 'PNG'));
    if (cur.files['document.pdf']) dl.push(h('a', { class: 'btn', href: blobUrl(cur.files['document.pdf']), download: name('pdf') }, icon('download'), 'PDF'));
    if (cur.files['poster.jpg']) dl.push(h('a', { class: 'btn', href: blobUrl(cur.files['poster.jpg']), download: name('jpg') }, icon('download'), t('poster')));
    body.append(h('div', { class: 'row wrap' }, dl));
    if (A.versionStale(cur)) {
      const running = S.job && ['queued', 'fired', 'running'].includes(S.job.status);
      body.append(h('div', { class: 'warnbox' }, t('out_of_date'), h('div', { class: 'row', style: { marginTop: '8px' } }, h('span', { class: 'hint grow' }, t('rerender_hint')),
        h('button', { class: 'btn', disabled: running, onclick: () => A.startJob('render').catch((e) => A.app.toast(e.message, 'err')) }, icon('refresh'), t('rerender')))));
    }
    const defs = (S.comp && S.comp.defaults) || {};
    const keys = Object.keys(defs);
    if (keys.length) {
      body.append(h('div', { class: 'sec' }, t('texts')), h('div', { class: 'hint' }, t('texts_hint')));
      const list = h('div', { class: 'textedit' });
      for (const k of keys) {
        const cur2 = (p.edits.texts || {})[k];
        const inp = h('input', { type: 'text', value: cur2 ?? defs[k], class: cur2 != null ? 'changed' : '', oninput: (e) => { A.editText(k, e.target.value); e.target.classList.toggle('changed', e.target.value !== defs[k]); } });
        list.append(h('div', { class: 'te' }, h('code', { title: k }, k), inp,
          h('button', { class: 'btn xs ghost', title: t('reset'), onclick: () => { inp.value = defs[k]; inp.classList.remove('changed'); A.editText(k, defs[k]); } }, icon('history'))));
      }
      body.append(list, h('div', { class: 'row' }, h('span', { class: 'grow' }), h('button', { class: 'btn sm', onclick: () => A.resetTexts() }, t('reset'))));
    }
  },
};

/** Style → 배경: colours only, or AI background images (one per scene or one shared). */
function backgroundSection(body, A) {
  const p = A.S.p;
  const bg = p.style.background;
  const isStatic = p.brief.format === 'static';
  body.append(h('div', { class: 'sec' }, t('bg_title')));
  body.append(seg([['color', t('bg_color')], ['image', t('bg_image')]], bg.mode, (v) => A.setBackground({ mode: v })));
  if (bg.mode !== 'image') {
    body.append(h('div', { class: 'hint' }, t('bg_color_hint')));
    return;
  }
  const row = h('div', { class: 'row wrap' });
  if (!isStatic) row.append(field(t('bg_scope'), seg([['scene', t('bg_per_scene')], ['single', t('bg_single')]], bg.scope, (v) => A.setBackground({ scope: v }))));
  row.append(field(t('bg_look'), h('select', { onchange: (e) => A.setBackground({ look: e.target.value }) },
    [['photo', t('bg_photo')], ['illustration', t('bg_illus')], ['3d', t('bg_3d')], ['abstract', t('bg_abstract')]].map(([v, l]) => h('option', { value: v, selected: bg.look === v }, l)))));
  body.append(row);
  body.append(field(t('bg_notes'), h('input', { type: 'text', value: bg.notes || '', placeholder: t('bg_notes_ph'), oninput: (e) => A.setBackground({ notes: e.target.value, _typing: true }) })));
  const sv = h('span', { class: 'tag' }, Math.round((bg.strength ?? 0.45) * 100) + '%');
  body.append(field(t('bg_strength'), h('div', { class: 'row' },
    h('input', { type: 'range', min: 0.1, max: 0.9, step: 0.05, value: bg.strength ?? 0.45, class: 'grow', oninput: (e) => { sv.textContent = Math.round(e.target.value * 100) + '%'; }, onchange: (e) => A.setBackground({ strength: e.target.value }) }), sv)));
  const bs = A.bgStatus();
  const model = (A.S.config.models && A.S.config.models.image) || 'qwen-image-3.0';
  const each = { 'z-image-turbo': 0.015, 'qwen-image-max': 0.075 }[model] ?? 0.03;
  const todo = bs.missing.length || bs.keys.length;
  body.append(h('div', { class: 'row wrap' },
    busyBtn(A, 'style', bs.missing.length ? t('bg_generate', { n: bs.missing.length }) : t('bg_regen_all', { n: bs.keys.length }),
      () => A.generateBackgrounds(bs.missing.length ? bs.missing : null), 'btn primary', 'wand'),
    h('span', { class: 'hint' }, `≈ $${(todo * each).toFixed(2)} · ${model}`)));
  const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: '8px' } });
  for (const k of bs.keys) {
    const im = (bg.images || {})[k];
    const scene = p.script.scenes.find((s) => s.id === k);
    grid.append(h('div', { class: 'card', style: { padding: '6px', gap: '6px' } },
      im ? h('img', { src: blobUrl(im.blobId), alt: '', title: im.prompt || '', style: { width: '100%', aspectRatio: '16/9', objectFit: 'cover', borderRadius: '6px', background: 'var(--panel3)' } })
        : h('div', { style: { aspectRatio: '16/9', borderRadius: '6px', background: 'var(--panel3)', display: 'grid', placeItems: 'center', color: 'var(--faint)', fontSize: '11px' } }, t('clip_missing')),
      h('div', { class: 'row' }, h('span', { class: 'mono grow', style: { fontSize: '11px', color: 'var(--faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, k === 'all' ? t('bg_single') : `${k} ${scene && scene.title ? scene.title : ''}`),
        h('button', { class: 'btn xs icon', title: t('regen'), disabled: A.S.busy.style, onclick: () => A.generateBackgrounds([k]).catch(() => {}) }, icon('refresh')),
        im ? h('button', { class: 'btn xs icon ghost', title: t('remove'), onclick: () => A.removeBackground(k) }, icon('trash')) : null)));
  }
  body.append(grid);
  body.append(h('div', { class: 'hint' }, t('bg_hint')));
}

function paletteIdea(pal, A) {
  const sc = scorePalette(pal.colors);
  return h('div', { class: 'pal', onclick: () => A.applyPalette({ ...pal, id: null }) },
    h('span', {}, pal.name, h('div', { class: 'hint' }, `Aa ${sc.text}:1`)),
    h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' } }, swatch(pal.colors), pal.why ? h('div', { class: 'hint' }, pal.why) : null));
}
