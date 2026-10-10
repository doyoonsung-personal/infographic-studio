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
  fn('set_background', 'Background style: mode color (palette only) or image (AI background images); scope scene (one per scene) or single (one shared); look collage|photo|illustration|3d|abstract; notes; strength 0.1-0.9 (how visible the images are).', {
    mode: { type: 'string', enum: ['color', 'image'] }, scope: { type: 'string', enum: ['scene', 'single'] },
    look: { type: 'string', enum: ['collage', 'photo', 'illustration', '3d', 'abstract'] }, notes: str(), strength: { type: 'number' },
  }),
  fn('generate_backgrounds', 'PAID (image credits): generate the background images that are missing (or the given scene ids). Shows a confirm button.', { scene_ids: { type: 'array', items: str() } }),
  fn('set_extras', 'Extra features for the next build (the step before the build): sfx = sound effects (whooshes, pops, ticks), ambient = background motion (never-frozen scenes), camera = camera moves and camera transitions (one continuous world), gsap = GSAP animation. Free to switch; a new build applies them.', {
    sfx: { type: 'boolean' }, ambient: { type: 'boolean' }, camera: { type: 'boolean' }, gsap: { type: 'boolean' },
    sfx_auto: { type: 'boolean' }, sfx_volume: { type: 'number' },
  }),
  fn('make_sound_effects', 'PAID (ElevenLabs credits, small, once for all projects): make the missing sounds of the shared sound-effect library. Shows a confirm button.', {}),
  fn('set_look','Overall look of the design: "collage" = Vox-style editorial paper collage (paper texture, grain, cut-out photos, torn paper, tape, highlighter, marker; also applies a paper palette), "default" = clean cards and charts. A new look needs a "Remake all" build.', { look: { type: 'string', enum: ['default', 'collage'] } }, ['look']),
  fn('plan_cutouts', 'Suggest cut-out photos (1-3 concrete subjects per scene) for the Cut-outs step. Free. Keeps cut-outs that already have a picture.', {}),
  fn('generate_cutouts', 'PAID (image credits, ~$0.04 each): generate the cut-out pictures that are missing. Shows a confirm button.', {}),
  fn('animate_backgrounds', 'PAID (video credits, ~$0.14 per second, ~5-10 s per image): turn background images into moving AI clips. Optional scene ids (or "all" for the shared image); default = all still images. Shows a confirm button.', { keys: { type: 'array', items: str() } }),
  fn('palette_from_website', 'Build a palette from a brand website\'s colours and apply it. Only when the owner gave a website URL.', { url: str('http(s) URL the owner gave') }, ['url']),
  fn('set_voice', 'Narration settings: enabled, voice_id (one of the available voices), speed 0.7-1.2, model (eleven_v4 / eleven_v3 support emotion tags; switching to them offers the owner to add tags, other models remove tags).', {
    enabled: { type: 'boolean' }, voice_id: str(), speed: { type: 'number' },
    model: { type: 'string', enum: ['eleven_v4', 'eleven_v3', 'eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_turbo_v2_5'] },
  }),
  fn('generate_voice', 'PAID (ElevenLabs credits): generate narration audio. Shows a confirm button to the owner.', { scene_ids: { type: 'array', items: str() }, only_missing: { type: 'boolean' } }),
  fn('set_music', 'Music settings: enabled, style_id (one of the music styles), custom prompt, volume 0-1.', { enabled: { type: 'boolean' }, style_id: str(), prompt: str(), volume: { type: 'number' } }),
  fn('generate_music', 'PAID (ElevenLabs credits): generate the music track. Shows a confirm button to the owner.', {}),
  fn('edit_text', 'Change one on-screen text of the current built version instantly (no rebuild). Use the keys listed in the state.', { key: str(), value: str() }, ['key', 'value']),
  fn('request_build', 'PAID (owner\'s Claude plan): "Remake all" mode. Claude designs every scene again from scratch, ignoring the current version. Use for: remake/redo/regenerate/re-render everything, new design, start over. Shows a confirm button.', { instruction: str('extra design direction') }),
  fn('request_revision', 'PAID (owner\'s Claude plan): "Keep graphics" mode with a change. Claude keeps the current design, brings in the latest brief/facts/script, and applies the instruction (layout, motion, charts, a scene\'s design). Shows a confirm button.', { instruction: str(), scene_id: str() }, ['instruction']),
  fn('request_render', 'PAID (owner\'s Claude plan, small): "Keep graphics" with no design change. Bakes the latest text/colour/background edits and brief/facts/script content into the video with the same design. Shows a confirm button.', {}),
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
- Each owner message is ONE new request. Earlier requests in the history are already done (their "[Already done…]" notes say what was done); never redo them.
- Do the smallest set of tool calls that fulfils the request. After write_script, do not call edit_scene unless the owner dictated exact wording.
- palette_from_website only when the owner gives a website URL. For "brighter/warmer/…" colour requests use set_style with a fitting saved palette_id or custom colors, or suggest_palettes.
- To change wording on screen after a build, use edit_text (instant). For layout/motion/design changes after a build, use request_revision.
- New versions come in two modes. "Keep graphics" = request_render (no design change) or request_revision (with a change). "Remake all" = request_build. When the owner asks to redo, regenerate, remake or "re-render everything", or says the graphics barely changed, use request_build, not request_render.
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
  for (const m of S.p.chat) {
    if (m.actions && m.actions.length) bubble('tool', '✓ ' + m.actions.join(' · '));
    if (m.content && m.content !== '✓') bubble(m.role, m.content);
  }

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

  // Earlier turns are replayed with their tool calls and results in the API's own format, so the
  // model knows those requests are finished (and doesn't imitate a text note instead of calling tools).
  function historyForModel() {
    const out = [];
    S.p.chat.slice(-16).forEach((m, i) => {
      if (m.role === 'assistant' && m.calls && m.calls.length) {
        const ids = m.calls.map((_, k) => `h${i}_${k}`);
        out.push({ role: 'assistant', content: '', tool_calls: m.calls.map((c, k) => ({ id: ids[k], type: 'function', function: { name: c.name, arguments: c.args || '{}' } })) });
        m.calls.forEach((c, k) => out.push({ role: 'tool', tool_call_id: ids[k], content: JSON.stringify(c.result || { ok: true }) }));
        if (m.content && m.content !== '✓') out.push({ role: 'assistant', content: m.content });
      } else if (m.content && m.content !== '✓') {
        out.push({ role: m.role, content: m.content });
      }
    });
    return out;
  }

  async function runAgent() {
    const sys = () => ({ role: 'system', content: systemPrompt() + '\n\nPROJECT STATE (live):\n' + A.projectSummary() });
    const messages = [sys(), ...historyForModel()];
    const actions = [];
    const calls = [];
    let finalText = '';
    for (let round = 0; round < 6; round++) {
      const el = bubble('assistant', '');
      el.append(h('span', { class: 'typing' }));
      const res = await chatStream({ messages, tools: TOOLS, thinking: false }, {
        signal: ctl.signal,
        onDelta: ({ content }) => { el.textContent = content; msgs.scrollTop = msgs.scrollHeight; },
      });
      if (res.content.trim()) { el.textContent = res.content; finalText = res.content.trim(); } else el.remove();
      if (!res.toolCalls.length) break;
      messages.push({ role: 'assistant', content: res.content || '', tool_calls: res.toolCalls });
      for (const call of res.toolCalls) {
        let args = {};
        try { args = JSON.parse(call.function.arguments || '{}'); } catch {}
        const note = bubble('tool', '⚙ ' + call.function.name + ' …');
        let result;
        try {
          result = await runTool(call.function.name, args);
          note.textContent = '✓ ' + call.function.name + (result && result.note ? ' — ' + result.note : '');
          actions.push(call.function.name + (result && result.note ? ` (${result.note})` : ''));
        } catch (e) {
          result = { error: e.message || String(e) };
          note.textContent = '⚠ ' + call.function.name + ': ' + result.error;
          actions.push(call.function.name + ' failed');
        }
        const rawArgs = call.function.arguments || '{}';
        calls.push({ name: call.function.name, args: rawArgs.length <= 600 ? rawArgs : '{}', result: compact(result) });
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 6000) });
      }
      // Refresh the state for the next round.
      messages[0] = sys();
    }
    if (finalText || actions.length) {
      S.p.chat.push({ role: 'assistant', content: finalText || '✓', actions, calls });
      A.changed({ canvas: false });
    }
  }

  function compact(r) {
    if (!r || typeof r !== 'object') return { ok: true };
    const out = {};
    for (const [k, v] of Object.entries(r)) {
      if (['ok', 'note', 'error', 'status', 'scenes', 'facts', 'applied'].includes(k)) out[k] = v;
    }
    return out;
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
      case 'set_background': {
        A.setBackground(a);
        return { ok: true, note: a.mode || '' };
      }
      case 'generate_backgrounds': {
        if (S.p.style.background.mode !== 'image') A.setBackground({ mode: 'image' });
        const bs = A.bgStatus();
        const ids = a.scene_ids && a.scene_ids.length ? a.scene_ids : (bs.missing.length ? bs.missing : bs.keys);
        return confirmCard(t('bg_generate', { n: ids.length }), ids.join(', '), () => A.generateBackgrounds(ids));
      }
      case 'set_extras': {
        for (const k of ['sfx', 'ambient', 'camera', 'gsap']) if (typeof a[k] === 'boolean') A.setExtras(k, { enabled: a[k] });
        if (typeof a.sfx_auto === 'boolean') A.setExtras('sfx', { auto: a.sfx_auto });
        if (a.sfx_volume != null) A.setExtras('sfx', { volume: a.sfx_volume });
        const ex = S.p.extras;
        return { ok: true, extras: Object.fromEntries(['sfx', 'ambient', 'camera', 'gsap'].map((k) => [k, ex[k].enabled])), sound_library_missing: A.sfxMissing() };
      }
      case 'make_sound_effects': {
        const missing = A.sfxMissing();
        if (!missing.length) return { ok: true, note: 'the sound library is complete' };
        return confirmCard(t('sfx_make', { n: missing.length }), missing.join(', '), () => A.generateSfx());
      }
      case 'set_look': {
        A.setLook(a.look);
        return { ok: true, look: S.p.style.look, palette: S.p.style.paletteName || S.p.style.paletteId };
      }
      case 'plan_cutouts': {
        const r = await A.planAssets();
        return { ok: true, planned: r ? r.planned : 0, cutouts: S.p.assets.items.map((x) => `${x.sceneId}: ${x.name}`) };
      }
      case 'generate_cutouts': {
        const todo = S.p.assets.items.filter((x) => !x.blobId && x.subject && !x.upload);
        if (!todo.length) throw new Error('no cut-outs to generate; call plan_cutouts first');
        return confirmCard(t('assets_generate', { n: todo.length }), todo.map((x) => x.name).join(', '), () => A.generateAssets());
      }
      case 'animate_backgrounds': {
        const im = S.p.style.background.images || {};
        const keys = (a.keys && a.keys.length ? a.keys : Object.keys(im).filter((k) => im[k] && !im[k].clip)).filter((k) => im[k]);
        if (!keys.length) throw new Error('no background images to animate; generate backgrounds first');
        return confirmCard(t('clip_generate', { n: keys.length }), keys.join(', '), () => A.generateClips(keys));
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
        if (a.model) await A.setVoiceModel(a.model);
        return { ok: true, note: a.model || undefined };
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
        if (!A.currentVersion()) return confirmCard(t('build_new'), a.instruction || t('build_hint'), () => A.startJob('build', { instruction: a.instruction || '', confirmed: true }));
        return confirmCard(t('mode_remake_go'), a.instruction || t('mode_remake_hint'), () => A.makeVersion('remake', { instruction: a.instruction || '', confirmed: true }));
      case 'request_revision':
        if (!A.currentVersion()) throw new Error('there is no built version yet; use request_build');
        return confirmCard(t('mode_keep_go'), `${a.scene_id ? a.scene_id + ': ' : ''}${a.instruction}`, () => A.makeVersion('keep', { instruction: a.instruction, sceneId: a.scene_id || null, confirmed: true }));
      case 'request_render':
        if (!A.currentVersion()) throw new Error('there is no built version yet');
        // Keep graphics: a plain re-render, or a content update when the brief/facts/script moved on.
        return confirmCard(t('mode_keep_go'), t('mode_keep_hint'), () => A.makeVersion('keep', { confirmed: true }));
    }
    throw new Error('unknown tool ' + name);
  }
}
