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
- **Two modes for a new version** (step 7):
  - **그래픽 유지 (Keep graphics):** a `render` job, or a `revise` job when there's a request or the brief/facts/script changed since the version. The worker gets `previous.html` plus a "Changed since vN" list built from that version's job snapshot.
  - **전부 새로 만들기 (Remake all):** a `build` job. It never gets the previous composition, because given one, Claude copied it byte for byte.
  - Each version stores a `contentKey` (`contentKey()` in `public/js/timeline.js`), so the app can show when the content has moved on.
- **Collage look (Vox-style)**, added 2026-10-09:
  - **Style → 룩 (look):** sets `style.look = 'collage'` and the paper palette. The stage gets paper texture and moving grain. Claude designs with the collage toolkit (`docs/COMPOSITION.md`) and follows `docs/looks/collage.md`.
  - **Step 5 컷아웃 (Cut-outs):** Qwen plans subjects per scene, and Qwen-Image draws each one on flat green. `public/js/cutout.js` then keys it out in the browser (flood fill from the border, de-spill) and saves a WebP with alpha. Compositions use `<img data-asset="id">`.
  - **Moving backgrounds:** any background image can be animated with HappyHorse 1.1 i2v or Wan 2.7 i2v (`server/video.js`, async task + poll; clip stored in KV). The preview gets the video bytes by postMessage. The worker cuts each clip into JPEG frames, and the runtime shows the exact frame for each t (`stageSettle()`).
  - **Costs** (2026-10-09 catalog): cut-out about $0.03–0.04 each; clip $0.14/s at 720P (HappyHorse), so a 6 s clip is about $0.84.
  - **Tests:** `test/local-collage.mjs` (free, synthetic). `test/e2e-collage.mjs` and `test/e2e-collage-build.mjs` are paid, live-app end-to-end tests. Test project: p_Su-4X_Z_eBSK.
- **My own photos in cut-outs** (내 사진 올리기), added 2026-10-10: for real people or products that can't be generated.
  - Upload from the Cut-outs panel (button, per-scene button, or drop on a scene card). The original is kept (JPEG ≤ 2400 px), so the cut-out can be redone.
  - **Modes**, all on the device, free, never redrawn:
    - **인물 컷아웃 (Person):** MODNet portrait matting. 25 MB model on first use, about 2 s per photo after that.
    - **사물 컷아웃 (Object):** keys out a plain backdrop (white wall, plain cloth) instantly. It refuses busy backgrounds with a message.
    - **사진 그대로 (Photo as is):** keeps the rectangle.
  - **Looks:** 원본 색 (original) / 흑백 망점 (halftone) / 빛바랜 컬러 (faded), so a real photo sits with collage cut-outs.
  - The build brief marks these as the owner's photos: never cover a face, never flip a person or a label.
  - A general object model (BiRefNet) was tried and dropped: it ran out of browser memory and exceeded the GPU limits on this laptop.
- **KV writes** (2026-10-10, after a 90% warning: 937 of 1,000 on Oct 9):
  - Autosave waits for 4 s of quiet (at most 15 s), skips unchanged saves, and saves when the tab is hidden.
  - Build progress lines in the same stage are stored at most every 30 s.
  - Uploaded build files no longer rewrite the job record.
- **Fallback:** Claude 빌드 → "고급: 이 PC에서 직접 빌드" creates a manual job and gives you text to paste into Claude Code on this PC.
- Dev notes: [CLAUDE.md](CLAUDE.md). Design contract for the builder: [docs/COMPOSITION.md](docs/COMPOSITION.md).

## Changing things

- **Password:** Cloudflare dashboard → Workers & Pages → infographic-studio → Settings → Variables and Secrets → `APP_PASSWORD`,
  then Deployments → Retry deployment (secrets apply on the next deploy). Or edit `.dev.vars` and run
  `powershell -ExecutionPolicy Bypass -File scripts\set-secrets.ps1` (press Enter at the other prompts), then ask me to redeploy.
- **Voices, music styles, palettes, models:** ⚙ Admin in the app (chat = qwen3.8-max, research = qwen3.8-flash, script = qwen3.8-max).
- **Deploy after code changes:** `node scripts/push.mjs "msg"` then `npx wrangler pages deploy --project-name infographic-studio --branch main` (see CLAUDE.md).

## Known limits / ideas for next

- The cloud routine works end to end as of 2026-10-09 (project p_sVkbiB20ZaJB, v1–v5).
- `check` fails on on-screen Chinese characters that aren't in the brief/script/facts (ko/en projects).
- Research takes 2–3 minutes (Qwen searches several times); progress shows in the 팩트 node.
- KV free plan: files ≤ 25 MB (videos are capped at ~24 MB by the renderer), 1,000 writes/day (resets 09:00 KST).
- Ideas: image generation for scene assets (Qwen-Image), 9:16 re-composition of an existing build, per-scene re-renders.
