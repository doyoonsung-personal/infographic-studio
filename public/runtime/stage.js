/* Infographic Studio stage runtime.
 * Inlined into every composition, in the app's preview and in the routine's renderer.
 * seek(t) draws the whole frame for time t from scratch: the picture depends on t only,
 * never on the previous frame, real time or randomness. See docs/COMPOSITION.md.
 */
(function () {
  'use strict';

  var CFG = window.STAGE || {};
  var TL = CFG.timeline || null;
  var stage = document.getElementById('stage');
  var root = document.documentElement;

  /* ---------- helpers ---------- */
  function clamp(x, a, b) { a = a == null ? 0 : a; b = b == null ? 1 : b; return Math.min(b, Math.max(a, x)); }
  function lerp(a, b, p) { return a + (b - a) * p; }
  var EASE = {
    linear: function (p) { return p; },
    out: function (p) { return 1 - Math.pow(1 - p, 3); },
    in: function (p) { return p * p * p; },
    inout: function (p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; },
    back: function (p) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); },
    expo: function (p) { return p >= 1 ? 1 : 1 - Math.pow(2, -10 * p); },
    elastic: function (p) { if (p <= 0 || p >= 1) return clamp(p); return Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * (2 * Math.PI) / 3) + 1; }
  };
  function prog(t, start, dur, ease) {
    if (!(dur > 0)) return t >= start ? 1 : 0;
    return (EASE[ease] || EASE.out)(clamp((t - start) / dur));
  }
  function rand(seed) {
    var s = (seed >>> 0) || 1;
    return function () { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1000000007) / 1000000007; };
  }
  function num(v, d) { var n = parseFloat(v); return isNaN(n) ? d : n; }
  function attr(el, name) { return el.getAttribute(name); }
  function has(el, name) { return el.hasAttribute(name); }

  var errors = [];

  /* ---------- texts and colours ---------- */
  var defaults = {};
  try {
    var tj = document.getElementById('texts');
    if (tj) defaults = JSON.parse(tj.textContent || '{}');
  } catch (e) { defaults = {}; }
  var texts = Object.assign({}, defaults, CFG.texts || {});

  function applyColors(colors, font) {
    if (colors) for (var k in colors) if (colors[k]) root.style.setProperty('--' + k, colors[k]);
    if (font) root.style.setProperty('--font', font);
  }
  applyColors(CFG.colors, CFG.font);

  function bindTexts() {
    var nodes = stage.querySelectorAll('[data-text]');
    for (var i = 0; i < nodes.length; i++) {
      var key = attr(nodes[i], 'data-text');
      if (Object.prototype.hasOwnProperty.call(texts, key)) nodes[i].textContent = texts[key];
    }
  }
  bindTexts();

  /* ---------- cut-out assets ---------- */
  // <img data-asset="a_xxx"> gets its picture from CFG.assets (data: URI in the preview, a file in the renderer).
  var ASSETS = CFG.assets || {};
  Array.prototype.forEach.call(stage.querySelectorAll('img[data-asset]'), function (im) {
    var id = attr(im, 'data-asset');
    if (ASSETS[id]) im.src = ASSETS[id];
    else if (Object.keys(ASSETS).length) report('asset not found: ' + id);
  });

  /* ---------- scenes ---------- */
  var sceneEls = Array.prototype.slice.call(stage.querySelectorAll('.scene'));
  var byId = {};
  if (TL && TL.scenes) TL.scenes.forEach(function (s) { byId[s.id] = s; });
  var cursor = 0;
  var scenes = sceneEls.map(function (el, i) {
    var id = attr(el, 'data-scene') || ('s' + (i + 1));
    var t = byId[id];
    var start, len, cues = {};
    if (t) { start = t.start; len = t.len; cues = t.cues || {}; }
    else {
      len = num(attr(el, 'data-len'), 5);
      start = has(el, 'data-start') ? num(attr(el, 'data-start'), cursor) : cursor;
    }
    cursor = Math.max(cursor, start + len);
    var designed = num(attr(el, 'data-len'), len);
    return {
      el: el, id: id, index: i, start: start, len: len, end: start + len, cues: cues,
      scale: designed > 0 ? Math.min(1, len / designed) : 1,
      transition: attr(el, 'data-transition') || 'fade',
      first: i === 0, last: i === sceneEls.length - 1, anims: []
    };
  });
  var STATIC = TL ? !!TL.static : has(stage, 'data-static');
  var DURATION = STATIC ? 0 : (TL && TL.duration) || cursor;

  /* ---------- background images (optional) ---------- */
  // CFG.images = {sceneId | 'all': url}. Each scene gets a full-bleed image layer (slow zoom) under a
  // colour scrim in var(--bg) so text stays readable. A composition can place the image itself by
  // adding an element with [data-bg-slot]; then only that element receives the image.
  var IMAGES = CFG.images || {};
  var bgStrength = clamp(num(CFG.bg && CFG.bg.strength, 0.45), 0.05, 0.95);
  var CLIPS = CFG.clips || {};
  var clipLayers = [];   // {key, sceneId, el (img | video), spec}
  var sceneById = {};
  scenes.forEach(function (s) { sceneById[s.id] = s; });
  sceneEls.forEach(function (el, i) {
    var id = attr(el, 'data-scene') || ('s' + (i + 1));
    var url = IMAGES[id] || IMAGES.all;
    if (!url) return;
    var css = 'url("' + String(url).replace(/"/g, '%22') + '")';
    root.style.setProperty('--bg-img-' + id, css);
    var slot = el.querySelector('[data-bg-slot]');
    if (slot) {
      slot.style.backgroundImage = css;
      if (!slot.style.backgroundSize) slot.style.backgroundSize = 'cover';
      if (!slot.style.backgroundPosition) slot.style.backgroundPosition = 'center';
      var inSlot = makeClipLayer(id);
      if (inSlot) { if (!slot.style.position) slot.style.position = 'relative'; inSlot.style.zIndex = '0'; slot.insertBefore(inSlot, slot.firstChild); }
      return;
    }
    var img = document.createElement('div');
    img.className = '__bgimg';
    img.setAttribute('data-a', 'none');
    img.setAttribute('data-ken', '1.07');
    img.style.cssText = 'position:absolute;inset:0;z-index:-1;pointer-events:none;background-position:center;background-size:cover;background-repeat:no-repeat;transform-origin:60% 50%';
    img.style.backgroundImage = css;
    var scrim = document.createElement('div');
    scrim.className = '__scrim';
    var a = Math.round((1 - bgStrength) * 100);
    scrim.style.cssText = 'position:absolute;inset:0;z-index:-1;pointer-events:none;' +
      'background:linear-gradient(100deg, color-mix(in srgb, var(--bg) ' + Math.min(100, a + 12) + '%, transparent) 0%, ' +
      'color-mix(in srgb, var(--bg) ' + a + '%, transparent) 55%, color-mix(in srgb, var(--bg) ' + Math.max(0, a - 10) + '%, transparent) 100%)';
    el.insertBefore(scrim, el.firstChild);
    var clipLayer = makeClipLayer(id);
    if (clipLayer) el.insertBefore(clipLayer, el.firstChild);
    el.insertBefore(img, el.firstChild);
  });

  /* ---------- moving backgrounds (AI clips of the background image) ---------- */
  // CFG.clips[sceneId | 'all'] = {dur, frames, n, fps} in the renderer (numbered JPEG files, exact per frame)
  // or {dur} in the preview, where the player sends the video bytes after load ('clips' message).
  function makeClipLayer(sceneId) {
    var key = CLIPS[sceneId] ? sceneId : CLIPS.all ? 'all' : null;
    if (!key) return null;
    var spec = CLIPS[key];
    var wrap = document.createElement('div');
    wrap.className = '__clip';
    wrap.setAttribute('data-a', 'none');
    wrap.setAttribute('data-ken', '1.05');
    wrap.style.cssText = 'position:absolute;inset:0;z-index:-1;pointer-events:none;overflow:hidden;transform-origin:55% 50%';
    var media = document.createElement(spec.frames ? 'img' : 'video');
    media.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';
    if (!spec.frames) { media.muted = true; media.playsInline = true; media.preload = 'auto'; media.loop = false; }
    wrap.appendChild(media);
    clipLayers.push({ key: key, sceneId: sceneId, el: media, spec: spec });
    return wrap;
  }

  /** Clip time for scene-local time lt: real speed, slowed (not below half) to fill a longer scene, then held. */
  function clipTime(c, lt, sceneLen) {
    var dur = Math.max(0.1, num(c.spec.dur, 5));
    var rate = sceneLen > dur ? Math.max(0.5, dur / sceneLen) : 1;
    return clamp(lt * rate, 0, dur - 0.05);
  }

  var pendingFrames = [];
  var clipPauseTimer = 0, lastSeekWall = 0, lastSeekT = -1;
  function updateClips(T) {
    if (!clipLayers.length) return;
    // Preview only: a run of small forward seeks means the player is playing, so let the videos run.
    var playing = false;
    if (!clipLayers[0].spec.frames) {
      var now = performance.now();
      playing = T > lastSeekT && T - lastSeekT < 0.25 && now - lastSeekWall < 250;
      lastSeekWall = now; lastSeekT = T;
      clearTimeout(clipPauseTimer);
      clipPauseTimer = setTimeout(function () { clipLayers.forEach(function (c) { if (c.el.pause) c.el.pause(); }); }, 260);
    }
    for (var i = 0; i < clipLayers.length; i++) {
      var c = clipLayers[i];
      var sc = sceneById[c.sceneId];
      if (!sc) continue;
      var visible = sc.el.style.visibility !== 'hidden';
      var ct = clipTime(c, T - sc.start, sc.len);
      if (c.spec.frames) {
        var idx = Math.min((c.spec.n || 1) - 1, Math.floor(ct * (c.spec.fps || 30)));
        var src = c.spec.frames + ('0000' + (idx + 1)).slice(-5) + '.jpg';
        if (visible && c.el.getAttribute('src') !== src) { c.el.setAttribute('src', src); pendingFrames.push(c.el); }
      } else if (c.el.src) {
        if (!visible) { if (!c.el.paused) c.el.pause(); continue; }
        var dur = Math.max(0.1, num(c.spec.dur, 5));
        c.el.playbackRate = sc.len > dur ? Math.max(0.5, dur / sc.len) : 1;
        if (Math.abs(c.el.currentTime - ct) > (playing ? 0.35 : 0.04)) c.el.currentTime = ct;
        if (playing && c.el.paused && ct < dur - 0.06) c.el.play().catch(function () {});
        if (!playing && !c.el.paused) c.el.pause();
      }
    }
  }

  /** Resolves when the clip frames set by the last seek have decoded (the renderer waits on it). */
  function stageSettle() {
    var list = pendingFrames;
    pendingFrames = [];
    return Promise.all(list.map(function (im) {
      return im.decode ? im.decode().catch(function () {}) : null;
    }));
  }

  function receiveClips(map) {
    clipLayers.forEach(function (c) {
      var buf = map && map[c.key];
      if (!buf || c.spec.frames) return;
      if (!c.url) c.url = URL.createObjectURL(new Blob([buf], { type: 'video/mp4' }));
      c.el.src = c.url;
      c.el.addEventListener('loadeddata', function () { seek(lastT); }, { once: true });
    });
  }

  /* ---------- per-element animation specs ---------- */
  var ANIM_SEL = '[data-in],[data-cue],[data-a],[data-grow],[data-count],[data-draw],[data-type],[data-loop],[data-ken],[data-out],[data-out-cue],[data-hl],[data-boil],[data-drift],[data-depth]';

  function timeFor(el, sc, inAttr, cueAttr, delayAttr) {
    var cue = attr(el, cueAttr);
    if (cue != null && sc.cues[cue] != null) return sc.cues[cue] + num(attr(el, delayAttr), 0);
    var v = attr(el, inAttr);
    if (v != null) return num(v, 0) * sc.scale;
    if (cue != null) {
      // Cue without a timeline entry: fall back to an even spread through the scene.
      return clamp(num(cue, 1) * 0.12, 0, 0.9) * sc.len;
    }
    return null;
  }

  function lengthUnit(v) {
    var m = /^(-?[\d.]+)\s*(%|px|vw|vh|em|rem)?$/.exec(String(v || '').trim());
    if (!m) return { n: 100, u: '%' };
    return { n: parseFloat(m[1]), u: m[2] || 'px' };
  }

  var specOf = new Map();

  // Nearest animated ancestor inside the scene, so nested counters and bars
  // start when their card appears instead of at the top of the scene.
  function ancestorStart(el, sc) {
    for (var p = el.parentElement; p && p !== sc.el; p = p.parentElement) {
      var s = specOf.get(p);
      if (s) return s.inT + Math.min(0.25, s.d * 0.5);
    }
    return null;
  }

  function buildSpec(el, sc, inherited) {
    var isSvg = el instanceof SVGElement;
    var grow = attr(el, 'data-grow');
    var count = has(el, 'data-count');
    var draw = has(el, 'data-draw');
    var type = has(el, 'data-type');
    var hl = has(el, 'data-hl');
    // Only data-boil / data-drift / data-depth (no entrance asked for): the element is simply there and moves.
    var still = !has(el, 'data-a') && !has(el, 'data-in') && !has(el, 'data-cue') && !grow && !count && !draw && !type && !hl &&
      !has(el, 'data-ken') && !has(el, 'data-loop') && (has(el, 'data-boil') || has(el, 'data-drift') || has(el, 'data-depth'));
    var anc = ancestorStart(el, sc);
    // A counter inside an animated card appears with the card; on its own it fades in.
    var defA = (grow || draw || type || hl || still) ? 'none' : (count ? (anc != null ? 'none' : 'fade') : 'up');
    var inT = timeFor(el, sc, 'data-in', 'data-cue', 'data-delay');
    if (inT == null && inherited) inT = inherited.inT;
    if (inT == null && anc != null) inT = anc;
    if (inT == null) inT = 0;
    var a = attr(el, 'data-a') || (inherited && inherited.a) || defA;
    var spec = {
      el: el, isSvg: isSvg, a: a, inT: inT,
      // Visible from the start of the scene (its parent handles the entrance); only the count or the
      // highlighter sweep waits for its time.
      showAlways: still || ((count && anc != null || hl) && !attr(el, 'data-a') && !(count && (has(el, 'data-in') || has(el, 'data-cue')))),
      d: num(attr(el, 'data-d'), a === 'pop' ? 0.55 : 0.6),
      ease: attr(el, 'data-ease') || (a === 'pop' ? 'back' : 'out'),
      dist: num(attr(el, 'data-dist'), 48),
      outT: timeFor(el, sc, 'data-out', 'data-out-cue', 'data-out-delay'),
      outA: attr(el, 'data-a-out') || 'fade',
      outD: num(attr(el, 'data-d-out'), 0.4),
      grow: grow, to: grow ? lengthUnit(attr(el, 'data-to')) : null,
      growD: num(attr(el, 'data-d'), 0.9),
      count: count, draw: draw, type: type,
      loop: attr(el, 'data-loop'), speed: num(attr(el, 'data-speed'), 1),
      ken: has(el, 'data-ken') ? num(attr(el, 'data-ken'), 1.08) : null,
      hl: hl, hlD: num(attr(el, 'data-hl'), 0) > 0 ? num(attr(el, 'data-hl'), 0) : 0.7,
      boil: has(el, 'data-boil') ? num(attr(el, 'data-boil'), 1.2) || 1.2 : 0,
      seed: sc.anims.length * 7919 + sc.index * 104729 + 17,
      drift: null,
      // Layer depth for camera pushes: 1 moves with the scene, <1 lags behind (background), >1 leads (foreground).
      depth: has(el, 'data-depth') ? num(attr(el, 'data-depth'), 1) : null
    };
    if (has(el, 'data-drift')) {
      var dv = String(attr(el, 'data-drift')).split(/[ ,]+/).map(function (x) { return num(x, 0); });
      spec.drift = { x: dv[0] || 0, y: dv[1] || 0 };
    }
    if (count) {
      spec.from = num(attr(el, 'data-from'), 0);
      spec.toN = num(attr(el, 'data-count'), num(attr(el, 'data-to'), 0));
      spec.decimals = num(attr(el, 'data-decimals'), (String(spec.toN).split('.')[1] || '').length);
      spec.prefix = attr(el, 'data-prefix') || '';
      spec.suffix = attr(el, 'data-suffix') || '';
      spec.sep = attr(el, 'data-sep') == null ? ',' : attr(el, 'data-sep');
      spec.countD = num(attr(el, 'data-d'), 1.2);
    }
    if (draw) {
      el.setAttribute('pathLength', '1');
      el.style.strokeDasharray = '1';
      spec.drawD = num(attr(el, 'data-d'), 1.0);
    }
    if (type) {
      spec.full = el.textContent;
      spec.typeD = num(attr(el, 'data-d'), Math.max(0.6, spec.full.length * 0.035));
    }
    if (isSvg && (a === 'scale' || a === 'pop' || spec.loop === 'pulse' || spec.loop === 'spin' || spec.ken)) {
      el.style.transformBox = 'fill-box';
      if (!el.style.transformOrigin) el.style.transformOrigin = 'center';
    }
    specOf.set(el, spec);
    return spec;
  }

  scenes.forEach(function (sc) {
    var seen = new Set();
    // Staggered groups first: their children inherit timing from the container.
    var groups = sc.el.querySelectorAll('[data-stagger]');
    Array.prototype.forEach.call(groups, function (g) {
      var base = timeFor(g, sc, 'data-in', 'data-cue', 'data-delay');
      if (base == null) base = 0;
      var step = num(attr(g, 'data-stagger'), 0.15) * sc.scale;
      var childA = attr(g, 'data-child-a') || 'up';
      var kids = Array.prototype.filter.call(g.children, function (c) { return c.nodeType === 1; });
      kids.forEach(function (c, i) {
        sc.anims.push(buildSpec(c, sc, { inT: base + i * step, a: childA }));
        seen.add(c);
      });
      if (has(g, 'data-a') || has(g, 'data-in') || has(g, 'data-cue')) {
        if (!has(g, 'data-a')) g.setAttribute('data-a', 'none');
        sc.anims.push(buildSpec(g, sc));
      }
      seen.add(g);
    });
    var els = sc.el.querySelectorAll(ANIM_SEL);
    Array.prototype.forEach.call(els, function (el) {
      if (seen.has(el)) return;
      sc.anims.push(buildSpec(el, sc));
    });
    sc.progress = sc.el.querySelectorAll('[data-progress]');
  });
  var globalProgress = Array.prototype.filter.call(stage.querySelectorAll('[data-progress]'), function (el) {
    return !el.closest('.scene');
  });

  function fmt(n, s) {
    var fixed = Math.abs(n).toFixed(s.decimals);
    var parts = fixed.split('.');
    if (s.sep) parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, s.sep);
    return (n < 0 ? '-' : '') + s.prefix + parts.join('.') + s.suffix;
  }

  function applySpec(s, lt, sceneLen) {
    var el = s.el;
    var raw = (s.d > 0) ? clamp((lt - s.inT) / s.d) : (lt >= s.inT ? 1 : 0);
    var p = (EASE[s.ease] || EASE.out)(raw);
    var started = lt >= s.inT;
    var op = 1, tx = 0, ty = 0, sc = 1, rot = 0, blur = 0, clip = '';

    switch (s.a) {
      case 'none': op = (started || s.showAlways) ? 1 : 0; break;
      case 'fade': op = p; break;
      case 'up': op = raw > 0 ? Math.min(1, raw * 1.6) : 0; ty = (1 - p) * s.dist; break;
      case 'down': op = raw > 0 ? Math.min(1, raw * 1.6) : 0; ty = -(1 - p) * s.dist; break;
      case 'left': op = raw > 0 ? Math.min(1, raw * 1.6) : 0; tx = -(1 - p) * s.dist; break;
      case 'right': op = raw > 0 ? Math.min(1, raw * 1.6) : 0; tx = (1 - p) * s.dist; break;
      case 'scale': op = p; sc = lerp(0.86, 1, p); break;
      case 'pop': op = Math.min(1, raw * 3); sc = raw > 0 ? lerp(0.55, 1, p) : 0.55; break;
      case 'blur': op = p; blur = (1 - p) * 14; break;
      case 'wipe': case 'wipe-right': op = started ? 1 : 0; clip = 'inset(0 ' + ((1 - p) * 100).toFixed(3) + '% 0 0)'; break;
      case 'wipe-left': op = started ? 1 : 0; clip = 'inset(0 0 0 ' + ((1 - p) * 100).toFixed(3) + '%)'; break;
      case 'wipe-up': op = started ? 1 : 0; clip = 'inset(' + ((1 - p) * 100).toFixed(3) + '% 0 0 0)'; break;
      case 'wipe-down': op = started ? 1 : 0; clip = 'inset(0 0 ' + ((1 - p) * 100).toFixed(3) + '% 0)'; break;
      default: op = p; ty = (1 - p) * s.dist;
    }

    if (s.outT != null) {
      var q = prog(lt, s.outT, s.outD, 'in');
      if (q > 0) {
        op *= (1 - q);
        if (s.outA === 'up') ty -= q * s.dist;
        else if (s.outA === 'down') ty += q * s.dist;
        else if (s.outA === 'left') tx -= q * s.dist;
        else if (s.outA === 'right') tx += q * s.dist;
        else if (s.outA === 'scale') sc *= lerp(1, 0.9, q);
      }
    }

    if (s.loop && started) {
      var lp = lt - s.inT;
      if (s.loop === 'float') ty += Math.sin(lp * 2 * Math.PI / (3 / s.speed)) * 6;
      else if (s.loop === 'pulse') sc *= 1 + 0.035 * Math.sin(lp * 2 * Math.PI / (1.6 / s.speed));
      else if (s.loop === 'spin') rot += lp * 24 * s.speed;
      else if (s.loop === 'sway') rot += Math.sin(lp * 2 * Math.PI / (4 / s.speed)) * 3;
    }
    if (s.ken != null) sc *= lerp(1, s.ken, clamp(lt / Math.max(0.1, sceneLen)));
    if (s.drift) {
      // Parallax: glide by (x, y) px over the scene.
      var dp = clamp(lt / Math.max(0.1, sceneLen));
      tx += s.drift.x * dp; ty += s.drift.y * dp;
    }
    if (s.boil) {
      // Stop-motion wobble: a new small random pose 8 times a second (seeded, so the same t gives the same pose).
      var rb = rand(s.seed + Math.floor(Math.max(0, lt) * 8) * 2654435761);
      rot += (rb() - 0.5) * 2 * s.boil;
      tx += (rb() - 0.5) * 2.4 * s.boil;
      ty += (rb() - 0.5) * 2.4 * s.boil;
    }
    if (s.hl) el.style.backgroundSize = (prog(lt, s.inT, s.hlD, 'inout') * 100).toFixed(2) + '% 46%';
    if (s.depth != null && (curPan.x || curPan.y)) {
      tx += (s.depth - 1) * curPan.x * 0.6;
      ty += (s.depth - 1) * curPan.y * 0.6;
    }

    el.style.opacity = op >= 0.999 ? '' : op.toFixed(4);
    el.style.translate = (tx || ty) ? tx.toFixed(2) + 'px ' + ty.toFixed(2) + 'px' : '';
    el.style.scale = sc !== 1 ? sc.toFixed(4) : '';
    el.style.rotate = rot ? rot.toFixed(3) + 'deg' : '';
    el.style.filter = blur > 0.01 ? 'blur(' + blur.toFixed(2) + 'px)' : '';
    el.style.clipPath = clip;

    if (s.grow) {
      var gp = prog(lt, s.inT, s.growD, s.ease);
      var v = (s.to.n * gp).toFixed(3) + s.to.u;
      if (s.grow === 'y') el.style.height = v; else el.style.width = v;
    }
    if (s.count) {
      el.textContent = fmt(lerp(s.from, s.toN, prog(lt, s.inT, s.countD, 'expo')), s);
    }
    if (s.draw) {
      el.style.strokeDashoffset = (1 - prog(lt, s.inT, s.drawD, s.ease === 'back' ? 'out' : s.ease)).toFixed(4);
    }
    if (s.type) {
      var n = Math.floor(s.full.length * clamp((lt - s.inT) / s.typeD));
      el.textContent = s.full.slice(0, n);
    }
  }

  /* ---------- extras (owner's switches in the app) ---------- */
  var EXTRAS = CFG.extras || {};
  var SW = (TL && TL.width) || stage.offsetWidth || 1920;
  var SH = (TL && TL.height) || stage.offsetHeight || 1080;
  var curPan = { x: 0, y: 0 };

  /* ---------- layout measuring (untransformed positions inside the stage) ---------- */
  function layoutRect(el) {
    if (el && el.offsetParent !== undefined && !(el instanceof SVGElement)) {
      var x = 0, y = 0, n = el;
      while (n && n !== stage) { x += n.offsetLeft || 0; y += n.offsetTop || 0; n = n.offsetParent; }
      return { x: x, y: y, w: el.offsetWidth || 1, h: el.offsetHeight || 1 };
    }
    var r = el.getBoundingClientRect(), s = stage.getBoundingClientRect();
    return { x: r.left - s.left, y: r.top - s.top, w: r.width || 1, h: r.height || 1 };
  }
  function center(r) { return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }

  /* ---------- camera inside a scene ---------- */
  // data-cam="0: 1 960 540; c2: #chart 1.6; 5.5: 1 960 540" -> keyframes "time: zoom cx cy" (the stage
  // point (cx, cy) is centred on screen) or "time: #selector zoom" (centre on that element). Times are
  // scene seconds or cues (c2, c2+0.3). Between keys the camera eases in and out.
  function cueTime(sc, v) {
    var m = /^c(\d+)\s*([+-]\s*[\d.]+)?$/.exec(String(v).trim());
    if (m) {
      var base = sc.cues[m[1]] != null ? sc.cues[m[1]] : clamp(num(m[1], 1) * 0.12, 0, 0.9) * sc.len;
      return base + (m[2] ? parseFloat(m[2].replace(/\s+/g, '')) : 0);
    }
    return num(v, 0) * sc.scale;
  }
  function parseCam(sc) {
    var src = attr(sc.el, 'data-cam');
    if (!src) return null;
    var keys = [];
    src.split(';').forEach(function (part) {
      var i = part.indexOf(':');
      if (i < 0) return;
      var t = cueTime(sc, part.slice(0, i));
      var v = part.slice(i + 1).trim().split(/\s+/);
      if (/^[#.\[]/.test(v[0] || '')) keys.push({ t: t, sel: v[0], z: num(v[1], 1.6) });
      else keys.push({ t: t, z: num(v[0], 1), cx: num(v[1], SW / 2), cy: num(v[2], SH / 2) });
    });
    keys.sort(function (a, b) { return a.t - b.t; });
    return keys.length ? keys : null;
  }
  function measureCam(sc) {
    if (!sc.cam) return;
    sc.cam.forEach(function (k) {
      if (!k.sel) return;
      var el = null;
      try { el = sc.el.querySelector(k.sel); } catch (e) { report('data-cam: bad selector ' + k.sel); }
      if (!el) { k.cx = SW / 2; k.cy = SH / 2; return; }
      var c = center(layoutRect(el));
      k.cx = c.x; k.cy = c.y;
    });
  }
  function camAt(sc, lt) {
    var ks = sc.cam;
    if (ks) {
      if (lt <= ks[0].t) return ks[0];
      for (var i = 0; i < ks.length - 1; i++) {
        var a = ks[i], b = ks[i + 1];
        if (lt <= b.t) {
          var p = EASE.inout(clamp((lt - a.t) / Math.max(0.001, b.t - a.t)));
          return { z: lerp(a.z, b.z, p), cx: lerp(a.cx, b.cx, p), cy: lerp(a.cy, b.cy, p) };
        }
      }
      return ks[ks.length - 1];
    }
    if (EXTRAS.ambient && EXTRAS.ambient.enabled && !STATIC) {
      // Background motion on: the camera breathes, a slow push with a little sideways drift.
      var q = clamp(lt / Math.max(0.1, sc.len));
      return { z: 1 + 0.035 * q, cx: SW / 2 + (sc.index % 2 ? -1 : 1) * 16 * q, cy: SH / 2 };
    }
    return null;
  }
  function camTransform(c) {
    if (!c || (Math.abs(c.z - 1) < 1e-4 && Math.abs(c.cx - SW / 2) < 0.01 && Math.abs(c.cy - SH / 2) < 0.01)) return '';
    return 'translate(' + (c.z * (SW / 2 - c.cx)).toFixed(2) + 'px,' + (c.z * (SH / 2 - c.cy)).toFixed(2) + 'px) scale(' + c.z.toFixed(4) + ')';
  }
  /** Where a stage point appears on screen under a scene's camera. */
  function camPoint(c, p) {
    if (!c) return p;
    return { x: SW / 2 + c.z * (p.x - c.cx), y: SH / 2 + c.z * (p.y - c.cy) };
  }

  /* ---------- transitions between scenes ---------- */
  // fade (default), cut, slide, zoom: each scene uses its own. Camera transitions (push, push-up,
  // zoom-in, zoom-out, whip, circle, morph): set on the ENTERING scene; the outgoing scene moves with it.
  var CAM_TYPES = { push: 1, 'push-up': 1, 'zoom-in': 1, 'zoom-out': 1, whip: 1, circle: 1, morph: 1 };
  function halfOf(type) { return type === 'whip' ? 0.2 : CAM_TYPES[type] ? 0.4 : 0.25; }
  scenes.forEach(function (sc, i) {
    sc.prev = scenes[i - 1] || null;
    sc.next = scenes[i + 1] || null;
    sc.exitType = sc.next && CAM_TYPES[sc.next.transition] ? sc.next.transition : sc.transition;
    sc.cam = STATIC ? null : parseCam(sc);
    sc.focusSel = attr(sc.el, 'data-focus');
  });
  // The point a zoom-in / circle transition grows from: the outgoing scene's data-focus element.
  function measureFocus(sc) {
    sc.focus = { x: SW / 2, y: SH / 2 };
    if (!sc.focusSel) return;
    var el = null;
    try { el = sc.el.querySelector(sc.focusSel); } catch (e) { report('data-focus: bad selector ' + sc.focusSel); }
    if (el) sc.focus = center(layoutRect(el));
  }

  // Shared elements: [data-share="key"] in a scene entered with "morph" glides from where the element
  // with the same key sat in the previous scene.
  var morphs = [];
  scenes.forEach(function (sc) {
    if (sc.transition !== 'morph' || !sc.prev) return;
    Array.prototype.forEach.call(sc.el.querySelectorAll('[data-share]'), function (b) {
      var a = sc.prev.el.querySelector('[data-share="' + attr(b, 'data-share') + '"]');
      if (a) morphs.push({ sc: sc, a: a, b: b, ra: null, rb: null, active: false });
      // The arriving copy is the one that glides in, so it has no entrance of its own.
      var sb = specOf.get(b);
      if (sb) { sb.a = 'none'; sb.showAlways = true; }
    });
  });
  function measureMorphs() {
    morphs.forEach(function (m) { m.ra = layoutRect(m.a); m.rb = layoutRect(m.b); });
  }

  function sceneState(sc, T) {
    var st = { op: 1, tx: 0, ty: 0, s: 1, blur: 0, clip: '', panX: 0, panY: 0, fin: 1, fout: 0, hidden: false };
    if (STATIC) return st;
    var lt = T - sc.start;
    var cam = camAt(sc, lt);
    // Entering.
    if (!sc.first) {
      var hIn = halfOf(sc.transition);
      if (sc.transition === 'cut') { if (T < sc.start) st.hidden = true; }
      else {
        var fin = clamp((T - (sc.start - hIn)) / (hIn * 2));
        if (fin <= 0) st.hidden = true;
        st.fin = fin;
        var e = EASE.inout(fin);
        var F = sc.prev ? camPoint(camAt(sc.prev, T - sc.prev.start), sc.prev.focus || { x: SW / 2, y: SH / 2 }) : { x: SW / 2, y: SH / 2 };
        switch (sc.transition) {
          case 'slide': st.tx += (1 - e) * SW; break;
          case 'zoom': st.op *= fin; st.s *= lerp(1.06, 1, EASE.out(fin)); break;
          case 'push': st.tx += (1 - e) * SW; st.panX = (1 - e) * SW; break;
          case 'push-up': st.ty += (1 - e) * SH; st.panY = (1 - e) * SH; break;
          case 'zoom-in': {
            var s1 = lerp(0.3, 1, e);
            st.s *= s1; st.tx += (1 - s1) * (F.x - SW / 2); st.ty += (1 - s1) * (F.y - SH / 2);
            st.op *= clamp((fin - 0.15) / 0.5);
            break;
          }
          case 'zoom-out': st.s *= lerp(1.8, 1, e); st.op *= clamp(fin / 0.6); break;
          case 'whip': st.tx += (1 - e) * SW * 1.1; st.blur = Math.sin(Math.PI * fin) * 22; break;
          case 'circle': {
            var r = e * Math.hypot(SW, SH);
            st.clip = fin >= 1 ? '' : 'circle(' + r.toFixed(1) + 'px at ' + F.x.toFixed(1) + 'px ' + F.y.toFixed(1) + 'px)';
            break;
          }
          case 'morph': st.op *= clamp(fin / 0.35); break;
          default: st.op *= fin;   // fade
        }
      }
    }
    // Leaving.
    if (!sc.last) {
      var hOut = halfOf(sc.exitType);
      if (sc.exitType === 'cut') { if (T >= sc.end) st.hidden = true; }
      else {
        var fout = clamp((T - (sc.end - hOut)) / (hOut * 2));
        st.fout = fout;
        var e2 = EASE.inout(fout);
        switch (sc.exitType) {
          case 'slide': st.tx -= e2 * SW; break;
          case 'zoom': st.op *= 1 - fout; st.s *= lerp(1, 0.97, fout); break;
          case 'push': st.tx -= e2 * SW; st.panX = -e2 * SW; break;
          case 'push-up': st.ty -= e2 * SH; st.panY = -e2 * SH; break;
          case 'zoom-in': {
            var F2 = camPoint(cam, sc.focus || { x: SW / 2, y: SH / 2 });
            var s2 = lerp(1, 4, EASE.in(fout));
            st.s *= s2; st.tx += (1 - s2) * (F2.x - SW / 2); st.ty += (1 - s2) * (F2.y - SH / 2);
            st.op *= 1 - clamp((fout - 0.45) / 0.45);
            break;
          }
          case 'zoom-out': st.s *= lerp(1, 0.55, e2); st.op *= 1 - clamp(fout / 0.7); break;
          case 'whip': st.tx -= e2 * SW * 1.1; st.blur = Math.max(st.blur, Math.sin(Math.PI * fout) * 22); break;
          case 'circle': break;   // stays until the next scene has covered it
          case 'morph': st.op *= 1 - clamp(fout / 0.8); break;
          default: st.op *= 1 - fout;
        }
        if (fout >= 1) st.hidden = true;
      }
    }
    st.cam = cam;
    return st;
  }

  /* ---------- ambient backgrounds: <div data-ambient="particles|glow|grid|waves|gradient"> ---------- */
  // Generated and moved by the stage (on the global clock, so the same preset flows on across scenes).
  var ambients = [];
  var SVGNS = 'http://www.w3.org/2000/svg';
  Array.prototype.forEach.call(stage.querySelectorAll('[data-ambient]'), function (box, idx) {
    var kind = attr(box, 'data-ambient');
    var R = rand(4099 + idx * 7919);
    var a = { box: box, kind: kind, spd: num(attr(box, 'data-speed'), 1), items: [] };
    var colors = ['var(--accent)', 'var(--accent2)', 'var(--accent3)', 'var(--muted)'];
    if (kind === 'particles') {
      var n = Math.min(160, num(attr(box, 'data-n'), 46));
      for (var i = 0; i < n; i++) {
        var d = document.createElement('i');
        var size = 2 + R() * 6, depth = 0.35 + R() * 0.9;
        d.style.cssText = 'position:absolute;left:0;top:0;border-radius:50%;width:' + size.toFixed(1) + 'px;height:' + size.toFixed(1) + 'px;background:' +
          colors[Math.floor(R() * 4)] + ';opacity:' + (0.12 + R() * 0.4).toFixed(2);
        box.appendChild(d);
        a.items.push({ el: d, x: R() * SW, y: R() * SH, depth: depth, ph: R() * 6.28 });
      }
    } else if (kind === 'glow') {
      var ng = Math.min(6, num(attr(box, 'data-n'), 3));
      for (var g = 0; g < ng; g++) {
        var b = document.createElement('i');
        var w = SW * (0.45 + R() * 0.3);
        b.style.cssText = 'position:absolute;left:0;top:0;border-radius:50%;width:' + w.toFixed(0) + 'px;height:' + w.toFixed(0) + 'px;' +
          'background:radial-gradient(circle,color-mix(in srgb,' + colors[g % 3] + ' 42%,transparent) 0%,transparent 68%)';
        box.appendChild(b);
        a.items.push({ el: b, w: w, fx: 0.05 + R() * 0.07, fy: 0.04 + R() * 0.06, ph: R() * 6.28 });
      }
    } else if (kind === 'grid') {
      var cell = num(attr(box, 'data-cell'), 80);
      var gr = document.createElement('i');
      gr.style.cssText = 'position:absolute;inset:-' + cell + 'px;background-image:linear-gradient(color-mix(in srgb,var(--muted) 22%,transparent) 1px,transparent 1px),' +
        'linear-gradient(90deg,color-mix(in srgb,var(--muted) 22%,transparent) 1px,transparent 1px);background-size:' + cell + 'px ' + cell + 'px' +
        (has(box, 'data-tilt') ? ';transform:perspective(900px) rotateX(58deg) scale(2.2);transform-origin:50% 100%' : '');
      box.appendChild(gr);
      a.items.push({ el: gr, cell: cell });
    } else if (kind === 'waves') {
      var svg = document.createElementNS(SVGNS, 'svg');
      svg.setAttribute('width', SW); svg.setAttribute('height', SH);
      svg.style.cssText = 'position:absolute;inset:0';
      var nw = Math.min(6, num(attr(box, 'data-n'), 3));
      for (var k = 0; k < nw; k++) {
        var p = document.createElementNS(SVGNS, 'path');
        p.setAttribute('fill', 'none');
        p.setAttribute('stroke', colors[k % 3]);
        p.setAttribute('stroke-width', String(2 + k));
        p.setAttribute('opacity', (0.18 + 0.08 * k).toFixed(2));
        svg.appendChild(p);
        a.items.push({ el: p, y: SH * (0.55 + 0.1 * k), amp: 22 + R() * 30, len: 0.0035 + R() * 0.003, ph: R() * 6.28, sp: 0.5 + R() * 0.5 });
      }
      box.appendChild(svg);
    } else if (kind !== 'gradient') {
      report('data-ambient: unknown kind "' + kind + '" (particles, glow, grid, waves, gradient)');
      return;
    }
    ambients.push(a);
  });
  function updateAmbient(T) {
    for (var i = 0; i < ambients.length; i++) {
      var a = ambients[i], s = a.spd, it, j;
      if (a.kind === 'particles') {
        for (j = 0; j < a.items.length; j++) {
          it = a.items[j];
          var y = ((it.y - T * 26 * s * it.depth) % (SH + 20) + SH + 20) % (SH + 20) - 10;
          var x = it.x + Math.sin(T * 0.6 * s + it.ph) * 14 * it.depth;
          it.el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
        }
      } else if (a.kind === 'glow') {
        for (j = 0; j < a.items.length; j++) {
          it = a.items[j];
          var gx = SW * (0.5 + 0.38 * Math.sin(T * it.fx * s * 6.28 + it.ph)) - it.w / 2;
          var gy = SH * (0.5 + 0.34 * Math.cos(T * it.fy * s * 6.28 + it.ph * 1.7)) - it.w / 2;
          it.el.style.transform = 'translate(' + gx.toFixed(1) + 'px,' + gy.toFixed(1) + 'px)';
        }
      } else if (a.kind === 'grid') {
        it = a.items[0];
        var off = (T * 18 * s) % it.cell;
        it.el.style.backgroundPosition = off.toFixed(2) + 'px ' + off.toFixed(2) + 'px';
      } else if (a.kind === 'waves') {
        for (j = 0; j < a.items.length; j++) {
          it = a.items[j];
          var d = 'M0 ' + it.y.toFixed(1);
          for (var x2 = 0; x2 <= SW; x2 += 32) {
            d += ' L' + x2 + ' ' + (it.y + Math.sin(x2 * it.len * 6.28 + T * it.sp * s * 2 + it.ph) * it.amp).toFixed(1);
          }
          it.el.setAttribute('d', d);
        }
      } else if (a.kind === 'gradient') {
        var ang = 120 + T * 9 * s;
        a.box.style.background = 'linear-gradient(' + ang.toFixed(2) + 'deg,var(--bg) 0%,color-mix(in srgb,var(--accent) 16%,var(--bg)) 45%,' +
          'color-mix(in srgb,var(--accent3) 14%,var(--bg)) 70%,var(--bg) 100%)';
      }
    }
  }

  /* ---------- GSAP timelines (optional): window.STAGE_TIMELINES = {sceneId: function (tl, ctx) {...}} ---------- */
  // Each builder fills a paused timeline whose time 0 is the scene start; seek(t) moves the playhead,
  // so frames stay exact. Rebuilt after fonts load (SplitText measures lines) and after text edits.
  var gsapCtx = null;
  function buildGsap() {
    var G = window.gsap, B = window.STAGE_TIMELINES;
    if (!B) return;
    if (!G) { report('STAGE_TIMELINES needs GSAP, which is not loaded'); return; }
    ['CustomEase', 'SplitText', 'DrawSVGPlugin', 'MorphSVGPlugin', 'MotionPathPlugin'].forEach(function (n) {
      if (window[n]) { try { G.registerPlugin(window[n]); } catch (e) { /* already registered */ } }
    });
    G.ticker.lagSmoothing(0);
    if (gsapCtx) gsapCtx.revert();
    scenes.forEach(function (sc) { sc.tl = null; });
    gsapCtx = G.context(function () {
      scenes.forEach(function (sc) {
        var fn = B[sc.id];
        if (typeof fn !== 'function') return;
        var tl = G.timeline({ paused: true });
        try {
          fn(tl, { el: sc.el, q: G.utils.selector(sc.el), cue: function (n) { return sc.cues[n] != null ? sc.cues[n] : null; }, len: sc.len, W: SW, H: SH, rand: rand });
        } catch (e) { report(e); }
        sc.tl = tl;
      });
    }, stage);
  }

  /* ---------- sound effects: where they fall (the player and the renderer mix them) ---------- */
  var SFX_GAIN = { whoosh: 0.55, swoosh: 0.45, pop: 0.5, click: 0.4, tick: 0.35, ding: 0.5, riser: 0.45, paper: 0.6, marker: 0.4, type: 0.35 };
  function sfxEvents() {
    var cfg = EXTRAS.sfx || {};
    if (!cfg.enabled || STATIC) return [];
    var auto = cfg.auto !== false;
    var collage = stage.getAttribute('data-look') === 'collage';
    var ev = [];
    scenes.forEach(function (sc) {
      var own = attr(sc.el, 'data-sfx');
      if (own && own !== 'none') ev.push({ t: sc.start + (has(sc.el, 'data-sfx-at') ? cueTime(sc, attr(sc.el, 'data-sfx-at')) : 0), name: own });
      if (auto && !sc.first && sc.transition !== 'cut' && own !== 'none') {
        var tn = sc.transition === 'circle' || sc.transition === 'morph' || sc.transition === 'fade' ? 'swoosh' : 'whoosh';
        ev.push({ t: Math.max(0, sc.start - halfOf(sc.transition) * 0.7), name: tn, auto: true });
      }
      // Elements with their own data-sfx (timed by their entrance, or data-sfx-at), then automatic ones.
      Array.prototype.forEach.call(sc.el.querySelectorAll('[data-sfx]'), function (el) {
        var name = attr(el, 'data-sfx');
        if (!name || name === 'none') return;
        var spec = specOf.get(el);
        var at = has(el, 'data-sfx-at') ? cueTime(sc, attr(el, 'data-sfx-at')) : spec ? spec.inT : 0;
        ev.push({ t: sc.start + at, name: name });
      });
      if (!auto) return;
      var n = 0;
      sc.anims.slice().sort(function (a, b) { return a.inT - b.inT; }).forEach(function (s) {
        if (n >= 4 || has(s.el, 'data-sfx')) return;
        var name = s.a === 'pop' ? (collage ? 'paper' : 'pop') : s.count ? 'tick'
          : s.draw && s.el.classList && s.el.classList.contains('c-marker') ? 'marker' : s.hl ? 'marker' : null;
        if (!name) return;
        ev.push({ t: sc.start + s.inT, name: name, auto: true });
        n++;
      });
    });
    ev.sort(function (a, b) { return a.t - b.t; });
    var out = [], last = -9, vol = num(cfg.volume, 1);
    ev.forEach(function (e) {
      if (e.t < 0 || e.t > DURATION) return;
      if (e.auto && e.t - last < 0.2) return;   // automatic sounds never pile up
      out.push({ t: +e.t.toFixed(3), name: e.name, gain: +((SFX_GAIN[e.name] || 0.45) * vol).toFixed(3) });
      last = e.t;
    });
    return out;
  }

  /** Fingerprint of what the composition shows now (for the "nothing moves" check). */
  function stageSignature() {
    var s = '';
    for (var i = 0; i < scenes.length; i++) {
      var sc = scenes[i];
      if (sc.el.style.visibility === 'hidden') continue;
      var html = sc.el.innerHTML, h = 2166136261;
      for (var j = 0; j < html.length; j++) { h ^= html.charCodeAt(j); h = Math.imul(h, 16777619); }
      // The automatic camera breathing doesn't count; camera moves the composition asked for do.
      s += sc.id + ':' + (h >>> 0).toString(36) + ':' + sc.el.style.translate + sc.el.style.scale + sc.el.style.opacity + sc.el.style.clipPath +
        (sc.cam ? sc.el.style.transform : '') + ';';
    }
    return s;
  }

  function measureAll() {
    scenes.forEach(function (sc) { measureCam(sc); measureFocus(sc); });
    measureMorphs();
  }

  var hooks = window.STAGE_HOOKS || {};
  var lastT = 0;
  var GRAINY = stage.getAttribute('data-look') === 'collage' || !!stage.querySelector('.c-grain');

  function seek(t) {
    t = Number(t) || 0;
    lastT = t;
    var T = STATIC ? 1e6 : clamp(t, 0, Math.max(0, DURATION));
    for (var i = 0; i < scenes.length; i++) {
      var sc = scenes[i];
      var o = sceneState(sc, T);
      var el = sc.el;
      var visible = !o.hidden && o.op > 0.0005;
      el.style.visibility = visible ? 'visible' : 'hidden';
      el.style.opacity = o.op >= 0.999 ? '' : o.op.toFixed(4);
      el.style.translate = (o.tx || o.ty) ? o.tx.toFixed(2) + 'px ' + o.ty.toFixed(2) + 'px' : '';
      el.style.scale = Math.abs(o.s - 1) > 1e-4 ? o.s.toFixed(4) : '';
      el.style.filter = o.blur > 0.05 ? 'blur(' + o.blur.toFixed(2) + 'px)' : '';
      el.style.clipPath = o.clip;
      // Scenes are transparent; a circle reveal must cover the scene underneath, so it borrows the
      // stage's own background (colour and paper texture, which line up exactly).
      el.style.background = o.clip ? 'inherit' : '';
      el.style.transform = STATIC ? '' : camTransform(o.cam);
      if (!visible && !STATIC) continue;
      var lt = STATIC ? 1e6 : T - sc.start;
      curPan.x = o.panX; curPan.y = o.panY;
      for (var j = 0; j < sc.anims.length; j++) applySpec(sc.anims[j], lt, sc.len);
      curPan.x = 0; curPan.y = 0;
      for (var k = 0; k < sc.progress.length; k++) sc.progress[k].style.width = (clamp(lt / sc.len) * 100).toFixed(3) + '%';
      if (sc.tl) sc.tl.seek(STATIC ? sc.tl.duration() : clamp(lt, 0, Math.max(sc.len, sc.tl.duration())), false);
      var h = hooks[sc.id];
      if (typeof h === 'function') {
        try { h(ctxFor(sc, lt, T)); } catch (e) { report(e); }
      }
    }
    // Shared elements gliding between scenes ("morph").
    for (var m = 0; m < morphs.length; m++) {
      var mp = morphs[m], B = mp.sc;
      var fin = STATIC ? 1 : clamp((T - (B.start - halfOf('morph'))) / (halfOf('morph') * 2));
      var during = fin > 0 && fin < 1;
      // The arriving copy sits exactly on the original while its scene fades in (the first 35%), then
      // the original hides and the copy glides to its own place.
      mp.a.style.visibility = during && fin > 0.35 ? 'hidden' : '';
      if (during && mp.ra && mp.rb) {
        var e = EASE.inout(clamp((fin - 0.35) / 0.65)), ca = center(mp.ra), cb = center(mp.rb);
        mp.b.style.translate = ((ca.x - cb.x) * (1 - e)).toFixed(2) + 'px ' + ((ca.y - cb.y) * (1 - e)).toFixed(2) + 'px';
        mp.b.style.scale = lerp(mp.ra.w / mp.rb.w, 1, e).toFixed(4) + ' ' + lerp(mp.ra.h / mp.rb.h, 1, e).toFixed(4);
        mp.b.style.opacity = '';
        mp.active = true;
      } else if (mp.active) {
        mp.active = false;
        if (!specOf.get(mp.b)) { mp.b.style.translate = ''; mp.b.style.scale = ''; }
      }
    }
    for (var g = 0; g < globalProgress.length; g++) {
      globalProgress[g].style.width = (DURATION > 0 ? clamp(T / DURATION) * 100 : 100).toFixed(3) + '%';
    }
    if (GRAINY) {
      // Film grain jumps 12 times a second.
      var gs = STATIC ? 0 : Math.floor(T * 12);
      root.style.setProperty('--grain-x', ((gs * 97) % 300) + 'px');
      root.style.setProperty('--grain-y', ((gs * 173) % 300) + 'px');
    }
    if (ambients.length) updateAmbient(STATIC ? 0 : T);
    updateClips(T);
    if (typeof hooks['*'] === 'function') {
      try { hooks['*'](ctxFor(null, T, T)); } catch (e) { report(e); }
    }
  }

  function ctxFor(sc, lt, T) {
    var el = sc ? sc.el : stage;
    return {
      t: lt, T: T, len: sc ? sc.len : DURATION, duration: DURATION, el: el, static: STATIC,
      $: function (s) { return el.querySelector(s); },
      $$: function (s) { return Array.prototype.slice.call(el.querySelectorAll(s)); },
      cue: function (n) { return sc && sc.cues[n] != null ? sc.cues[n] : null; },
      prog: prog, ease: EASE, lerp: lerp, clamp: clamp, rand: rand
    };
  }

  function report(e) {
    var msg = String(e && e.message || e);
    if (errors.indexOf(msg) < 0) errors.push(msg);
    if (window.parent !== window) window.parent.postMessage({ type: 'stage-error', message: msg }, '*');
  }

  /* ---------- live edits (preview only) ---------- */
  function stageApply(patch) {
    patch = patch || {};
    if (patch.texts) {
      // GSAP may have split the old text into spans: undo that first, then bind the new text.
      if (gsapCtx) { gsapCtx.revert(); gsapCtx = null; }
      texts = Object.assign({}, defaults, patch.texts);
      bindTexts();
      // Typewriter specs need the newly bound text before we redraw.
      scenes.forEach(function (sc) {
        sc.anims.forEach(function (s) {
          if (s.type && s.el.hasAttribute('data-text')) s.full = texts[s.el.getAttribute('data-text')] || s.full;
        });
      });
    }
    if (patch.colors || patch.font) applyColors(patch.colors, patch.font);
    if (patch.texts) {
      measureAll();
      buildGsap();
    }
    seek(lastT);
  }

  measureAll();
  buildGsap();

  var ready = (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve())
    .then(function () {
      // Fonts change text sizes: measure again and let SplitText split the final lines.
      measureAll();
      buildGsap();
      var imgs = Array.prototype.slice.call(stage.querySelectorAll('img'));
      return Promise.all(imgs.map(function (im) { return im.decode ? im.decode().catch(function () {}) : null; }));
    })
    .then(function () { seek(lastT); return true; });

  window.DURATION = DURATION;
  window.seek = seek;
  window.stageSettle = stageSettle;
  window.stageSignature = stageSignature;
  window.STAGE_READY = ready;
  window.stageApply = stageApply;
  window.stageInfo = function () {
    return {
      duration: DURATION, static: STATIC, errors: errors.slice(),
      textDefaults: defaults,
      sfx: sfxEvents(),
      scenes: scenes.map(function (s) { return { id: s.id, start: s.start, end: s.end, len: s.len, anims: s.anims.length, transition: s.transition, gsap: !!s.tl }; })
    };
  };

  window.addEventListener('error', function (e) { report(e.error || e.message); });
  window.addEventListener('message', function (e) {
    var m = e.data || {};
    if (m.type === 'seek') seek(m.t);
    else if (m.type === 'apply') stageApply(m);
    else if (m.type === 'clips') receiveClips(m.clips);
  });

  seek(0);
  ready.then(function () {
    if (window.parent !== window) window.parent.postMessage({ type: 'stage-ready', info: window.stageInfo() }, '*');
  });
})();
