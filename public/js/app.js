// App shell: sign-in, routing (#/, #/p/<id>, #/admin), top bar, toasts and confirm dialogs.

import { api, blobUrl, setUnauthorizedHandler } from './api.js';
import { h, icon, fmtDate } from './util.js';
import { t, getLang, setLang } from './i18n.js';
import { openStudio } from './studio.js';
import { openAdmin } from './admin.js';

const app = {
  me: null,
  config: null,
  view: null,
  toast,
  confirm,
  setSaveState,
  setTitle,
};

const topbar = document.getElementById('topbar');
const root = document.getElementById('app');
const toasts = document.getElementById('toasts');
let current = null; // view handle with destroy()

setLang(getLang());
setUnauthorizedHandler(() => { if (app.me) { app.me = null; route(); } });

/* ---------- top bar ---------- */
const titleInput = h('input', { class: 'title-input', hidden: true });
const saveState = h('span', { class: 'save-state' });
const crumb = h('div', { class: 'crumb' });
const svc = h('div', { class: 'svc', title: 'Qwen · ElevenLabs · Claude routine' });
let titleHandler = null;
titleInput.addEventListener('input', () => titleHandler && titleHandler(titleInput.value));

function drawTopbar() {
  const signedIn = Boolean(app.me);
  const langBtn = h('div', { class: 'seg' },
    h('button', { class: getLang() === 'ko' ? 'on' : '', onclick: () => { setLang('ko'); route(true); } }, 'KO'),
    h('button', { class: getLang() === 'en' ? 'on' : '', onclick: () => { setLang('en'); route(true); } }, 'EN'));
  if (app.me) {
    const c = app.me.configured;
    svc.replaceChildren(...[c.qwen, c.eleven, c.routine].map((ok) => h('i', { class: ok ? 'ok' : '' })));
  }
  topbar.replaceChildren(
    h('a', { class: 'brand', href: '#/' }, h('div', { class: 'logo' }, 'IS'), h('div', { class: 'brand-name' }, 'Infographic ', h('span', {}, 'Studio'))),
    crumb,
    h('div', { class: 'top-actions' },
      signedIn ? svc : null,
      langBtn,
      signedIn ? h('a', { class: 'btn sm icon ghost', href: '#/', title: t('projects') }, icon('home')) : null,
      signedIn ? h('a', { class: 'btn sm icon ghost', href: '#/admin', title: t('admin') }, icon('gear')) : null,
      signedIn ? h('button', { class: 'btn sm ghost', onclick: logout }, t('logout')) : null));
}

function setTitle(title, onChange) {
  titleHandler = onChange || null;
  titleInput.value = title || '';
  titleInput.hidden = !onChange;
  crumb.replaceChildren(h('span', { class: 'sep' }, '/'), titleInput, saveState);
}

function setSaveState(s) {
  saveState.className = 'save-state' + (s === 'error' ? ' err' : '');
  saveState.textContent = s === 'saving' ? t('saving') : s === 'saved' ? t('saved') : s === 'dirty' ? t('unsaved') : s === 'error' ? t('save_failed') : '';
}

/* ---------- toasts + confirm ---------- */
function toast(msg, kind = '') {
  const el = h('div', { class: 'toast ' + kind }, msg);
  toasts.append(el);
  setTimeout(() => el.remove(), kind === 'err' ? 9000 : 4500);
}

function confirm(title, body) {
  return new Promise((resolve) => {
    const done = (v) => { bg.remove(); resolve(v); };
    const bg = h('div', { class: 'modal-bg', onclick: (e) => { if (e.target === bg) done(false); } },
      h('div', { class: 'modal' }, h('h3', {}, title), body ? h('p', { style: { whiteSpace: 'pre-wrap' } }, body) : null,
        h('div', { class: 'row' }, h('span', { class: 'grow' }),
          h('button', { class: 'btn ghost', onclick: () => done(false) }, t('cancel')),
          h('button', { class: 'btn claude', onclick: () => done(true) }, t('ok')))));
    document.body.append(bg);
  });
}

/* ---------- auth ---------- */
async function loadMe() {
  try { app.me = await api('me'); } catch { app.me = null; }
  if (app.me) {
    try { app.config = await api('config'); } catch (e) { toast(e.message, 'err'); }
  }
}

async function logout() {
  await api('logout', { method: 'POST' }).catch(() => {});
  app.me = null;
  location.hash = '#/';
  route();
}

function loginView() {
  const pw = h('input', { type: 'password', placeholder: t('password'), autocomplete: 'current-password' });
  const err = h('div', { class: 'err', hidden: true });
  const btn = h('button', { class: 'btn primary', style: { width: '100%', marginTop: '12px' } }, t('signin'));
  const go = async () => {
    btn.disabled = true;
    err.hidden = true;
    try {
      await api('login', { method: 'POST', body: { password: pw.value } });
      await loadMe();
      route(true);
    } catch (e) {
      err.textContent = e.status === 401 ? t('wrong_pw') : e.message;
      err.hidden = false;
    } finally { btn.disabled = false; }
  };
  btn.onclick = go;
  pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  const card = h('div', { class: 'center-card' }, h('div', { class: 'logo' }, 'IS'), h('h1', {}, t('login_title')), h('p', {}, t('login_body')), pw, btn, err);
  root.replaceChildren(h('div', { class: 'view' }, card));
  setTimeout(() => pw.focus(), 50);
}

/* ---------- home ---------- */
async function homeView() {
  const d = (app.config && app.config.defaults) || {};
  const opts = { format: d.format || 'animated', ratio: d.ratio || '16:9', length: d.length || 45, language: d.language || getLang() };
  const topic = h('textarea', { placeholder: t('new_ph'), rows: 3 });
  const segF = seg([['animated', t('animated')], ['static', t('static')]], opts.format, (v) => { opts.format = v; lenWrap.hidden = v === 'static'; if (v === 'static' && opts.ratio === '16:9') { opts.ratio = 'a4'; ratioSel.value = 'a4'; } });
  const ratioSel = h('select', { style: { width: 'auto' }, onchange: (e) => { opts.ratio = e.target.value; } },
    [['16:9', '16:9'], ['9:16', '9:16'], ['1:1', '1:1'], ['4:5', '4:5'], ['a4', 'A4']].map(([v, l]) => h('option', { value: v, selected: opts.ratio === v }, l)));
  const lenWrap = h('div', { class: 'row', hidden: opts.format === 'static' }, h('span', { class: 'lbl' }, t('length')),
    h('select', { style: { width: 'auto' }, onchange: (e) => { opts.length = Number(e.target.value); } }, [15, 20, 30, 45, 60, 90].map((n) => h('option', { value: n, selected: Number(opts.length) === n }, n + t('sec')))));
  const segL = seg([['ko', '한국어'], ['en', 'English']], opts.language, (v) => { opts.language = v; });
  const create = h('button', { class: 'btn primary' }, icon('plus'), t('create'));
  create.onclick = async () => {
    const tp = topic.value.trim();
    if (!tp) { topic.focus(); return; }
    create.disabled = true;
    try {
      const p = await api('projects', { method: 'POST', body: { title: tp.slice(0, 80), brief: { topic: tp, ...opts } } });
      location.hash = '#/p/' + p.id;
    } catch (e) { toast(e.message, 'err'); create.disabled = false; }
  };
  topic.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) create.click(); });
  const list = h('div', { class: 'plist' });
  root.replaceChildren(h('div', { class: 'view' }, h('div', { class: 'home' },
    h('section', { class: 'hero-new' }, h('h1', {}, t('new_title')), topic,
      h('div', { class: 'opts' }, segF, h('span', { class: 'lbl' }, t('ratio')), ratioSel, lenWrap, segL, h('span', { style: { flex: 1 } }), create)),
    list)));
  setTimeout(() => topic.focus(), 50);
  try {
    const r = await api('projects');
    if (!r.projects.length) list.append(h('div', { class: 'hint' }, t('no_projects')));
    for (const p of r.projects) {
      list.append(h('div', { class: 'pcard', onclick: () => { location.hash = '#/p/' + p.id; } },
        h('div', { class: 'thumb', style: p.poster ? { backgroundImage: `url(${blobUrl(p.poster)})` } : {} }, p.poster ? '' : (p.format === 'static' ? t('static') : t('animated'))),
        h('div', { class: 'meta' }, h('div', { class: 't' }, p.title || '(untitled)'),
          h('div', { class: 'sub' }, h('span', { class: 'tag' }, p.ratio || '16:9'), h('span', {}, `${t('updated')} ${fmtDate(p.updatedAt)}`),
            h('button', { class: 'btn xs icon ghost del', title: t('delete'), onclick: async (e) => {
              e.stopPropagation();
              if (!(await confirm(t('confirm_delete', { t: p.title || '' }), ''))) return;
              await api('projects/' + p.id, { method: 'DELETE' });
              homeView();
            } }, icon('trash'))))));
    }
  } catch (e) { toast(e.message, 'err'); }
}

function seg(options, value, onpick) {
  return h('div', { class: 'seg' }, options.map(([v, label]) => h('button', { class: v === value ? 'on' : '', onclick: (e) => {
    e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.classList.remove('on'));
    e.currentTarget.classList.add('on');
    onpick(v);
  } }, label)));
}

/* ---------- router ---------- */
async function route(force) {
  if (current && current.destroy) { try { current.destroy(); } catch {} }
  current = null;
  setTitle('', null);
  setSaveState('');
  if (app.me === null && force !== 'skip') await loadMe();
  drawTopbar();
  if (!app.me) { loginView(); return; }
  const hash = location.hash || '#/';
  let m;
  if ((m = /^#\/p\/([\w-]+)/.exec(hash))) {
    root.replaceChildren(h('div', { class: 'view' }, h('div', { class: 'center-card' }, h('span', { class: 'spin' }))));
    try { current = await openStudio(root, m[1], app); } catch (e) { toast(e.message, 'err'); location.hash = '#/'; }
  } else if (hash.startsWith('#/admin')) {
    setTitle(t('admin'), null);
    try { await openAdmin(root, app); } catch (e) { toast(e.message, 'err'); }
  } else {
    await homeView();
  }
}

window.addEventListener('hashchange', () => route('skip'));
window.addEventListener('beforeunload', () => { if (current && current.destroy) current.destroy(); });
route();
