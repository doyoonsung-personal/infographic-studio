# Routine steps (Infographic Studio builder)

You are running as the owner's Claude Code routine in a cloud session. One run = one job.
Work only inside `work/<job_id>/`. Do not commit, push, open pull requests or edit any other file.
Aim to finish within about 25 minutes.

## 0. Get the ticket

The routine-fire-payload block holds JSON like `{"job_id":"j_…","token":"…"}`. Use exactly those two
values in the commands below. The app address is the `STUDIO_API_BASE` environment variable; if it is
missing, stop (you can't report back without it).

## 1. Prepare

```bash
node --version                      # 22.x is fine
test -d node_modules || npm ci --omit=dev --no-audit --no-fund
node routine/worker.mjs fetch --job <job_id> --token <token>
```

`fetch` prints the job kind and where everything is. If it fails with a network error, the environment
probably doesn't allow the app's domain: report nothing further (you can't reach the app) and end the
run with a clear message in the transcript.

## 2. By job kind

**ping**: `node routine/worker.mjs complete --job <job_id> --notes "pong"` and stop.

**render** (owner changed text or colours and wants a new video): `composition.html` is already in place.
Run `check`, then `render`, then `upload` (steps 4–6). Don't redesign anything.

**build** / **revise**:

1. Read `docs/COMPOSITION.md` completely. It is the contract and the design rules.
2. Read `work/<job_id>/BRIEF.md`. For **revise**, also read `previous.html`, start from a copy of it and
   change only what the request asks.
3. Plan before writing: for each scene, its one hero element, the supporting elements, which `data-cue`
   each narration marker drives, and the transition. Keep one visual system across scenes (same margins,
   type scale, icon style, colour roles).
4. Write `work/<job_id>/composition.html`.

## 3. Check and look

```bash
node routine/worker.mjs check --job <job_id>
```

- Fix every error.
- **Open and look at** `work/<job_id>/out/contact.jpg` and `out/entries.jpg` with the Read tool. Judge
  each scene: is the hero obvious, is anything clipped/overlapping/too small/off-frame, is a frame
  empty, does it match the style of the other scenes, would the owner be proud to post it?
- Fix and re-run `check`. Two or three rounds is normal; stop when it is clean and good.

## 4. Render

```bash
node routine/worker.mjs render --job <job_id>
```

Animated jobs produce `out/video.mp4` (with narration/music mixed in) and `out/poster.jpg`; static jobs
produce `out/image.png`, `out/document.pdf` and `out/poster.jpg`.

## 5. Upload

```bash
node routine/worker.mjs upload --job <job_id> --notes "2–4 sentences: what you made, any compromise, anything the owner should check"
```

The app shows the new version immediately after this.

## If something blocks you

```bash
node routine/worker.mjs fail --job <job_id> --reason "short, specific reason"
```

Use it for real blockers (missing data, a crash you can't fix). Don't leave a job without either
`upload`, `complete` or `fail`.

## Progress messages

The worker posts progress automatically at each step. For a long design phase you can add one:
`node routine/worker.mjs status --job <job_id> --msg "Designing scene 4 of 9"`.
