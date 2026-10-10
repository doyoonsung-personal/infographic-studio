// Turns a generated "object on a flat green background" image into a transparent cut-out.
// The background is found from the border, flood-filled inward (so green inside the object stays),
// feathered at the edge and de-spilled, then the result is cropped and saved as WebP with alpha.

/** Pixels of image data -> {alpha: Uint8ClampedArray} with the border-connected background removed. */
export function keyPixels(data, W, H) {
  const N = W * H;
  // Background colour: median of the border pixels.
  const rs = [], gs = [], bs = [];
  const sample = (x, y) => { const i = (y * W + x) * 4; rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]); };
  for (let x = 0; x < W; x += 3) { sample(x, 0); sample(x, H - 1); }
  for (let y = 0; y < H; y += 3) { sample(0, y); sample(W - 1, y); }
  const med = (a) => a.sort((p, q) => p - q)[a.length >> 1];
  const br = med(rs), bg = med(gs), bb = med(bs);
  const greenScreen = bg > 110 && bg > br + 50 && bg > bb + 50;
  const gBg = Math.max(1, bg - Math.max(br, bb));

  // How background-like each pixel is, 0..1: near the background colour or (for green screens) as green.
  const score = new Float32Array(N);
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const dist = Math.sqrt((r - br) ** 2 + (g - bg) ** 2 + (b - bb) ** 2);
    let s = 1 - dist / 150;
    if (greenScreen) s = Math.max(s, (g - Math.max(r, b)) / gBg);
    score[p] = s;
  }

  // Flood fill from the border through background-like pixels.
  const region = new Uint8Array(N);
  const stack = new Int32Array(N);
  let top = 0;
  const push = (p) => { if (!region[p] && score[p] > 0.32) { region[p] = 1; stack[top++] = p; } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (top) {
    const p = stack[--top];
    const x = p % W;
    if (x > 0) push(p - 1);
    if (x < W - 1) push(p + 1);
    if (p >= W) push(p - W);
    if (p < N - W) push(p + W);
  }

  const alpha = new Uint8ClampedArray(N);
  for (let p = 0; p < N; p++) {
    alpha[p] = region[p] ? Math.round(Math.min(1, Math.max(0, (0.82 - score[p]) / 0.5)) * 255) : 255;
  }
  // De-spill: pull green out of the object's edge (pixels within 2px of the removed background).
  if (greenScreen) {
    const near = new Uint8Array(N);
    for (let p = 0; p < N; p++) {
      if (!region[p]) continue;
      const x = p % W, y = (p / W) | 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H) near[yy * W + xx] = 1;
      }
    }
    for (let p = 0, i = 0; p < N; p++, i += 4) {
      if (!near[p]) continue;
      const cap = Math.max(data[i], data[i + 2]);
      if (data[i + 1] > cap) data[i + 1] = cap;
    }
  }
  return { alpha, background: [br, bg, bb], greenScreen };
}

/**
 * blob (PNG/JPEG) -> { blob: WebP with alpha, width, height, coverage } cropped to the object.
 * coverage = share of the frame the object fills (0 means nothing was found).
 */
export async function makeCutout(blob, { maxSide = 900, pad = 10 } = {}) {
  const bmp = await createImageBitmap(blob);
  const W = bmp.width, H = bmp.height;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const im = ctx.getImageData(0, 0, W, H);
  const { alpha } = keyPixels(im.data, W, H);
  let x0 = W, y0 = H, x1 = -1, y1 = -1, solid = 0;
  for (let p = 0, i = 3; p < W * H; p++, i += 4) {
    im.data[i] = alpha[p];
    if (alpha[p] > 24) {
      solid++;
      const x = p % W, y = (p / W) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { blob: null, width: 0, height: 0, coverage: 0 };
  ctx.putImageData(im, 0, 0);
  return { ...(await cropEncode(c, [x0, y0, x1, y1], pad, maxSide)), coverage: solid / (W * H) };
}

/** Crop a canvas to box [x0,y0,x1,y1] (+pad), scale to maxSide and encode as WebP with alpha (PNG fallback). */
async function cropEncode(c, [x0, y0, x1, y1], pad, maxSide) {
  const W = c.width, H = c.height;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const s = Math.min(1, maxSide / Math.max(cw, ch));
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(cw * s));
  out.height = Math.max(1, Math.round(ch * s));
  out.getContext('2d').drawImage(c, x0, y0, cw, ch, 0, 0, out.width, out.height);
  let file = await new Promise((res) => out.toBlob(res, 'image/webp', 0.9));
  if (!file || file.type !== 'image/webp') file = await new Promise((res) => out.toBlob(res, 'image/png'));
  return { blob: file, width: out.width, height: out.height };
}

/* ---------- the owner's own photos ---------- */

/** A photo file -> canvas, scaled down to maxSide (phone photos are 12+ MP; KV values cap at 25 MB). */
async function loadCanvas(blob, maxSide) {
  // phone photos carry their rotation in EXIF; older browsers don't know 'from-image' (they rotate anyway)
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(blob));
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * s));
  c.height = Math.max(1, Math.round(bmp.height * s));
  c.getContext('2d', { willReadFrequently: true }).drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

/** The uploaded original, resized for storage as JPEG (it is kept so the cut-out can be redone later). */
export async function shrinkPhoto(blob, maxSide = 2400) {
  const c = await loadCanvas(blob, maxSide);
  const file = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9));
  return { blob: file, width: c.width, height: c.height };
}

/**
 * Print looks so a real photo sits with the generated cut-outs (which are drawn in the project's style):
 *   none     — untouched
 *   halftone — black-and-white newspaper print: contrasty greys plus a 45° ink dot screen
 *   faded    — vintage magazine colour: softer, warmer, lifted blacks
 * Works in place on RGBA pixels; transparent pixels are left alone.
 */
export function applyLook(data, W, H, look) {
  if (look === 'halftone') {
    const cell = Math.max(3, Math.round(Math.min(W, H) / 170));
    const cs = Math.SQRT1_2, PAPER = [244, 239, 228], INK = [28, 26, 23];
    for (let y = 0, i = 0; y < H; y++) {
      for (let x = 0; x < W; x++, i += 4) {
        if (!data[i + 3]) continue;
        let L = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
        L = Math.min(1, Math.max(0, (L - 0.5) * 1.35 + 0.52));
        // distance to the nearest dot centre on a grid rotated 45°
        const u = (x * cs - y * cs) / cell, v = (x * cs + y * cs) / cell;
        const du = u - Math.floor(u) - 0.5, dv = v - Math.floor(v) - 0.5;
        const d = Math.sqrt(du * du + dv * dv);
        const r = Math.sqrt(1 - L) * 0.62;
        const ink = Math.min(1, Math.max(0, (r - d) / 0.12 + 0.5));
        // keep some continuous tone so faces stay recognisable
        const tone = 0.62 * ink + 0.38 * (1 - L);
        for (let k = 0; k < 3; k++) data[i + k] = PAPER[k] + (INK[k] - PAPER[k]) * tone;
      }
    }
  } else if (look === 'faded') {
    for (let i = 0; i < data.length; i += 4) {
      if (!data[i + 3]) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2], l = 0.299 * r + 0.587 * g + 0.114 * b;
      const mix = (c) => (c * 0.72 + l * 0.28) * 0.86 + 22;   // desaturate, flatten contrast, lift blacks
      data[i] = Math.min(255, mix(r) + 10);
      data[i + 1] = Math.min(255, mix(g) + 3);
      data[i + 2] = Math.max(0, mix(b) - 12);
    }
  }
}

/**
 * Mask for an object photographed on a plain background (no model, instant): the border colour is
 * flood-filled inward, with a tolerance set by how noisy the border is, so a white product on a white
 * table keeps its light parts. Holes that are background-coloured but enclosed (a label, a mug handle)
 * stay, which is the safe side. ok = false when the background is busy and the result should not be
 * used: the border isn't mostly one colour (plain < 0.6), or the mask is murky (on a plain backdrop the
 * split is crisp, ~2% half-transparent pixels; a blurred bar scene with a dark border gives 12–14%).
 */
export function plainKey(data, W, H) {
  const N = W * H;
  const border = [];
  const ring = Math.max(1, Math.round(Math.min(W, H) * 0.01));
  for (let k = 0; k < ring; k++) {
    for (let x = 0; x < W; x += 2) border.push((k * W + x) * 4, ((H - 1 - k) * W + x) * 4);
    for (let y = 0; y < H; y += 2) border.push((y * W + k) * 4, (y * W + W - 1 - k) * 4);
  }
  const med = (c) => border.map((i) => data[i + c]).sort((p, q) => p - q)[border.length >> 1];
  const bg = [med(0), med(1), med(2)];
  const dist = (i) => Math.sqrt((data[i] - bg[0]) ** 2 + (data[i + 1] - bg[1]) ** 2 + (data[i + 2] - bg[2]) ** 2);
  const bd = border.map(dist).sort((p, q) => p - q);
  const plain = bd.filter((d) => d < 40).length / bd.length;
  // tolerance: the spread of most of the border (shading, JPEG noise), within sane bounds
  const lo = Math.min(40, Math.max(10, bd[Math.floor(bd.length * 0.85)] * 1.3));
  const hi = lo + 28;

  // the fill only takes small steps between neighbours: a backdrop's shading passes, the edge of the
  // subject stops it (else near-white skin or a white label next to a white wall would be eaten).
  // step: a few times the pixel noise along the border.
  const diffs = [];
  for (let k = 2; k < border.length; k += 2) {
    const i = border[k], j = border[k - 2];
    diffs.push(Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]));
  }
  diffs.sort((p, q) => p - q);
  const step = Math.min(30, Math.max(12, diffs[diffs.length >> 1] * 4));
  const near = (p, q) => {
    const i = p * 4, j = q * 4;
    return Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]) < step;
  };

  const d = new Float32Array(N);
  for (let p = 0; p < N; p++) d[p] = dist(p * 4);
  const region = new Uint8Array(N);
  const stack = new Int32Array(N);
  let top = 0;
  const push = (q, p) => { if (!region[q] && d[q] < hi && (p < 0 || near(q, p))) { region[q] = 1; stack[top++] = q; } };
  for (let x = 0; x < W; x++) { push(x, -1); push((H - 1) * W + x, -1); }
  for (let y = 0; y < H; y++) { push(y * W, -1); push(y * W + W - 1, -1); }
  while (top) {
    const p = stack[--top];
    const x = p % W;
    if (x > 0) push(p - 1, p);
    if (x < W - 1) push(p + 1, p);
    if (p >= W) push(p - W, p);
    if (p < N - W) push(p + W, p);
  }
  // the 2px just inside the subject's edge also fade by colour, for a soft (not scissor-cut) edge
  const edge = new Uint8Array(N);
  for (let p = 0; p < N; p++) {
    if (!region[p]) continue;
    const x = p % W, y = (p / W) | 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H) edge[yy * W + xx] = 1;
    }
  }
  const raw = new Uint8ClampedArray(N);
  for (let p = 0; p < N; p++) raw[p] = region[p] || edge[p] ? Math.min(1, Math.max(0, (d[p] - lo) / (hi - lo))) * 255 : 255;
  // soften the edge by one pixel so it doesn't look scissor-cut when scaled
  const mask = new Uint8ClampedArray(N);
  let partial = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H) { s += raw[yy * W + xx]; n++; }
      }
      const v = (mask[y * W + x] = s / n);
      if (v > 25 && v < 230) partial++;
    }
  }
  partial /= N;
  return { mask, ok: plain >= 0.6 && partial <= 0.06, plain, partial, background: bg };
}

/** plainKey for a photo file, worked at up to maxSide px; the mask is scaled to the photo by cutoutFromMask. */
export async function plainBackgroundMask(blob, maxSide = 1200) {
  const c = await loadCanvas(blob, maxSide);
  const { data } = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
  return { ...plainKey(data, c.width, c.height), width: c.width, height: c.height };
}

/**
 * Uploaded photo + background mask (mw×mh, 0 = background) -> transparent cut-out cropped to the subject.
 * The mask is scaled up to the photo, so edges follow the photo's own pixels.
 */
export async function cutoutFromMask(blob, mask, mw, mh, { look = 'none', maxSide = 1200, pad = 12 } = {}) {
  const c = await loadCanvas(blob, 2000);
  const W = c.width, H = c.height;
  const mc = document.createElement('canvas');
  mc.width = mw; mc.height = mh;
  const mctx = mc.getContext('2d');
  const md = mctx.createImageData(mw, mh);
  for (let p = 0; p < mask.length; p++) { const a = mask[p]; md.data[p * 4 + 3] = a < 12 ? 0 : a > 243 ? 255 : a; }
  mctx.putImageData(md, 0, 0);
  const big = document.createElement('canvas');
  big.width = W; big.height = H;
  const bctx = big.getContext('2d', { willReadFrequently: true });
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(mc, 0, 0, W, H);
  const alpha = bctx.getImageData(0, 0, W, H).data;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const im = ctx.getImageData(0, 0, W, H);
  let x0 = W, y0 = H, x1 = -1, y1 = -1, solid = 0;
  for (let p = 0, i = 3; p < W * H; p++, i += 4) {
    const a = alpha[i];
    im.data[i] = a;
    if (a > 24) {
      solid++;
      const x = p % W, y = (p / W) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { blob: null, width: 0, height: 0, coverage: 0 };
  applyLook(im.data, W, H, look);
  ctx.putImageData(im, 0, 0);
  return { ...(await cropEncode(c, [x0, y0, x1, y1], pad, maxSide)), coverage: solid / (W * H) };
}

/** Uploaded photo kept as a rectangle (no cut-out), resized, with the look applied. */
export async function photoAsset(blob, { look = 'none', maxSide = 1400 } = {}) {
  const c = await loadCanvas(blob, maxSide);
  if (look !== 'none') {
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const im = ctx.getImageData(0, 0, c.width, c.height);
    applyLook(im.data, c.width, c.height, look);
    ctx.putImageData(im, 0, 0);
  }
  const file = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9));
  return { blob: file, width: c.width, height: c.height, coverage: 1 };
}
