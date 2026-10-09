// Pull the most-used colours from a website (HTML + up to two stylesheets), so the style node
// can build a palette that matches a brand site.

import { fail } from './http.js';

const MAX_TEXT = 600_000;

export async function colorsFromUrl(body) {
  let url;
  try { url = new URL(String(body.url || '')); } catch { fail(400, 'invalid url'); }
  if (!/^https?:$/.test(url.protocol)) fail(400, 'http(s) url required');
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/.test(url.hostname)) fail(400, 'private addresses are not allowed');

  const html = await getText(url.href);
  let text = html;
  const sheets = [...html.matchAll(/<link[^>]+rel=["']?stylesheet["']?[^>]*>/gi)]
    .map((m) => (/href=["']([^"']+)["']/i.exec(m[0]) || [])[1])
    .filter(Boolean)
    .slice(0, 2);
  for (const href of sheets) {
    try { text += '\n' + (await getText(new URL(href, url).href)); } catch {}
    if (text.length > MAX_TEXT) break;
  }
  text = text.slice(0, MAX_TEXT);

  const counts = new Map();
  const add = (hex, w = 1) => {
    hex = normalize(hex);
    if (hex) counts.set(hex, (counts.get(hex) || 0) + w);
  };
  const theme = /<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i.exec(html);
  if (theme) add(theme[1], 25);
  for (const m of text.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) add('#' + m[1]);
  for (const m of text.matchAll(/rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/g)) {
    add('#' + [m[1], m[2], m[3]].map((x) => Math.min(255, +x).toString(16).padStart(2, '0')).join(''));
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24)
    .map(([hex, n]) => ({ hex, n, chroma: chroma(hex) }));
  const title = (/<title[^>]*>([^<]{0,120})/i.exec(html) || [])[1] || '';
  return { url: url.href, title: title.trim(), colors: ranked };
}

async function getText(href) {
  let r;
  try {
    r = await fetch(href, {
      headers: { 'user-agent': 'Mozilla/5.0 (InfographicStudio palette reader)', accept: 'text/html,text/css,*/*' },
      redirect: 'follow',
    });
  } catch (e) {
    fail(502, 'could not reach ' + href + ': ' + (e.message || e));
  }
  if (!r.ok) fail(502, 'could not read ' + href + ' (' + r.status + ')');
  const t = await r.text();
  return t.slice(0, MAX_TEXT);
}

function normalize(c) {
  c = String(c).trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(c)) c = '#' + c.slice(1).split('').map((x) => x + x).join('');
  return /^#[0-9a-f]{6}$/.test(c) ? c : null;
}

function chroma(hex) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return Math.max(r, g, b) - Math.min(r, g, b);
}
