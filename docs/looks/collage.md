# Look: editorial paper collage (Vox-style)

The feel of modern explainer videos: real-world pictures cut out of magazines and newspapers, stuck onto
paper with tape, annotated with a highlighter and a red marker, slightly imperfect and tactile. The facts
stay crisp and exact; the craft is in the layering.

Use the classes and attributes in "Collage toolkit" and "Cut-out pictures" in docs/COMPOSITION.md.

## What every scene has

- **A paper ground.** The stage already has a paper texture and moving film grain. Add one or two large
  torn paper pieces (`.c-paper.c-torn`, in `var(--surface)` or a flat colour block in `var(--accent3)`
  at 85–100%) behind the hero, slightly rotated (−3° to 3°), wrapped in `.c-shadow`.
- **One hero.** Either a cut-out picture (`<img data-asset class="c-cutout">`) large enough to read
  (35–60% of the frame height), or one big number set in heavy type on a `.c-label` or a torn piece.
- **One or two supporting pieces.** A newspaper clipping with the fact and its source (`.c-clipping`, serif,
  the key phrase in `<span data-hl>`), a small cut-out, a strip of tape, a marker circle around the number.
- **Text on paper, never floating on the photo.** Titles on `.c-label` strips or torn pieces; body text on
  clippings. Keep the house typeface for headlines (`var(--font)`, weight 800–900) and serif for clippings.

## Motion

- Pieces arrive like hands placing them: `data-a="pop"` or `data-a="down"` with a small `data-dist`
  (20–40 px), staggered 0.15–0.3 s, on the narration cues. Avoid smooth fades for paper.
- Give most pieces a slight constant life: `data-boil="0.6"` to `"1.2"` on cut-outs and labels (not on
  long text), and `data-drift` of 10–40 px on background pieces for parallax (opposite directions for
  front and back layers).
- Highlighter swipes (`data-hl` + `data-cue`) and marker draw-ons (`.c-marker` + `data-draw`) land on the
  spoken word. These are the signature moments; use one or two per scene, not more.
- Transitions: `cut` or `slide` between scenes suits paper better than long fades.

## Colour

The look comes with a paper palette (warm paper `--bg`, off-white `--surface`, ink `--text`, highlighter
yellow `--accent`, marker red `--accent2`, print blue `--accent3`); always use the variables. Cut-outs
stay as they are (black-and-white halftone, colour print or paper craft); flat colour blocks carry the
palette.

## Composition

- Overlap things. A clipping half under a cut-out, tape across two pieces, a label breaking the edge of a
  torn piece. Nothing perfectly aligned to a grid, but keep a clear reading order (hero → number → clip).
- Leave paper showing. 20–35% empty paper keeps it from looking cluttered.
- Keep everything inside the safe area; tilted pieces must not clip at the frame edge.
- Charts become paper too: bars cut from coloured paper (`.c-paper` blocks with `data-grow`), a hand-drawn
  axis (`.c-marker` paths), numbers on labels.

## Don'ts

- No glossy gradients, glassmorphism, neon glows or drop shadows on text.
- No text inside cut-out pictures (they have none) and no invented logos.
- Don't cover moving backgrounds with opaque full-scene paper; use pieces.
