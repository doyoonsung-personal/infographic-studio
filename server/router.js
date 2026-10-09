// All /api/* routes. Everything except login, health and the routine's worker endpoints
// needs the session cookie set by POST /api/login.

import {
  HttpError, json, fail, readJson, newId, isSignedIn, sessionValue, sessionCookie, safeEqual,
} from './http.js';
import { getJSON, putJSON, del, putBlob, serveBlob, listAll } from './store.js';
import { loadConfig, saveConfig } from './config.js';
import * as qwen from './qwen.js';
import * as eleven from './eleven.js';
import * as jobs from './jobs.js';
import { colorsFromUrl } from './palette.js';

const failedLogins = new Map(); // per-isolate brake on password guessing

export async function handle(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
  const parts = path ? path.split('/') : [];
  const method = request.method;

  try {
    if (!env.STUDIO_KV) fail(500, 'KV binding STUDIO_KV is missing');

    /* ---------- public ---------- */
    if (path === 'health') return json({ ok: true });
    if (path === 'login' && method === 'POST') return await login(request, env);
    if (path === 'logout' && method === 'POST') {
      return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0, url.protocol === 'https:') });
    }

    /* ---------- routine worker (per-job token) ---------- */
    if (parts[0] === 'worker') return await worker(request, env, parts.slice(1), method);

    /* ---------- everything else needs the session ---------- */
    if (!(await isSignedIn(request, env))) fail(401, 'sign in required');

    if (path === 'me') {
      return json({
        ok: true,
        configured: {
          qwen: Boolean(env.DASHSCOPE_API_KEY && env.DASHSCOPE_BASE_URL),
          eleven: Boolean(env.ELEVENLABS_API_KEY),
          routine: Boolean(env.ROUTINE_FIRE_URL && env.ROUTINE_TOKEN),
        },
      });
    }

    if (path === 'config') {
      if (method === 'GET') return json(await loadConfig(env));
      if (method === 'PUT') return json(await saveConfig(env, await readJson(request)));
    }

    if (parts[0] === 'projects') return await projects(request, env, parts.slice(1), method);

    if (parts[0] === 'blobs') {
      if (parts.length === 1 && method === 'POST') {
        const type = request.headers.get('content-type') || 'application/octet-stream';
        if (!/^(audio|image|video)\//.test(type)) fail(415, 'only audio, image or video uploads');
        const len = Number(request.headers.get('content-length')) || null;
        const id = await putBlob(env, len ? request.body : await request.arrayBuffer(), type, {
          name: request.headers.get('x-file-name') || null, size: len,
        });
        return json({ blobId: id });
      }
      if (parts.length === 2 && method === 'GET') return await serveBlob(env, parts[1], request);
    }

    if (path === 'ai/chat' && method === 'POST') return await qwen.chat(env, await readJson(request, 4_000_000), await loadConfig(env));
    if (path === 'ai/research' && method === 'POST') return await qwen.research(env, await readJson(request), await loadConfig(env));
    if (path === 'tts' && method === 'POST') return json(await eleven.tts(env, await readJson(request), await loadConfig(env)));
    if (path === 'music' && method === 'POST') return json(await eleven.music(env, await readJson(request), await loadConfig(env)));
    if (path === 'eleven/voices' && method === 'GET') return json(await eleven.voices(env));
    if (path === 'palette-from-url' && method === 'POST') return json(await colorsFromUrl(await readJson(request)));

    if (parts[0] === 'jobs') {
      if (parts.length === 1 && method === 'POST') {
        return json(await jobs.createJob(env, await readJson(request, 4_000_000), url.origin));
      }
      if (parts.length === 2 && method === 'GET') return json(await jobs.jobForUser(env, parts[1]));
    }

    fail(404, 'no such endpoint: ' + method + ' /api/' + path);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, ...(e.extra || {}) }, e.status);
    console.error(e);
    return json({ error: 'server error: ' + (e && e.message ? e.message : String(e)) }, 500);
  }
}

async function login(request, env) {
  if (!env.APP_PASSWORD) fail(503, 'APP_PASSWORD is not set on the server');
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const rec = failedLogins.get(ip) || { n: 0, at: 0 };
  if (rec.n >= 8 && Date.now() - rec.at < 10 * 60 * 1000) fail(429, 'too many attempts, try again in 10 minutes');
  const body = await readJson(request);
  if (!safeEqual(String(body.password || ''), env.APP_PASSWORD)) {
    failedLogins.set(ip, { n: rec.n + 1, at: Date.now() });
    await new Promise((r) => setTimeout(r, 600));
    fail(401, 'wrong password');
  }
  failedLogins.delete(ip);
  const secure = new URL(request.url).protocol === 'https:';
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(await sessionValue(env), 60 * 60 * 24 * 60, secure) });
}

/* ---------- projects ---------- */

function meta(p) {
  return {
    // KV metadata: ASCII-safe and under the 1,024-byte cap (an encoded Korean character is 9 bytes).
    t: encodeURIComponent(String(p.title || p.brief?.topic || '').slice(0, 60)),
    updatedAt: p.updatedAt || Date.now(),
    createdAt: p.createdAt || Date.now(),
    format: p.brief?.format || 'animated',
    ratio: p.brief?.ratio || '16:9',
    poster: p.poster || null,
  };
}

async function projects(request, env, parts, method) {
  if (parts.length === 0 && method === 'GET') {
    const keys = await listAll(env, 'project:');
    const list = keys.map((k) => {
      const { t, ...m } = k.metadata || {};
      let title = m.title || '';
      try { if (t) title = decodeURIComponent(t); } catch {}
      return { id: k.name.slice(8), ...m, title };
    }).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return json({ projects: list });
  }
  if (parts.length === 0 && method === 'POST') {
    const body = await readJson(request);
    const id = newId('p_');
    const now = Date.now();
    const p = { ...body, id, createdAt: now, updatedAt: now };
    await putJSON(env, 'project:' + id, p, meta(p));
    return json(p);
  }
  const id = parts[0];
  if (!/^p_[\w-]+$/.test(id || '')) fail(400, 'bad project id');
  const key = 'project:' + id;

  if (parts[1] === 'versions' && method === 'GET') {
    return json({ versions: (await getJSON(env, 'versions:' + id)) || [] });
  }
  if (parts.length === 1) {
    if (method === 'GET') {
      const p = await getJSON(env, key);
      if (!p) fail(404, 'project not found');
      return json(p);
    }
    if (method === 'PUT') {
      const body = await readJson(request, 3_000_000);
      const existing = await getJSON(env, key);
      if (!existing) fail(404, 'project not found');
      if (body.rev != null && existing.rev != null && body.rev < existing.rev) {
        fail(409, 'project changed in another window; reload to continue', { rev: existing.rev });
      }
      const p = { ...body, id, createdAt: existing.createdAt, updatedAt: Date.now(), rev: (existing.rev || 0) + 1 };
      await putJSON(env, key, p, meta(p));
      return json({ ok: true, rev: p.rev, updatedAt: p.updatedAt });
    }
    if (method === 'DELETE') {
      await del(env, key);
      return json({ ok: true });
    }
  }
  fail(404, 'no such project endpoint');
}

/* ---------- worker ---------- */

async function worker(request, env, parts, method) {
  // /api/worker/jobs/:id[/status|/files/:name|/complete|/fail]
  // /api/worker/blobs/:blobId?job=:id
  if (parts[0] === 'blobs' && parts[1] && method === 'GET') {
    const jobId = new URL(request.url).searchParams.get('job') || '';
    await jobs.authWorker(env, request, jobId);
    return serveBlob(env, parts[1], null);
  }
  if (parts[0] !== 'jobs' || !parts[1]) fail(404, 'no such worker endpoint');
  const job = await jobs.authWorker(env, request, parts[1]);
  const action = parts[2] || '';
  if (!action && method === 'GET') return json(await jobs.workerBundle(env, job));
  if (action === 'status' && method === 'POST') return json(await jobs.workerStatus(env, job, await readJson(request)));
  if (action === 'files' && parts[3] && method === 'PUT') return json(await jobs.workerFile(env, job, parts[3], request));
  if (action === 'complete' && method === 'POST') return json(await jobs.workerComplete(env, job, await readJson(request)));
  if (action === 'fail' && method === 'POST') return json(await jobs.workerFail(env, job, await readJson(request)));
  fail(404, 'no such worker endpoint');
}
