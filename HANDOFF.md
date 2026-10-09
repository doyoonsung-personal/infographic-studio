# Infographic Studio — morning handoff (2026-10-09)

**App:** https://infographic-studio.pages.dev · password = `APP_PASSWORD` in [.dev.vars](.dev.vars) (same value is set in Cloudflare)
**Repo:** github.com/doyoonsung-personal/infographic-studio (public — no secrets in it) · **Code:** `C:\Users\mendo\Documents\InfographicStudio`

## Where things stand

| Part | Status |
|---|---|
| Web app (canvas, chat, inspector, admin, KO/EN, phone layout) | ✅ deployed and checked on the live site |
| Qwen3.8: brief, web research (streamed), script, palettes, chat agent with tools | ✅ tested end to end on the live site |
| Renderer: frame checks, contact sheets, MP4, audio mix with ducking, PNG/PDF for still pages | ✅ tested on this PC (Edge + ffmpeg) |
| **Sample**: project "한국 1인 가구 증가 추이" → v1, 49.6 s MP4 from real researched facts | ✅ on the live app (built by me locally via a manual job) |
| Claude routine (cloud build) | ⚠ **needs one settings fix from you** (below) |
| ElevenLabs narration / music | ⚠ wired, **not yet run** (no credits spent overnight) |

## 1. Fix the routine (5 min) — the one blocker

The test ping reached your routine **"Infographic Maker"**, but its cloud environment has no network access to the app,
no setup script and no variables, and it ran on Sonnet 5.5. (Run log: the worker couldn't find the app address.)
I already made the app address come from the repo (`routine/app.json`), so what's left is network access:

1. claude.ai/code/routines → **Infographic Maker** → Edit → click the environment (cloud icon under Instructions) → ⚙ settings.
2. **Network access → Custom**, Allowed domains: `infographic-studio.pages.dev`, keep **"Also include default list"** ticked.
3. Environment variables (optional but recommended): `STUDIO_API_BASE=https://infographic-studio.pages.dev`
4. Setup script (optional — makes every run ~1–2 min faster): paste [routine/setup.sh](routine/setup.sh). Without it the worker installs ffmpeg/fonts/Chrome itself each run.
5. In the routine's Instructions box, set the model to **Opus 5.5** (design quality). Optionally paste the updated [routine/ROUTINE_PROMPT.md](routine/ROUTINE_PROMPT.md).
6. Delete the older unused routine **"Infographic Studio builder"** (it has no repo attached).

I can do steps 3/5 for you through the routines API if you'd like — say so; I didn't change your routine without asking.

**Then test:** app → ⚙ Admin → **루틴 테스트 (ping)**. Expect "Routine connected to the app" → "Finished" within ~2 min.
If it stalls, the app now says so after 12 min, and I can read the run log for you.

## 2. Try the full flow

1. Open the sample project → **보이스** node → turn on 보이스 사용 → pick a voice → **모든 장면 보이스 생성** (ElevenLabs credits).
2. **음악** node → turn on → pick a style → **음악 생성** (credits).
3. **Claude 빌드** node → **현재 수정으로 다시 렌더** (keeps the design, adds voice + music, re-times to the narration) — or **수정 요청** with a note.
4. Or start fresh from the home page: type a topic → the brief fills itself → 리서치 (≈2–3 min) → 스크립트 쓰기 (≈30 s) → style/voice/music → Claude로 빌드.

## 3. ElevenLabs key

- Fixed 2026-10-09: the app now uses an unrestricted `sk_…` key (the first one was restricted to TTS only, which is why music got a 401).
  Admin → "ElevenLabs에서 불러오기" now lists your 58 account voices.
- The 9 seeded voices are mostly Voice Library voices; if one fails with "voice not found", add it to My Voices in ElevenLabs.
- **Emotion/tone tags:** 보이스 → 음성 모델. Choosing Eleven v4 or v3 offers to add tags like `[warmly]`, `[short pause]` to the narration
  (words and cues stay unchanged; tags are editable in the script). Choosing any other model removes them (restorable via 이전 버전).

## Spend tonight

- Qwen: roughly **$0.5–0.8** (research runs, scripts, chat tests) — under the $1 cap.
- Claude routine: **1 ping** (stopped after 11 s). ElevenLabs: **0**.

## How it works (short)

- **Cloudflare Pages** hosts the app (`public/`) and the backend (`functions/` → `server/`); data in Workers KV.
- **Build** = the app fires your routine with `{job_id, token}` → the routine runs `routine/worker.mjs`
  (`setup → fetch → design composition → check (lint + contact sheets it looks at) → render → upload`) → new version appears.
- The **same runtime** (`public/runtime/stage.js`) draws the live preview and the final MP4, so text/colour edits preview instantly; **다시 렌더** bakes them into the file.
- **Fallback:** Claude 빌드 → "고급: 이 PC에서 직접 빌드" creates a manual job and gives you text to paste into Claude Code on this PC.
- Dev notes: [CLAUDE.md](CLAUDE.md). Design contract for the builder: [docs/COMPOSITION.md](docs/COMPOSITION.md).

## Changing things

- **Password:** Cloudflare dashboard → Workers & Pages → infographic-studio → Settings → Variables and Secrets → `APP_PASSWORD`,
  then Deployments → Retry deployment (secrets apply on the next deploy). Or edit `.dev.vars` and run
  `powershell -ExecutionPolicy Bypass -File scripts\set-secrets.ps1` (press Enter at the other prompts), then ask me to redeploy.
- **Voices, music styles, palettes, models:** ⚙ Admin in the app (chat = qwen3.8-max, research = qwen3.8-flash, script = qwen3.8-max).
- **Deploy after code changes:** `node scripts/push.mjs "msg"` then `npx wrangler pages deploy --project-name infographic-studio --branch main` (see CLAUDE.md).

## Known limits / ideas for next

- Not verified yet: ElevenLabs TTS/music calls, the cloud routine end to end, Chrome/ffmpeg install inside the cloud session.
- Research takes 2–3 minutes (Qwen searches several times); progress shows in the 팩트 node.
- KV free plan: files ≤ 25 MB (videos are capped at ~24 MB by the renderer), 1,000 writes/day.
- Ideas: image generation for scene assets (Qwen-Image), 9:16 re-composition of an existing build, per-scene re-renders.
