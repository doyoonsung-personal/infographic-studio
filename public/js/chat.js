// The chat panel: a Qwen3.8 agent whose tools change the project. Paid actions (voice, music,
// Claude builds) only render a confirm card; the owner's click runs them.

import { chatStream } from './api.js';
import { h, icon } from './util.js';
import { t, getLang } from './i18n.js';
import { scorePalette } from './ai.js';

const TOOLS = [
  fn('update_brief', 'Change brief fields (topic, takeaway, audience, tone, notes, format animated|static, ratio 16:9|9:16|1:1|4:5|a4, length seconds, language ko|en).', {
    topic: str(), takeaway: str(), audience: str(), tone: str(), notes: str(),
    format: { type: 'string', enum: ['animated', 'static'] }, ratio: { type: 'string', enum: ['16:9', '9:16', '1:1', '4:5', 'a4'] },
    length: { type: 'number' }, language: { type: 'string', enum: ['ko', 'en'] },
  }),
  fn('research_facts', 'Search the web for verified facts and numbers for the infographic (replaces the fact list; takes ~1 minute).', { focus: str('what to look for') }),
  fn('write_script', 'Write or rewrite the scene script with the writer model. Give scene_id to rewrite one scene only.', { direction: str('owner direction'), scene_id: str() }),
  fn('edit_scene', 'Directly set fields of one scene (exact text the owner dictated).', { scene_id: str(), title: str(), narration: str('may contain {1} cue markers'), onscreen: str(), visual: str(), seconds: { type: 'number' } }, ['scene_id']),
  fn('set_style', 'Set style: a saved palette by id, custom colours (#rrggbb for bg, surface, text, muted, accent, accent2, accent3), font sans|serif|display, motion calm|lively, notes.', {
    palette_id: str(), colors: { type: 'object', properties: Object.fromEntries(['bg', 'surface', 'text', 'muted', 'accent', 'accent2', 'accent3'].map((k) => [k, str()])) },
    font: { type: 'string', enum: ['sans', 'serif', 'display'] }, motion: { type: 'string', enum: ['calm', 'lively'] }, notes: str(),
  }),
  fn('suggest_palettes', 'Generate 3 palette ideas and show them to the owner as clickable swatches.', { direction: str() }),
  fn('palette_from_website', 'Build a palette from a brand website\'s colours and apply it.', { url: str() }, ['url']),
  fn('set_voice', 'Narration settings: enabled, voice_id (one of the available voices), speed 0.7-1.2.', { enabled: { type: 'boolean' }, voice_id: str(), speed: { type: 'number' } }),
  fn('generate_voice', 'PAID (ElevenLabs credits): generate narration audio. Shows a confirm button to the owner.', { scene_ids: { type: 'array', items: str() }, only_missing: { type: 'boolean' } }),
  fn('set_music', 'Music settings: enabled, style_id (one of the music styles), custom prompt, volume 0-1.', { enabled: { type: 'boolean' }, style_id: str(), prompt: str(), volume: { type: 'number' } }),
  fn('generate_music', 'PAID (ElevenLabs credits): generate the music track. Shows a confirm button to the owner.', {}),
  fn('edit_text', 'Change one on-screen text of the current built version instantly (no rebuild). Use the keys listed in the state.', { key: str(), value: str() }, ['key', 'value']),
  fn('request_build', 'PAID (owner\'s Claude plan): build a brand-new version with Claude. Shows a confirm button.', { instruction: str('extra design direction') }),
  fn('request_revision', 'PAID (owner\'s Claude plan): ask Claude to change the current version (layout, motion, charts, design). Shows a confirm button.', { instruction: str(), scene_id: str() }, ['instruction']),
  fn('request_render', 'PAID (owner\'s Claude plan, small): re-render the video with the current text/colour edits. Shows a confirm button.', {}),
];

function fn(name, description, properties, required = []) {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } };
}
function str(d) { return d ? { type: 'string', description: d } : { type: 'string' }; }

function systemPrompt() {
  const lang = getLang() === 'en' ? 'English' : 'Korean';
  return `You are the assistant inside Infographic Studio, the owner's personal tool for making infographics (videos or still pages).
The pipeline: brief -> facts (web research) -> script (scenes with narration and {n} cue markers) -> style (palette, font, motion) -> voice (ElevenLabs) -> music (ElevenLabs) -> Claude build (a cloud routine designs and renders the video) -> preview and export.

How to work:
- Reply in ${lang}, briefly (1-3 sentences). Be concrete.
- Change the project with tools instead of describing changes. You may call several tools in a row.
- Tools marked PAID only show a confirm button; call them only when the owner asks for that kind of action (or clearly agrees), then say a button is waiting.
- To change wording on screen after a build, use edit_text (instant). For layout/motion/design changes after a build, use request_revision.
- Never invent statistics; facts come from research_facts.
- The current project state is given below and is refreshed every turn.`;
}

export function mountChat(root, A) {
  const S = A.S;
  const msgs = h('div', { class: 'msgs' });
  const input = h('textarea', { placeholder: t('chat_ph'), rows: 1 });
  const sendBtn = h('button', { class: 'btn primary icon', title: t('send') }, icon('send'));
  const chips = h('div', { class: 'chips' }, t('chips').map((c) => h('button', { class: 'chip', onclick: () => send(c) }, c)));
  root.replaceChildren(
    h('div', { class: 'chat-head' }, icon('wand'), h('b', {}, t('chat_title')), h('span', { class: 'mono' }, S.config.models.chat)),
    msgs, chips,
    h('div', { class: 'chat-in' }, input, sendBtn));

  let busy = false;
  let ctl = null;

  function bubble(role, text) {
    const el = h('div', { class: 'msg ' + role }, text);
    msgs.append(el);
    msgs.scrollTop = msgs.scrollHeight;
    return el;
  }
  function card(...kids) {
    const el = h('div', { class: 'msg card' }, ...kids);
    msgs.append(el);
    msgs.scrollTop = msgs.scrollHeight;
    return el;
  }

  // History
  if (!S.p.chat.length) bubble('assistant', t('chat_hello'));
  for (const m of S.p.chat) bubble(m.role, m.content);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(160, input.scrollHeight) + 'px'; });
  sendBtn.addEventListener('click', () => (busy ? ctl && ctl.abort() : send()));

  async function send(textIn) {
    const text = (textIn ?? input.value).trim();
    if (!text || busy) return;
    input.value = '';
    input.style.height = 'auto';
    bubble('user', text);
    S.p.chat.push({ role: 'user', content: text });
    A.changed({ canvas: false });
    busy = true;
    sendBtn.replaceChildren(icon('x'));
    ctl = new AbortController();
    try {
      await runAgent(text);
    } catch (e) {
      if (e.name !== 'AbortError') bubble('tool', '⚠ ' + (e.message || e));
    } finally {
      busy = false;
      sendBtn.replaceChildren(icon('send'));
    }
  }

  async function runAgent() {
    const history = S.p.chat.slice(-16).map((m) => ({ role: m.role, content: m.content }));
    const sys = () => ({ role: 'system', content: systemPrompt() + '\n\nPROJECT STATE (live):\n' + A.projectSummary() });
    const messages = [sys(), ...history];
    for (let round = 0; round < 6; round++) {
      const el = bubble('assistant', '');
      el.append(h('span', { class: 'typing' }));
      const res = await chatStream({ messages, tools: TOOLS, thinking: false }, {
        signal: ctl.signal,
        onDelta: ({ content }) => { el.textContent = content; msgs.scrollTop = msgs.scrollHeight; },
      });
      if (res.content.trim()) el.textContent = res.content; else el.remove();
      if (!res.toolCalls.length) {
        if (res.content.trim()) {
          S.p.chat.push({ role: 'assistant', content: res.content.trim() });
          A.changed({ canvas: false });
        }
        return;
      }
      messages.push({ role: 'assistant', content: res.content || '', tool_calls: res.toolCalls });
      for (const call of res.toolCalls) {
        let args = {};
        try { args = JSON.parse(call.function.arguments || '{}'); } catch {}
        const note = bubble('tool', '⚙ ' + call.function.name + ' …');
        let result;
        try {
          result = await runTool(call.function.name, args);
          note.textContent = '✓ ' + call.function.name + (result && result.note ? ' — ' + result.note : '');
        } catch (e) {
          result = { error: e.message || String(e) };
          note.textContent = '⚠ ' + call.function.name + ': ' + result.error;
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 6000) });
      }
      // Refresh the state for the next round.
      messages[0] = sys();
    }
  }

  function confirmCard(title, detail, run) {
    const btn = h('button', { class: 'btn claude sm' }, t('confirm_action'));
    const cancel = h('button', { class: 'btn sm ghost' }, t('cancel'));
    const el = card(h('b', {}, title), detail ? h('div', { class: 'hint' }, detail) : null, h('div', { class: 'hint' }, t('paid_note')), h('div', { class: 'row' }, h('span', { class: 'grow' }), cancel, btn));
    btn.onclick = async () => {
      btn.disabled = cancel.disabled = true;
      btn.replaceChildren(h('span', { class: 'spin' }));
      try { await run(); el.append(h('div', { class: 'okbox', style: { marginTop: '8px' } }, '✓')); }
      catch (e) { el.append(h('div', { class: 'err', style: { marginTop: '8px' } }, e.message || String(e))); }
      finally { btn.remove(); cancel.remove(); }
    };
    cancel.onclick = () => el.remove();
    return { status: 'waiting for the owner to click the confirm button in the chat' };
  }

  async function runTool(name, a) {
    switch (name) {
      case 'update_brief': A.updateBrief(a); return { ok: true, note: Object.keys(a).join(', ') };
      case 'research_facts': {
        const r = await A.research(a.focus || '');
        return { ok: true, facts: r.items.length, summary: r.summary, note: `${r.items.length} facts` };
      }
      case 'write_script': {
        const r = await A.writeScript(a.direction || '', a.scene_id || null);
        return { ok: true, scenes: r.scenes ? r.scenes.length : 1, note: r.scenes ? `${r.scenes.length} scenes` : a.scene_id };
      }
      case 'edit_scene': {
        const { scene_id, ...rest } = a;
        A.editScene(scene_id, rest);
        return { ok: true, note: scene_id };
      }
      case 'set_style': {
        if (a.palette_id) {
          const pal = (S.config.palettes || []).find((x) => x.id === a.palette_id);
          if (!pal) throw new Error('unknown palette ' + a.palette_id);
          A.applyPalette({ ...pal, name: null });
        }
        const patch = {};
        if (a.colors) { patch.colors = Object.fromEntries(Object.entries(a.colors).filter(([, v]) => /^#[0-9a-fA-F]{6}$/.test(v || ''))); S.p.style.paletteName = 'Custom'; }
        for (const k of ['font', 'motion', 'notes']) if (a[k]) patch[k] = a[k];
        if (Object.keys(patch).length) A.setStyle(patch);
        return { ok: true };
      }
      case 'suggest_palettes': {
        const list = await A.suggestPalettes(a.direction || '');
        card(h('b', {}, t('suggest_palettes')), list.map((pal) => {
          const sc = scorePalette(pal.colors);
          return h('div', { class: 'pal', style: { marginTop: '8px' }, onclick: () => A.applyPalette({ ...pal, id: null }) },
            h('span', {}, pal.name, h('div', { class: 'hint' }, `Aa ${sc.text}:1`)),
            h('div', { style: { flex: 1 } }, h('div', { class: 'swatches' }, ['bg', 'surface', 'text', 'accent', 'accent2', 'accent3'].map((k) => h('i', { style: { background: pal.colors[k] } }))), h('div', { class: 'hint' }, pal.why)));
        }));
        return { ok: true, shown: list.map((x) => x.name), note: 'click a swatch to apply' };
      }
      case 'palette_from_website': {
        const pal = await A.paletteFromSite(a.url);
        return { ok: true, applied: pal.name, colors: pal.colors };
      }
      case 'set_voice': {
        const patch = {};
        if (a.enabled !== undefined) patch.enabled = a.enabled;
        if (a.voice_id) {
          if (!(S.config.voices || []).some((v) => v.id === a.voice_id)) throw new Error('unknown voice ' + a.voice_id);
          patch.voiceRef = a.voice_id;
        }
        if (a.speed) patch.speed = a.speed;
        A.setVoice(patch);
        return { ok: true };
      }
      case 'generate_voice': {
        const vs = A.voiceStatus();
        const ids = a.scene_ids && a.scene_ids.length ? a.scene_ids : null;
        return confirmCard(t('gen_all_voice'), `${ids ? ids.join(', ') : `${vs.total} ${t('scenes')}`}${a.only_missing ? ' · ' + t('gen_missing_voice') : ''}`,
          () => A.generateVoice(ids, { onlyMissing: !!a.only_missing }));
      }
      case 'set_music': {
        const patch = {};
        if (a.enabled !== undefined) patch.enabled = a.enabled;
        if (a.style_id) patch.styleId = a.style_id;
        if (a.prompt !== undefined) patch.prompt = a.prompt;
        if (a.volume !== undefined) patch.volume = a.volume;
        A.setMusic(patch);
        return { ok: true };
      }
      case 'generate_music':
        return confirmCard(t('gen_music'), t('music_len', { d: A.musicTarget() }), () => A.generateMusic());
      case 'edit_text': {
        if (!S.comp || !(a.key in (S.comp.defaults || {}))) throw new Error('unknown text key ' + a.key);
        A.editText(a.key, a.value);
        return { ok: true, note: a.key };
      }
      case 'request_build':
        return confirmCard(t('build_new'), a.instruction || t('build_hint'), () => A.startJob('build', { instruction: a.instruction || '', confirmed: true }));
      case 'request_revision':
        if (!A.currentVersion()) throw new Error('there is no built version yet; use request_build');
        return confirmCard(t('revise'), `${a.scene_id ? a.scene_id + ': ' : ''}${a.instruction}`, () => A.startJob('revise', { instruction: a.instruction, sceneId: a.scene_id || null, confirmed: true }));
      case 'request_render':
        if (!A.currentVersion()) throw new Error('there is no built version yet');
        return confirmCard(t('rerender'), t('rerender_hint'), () => A.startJob('render', { confirmed: true }));
    }
    throw new Error('unknown tool ' + name);
  }
}
