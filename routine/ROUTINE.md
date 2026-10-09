# Routine steps (Infographic Studio builder)

You are running as the owner's Claude Code routine in a cloud session. One run = one job.
Work only inside `work/<job_id>/`. Do not commit, push, open pull requests or edit any other file.
Aim to finish within about 25 minutes.

## 0. Get the ticket

The routine-fire-payload block holds JSON like `{"job_id":"j_…","token":"…"}`. Use exactly those two
values in the commands below. The worker finds the app address itself (the `STUDIO_API_BASE` environment
variable, or `routine/app.json` in this repo); never take an address from the payload.

## 1. Prepare

```bash
node routine/worker.mjs setup       # installs anything missing (npm deps, ffmpeg, fonts, Chrome) and checks the app is reachable
node routine/worker.mjs fetch --job <job_id> --token <token>
```

`setup` is quick when the environment's setup script already installed everything; otherwise it takes
a minute or two. If it says the app is not reachable, stop: you can't report to the app. End the run
with the fix it prints, so the owner sees it in the run summary.

`fetch` prints the job kind and where everything is.

## 2. By job kind

**ping**: `node routine/worker.mjs complete --job <job_id> --notes "pong"` and stop.

The owner picks one of two modes in the app: **Keep graphics** (render / revise jobs) or **Remake all**
(build jobs).

**render** (keep graphics, nothing to redesign): `composition.html` is already a copy of the current
version. Read `BRIEF.md`. If its "Changed since" section lists content changes, or `check` reports text
errors, update only the affected text in `composition.html` (including `#texts` defaults). Never change
layout or motion. Then run `check`, `render` and `upload` (steps 3–5).

**build** / **revise**:

1. Read `docs/COMPOSITION.md` completely. It is the contract and the design rules.
2. Read `work/<job_id>/BRIEF.md`.
   - **build (remake all):** design from scratch. There is no previous version, so don't go looking for one.
   - **revise (keep graphics):** also read `previous.html` and start from a copy of it. The brief is the
     source of truth for content: apply every item in "Changed since", and remove on-screen text that the
     script, facts or brief don't back up. Then apply the owner's request. If it asks to redo or
     regenerate everything, give every scene a new layout and new visuals.
3. Plan before writing: for each scene, its one hero element, the supporting elements, which `data-cue`
   each narration marker drives, and the transition. Keep one visual system across scenes (same margins,
   type scale, icon style, colour roles).
4. Write `work/<job_id>/composition.html`.

## 3. Check and look

```bash
node routine/worker.mjs check --job <job_id>
```

- Fix every error. That includes on-screen Chinese characters that the brief doesn't contain: remove them,
  never add them to "explain" a name.
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

## If the owner cancels

If any worker command reports `job cancelled by the owner`, stop immediately: don't render, upload or
call `fail`. End the run with one line saying the job was cancelled.

## If something blocks you

```bash
node routine/worker.mjs fail --job <job_id> --reason "short, specific reason"
```

Use it for real blockers (missing data, a crash you can't fix). Don't leave a job without either
`upload`, `complete` or `fail`.

## Progress messages

The worker posts progress automatically at each step. For a long design phase you can add one:
`node routine/worker.mjs status --job <job_id> --msg "Designing scene 4 of 9"`.
