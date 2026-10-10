// Static checks on a composition fragment. Errors break determinism or the render; warnings are advice.
// Script rules look only inside <script> code, CSS rules only inside <style>, so on-screen words
// like "import" or "transition" never trip them.

const JS_RULES = [
  [/requestAnimationFrame/, 'requestAnimationFrame is banned: draw everything from seek(t) / data attributes'],
  [/set(Timeout|Interval)\s*\(/, 'setTimeout/setInterval are banned: time comes only from seek(t)'],
  [/\bDate\s*\.\s*now|new\s+Date\s*\(/, 'Date is banned: the frame must depend on t only'],
  [/performance\s*\.\s*now/, 'performance.now is banned'],
  [/Math\s*\.\s*random/, 'Math.random is banned: use ctx.rand(seed) inside a hook'],
  [/\bfetch\s*\(|XMLHttpRequest|\bimport\s*\(|^\s*import\s/m, 'network/module loading is not allowed'],
  [/\.animate\s*\(/, 'Element.animate (Web Animations) runs on real time: banned'],
  // GSAP: timelines are fine (the stage seeks them); anything random or clock-driven is not.
  [/gsap\s*\.\s*utils\s*\.\s*random|["'`]random\(/, 'GSAP random values are banned: use c.rand(seed)'],
  [/delayedCall|ScrollTrigger|gsap\s*\.\s*ticker/, 'GSAP delayedCall / ScrollTrigger / ticker run on real time: put everything on the scene timeline'],
];

const CSS_RULES = [
  [/@keyframes|(^|[;{\s])animation(-name)?\s*:/, 'CSS animations are banned: use data-a / hooks'],
  [/(^|[;{\s])transition(-property|-duration)?\s*:\s*(?!none)/, 'CSS transitions are banned (they run on real time)'],
  [/url\(\s*["']?https?:/i, 'remote url() is not allowed'],
  [/@import/i, '@import is not allowed: web fonts are provided by the stage'],
];

const HTML_RULES = [
  [/<(video|audio|iframe|object|embed)\b/i, '<video>/<audio>/<iframe>/<object> are not allowed'],
  [/<script[^>]+\bsrc\s*=/i, 'external scripts are not allowed: everything must be inline'],
  [/<link\b/i, '<link> is not allowed: web fonts are provided by the stage'],
  [/\s(src|href|xlink:href)\s*=\s*["']https?:/i, 'remote images/links are not allowed: inline SVG or data: URIs only'],
  [/<html|<head|<body|<!doctype/i, 'write a fragment, not a full document (no <html>/<head>/<body>)'],
  [/\sid\s*=\s*["']stage["']/, 'do not create #stage: the fragment is placed inside it'],
];

const WARN_RULES = [
  [/style\s*=\s*["'][^"']*(^|[;\s])(translate|scale|rotate)\s*:/i, 'individual translate/scale/rotate properties are owned by the runtime on animated elements'],
  [/font-size\s*:\s*(1\d|[0-9])(\.\d+)?px/i, 'very small font-size (<20px) is hard to read in a video'],
];

function blocks(src, tag) {
  const re = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  return [...src.matchAll(re)].map((m) => ({ attrs: m[1], body: m[2] }));
}

export function lintComposition(fragment) {
  const errors = [];
  const warnings = [];
  const src = String(fragment || '');
  if (!src.trim()) errors.push('composition is empty');

  const scripts = blocks(src, 'script').filter((b) => !/type\s*=\s*["']application\/json["']/i.test(b.attrs));
  const js = scripts.map((b) => b.body).join('\n;\n');
  const css = blocks(src, 'style').map((b) => b.body).join('\n') +
    '\n' + [...src.matchAll(/\sstyle\s*=\s*"([^"]*)"/gi)].map((m) => m[1]).join(';\n');

  for (const [re, msg] of JS_RULES) if (re.test(js)) errors.push(msg);
  for (const [re, msg] of CSS_RULES) if (re.test(css)) errors.push(msg);
  for (const [re, msg] of HTML_RULES) if (re.test(src)) errors.push(msg);
  for (const [re, msg] of WARN_RULES) if (re.test(src)) warnings.push(msg);

  if (!/class\s*=\s*["'][^"']*\bscene\b/.test(src)) errors.push('no .scene sections found');
  const ids = [...src.matchAll(/data-scene\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) errors.push('duplicate data-scene ids: ' + [...new Set(dup)].join(', '));

  const tm = /<script[^>]*id\s*=\s*["']texts["'][^>]*>([\s\S]*?)<\/script>/i.exec(src);
  if (tm) {
    try {
      const t = JSON.parse(tm[1]);
      const keys = new Set([...src.matchAll(/data-text\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]));
      const unused = Object.keys(t).filter((k) => !keys.has(k));
      const undef = [...keys].filter((k) => !(k in t));
      if (undef.length) warnings.push('data-text keys missing from #texts: ' + undef.slice(0, 8).join(', '));
      if (unused.length) warnings.push('#texts keys not used by any data-text: ' + unused.slice(0, 8).join(', '));
    } catch (e) { errors.push('#texts is not valid JSON: ' + e.message); }
  } else {
    warnings.push('no <script type="application/json" id="texts"> block: on-screen text will not be editable in the app');
  }
  if (src.length > 400000) warnings.push('composition is very large (' + Math.round(src.length / 1024) + ' KB)');
  return { ok: errors.length === 0, errors, warnings, sceneIds: ids };
}

/** Compare composition scene ids with the timeline's scene ids. */
export function checkScenes(fragmentIds, timeline) {
  const want = ((timeline && timeline.scenes) || []).map((s) => s.id);
  const missing = want.filter((id) => !fragmentIds.includes(id));
  const extra = fragmentIds.filter((id) => !want.includes(id));
  return { missing, extra };
}

/** Pull the default texts from a fragment's #texts block. */
export function extractTexts(fragment) {
  const m = /<script[^>]*id\s*=\s*["']texts["'][^>]*>([\s\S]*?)<\/script>/i.exec(String(fragment || ''));
  if (!m) return {};
  try { return JSON.parse(m[1]); } catch { return {}; }
}
