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

/** Identifies the colours + font a render was made with, so the app can tell when it is stale. */
export function styleKey(style) {
  const st = style || {};
  const c = st.colors || {};
  const keys = Object.keys(c).sort();
  const out = { c: keys.map((k) => [k, c[k]]), f: st.font || 'sans' };
  const bg = st.background || {};
  if (bg.mode === 'image') {
    const im = bg.images || {};
    out.b = { s: bg.strength ?? 0.45, i: Object.keys(im).sort().map((k) => [k, im[k] && im[k].blobId]) };
  }
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
 *   webFonts - include the Google Fonts link (default true)
 */
export function assembleDocument(fragment, o = {}) {
  const tl = o.timeline || { width: 1920, height: 1080, duration: 0, scenes: [], static: false };
  const W = tl.width || 1920;
  const H = tl.height || 1080;
  const colors = Object.assign({}, DEFAULT_COLORS, o.colors || {});
  const font = FONT_STACKS[o.font] || o.font || FONT_STACKS.sans;
  const vars = Object.entries(colors).map(([k, v]) => `--${k}:${v};`).join('');
  const cfg = { timeline: tl, colors, font, texts: o.texts || {}, images: o.images || {}, bg: { strength: o.bgStrength ?? 0.45 } };
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
</style>
<script>window.STAGE=${esc(JSON.stringify(cfg))};</script>
</head><body><div id="stage"${tl.static ? ' data-static' : ''}>
${fragment}
</div>
<script>${o.runtime || ''}</script>
</body></html>`;
}
