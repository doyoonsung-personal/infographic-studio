// Small HTTP helpers for the Pages Functions backend.

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export function fail(status, message, extra) {
  throw new HttpError(status, message, extra);
}

export async function readJson(request, limit = 2_000_000) {
  const text = await request.text();
  if (text.length > limit) fail(413, 'request body too large');
  if (!text) return {};
  try { return JSON.parse(text); } catch { fail(400, 'invalid JSON body'); }
}

export function newId(prefix = '') {
  const b = new Uint8Array(9);
  crypto.getRandomValues(b);
  return prefix + b64url(b);
}

export function b64url(bytes) {
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomToken(n = 32) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b64url(b);
}

export async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return b64url(new Uint8Array(d));
}

export async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
  return b64url(new Uint8Array(sig));
}

export function safeEqual(a, b) {
  a = String(a || '');
  b = String(b || '');
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function getCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}

/* ---------- session (stateless: changing APP_PASSWORD signs everyone out) ---------- */

export const SESSION_COOKIE = 'is_session';

export async function sessionValue(env) {
  if (!env.APP_PASSWORD) return null;
  return hmac(env.APP_PASSWORD, 'infographic-studio/session/v1');
}

export async function isSignedIn(request, env) {
  const want = await sessionValue(env);
  if (!want) return false;
  return safeEqual(getCookie(request, SESSION_COOKIE), want);
}

export function sessionCookie(value, maxAge, secure = true) {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Lax; Max-Age=${maxAge}`;
}
