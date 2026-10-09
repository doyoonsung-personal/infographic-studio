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
    el.insertBefore(img, el.firstChild);
  });

  /* ---------- per-element animation specs ---------- */
  var ANIM_SEL = '[data-in],[data-cue],[data-a],[data-grow],[data-count],[data-draw],[data-type],[data-loop],[data-ken],[data-out],[data-out-cue]';

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
    var anc = ancestorStart(el, sc);
    // A counter inside an animated card appears with the card; on its own it fades in.
    var defA = (grow || draw || type) ? 'none' : (count ? (anc != null ? 'none' : 'fade') : 'up');
    var inT = timeFor(el, sc, 'data-in', 'data-cue', 'data-delay');
    if (inT == null && inherited) inT = inherited.inT;
    if (inT == null && anc != null) inT = anc;
    if (inT == null) inT = 0;
    var a = attr(el, 'data-a') || (inherited && inherited.a) || defA;
    var spec = {
      el: el, isSvg: isSvg, a: a, inT: inT,
      // Visible from the start of the scene (its parent handles the entrance); only the count waits.
      showAlways: count && anc != null && !attr(el, 'data-a') && !has(el, 'data-in') && !has(el, 'data-cue'),
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
      ken: has(el, 'data-ken') ? num(attr(el, 'data-ken'), 1.08) : null
    };
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

  function sceneOpacity(sc, t) {
    var half = 0.25;
    if (sc.transition === 'cut') {
      var vis = t >= sc.start && (t < sc.end || sc.last);
      return { op: vis ? 1 : 0, fin: vis ? 1 : 0, fout: 0 };
    }
    var fin = sc.first ? (t >= sc.start - half ? 1 : 0) : clamp((t - (sc.start - half)) / (half * 2));
    var fout = sc.last ? 0 : clamp((t - (sc.end - half)) / (half * 2));
    return { op: fin * (1 - fout), fin: fin, fout: fout };
  }

  var hooks = window.STAGE_HOOKS || {};
  var lastT = 0;

  function seek(t) {
    t = Number(t) || 0;
    lastT = t;
    var T = STATIC ? 1e6 : clamp(t, 0, Math.max(0, DURATION));
    for (var i = 0; i < scenes.length; i++) {
      var sc = scenes[i];
      var o = STATIC ? { op: 1, fin: 1, fout: 0 } : sceneOpacity(sc, T);
      var el = sc.el;
      el.style.visibility = o.op > 0.0005 ? 'visible' : 'hidden';
      el.style.opacity = o.op >= 0.999 ? '' : o.op.toFixed(4);
      var tr = '', scl = '';
      if (!STATIC && sc.transition === 'slide') {
        var off = o.fin < 1 ? (1 - EASE.inout(o.fin)) * 100 : -EASE.inout(o.fout) * 100;
        tr = off ? off.toFixed(3) + '% 0' : '';
        el.style.opacity = '';
      } else if (!STATIC && sc.transition === 'zoom') {
        var z = o.fin < 1 ? lerp(1.06, 1, EASE.out(o.fin)) : lerp(1, 0.97, o.fout);
        scl = z !== 1 ? z.toFixed(4) : '';
      }
      el.style.translate = tr;
      el.style.scale = scl;
      if (o.op <= 0.0005 && !STATIC) continue;
      var lt = STATIC ? 1e6 : T - sc.start;
      for (var j = 0; j < sc.anims.length; j++) applySpec(sc.anims[j], lt, sc.len);
      for (var k = 0; k < sc.progress.length; k++) sc.progress[k].style.width = (clamp(lt / sc.len) * 100).toFixed(3) + '%';
      var h = hooks[sc.id];
      if (typeof h === 'function') {
        try { h(ctxFor(sc, lt, T)); } catch (e) { report(e); }
      }
    }
    for (var g = 0; g < globalProgress.length; g++) {
      globalProgress[g].style.width = (DURATION > 0 ? clamp(T / DURATION) * 100 : 100).toFixed(3) + '%';
    }
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

  var errors = [];
  function report(e) {
    var msg = String(e && e.message || e);
    if (errors.indexOf(msg) < 0) errors.push(msg);
    if (window.parent !== window) window.parent.postMessage({ type: 'stage-error', message: msg }, '*');
  }

  /* ---------- live edits (preview only) ---------- */
  function stageApply(patch) {
    patch = patch || {};
    if (patch.texts) {
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
    seek(lastT);
  }

  var ready = (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve())
    .then(function () {
      var imgs = Array.prototype.slice.call(stage.querySelectorAll('img'));
      return Promise.all(imgs.map(function (im) { return im.decode ? im.decode().catch(function () {}) : null; }));
    })
    .then(function () { seek(lastT); return true; });

  window.DURATION = DURATION;
  window.seek = seek;
  window.STAGE_READY = ready;
  window.stageApply = stageApply;
  window.stageInfo = function () {
    return {
      duration: DURATION, static: STATIC, errors: errors.slice(),
      textDefaults: defaults,
      scenes: scenes.map(function (s) { return { id: s.id, start: s.start, end: s.end, len: s.len, anims: s.anims.length }; })
    };
  };

  window.addEventListener('error', function (e) { report(e.error || e.message); });
  window.addEventListener('message', function (e) {
    var m = e.data || {};
    if (m.type === 'seek') seek(m.t);
    else if (m.type === 'apply') stageApply(m);
  });

  seek(0);
  ready.then(function () {
    if (window.parent !== window) window.parent.postMessage({ type: 'stage-ready', info: window.stageInfo() }, '*');
  });
})();
