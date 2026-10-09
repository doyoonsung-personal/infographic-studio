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
node --test test/                                                  # unit tests
node scripts/push.mjs "message"                                    # push working tree to GitHub (GITHUB_TOKEN)
npx wrangler pages deploy --project-name infographic-studio --branch main   # deploy (CLOUDFLARE_* env)
```

Portable Node lives in `.tools/` (gitignored); ffmpeg via `FFMPEG_PATH`.

## Conventions

- Match the surrounding style: small modules, `h()` DOM helper, no framework, no bundler.
- Compositions must stay deterministic (see `public/js/lint.js`); never add real-time APIs to the runtime.
- KV free plan: 25 MiB per value, 1,000 writes/day — debounce writes, keep blobs under 24.5 MB.
