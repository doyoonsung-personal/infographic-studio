# Infographic Studio

Personal web app for making infographics (animated videos or still pages) from a topic.

- **Routine run (cloud)?** You are the builder. Read `routine/ROUTINE.md` and follow it; the design
  contract is `docs/COMPOSITION.md`. Work only in `work/<job_id>/`; never commit or push.
- **Developing the app?** Read on.

## Architecture

| Part | Where | What |
|---|---|---|
| Web app | `public/` (static, no build step) | Vanilla JS ES modules. `js/app.js` routes `#/`, `#/p/<id>`, `#/admin`. |
| Backend | `functions/api/[[path]].js` → `server/*.js` | Cloudflare Pages Functions. Auth (APP_PASSWORD cookie), projects, blobs, Qwen proxy, ElevenLabs, jobs. Storage: Workers KV `STUDIO_KV`. |
| Builder | `routine/` | The owner's Claude Code routine runs `routine/worker.mjs` in Claude's cloud: fetch job → write composition → check frames → render MP4 (headless Chrome + ffmpeg) → upload. |
| Shared | `public/js/timeline.js`, `assemble.js`, `lint.js`, `public/runtime/stage.js` | Used by both the browser preview and the cloud renderer, so they draw identical frames. |

Flow: the browser POSTs `/api/jobs` → the backend fires the routine (`ROUTINE_FIRE_URL` + `ROUTINE_TOKEN`)
with `{job_id, token}` → the routine calls `/api/worker/...` with the per-job token → the app polls the job.

## Secrets (Cloudflare Pages project `infographic-studio`)

`APP_PASSWORD`, `DASHSCOPE_API_KEY`, `DASHSCOPE_BASE_URL`, `ELEVENLABS_API_KEY`, `ROUTINE_FIRE_URL`,
`ROUTINE_TOKEN`. Locally: `.dev.vars` (gitignored) plus env vars passed by `scripts/dev.ps1`.

## Commands (Windows dev machine)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\dev.ps1          # local server on :8788 (local KV)
node test/ui-shot.mjs work/ui /p/<id>                              # UI screenshots with headless Edge
node --test "test/*.test.mjs"                                      # unit tests (a bare directory fails)
node test/local-upload.mjs <photo> person,object,photo --look none,halftone   # "Upload my photo" in the UI (free)
node scripts/push.mjs "message"                                    # push working tree to GitHub (GITHUB_TOKEN)
npx wrangler pages deploy --project-name infographic-studio --branch main   # deploy (CLOUDFLARE_* env)
```

Portable Node lives in `.tools/` (gitignored); ffmpeg via `FFMPEG_PATH`.

## Conventions

- Match the surrounding style: small modules, `h()` DOM helper, no framework, no bundler.
- Compositions must stay deterministic (see `public/js/lint.js`); never add real-time APIs to the runtime.
- KV free plan: 25 MiB per value, 1,000 writes/day (resets 09:00 KST) — keep blobs under 24.5 MB and
  count writes when adding a feature. Current budget savers: project autosave waits for 4 s of quiet
  (at most 15 s), skips unchanged bodies and flushes when the tab is hidden; the worker's same-stage
  status lines are stored at most every 30 s; build files go under fixed ids (`fileBlobId`) and are
  collected with one KV list at completion instead of rewriting the job per file.
- Owner photo cut-outs run in the browser: `segment-worker.js` (MODNet, WASM only — WebGPU gave a broken
  matte on Intel Arc) for people, `plainKey()` in `cutout.js` for objects on plain backgrounds.
