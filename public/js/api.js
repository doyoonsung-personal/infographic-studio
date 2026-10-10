// Calls to the Pages Functions backend.

export class ApiError extends Error {
  constructor(status, message, data) { super(message); this.status = status; this.data = data; }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

export async function api(path, { method = 'GET', body, raw, signal, headers, keepalive } = {}) {
  const opts = { method, headers: { ...(headers || {}) }, signal, credentials: 'same-origin', keepalive: Boolean(keepalive) };
  if (body !== undefined) {
    if (raw) opts.body = body;
    else { opts.body = JSON.stringify(body); opts.headers['content-type'] = 'application/json'; }
  }
  const r = await fetch('/api/' + path.replace(/^\//, ''), opts);
  if (r.status === 401 && path !== 'login') onUnauthorized();
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await r.json().catch(() => ({})) : await r.text();
  if (!r.ok) throw new ApiError(r.status, (data && data.error) || (typeof data === 'string' && data) || r.statusText, data);
  return data;
}

export const blobUrl = (id) => (id ? '/api/blobs/' + encodeURIComponent(id) : '');

export async function blobText(id) {
  const r = await fetch(blobUrl(id), { credentials: 'same-origin' });
  if (!r.ok) throw new ApiError(r.status, 'could not load file');
  return r.text();
}

/**
 * Stream a Qwen chat completion. Calls onDelta({content, reasoning}) as text arrives.
 * Resolves with { content, toolCalls, usage, finishReason }.
 */
export async function chatStream(body, { onDelta, signal } = {}) {
  const r = await fetch('/api/ai/chat', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (r.status === 401) onUnauthorized();
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new ApiError(r.status, d.error || r.statusText);
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let content = '';
  let reasoning = '';
  let usage = null;
  let finishReason = null;
  const calls = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      let j;
      try { j = JSON.parse(payload); } catch { continue; }
      if (j.usage) usage = j.usage;
      const ch = j.choices && j.choices[0];
      if (!ch) continue;
      if (ch.finish_reason) finishReason = ch.finish_reason;
      const d = ch.delta || {};
      if (d.content) content += d.content;
      if (d.reasoning_content) reasoning += d.reasoning_content;
      if (d.tool_calls) {
        for (const tc of d.tool_calls) {
          const k = tc.index ?? 0;
          calls[k] = calls[k] || { id: '', type: 'function', function: { name: '', arguments: '' } };
          if (tc.id) calls[k].id = tc.id;
          if (tc.function && tc.function.name) calls[k].function.name += tc.function.name;
          if (tc.function && tc.function.arguments) calls[k].function.arguments += tc.function.arguments;
        }
      }
      if (onDelta && (d.content || d.reasoning_content)) onDelta({ content, reasoning });
    }
  }
  return { content, reasoning, toolCalls: calls.filter(Boolean), usage, finishReason };
}

/**
 * Stream a Responses API web-search run. Calls onSearch(queries) as searches happen and
 * resolves with the final response object (`response.completed`).
 */
export async function researchStream(input, { onSearch, onText, signal } = {}) {
  const r = await fetch('/api/ai/research', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input }),
    signal,
  });
  if (r.status === 401) onUnauthorized();
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new ApiError(r.status, d.error || r.statusText);
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let final = null;
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      let j;
      try { j = JSON.parse(line.slice(5)); } catch { continue; }
      if (j.type === 'response.output_item.done' && j.item && j.item.type === 'web_search_call' && onSearch) {
        const a = j.item.action || {};
        onSearch(a.queries || (a.query ? [a.query] : []));
      } else if (j.type === 'response.output_text.delta' && j.delta) {
        text += j.delta;
        if (onText) onText(text);
      } else if (j.type === 'response.completed' || j.type === 'response.failed' || j.type === 'response.incomplete') {
        final = j.response || null;
      } else if (j.type === 'error') {
        throw new ApiError(502, (j.error && j.error.message) || j.message || 'research failed');
      }
    }
  }
  if (!final) throw new ApiError(502, 'research ended without a result');
  return final;
}

/** One-shot completion that must return JSON. */
export async function askJSON(messages, { role = 'writer', thinking = true, signal } = {}) {
  const { extractJSON } = await import('./util.js');
  const res = await chatStream({ messages, role, thinking }, { signal });
  return extractJSON(res.content);
}
