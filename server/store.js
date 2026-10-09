// Workers KV storage: JSON documents and binary blobs (audio, video, images, compositions).
// Free-plan limits worth remembering: 25 MiB per value, 1,000 writes a day.

import { fail, newId } from './http.js';

export const MAX_BLOB = 25 * 1024 * 1024;

export async function getJSON(env, key) {
  return env.STUDIO_KV.get(key, 'json');
}

export async function putJSON(env, key, value, metadata) {
  await env.STUDIO_KV.put(key, JSON.stringify(value), metadata ? { metadata } : undefined);
}

export async function del(env, key) {
  await env.STUDIO_KV.delete(key);
}

/** Store a blob from bytes or a stream. Returns its id. */
export async function putBlob(env, body, type, extra = {}) {
  const id = newId('b_');
  const size = body && typeof body.byteLength === 'number' ? body.byteLength : extra.size || null;
  if (size != null && size > MAX_BLOB) fail(413, `file too large (${Math.round(size / 1048576)} MB, limit 25 MB)`);
  await env.STUDIO_KV.put('blob:' + id, body, {
    metadata: { type: type || 'application/octet-stream', size, name: extra.name || null, at: Date.now() },
  });
  return id;
}

/** Serve a blob, honouring Range requests so audio/video can seek. */
export async function serveBlob(env, id, request) {
  if (!/^b_[\w-]+$/.test(id)) fail(400, 'bad blob id');
  const range = request && request.headers.get('range');
  if (!range) {
    const { value, metadata } = await env.STUDIO_KV.getWithMetadata('blob:' + id, 'stream');
    if (!value) fail(404, 'not found');
    const h = blobHeaders(metadata);
    if (metadata && metadata.size) h['content-length'] = String(metadata.size);
    return new Response(value, { headers: h });
  }
  const { value, metadata } = await env.STUDIO_KV.getWithMetadata('blob:' + id, 'arrayBuffer');
  if (!value) fail(404, 'not found');
  const total = value.byteLength;
  const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
  let start = m[1] ? parseInt(m[1], 10) : 0;
  let end = m[2] ? parseInt(m[2], 10) : total - 1;
  if (!m[1] && m[2]) { start = Math.max(0, total - parseInt(m[2], 10)); end = total - 1; }
  end = Math.min(end, total - 1);
  if (start > end || start >= total) {
    return new Response(null, { status: 416, headers: { 'content-range': `bytes */${total}` } });
  }
  const h = blobHeaders(metadata);
  h['content-range'] = `bytes ${start}-${end}/${total}`;
  h['content-length'] = String(end - start + 1);
  return new Response(value.slice(start, end + 1), { status: 206, headers: h });
}

function blobHeaders(md) {
  return {
    'content-type': (md && md.type) || 'application/octet-stream',
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=31536000, immutable',
  };
}

export async function getBlobText(env, id) {
  if (!id) return null;
  return env.STUDIO_KV.get('blob:' + id, 'text');
}

/** List keys under a prefix, following cursors (small collections only). */
export async function listAll(env, prefix, max = 1000) {
  const out = [];
  let cursor;
  do {
    const r = await env.STUDIO_KV.list({ prefix, cursor, limit: 1000 });
    out.push(...r.keys);
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor && out.length < max);
  return out;
}
