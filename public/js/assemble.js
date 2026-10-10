// Turns a composition fragment (what Claude writes) into a full, self-contained HTML document.
// Shared by the app's preview player and the routine's renderer, so both draw identical frames.

export const FONT_STACKS = {
  sans: "'Noto Sans KR','Noto Sans CJK KR','Pretendard','Apple SD Gothic Neo','Malgun Gothic',system-ui,sans-serif",
  serif: "'Noto Serif KR','Noto Serif CJK KR','AppleMyungjo','Batang',Georgia,serif",
  display: "'Black Han Sans','Noto Sans KR','Noto Sans CJK KR','Malgun Gothic',sans-serif",
  mono: "'JetBrains Mono','Noto Sans Mono CJK KR','D2Coding',Consolas,monospace",
};

const FONT_LINK =
  'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700;900' +
  '&family=Noto+Serif+KR:wght@400;700;900&family=Black+Han+Sans&family=JetBrains+Mono:wght@400;700&display=block';

export const DEFAULT_COLORS = {
  bg: '#0f1420',
  surface: '#1a2133',
  text: '#f2f4f8',
  muted: '#9aa4b8',
  accent: '#ff7a1a',
  accent2: '#3ec6ff',
  accent3: '#9b7bff',
};

/**
 * Identifies the pictures a render was made with (colours, font, background images and clips, cut-out
 * images), so the app can tell when a re-render would change the video.
 */
export function styleKey(style, assets, extras) {
  const st = style || {};
  const c = st.colors || {};
  const keys = Object.keys(c).sort();
  const out = { c: keys.map((k) => [k, c[k]]), f: st.font || 'sans' };
  const bg = st.background || {};
  if (bg.mode === 'image') {
    const im = bg.images || {};
    out.b = { s: bg.strength ?? 0.45, i: Object.keys(im).sort().map((k) => im[k] && im[k].clip ? [k, im[k].blobId, im[k].clip.blobId] : [k, im[k] && im[k].blobId]) };
  }
  const made = ((assets && assets.items) || []).filter((a) => a.blobId);
  if (made.length) out.a = made.map((a) => [a.id, a.blobId]);
  // Sound effects are added at render time, so switching them changes the file but not the design.
  const fx = extras && extras.sfx;
  if (fx && fx.enabled) out.x = [fx.auto !== false ? 1 : 0, fx.volume ?? 1];
  return JSON.stringify(out);
}

/** Which image keys a project's background needs: 'all' for one shared image, else one per scene. */
export function backgroundKeys(project) {
  const bg = (project.style && project.style.background) || {};
  if (bg.mode !== 'image') return [];
  const isStatic = project.brief && project.brief.format === 'static';
  if (bg.scope === 'single' || isStatic) return ['all'];
  return ((project.script && project.script.scenes) || []).map((s) => s.id);
}

/* ---------- collage toolkit textures (used by the classes in COLLAGE_CSS) ---------- */
function svgUrl(svg) { return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`; }

// Paper: fine fibres plus slow mottling, as a tiling SVG noise. Grain: finer, stronger, for film grain.
const PAPER = svgUrl("<svg xmlns='http://www.w3.org/2000/svg' width='360' height='360'>" +
  "<filter id='f'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .32 0 0 0 0 .27 0 0 0 0 .2 0 0 0 .11 0'/></filter>" +
  "<filter id='m'><feTurbulence type='fractalNoise' baseFrequency='.012' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .45 0 0 0 0 .37 0 0 0 0 .25 0 0 0 .16 0'/></filter>" +
  "<rect width='100%' height='100%' filter='url(#m)'/><rect width='100%' height='100%' filter='url(#f)'/></svg>");
const GRAIN = svgUrl("<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'>" +
  "<filter id='g'><feTurbulence type='fractalNoise' baseFrequency='1.7' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .2 0 0 0 0 .18 0 0 0 0 .15 0 0 0 .55 -.12'/></filter>" +
  "<rect width='100%' height='100%' filter='url(#g)'/></svg>");

/** A torn-paper mask: a rectangle whose four edges are jagged (deterministic). */
function tornMask() {
  let s = 20261009;
  const r = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1000) / 1000; };
  const pts = [];
  // Walk each side; d is how far the tear bites inward (0.4–1.7% of the side).
  const edge = (at, n) => { for (let i = 0; i <= n; i++) pts.push(at(i / n, 4 + r() * 13)); };
  edge((p, d) => [p * 1000, d], 70);                 // top, left to right
  edge((p, d) => [1000 - d, p * 1000], 50);          // right, top to bottom
  edge((p, d) => [1000 - p * 1000, 1000 - d], 70);   // bottom, right to left
  edge((p, d) => [d, 1000 - p * 1000], 50);          // left, bottom to top
  const d = 'M' + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L') + 'Z';
  return svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1000 1000' preserveAspectRatio='none'><path d='${d}' fill='white'/></svg>`);
}
const TORN = tornMask();

// Classes and attributes of the collage toolkit (docs/COMPOSITION.md, "Collage toolkit"). Always
// available; the collage look (#stage[data-look=collage]) also gives the stage paper and moving grain.
const COLLAGE_CSS = `
:root{--paper:${PAPER};--grain:${GRAIN};--torn:${TORN}}
#stage[data-look=collage]{background-image:var(--paper)}
#stage[data-look=collage]::after,.c-grain{content:"";position:absolute;inset:-300px;z-index:60;pointer-events:none;background-image:var(--grain);opacity:.55;mix-blend-mode:multiply;translate:var(--grain-x,0px) var(--grain-y,0px)}
.c-grain{z-index:auto}
.c-paper{background-color:var(--surface);background-image:var(--paper)}
.c-halftone{background-image:radial-gradient(circle,color-mix(in srgb,var(--text) 30%,transparent) 1.4px,transparent 1.8px);background-size:10px 10px}
.c-cutout{filter:drop-shadow(5px 0 0 #fff) drop-shadow(-5px 0 0 #fff) drop-shadow(0 5px 0 #fff) drop-shadow(0 -5px 0 #fff) drop-shadow(9px 14px 10px rgba(0,0,0,.32))}
.c-shadow{filter:drop-shadow(0 12px 14px rgba(0,0,0,.28))}
.c-torn{-webkit-mask-image:var(--torn);mask-image:var(--torn);-webkit-mask-size:100% 100%;mask-size:100% 100%}
.c-tape{position:relative}
.c-tape::before{content:"";position:absolute;left:50%;top:-18px;width:min(46%,170px);height:38px;translate:-50% 0;rotate:-3deg;background:color-mix(in srgb,#efe6c8 74%,transparent);box-shadow:0 1px 3px rgba(0,0,0,.16);z-index:3}
.c-clipping{position:relative;background-color:#fbf8f0;background-image:var(--paper);color:#1d1b18;font-family:'Noto Serif KR','Noto Serif CJK KR',Georgia,serif;padding:30px 38px;-webkit-mask-image:var(--torn);mask-image:var(--torn);-webkit-mask-size:100% 100%;mask-size:100% 100%}
.c-label{display:inline-block;background:var(--text);color:var(--bg);padding:.1em .38em .14em;font-weight:900;line-height:1.1;box-shadow:6px 7px 0 rgba(0,0,0,.18)}
.c-marker{fill:none;stroke:var(--accent2);stroke-width:7;stroke-linecap:round;stroke-linejoin:round}
[data-ambient]{position:absolute;inset:0;overflow:hidden;pointer-events:none}
[data-hl]{background-image:linear-gradient(100deg,transparent .15em,color-mix(in srgb,var(--accent) 88%,transparent) .3em calc(100% - .2em),transparent calc(100% - .05em));background-repeat:no-repeat;background-position:0 78%;background-size:0% 46%;-webkit-box-decoration-break:clone;box-decoration-break:clone}
`;

function esc(s) {
  return String(s).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * @param {string} fragment  composition HTML (styles + .scene sections + optional #texts JSON + hooks)
 * @param {object} o
 *   runtime  - source of public/runtime/stage.js (required)
 *   timeline - from computeTimeline()
 *   colors   - {bg, surface, text, muted, accent, accent2, accent3}
 *   font     - key of FONT_STACKS or a CSS font-family list
 *   texts    - text overrides {key: value}
 *   images   - background images {sceneId | 'all': url (data: URI)}; omit for colours only
 *   bgStrength - how visible the background images are, 0..1 (default 0.45)
 *   look     - 'collage' gives the stage paper texture and moving film grain; anything else: plain
 *   assets   - cut-out images {assetId: url} for <img data-asset="id">
 *   clips    - moving backgrounds {sceneId | 'all': {dur, frames?, n?, fps?}}: with frames (renderer) the
 *              runtime shows numbered JPEGs; without (preview) it plays a video the player sends in
 *   extras   - the owner's extra-feature switches {sfx, ambient, camera, gsap} (see project.extras)
 *   libs     - library source inlined before the runtime (GSAP, when the composition uses it)
 *   webFonts - include the Google Fonts link (default true)
 */
export function assembleDocument(fragment, o = {}) {
  const tl = o.timeline || { width: 1920, height: 1080, duration: 0, scenes: [], static: false };
  const W = tl.width || 1920;
  const H = tl.height || 1080;
  const colors = Object.assign({}, DEFAULT_COLORS, o.colors || {});
  const font = FONT_STACKS[o.font] || o.font || FONT_STACKS.sans;
  const vars = Object.entries(colors).map(([k, v]) => `--${k}:${v};`).join('');
  const look = o.look === 'collage' ? 'collage' : '';
  const cfg = {
    timeline: tl, colors, font, texts: o.texts || {}, images: o.images || {}, bg: { strength: o.bgStrength ?? 0.45 },
    look, assets: o.assets || {}, clips: o.clips || {}, extras: o.extras || {},
  };
  const fontsLink = o.webFonts === false ? '' :
    `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${FONT_LINK}">`;

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=${W}">
${fontsLink}
<style>
:root{${vars}--font:${font};--W:${W}px;--H:${H}px;}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--bg);width:${W}px;height:${H}px;overflow:hidden}
#stage{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:var(--bg);color:var(--text);font-family:var(--font);-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision;font-kerning:normal;word-break:keep-all;overflow-wrap:break-word}
#stage .scene{position:absolute;inset:0;overflow:hidden;isolation:isolate}
#stage svg{overflow:visible}
${COLLAGE_CSS}
</style>
<script>window.STAGE=${esc(JSON.stringify(cfg))};</script>
</head><body><div id="stage"${tl.static ? ' data-static' : ''}${look ? ` data-look="${look}"` : ''}>
${fragment}
</div>
${o.libs ? `<script>${o.libs}</script>\n` : ''}<script>${o.runtime || ''}</script>
</body></html>`;
}

/** Does a composition drive GSAP timelines (so the document needs the GSAP bundle)? */
export function usesGsap(fragment) {
  return /STAGE_TIMELINES|\bgsap\.|SplitText|MorphSVGPlugin|DrawSVGPlugin|MotionPathPlugin|CustomEase/.test(String(fragment || ''));
}
