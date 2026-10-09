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
  return { blob: file, width: out.width, height: out.height, coverage: solid / (W * H) };
}
