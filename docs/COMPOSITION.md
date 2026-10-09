# Composition contract

A composition is the HTML **fragment** you write to `work/<job>/composition.html`. The stage wraps it in a
full document (fonts, colour variables, the timeline and the runtime in `public/runtime/stage.js`), and the
same document is used for the app's live preview and the final render, so what passes `check` is exactly
what the owner sees.

The runtime draws every frame from `seek(t)`: the picture depends on `t` only. You describe motion with
`data-*` attributes; write JavaScript only for motion the attributes can't express.

## Skeleton

```html
<style>
  /* Scoped by scene classes. Sizes in px for the stage size in BRIEF.md. Colours only via var(--…). */
  .s-title h1 { font-size: 96px; font-weight: 900; color: var(--text); }
</style>

<section class="scene s-title" data-scene="s1" data-transition="fade">
  <div class="wrap">
    <p class="kicker" data-text="s1_kicker" data-in="0.1" data-a="fade">2026 커피 리포트</p>
    <h1 data-text="s1_title" data-cue="1" data-a="up">원두값이 38% 올랐다</h1>
  </div>
</section>

<!-- one section per timeline scene, same ids, same order -->

<script type="application/json" id="texts">
{ "s1_kicker": "2026 커피 리포트", "s1_title": "원두값이 38% 올랐다" }
</script>

<script>
  // Optional custom motion; see "Hooks".
  window.STAGE_HOOKS = {};
</script>
```

Rules for the fragment:

- No `<html>`, `<head>`, `<body>`, `<link>`, external `src`/`href`, `@import`, or remote `url(...)`.
  Everything is inline: shapes, inline SVG icons and illustrations, `data:` URIs if you must.
- Fonts are already loaded: use `font-family: var(--font)` (inherited by default). Weights 300–900 exist for
  the sans font.
- Colours: only `var(--bg) var(--surface) var(--text) var(--muted) var(--accent) var(--accent2) var(--accent3)`.
  Tints are fine: `color-mix(in srgb, var(--accent) 20%, transparent)`, gradients of the variables.
  The owner swaps palettes in the app without a rebuild, so never hard-code hex colours.
- `var(--W)` and `var(--H)` hold the stage size.
- Banned (breaks determinism; `check` fails): `requestAnimationFrame`, `setTimeout`, `setInterval`,
  `Date`, `performance.now`, `Math.random`, `Element.animate`, CSS `@keyframes`/`animation`/`transition`,
  `<video>`, `<audio>`, `<iframe>`, `fetch`, `import`.

## Scenes

- `<section class="scene" data-scene="ID">` for every timeline row, in order. The runtime places each scene
  in its time window (from `timeline.json`) and positions it `absolute; inset: 0`.
- `data-transition`: `fade` (default, 0.5 s crossfade), `cut`, `slide` (pushes left), `zoom`.
- Static jobs: one `<section class="scene" data-scene="page">`. Motion attributes resolve to their final
  state, so you can still use them, but nothing moves.

## Animation attributes

All times are **seconds from the start of the scene**.

| Attribute | Meaning |
|---|---|
| `data-in="0.4"` | when the element enters |
| `data-cue="2"` | enter when narration marker `{2}` is spoken (cue times are in BRIEF.md); `data-delay="0.1"` shifts it |
| `data-a="up"` | entrance: `up` (rises in), `down`, `left` (from the left), `right`, `fade`, `scale`, `pop` (springy), `blur`, `wipe` / `wipe-right`, `wipe-left`, `wipe-up`, `wipe-down`, `none` (just appears). Default `up` |
| `data-d="0.6"` | entrance duration |
| `data-dist="48"` | travel in px for up/down/left/right |
| `data-ease="out"` | `out` (default), `inout`, `back`, `expo`, `elastic`, `linear` |
| `data-out="5.2"` / `data-out-cue="4"` | leave before the scene ends; `data-a-out` = `fade` (default), `up`, `down`, `left`, `right`, `scale`; `data-d-out="0.4"` |
| `data-stagger="0.25"` | on a container: its direct children enter one after another from the container's `data-in`/`data-cue`. `data-child-a` sets their entrance (default `up`) |
| `data-grow="x"` + `data-to="72%"` | bar grows its width (`y`: height) from 0 to the value; `data-d` default 0.9 |
| `data-count="38.5"` | number counts up from `data-from` (0); `data-decimals`, `data-prefix`, `data-suffix="%"`, `data-sep=","`; `data-d` default 1.2 |
| `data-draw` | on SVG `path`/`line`/`polyline`/`circle`: stroke draws itself (`stroke-dasharray` is set for you) |
| `data-type` | typewriter reveal of the element's text |
| `data-loop="float"` | gentle motion after entering: `float`, `pulse`, `spin`, `sway`; `data-speed="1"` |
| `data-ken="1.08"` | slow zoom across the whole scene (backgrounds, illustrations) |
| `data-progress` | width becomes progress 0–100% (inside a scene: through that scene; outside scenes: whole video) |

Elements nested inside an animated element (and with no timing of their own) start with their parent.

The runtime animates with the CSS `opacity`, `translate`, `scale`, `rotate`, `filter` and `clip-path`
properties. You may use `transform` freely for layout (it composes with them), but do not set `translate`,
`scale` or `rotate` yourself on animated elements.

## Editable text

Put every visible sentence, label and headline in the `#texts` JSON and bind it with `data-text="key"`.
The owner edits these in the app and sees the change instantly; keys must be stable (`s3_label_2`, not
random). Counters (`data-count`) and decorative glyphs don't need keys.

## Hooks (custom motion)

```html
<script>
window.STAGE_HOOKS = {
  s4: function (ctx) {
    // ctx.t = seconds into the scene, ctx.len, ctx.T = global time, ctx.el = the section
    // ctx.$ / ctx.$$ query inside the scene, ctx.cue(n), ctx.prog(t, start, dur, ease),
    // ctx.ease.out(p), ctx.lerp(a, b, p), ctx.clamp(x), ctx.rand(seed) -> seeded generator
    var p = ctx.prog(ctx.t, 0.8, 1.6, 'inout');
    ctx.$('.needle').style.rotate = ctx.lerp(-90, 30, p) + 'deg';
  },
  '*': function (ctx) { /* runs every frame for the whole stage */ }
};
</script>
```

A hook must set every property it touches on every call (no state carried between frames), and must only
use `ctx` for time.

## Design rules

These come from the studio's build method; follow them unless the owner asked otherwise.

- **One hero per scene**: a headline, a hero number or one diagram. Everything else supports it.
- **Takeaway first**: the opening scene states the takeaway in plain words; the viewer should get it
  within 3 seconds.
- **Readable at real size** (1080 px short side; scale proportionally for other stages): hero numbers
  160–280 px, headlines 72–110 px, body 36–48 px, labels and sources ≥ 26 px. Never below 24 px.
- **Margins**: keep content inside ~6% of every edge. 9:16: nothing important in the bottom 18% or the
  right 12% (platform UI).
- **Staggered reveals**: 0.2–0.3 s between siblings, entrances 0.5–0.8 s with ease-out. Don't move
  everything at once.
- **No dead air**: something visible within 0.3 s of each scene start (the crossfade covers the rest).
- **Hold text for reading**: after a line lands, leave ≈0.3 s per word (min 1 s) before the scene ends.
- **Sync to narration**: when BRIEF.md lists cues, put `data-cue` on the element each `{n}` refers to, so
  the visual lands on the word.
- **Charts**: label units and axes; bars via `data-grow`, lines via SVG `data-draw`, shares as stacked
  bars or donuts (hook or `data-draw` on a circle), big numbers via `data-count`. Use only numbers from
  BRIEF.md's facts.
- **Meaning never by colour alone**: add labels or icons. Keep contrast high (`--text` on `--bg`).
- **Illustrate, don't decorate**: concrete inline-SVG pictograms (cups, coins, arrows, factories…) beat
  abstract blobs. Flat, geometric, consistent stroke widths.
- **End card**: the takeaway, an "as of <date>" stamp and a one-line source, held fully visible ≥ 3 s.
- **A thin chapter bar** (`data-progress` outside the scenes) helps business explainers.
- Text in the on-screen language from BRIEF.md. Korean: `word-break: keep-all` is already on; keep lines
  short (≈ 18 Korean characters for headlines).

## Before you render

1. `node routine/worker.mjs check --job <id>` passes with no errors.
2. You opened `out/contact.jpg` (each scene at its fullest) and `out/entries.jpg` (each scene 0.35 s in)
   and looked for: clipped or overlapping text, text too small, empty frames, things off the edge,
   inconsistent style between scenes, a takeaway that isn't obvious.
3. Warnings are fixed or knowingly accepted (say which in the upload notes).
