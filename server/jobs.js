// Build jobs: the app creates a job and fires the owner's Claude Code routine; the routine
// (running routine/worker.mjs in Claude's cloud) fetches the job, builds, renders and uploads.

import { fail, newId, randomToken, sha256, safeEqual } from './http.js';
import { getJSON, putJSON, putBlob, getBlobText, listAll } from './store.js';

const KINDS = new Set(['build', 'revise', 'render', 'ping']);
export const FILE_NAMES = {
  'composition.html': 'text/html; charset=utf-8',
  'video.mp4': 'video/mp4',
  'poster.jpg': 'image/jpeg',
  'contact.jpg': 'image/jpeg',
  'image.png': 'image/png',
  'document.pdf': 'application/pdf',
  'report.json': 'application/json',
};

const ROUTINE_BETA = 'experimental-cc-routine-2026-04-01';

const ACTIVE = new Set(['queued', 'fired', 'running']);
const STALE_MS = 60 * 60 * 1000; // an active job with no activity for an hour is treated as dead

function publicJob(job) {
  if (!job) return null;
  const { tokenHash, ...rest } = job;
  return rest;
}

/** Jobs are stored with small metadata so the owner can list active ones without reading each. */
async function putJob(env, job) {
  await putJSON(env, 'job:' + job.id, job, {
    status: job.status, kind: job.kind, projectId: job.projectId,
    title: encodeURIComponent(String(job.title || '').slice(0, 40)),
    createdAt: job.createdAt, updatedAt: job.updatedAt,
  });
}

function endJob(job, status, reason) {
  job.status = status;
  job.stage = status;
  job.error = reason;
  job.log.push({ at: Date.now(), msg: reason });
  job.updatedAt = Date.now();
}

/** Expire an active job that has shown no activity for an hour. Returns true if it changed. */
function expireIfStale(job) {
  if (ACTIVE.has(job.status) && Date.now() - (job.updatedAt || job.createdAt) > STALE_MS) {
    endJob(job, 'failed', 'Timed out: no activity from the routine for 60 minutes');
    return true;
  }
  return false;
}

/** POST /api/jobs { projectId, kind, instruction?, sceneId?, project } */
export async function createJob(env, body, origin) {
  const kind = String(body.kind || '');
  if (!KINDS.has(kind)) fail(400, 'kind must be build, revise, render or ping');
  const project = body.project;
  if (kind !== 'ping' && (!project || !project.id)) fail(400, 'project snapshot required');

  const id = newId('j_');
  const token = randomToken(32);
  const versions = project ? (await getJSON(env, 'versions:' + project.id)) || [] : [];
  const base = pickBase(versions, project, body.baseVersion);
  const now = Date.now();
  const job = {
    id,
    kind,
    projectId: project ? project.id : null,
    title: project ? (project.title || project.brief?.topic || '').slice(0, 120) : 'ping',
    instruction: String(body.instruction || '').slice(0, 4000),
    sceneId: body.sceneId ? String(body.sceneId).slice(0, 40) : null,
    baseVersion: base ? base.v : null,
    status: 'queued',
    stage: 'queued',
    log: [{ at: now, msg: 'Job created' }],
    files: {},
    createdAt: now,
    updatedAt: now,
    sessionUrl: null,
    tokenHash: await sha256(token),
  };
  await putJSON(env, 'jobsnap:' + id, {
    project: project || null,
    baseComposition: base && base.files ? base.files['composition.html'] || null : null,
  });

  if (body.manual === true) {
    // The owner runs the worker on their own machine (e.g. with Claude Code); the token is shown once.
    job.log.push({ at: Date.now(), msg: 'Manual job: run routine/worker.mjs yourself with this job id and token' });
    await putJob(env, job);
    return { ...publicJob(job), token };
  }
  if (env.ROUTINE_FIRE_URL && env.ROUTINE_TOKEN) {
    const fired = await fireRoutine(env, { job_id: id, token, app: origin });
    if (fired.ok) {
      job.status = 'fired';
      job.stage = 'starting';
      job.sessionUrl = fired.sessionUrl;
      job.log.push({ at: Date.now(), msg: 'Routine started' });
    } else {
      job.status = 'failed';
      job.stage = 'failed';
      job.error = fired.error;
      job.log.push({ at: Date.now(), msg: 'Could not start the routine: ' + fired.error });
    }
  } else {
    job.log.push({ at: Date.now(), msg: 'Routine is not configured (ROUTINE_FIRE_URL / ROUTINE_TOKEN); waiting for a manual worker' });
    job.devToken = env.DEV_MODE === '1' ? token : undefined;
  }
  await putJob(env, job);
  return publicJob(job);
}

function pickBase(versions, project, wanted) {
  if (!versions.length) return null;
  const want = wanted != null ? Number(wanted) : project && project.build && project.build.current;
  return versions.find((v) => v.v === want) || versions[versions.length - 1];
}

async function fireRoutine(env, ticket) {
  try {
    const r = await fetch(env.ROUTINE_FIRE_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.ROUTINE_TOKEN,
        'anthropic-beta': ROUTINE_BETA,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: JSON.stringify({ job_id: ticket.job_id, token: ticket.token }) }),
    });
    const text = await r.text();
    if (!r.ok) {
      const retry = r.headers.get('retry-after');
      return { ok: false, error: `HTTP ${r.status}${retry ? ` (retry after ${retry}s)` : ''}: ${text.slice(0, 300)}` };
    }
    let j = {};
    try { j = JSON.parse(text); } catch {}
    return { ok: true, sessionUrl: j.claude_code_session_url || null, sessionId: j.claude_code_session_id || null };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

export async function getJob(env, id) {
  if (!/^j_[\w-]+$/.test(id)) fail(400, 'bad job id');
  const job = await getJSON(env, 'job:' + id);
  if (!job) fail(404, 'job not found');
  return job;
}

export async function jobForUser(env, id) {
  const job = await getJob(env, id);
  if (expireIfStale(job)) await putJob(env, job);
  return publicJob(job);
}

/** POST /api/jobs/:id/cancel — the owner stops a job; the routine's next call is refused. */
export async function cancelJob(env, id) {
  const job = await getJob(env, id);
  if (ACTIVE.has(job.status)) {
    endJob(job, 'cancelled', 'Cancelled by the owner');
    await putJob(env, job);
  }
  return publicJob(job);
}

/** GET /api/jobs?active=1 — jobs still queued/fired/running (stale ones are expired on the way). */
export async function listJobs(env, { active = true } = {}) {
  const keys = await listAll(env, 'job:', 2000);
  const out = [];
  for (const k of keys) {
    const m = k.metadata || {};
    if (active && m.status && !ACTIVE.has(m.status)) continue;
    let title = '';
    try { title = decodeURIComponent(m.title || ''); } catch {}
    const row = { id: k.name.slice(4), status: m.status || 'unknown', kind: m.kind, projectId: m.projectId, title, createdAt: m.createdAt, updatedAt: m.updatedAt };
    if (active && (!m.status || Date.now() - (m.updatedAt || m.createdAt || 0) > STALE_MS)) {
      // No metadata (older job) or stale: read it, expire if needed, and keep only if still active.
      const job = await getJSON(env, k.name);
      if (!job) continue;
      if (expireIfStale(job)) await putJob(env, job);
      if (!ACTIVE.has(job.status)) continue;
      Object.assign(row, { status: job.status, kind: job.kind, projectId: job.projectId, title: job.title, createdAt: job.createdAt, updatedAt: job.updatedAt });
    }
    out.push(row);
  }
  return out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/* ---------- worker side (authenticated by the per-job token) ---------- */

export async function authWorker(env, request, id) {
  const job = await getJob(env, id);
  const token = request.headers.get('x-job-token') || '';
  if (!token || !safeEqual(await sha256(token), job.tokenHash)) fail(403, 'bad job token');
  if (job.status === 'cancelled') fail(409, 'job cancelled by the owner: stop working on it');
  if (job.status === 'done' || job.status === 'failed') {
    if (request.method !== 'GET') fail(409, 'job already ' + job.status);
  }
  return job;
}

export async function workerBundle(env, job) {
  if (job.status === 'fired' || job.status === 'queued') {
    // First contact: tells the owner the routine reached the app (network and token are fine).
    job.status = 'running';
    job.stage = 'connected';
    job.log.push({ at: Date.now(), msg: 'Routine connected to the app' });
    job.updatedAt = Date.now();
    await putJob(env, job);
  }
  const snap = (await getJSON(env, 'jobsnap:' + job.id)) || {};
  const composition = snap.baseComposition ? await getBlobText(env, snap.baseComposition) : null;
  const versions = job.projectId ? (await getJSON(env, 'versions:' + job.projectId)) || [] : [];
  const base = versions.find((v) => v.v === job.baseVersion) || null;
  return { job: publicJob(job), project: snap.project, baseComposition: composition, baseVersion: base };
}

export async function workerStatus(env, job, body) {
  const msg = String(body.message || '').slice(0, 400);
  const stage = String(body.stage || job.stage || 'running').slice(0, 40);
  job.status = 'running';
  job.stage = stage;
  if (body.sessionUrl && /^https:\/\/claude\.ai\//.test(body.sessionUrl)) job.sessionUrl = body.sessionUrl;
  if (msg) job.log.push({ at: Date.now(), msg });
  job.log = job.log.slice(-40);
  job.updatedAt = Date.now();
  await putJob(env, job);
  return publicJob(job);
}

export async function workerFile(env, job, name, request) {
  const type = FILE_NAMES[name];
  if (!type) fail(400, 'unknown file name');
  const len = Number(request.headers.get('content-length')) || null;
  const blobId = await putBlob(env, len ? request.body : await request.arrayBuffer(), type, { name, size: len });
  job.files[name] = blobId;
  job.updatedAt = Date.now();
  await putJob(env, job);
  return { blobId };
}

export async function workerComplete(env, job, body) {
  job.status = 'done';
  job.stage = 'done';
  job.notes = String(body.notes || '').slice(0, 4000);
  job.report = body.report && typeof body.report === 'object' ? body.report : null;
  job.log.push({ at: Date.now(), msg: 'Finished' });
  job.updatedAt = Date.now();
  let version = null;
  if (job.kind !== 'ping' && job.projectId && job.files['composition.html']) {
    const key = 'versions:' + job.projectId;
    const versions = (await getJSON(env, key)) || [];
    const v = versions.reduce((m, x) => Math.max(m, x.v), 0) + 1;
    version = {
      v,
      jobId: job.id,
      kind: job.kind,
      instruction: job.instruction,
      sceneId: job.sceneId,
      createdAt: Date.now(),
      files: { ...job.files },
      notes: job.notes,
      duration: Number(body.duration) || null,
      textsUsed: body.textsUsed && typeof body.textsUsed === 'object' ? body.textsUsed : null,
      styleKey: String(body.styleKey || '').slice(0, 200),
    };
    versions.push(version);
    await putJSON(env, key, versions.slice(-40));
    job.version = v;
  }
  await putJob(env, job);
  return { job: publicJob(job), version };
}

export async function workerFail(env, job, body) {
  job.status = 'failed';
  job.stage = 'failed';
  job.error = String(body.reason || 'unknown error').slice(0, 1000);
  job.log.push({ at: Date.now(), msg: 'Failed: ' + job.error });
  job.updatedAt = Date.now();
  await putJob(env, job);
  return publicJob(job);
}
