// capture.js — walks a rendered document and produces a layer tree for Figma.
// Runs inside the plugin UI (a browser iframe). No Figma API here.
(function (global) {
  'use strict';

  // ---------- small utils ----------
  function px(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function round(n) { return Math.round(n * 100) / 100; }

  function splitTop(str, sep) {
    // split by separator at paren depth 0
    var out = [], depth = 0, cur = '';
    for (var i = 0; i < str.length; i++) {
      var c = str[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      if (depth === 0 && (sep === ' ' ? /\s/.test(c) : c === sep)) {
        if (cur.trim() !== '') out.push(cur.trim());
        cur = '';
      } else cur += c;
    }
    if (cur.trim() !== '') out.push(cur.trim());
    return out;
  }

  var _ctx = null;
  var RGB_RE = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/;
  var SRGB_RE = /^color\(srgb\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)(?:\s*\/\s*([\d.e]+%?))?\s*\)$/;
  function alphaOf(t) { return t === undefined ? 1 : (t.indexOf('%') > -1 ? parseFloat(t) / 100 : parseFloat(t)); }
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }
  // Any CSS colour (rgb, hex, named, oklch, lab, color(), color-mix…) as sRGB 0..1, alpha included (may be 0).
  function parseColorRaw(str) {
    if (!str) return null;
    str = str.trim();
    if (str === 'none' || str === 'currentcolor') return null;
    if (str === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    var m = str.match(RGB_RE);
    if (m) return { r: +m[1] / 255, g: +m[2] / 255, b: +m[3] / 255, a: alphaOf(m[4]) };
    if ((m = str.match(SRGB_RE))) return { r: clamp01(+m[1]), g: clamp01(+m[2]), b: clamp01(+m[3]), a: alphaOf(m[4]) };
    if (!_ctx) _ctx = document.createElement('canvas').getContext('2d');
    // modern colour spaces: ask the browser to convert to sRGB (relative colour syntax)
    _ctx.fillStyle = '#010203';
    _ctx.fillStyle = 'color(from ' + str + ' srgb r g b / alpha)';
    var n = _ctx.fillStyle;
    if ((m = n.match(SRGB_RE))) return { r: clamp01(+m[1]), g: clamp01(+m[2]), b: clamp01(+m[3]), a: alphaOf(m[4]) };
    _ctx.fillStyle = '#010203';
    _ctx.fillStyle = str;
    n = _ctx.fillStyle;
    if (n === '#010203' && !/^#010203$/i.test(str)) return null; // not a colour
    if (n[0] === '#') return { r: parseInt(n.substr(1, 2), 16) / 255, g: parseInt(n.substr(3, 2), 16) / 255, b: parseInt(n.substr(5, 2), 16) / 255, a: 1 };
    if ((m = n.match(RGB_RE))) return { r: +m[1] / 255, g: +m[2] / 255, b: +m[3] / 255, a: alphaOf(m[4]) };
    if ((m = n.match(SRGB_RE))) return { r: clamp01(+m[1]), g: clamp01(+m[2]), b: clamp01(+m[3]), a: alphaOf(m[4]) };
    // last resort: paint one pixel and read it back
    try {
      var cv = document.createElement('canvas'); cv.width = cv.height = 1;
      var x = cv.getContext('2d'); x.fillStyle = str; x.fillRect(0, 0, 1, 1);
      var d = x.getImageData(0, 0, 1, 1).data;
      return { r: d[0] / 255, g: d[1] / 255, b: d[2] / 255, a: d[3] / 255 };
    } catch (e) { return null; }
  }
  function parseColor(str) {
    var c = parseColorRaw(str);
    return c && c.a > 0.001 ? c : null;
  }
  function solid(c) { return { type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: c.a }; }

  // ---------- gradients ----------
  function parseStops(parts) {
    var stops = [];
    parts.forEach(function (p) {
      var toks = splitTop(p, ' ');
      var colTok = null, positions = [];
      toks.forEach(function (t) {
        if (/^-?[\d.]+(%|px)?$/.test(t)) positions.push(t);
        else colTok = (colTok ? colTok + ' ' : '') + t;
      });
      var c = parseColorRaw(colTok);
      if (!c) return; // interpolation hints etc.
      if (positions.length === 0) stops.push({ color: c, pos: null });
      positions.forEach(function (pp) { stops.push({ color: c, pos: pp }); });
    });
    return stops;
  }
  function finalizeStops(stops, lenPx) {
    stops.forEach(function (s) {
      if (s.pos === null) return;
      s.p = s.pos.indexOf('%') > -1 ? parseFloat(s.pos) / 100 : (lenPx ? parseFloat(s.pos) / lenPx : 0);
    });
    if (stops.length && stops[0].p === undefined) stops[0].p = 0;
    if (stops.length && stops[stops.length - 1].p === undefined) stops[stops.length - 1].p = 1;
    for (var i = 0; i < stops.length; i++) {
      if (stops[i].p !== undefined) continue;
      var j = i; while (stops[j].p === undefined) j++;
      var a = stops[i - 1].p, b = stops[j].p;
      for (var k = i; k < j; k++) stops[k].p = a + (b - a) * (k - i + 1) / (j - i + 1);
    }
    // a fully transparent stop fades the neighbouring colour (CSS interpolates premultiplied)
    stops.forEach(function (s, i) {
      if (s.color.a > 0.001) return;
      var nb = null;
      for (var d = 1; d < stops.length && !nb; d++) {
        var a = stops[i - d], b = stops[i + d];
        if (a && a.color.a > 0.001) nb = a.color; else if (b && b.color.a > 0.001) nb = b.color;
      }
      if (nb) s.color = { r: nb.r, g: nb.g, b: nb.b, a: 0 };
    });
    var last = 0;
    return stops.map(function (s) {
      var p = Math.max(last, Math.min(1, Math.max(0, s.p))); last = p;
      return { color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a }, position: p };
    });
  }
  // Browsers blend gradients made of modern colours (oklch, lab, color()…) in Oklab, and every gradient with
  // premultiplied alpha; Figma blends straight sRGB. Extra stops computed the browser's way bridge the gap.
  function lin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function gam(c) { c = Math.max(0, Math.min(1, c)); return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }
  function toOklab(c) {
    var r = lin(c.r), g = lin(c.g), b = lin(c.b);
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
  }
  function fromOklab(L) {
    var l = Math.pow(L[0] + 0.3963377774 * L[1] + 0.2158037573 * L[2], 3), m = Math.pow(L[0] - 0.1055613458 * L[1] - 0.0638541728 * L[2], 3), s = Math.pow(L[0] - 0.0894841775 * L[1] - 1.2914855480 * L[2], 3);
    return { r: gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), g: gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), b: gam(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s) };
  }
  function mixColor(a, b, t, space) {
    var al = a.a + (b.a - a.a) * t;
    var ok = space !== 'srgb';
    var A = ok ? toOklab(a) : [a.r, a.g, a.b], B = ok ? toOklab(b) : [b.r, b.g, b.b], o = [];
    if (space === 'oklch') { // polar: lightness and chroma blend, hue takes the shorter way round
      var ca = Math.hypot(A[1], A[2]), cb = Math.hypot(B[1], B[2]), ha = Math.atan2(A[2], A[1]), hb = Math.atan2(B[2], B[1]);
      if (ca < 1e-4) ha = hb; if (cb < 1e-4) hb = ha;
      var dh = hb - ha; if (dh > Math.PI) dh -= 2 * Math.PI; if (dh < -Math.PI) dh += 2 * Math.PI;
      var L = al > 1e-6 ? (A[0] * a.a + (B[0] * b.a - A[0] * a.a) * t) / al : A[0] + (B[0] - A[0]) * t;
      var C = ca + (cb - ca) * t, H = ha + dh * t;
      o = [L, C * Math.cos(H), C * Math.sin(H)];
    } else for (var i = 0; i < 3; i++) o.push(al > 1e-6 ? (A[i] * a.a + (B[i] * b.a - A[i] * a.a) * t) / al : A[i] + (B[i] - A[i]) * t);
    var c = ok ? fromOklab(o) : { r: o[0], g: o[1], b: o[2] };
    return { r: c.r, g: c.g, b: c.b, a: al };
  }
  function gradientSpace(args) {
    var m = args.match(/\bin\s+([a-z0-9-]+)/);
    if (m) return m[1] === 'srgb' ? 'srgb' : /^(oklch|lch|hsl|hwb)$/.test(m[1]) ? 'oklch' : 'oklab';
    return /\b(oklch|oklab|lab|lch|color)\(/.test(args) ? 'oklab' : 'srgb';
  }
  function densify(stops, space) {
    if (stops.length < 2) return stops;
    var out = [stops[0]];
    for (var i = 1; i < stops.length; i++) {
      var a = stops[i - 1], b = stops[i], dp = b.position - a.position;
      var needs = dp > 0.001 && (space !== 'srgb' || Math.abs(a.color.a - b.color.a) > 0.01);
      if (needs) for (var k = 1; k < 8; k++) { var t = k / 8; out.push({ color: mixColor(a.color, b.color, t, space), position: a.position + dp * t }); }
      out.push(b);
    }
    return out;
  }
  function parseLinear(args, w, h) {
    var parts = splitTop(args, ',');
    parts[0] = parts[0].replace(/(^|\s)in\s+[a-z0-9-]+(\s+(shorter|longer|increasing|decreasing)\s+hue)?/, ' ').trim();
    if (!parts[0]) parts.shift();
    var angle = 180; // default: to bottom
    var first = parts[0].trim();
    if (/^-?[\d.]+(deg|turn|rad|grad)$/.test(first)) {
      var v = parseFloat(first);
      if (/turn$/.test(first)) v *= 360; else if (/grad$/.test(first)) v *= 0.9; else if (/rad$/.test(first)) v *= 180 / Math.PI;
      angle = v; parts.shift();
    } else if (/^to\s/.test(first)) {
      var d = first.replace(/^to\s+/, '').split(/\s+/);
      var hasT = d.indexOf('top') > -1, hasB = d.indexOf('bottom') > -1, hasL = d.indexOf('left') > -1, hasR = d.indexOf('right') > -1;
      if ((hasT || hasB) && (hasL || hasR)) {
        var a0 = Math.atan2(w, h) * 180 / Math.PI; // corner angle
        if (hasT && hasR) angle = a0; else if (hasB && hasR) angle = 180 - a0; else if (hasB && hasL) angle = 180 + a0; else angle = 360 - a0;
      } else angle = hasT ? 0 : hasR ? 90 : hasB ? 180 : 270;
      parts.shift();
    }
    var rad = angle * Math.PI / 180;
    var dx = Math.sin(rad), dy = -Math.cos(rad);
    var L = Math.abs(w * dx) + Math.abs(h * dy);
    var sx = (w / 2 - dx * L / 2) / w, sy = (h / 2 - dy * L / 2) / h;
    var ex = (w / 2 + dx * L / 2) / w, ey = (h / 2 + dy * L / 2) / h;
    var vx = ex - sx, vy = ey - sy, n2 = vx * vx + vy * vy || 1;
    var transform = [
      [vx / n2, vy / n2, -(sx * vx + sy * vy) / n2],
      [-vy / n2, vx / n2, -(-sx * vy + sy * vx) / n2 + 0.5]
    ];
    var stops = finalizeStops(parseStops(parts), L);
    if (stops.length < 2) return null;
    stops = densify(stops, gradientSpace(args));
    return { type: 'GRADIENT_LINEAR', gradientTransform: transform, gradientStops: stops };
  }
  function parseRadial(args, w, h) {
    var parts = splitTop(args, ',');
    parts[0] = parts[0].replace(/(^|\s)in\s+[a-z0-9-]+(\s+(shorter|longer|increasing|decreasing)\s+hue)?/, ' ').trim();
    if (!parts[0]) parts.shift();
    var cx = 0.5 * w, cy = 0.5 * h, shape = 'ellipse', size = 'farthest-corner', explicit = null;
    var first = parts[0].trim();
    if (!parseColorRaw(splitTop(first, ' ')[0])) {
      var sp = first.split(/(?:^|\s)at\s/), geo = (sp[0] || '').trim(), at = sp[1];
      if (at) {
        var toks = at.trim().split(/\s+/);
        var kw = { left: 0, center: 0.5, right: 1, top: 0, bottom: 1 };
        var len = function (t, L) { if (t in kw) return kw[t] * L; if (/%$/.test(t)) return parseFloat(t) / 100 * L; return parseFloat(t); };
        if (toks[0] === 'top' || toks[0] === 'bottom') { cy = len(toks[0], h); if (toks[1]) cx = len(toks[1], w); }
        else { if (toks[0]) cx = len(toks[0], w); if (toks[1]) cy = len(toks[1], h); }
      }
      geo.split(/\s+/).filter(Boolean).forEach(function (t) {
        if (t === 'circle' || t === 'ellipse') shape = t;
        else if (/^(closest|farthest)-(side|corner)$/.test(t)) size = t;
        else (explicit = explicit || []).push(t);
      });
      parts.shift();
    }
    var dl = cx, dr = w - cx, dt = cy, db = h - cy, rx, ry;
    if (explicit) {
      rx = /%$/.test(explicit[0]) ? parseFloat(explicit[0]) / 100 * w : parseFloat(explicit[0]);
      ry = explicit[1] ? (/%$/.test(explicit[1]) ? parseFloat(explicit[1]) / 100 * h : parseFloat(explicit[1])) : rx;
      if (explicit.length === 1) shape = 'circle';
    } else {
      var sx = size.indexOf('closest') === 0 ? Math.min(Math.abs(dl), Math.abs(dr)) : Math.max(Math.abs(dl), Math.abs(dr));
      var sy = size.indexOf('closest') === 0 ? Math.min(Math.abs(dt), Math.abs(db)) : Math.max(Math.abs(dt), Math.abs(db));
      if (shape === 'circle') {
        var r = /side$/.test(size) ? (size.indexOf('closest') === 0 ? Math.min(sx, sy) : Math.max(sx, sy)) : Math.sqrt(sx * sx + sy * sy);
        rx = ry = r;
      } else if (/side$/.test(size)) { rx = sx; ry = sy; }
      else { rx = sx * Math.SQRT2; ry = sy * Math.SQRT2; }
    }
    rx = Math.max(rx, 0.5); ry = Math.max(ry, 0.5);
    var stops = finalizeStops(parseStops(parts), rx);
    if (stops.length < 2) return null;
    stops = densify(stops, gradientSpace(args));
    // node space (0..1) -> gradient space where the ellipse is centred at (0.5,0.5) with radius 0.5
    var transform = [
      [w / (2 * rx), 0, 0.5 - cx / (2 * rx)],
      [0, h / (2 * ry), 0.5 - cy / (2 * ry)]
    ];
    return { type: 'GRADIENT_RADIAL', gradientTransform: transform, gradientStops: stops };
  }
  // All gradient layers of an element's background, bottom layer first (Figma order).
  function gradientLayers(el) {
    var win = el.ownerDocument.defaultView, cs = win.getComputedStyle(el), bi = cs.backgroundImage;
    if (!bi || bi.indexOf('gradient(') < 0) return [];
    var r = el.getBoundingClientRect(), w = r.width || 1, h = r.height || 1, out = [];
    splitTop(bi, ',').forEach(function (L) {
      var m, f = null;
      L = L.trim();
      if ((m = L.match(/^(?:-webkit-)?(repeating-)?linear-gradient\(([\s\S]*)\)$/))) f = parseLinear(m[2], w, h);
      else if ((m = L.match(/^(?:-webkit-)?(repeating-)?radial-gradient\(([\s\S]*)\)$/))) f = parseRadial(m[2], w, h);
      else if (/conic-gradient\(/.test(L)) f = { type: 'CONIC', css: L };
      if (f) out.push(f);
    });
    return out.reverse();
  }

  // ---------- shadows ----------
  function parseShadows(str, scale) {
    if (!str || str === 'none') return [];
    return splitTop(str, ',').map(function (one) {
      var toks = splitTop(one, ' ');
      var inset = false, col = null, nums = [];
      toks.forEach(function (t) {
        if (t === 'inset') inset = true;
        else if (/^-?[\d.]+(px)?$/.test(t)) nums.push(parseFloat(t) * scale);
        else col = parseColor(t) || col;
      });
      if (!col) col = { r: 0, g: 0, b: 0, a: 1 };
      if (col.a === 0) return null;
      return {
        type: inset ? 'INNER_SHADOW' : 'DROP_SHADOW',
        color: { r: col.r, g: col.g, b: col.b, a: col.a },
        offset: { x: nums[0] || 0, y: nums[1] || 0 },
        radius: Math.max(0, nums[2] || 0),
        spread: nums[3] || 0,
        visible: true, blendMode: 'NORMAL'
      };
    }).filter(Boolean);
  }

  // ---------- fonts ----------
  function fontSpec(cs, scale) {
    var fams = cs.fontFamily.split(',').map(function (f) { return f.trim().replace(/^["']|["']$/g, ''); }).filter(Boolean);
    var lh = cs.lineHeight === 'normal' ? null : px(cs.lineHeight) * scale;
    var ls = cs.letterSpacing === 'normal' ? 0 : px(cs.letterSpacing) * scale;
    var deco = (cs.textDecorationLine || cs.textDecoration || '');
    var tt = cs.textTransform;
    return {
      families: fams,
      weight: parseInt(cs.fontWeight, 10) || 400,
      italic: cs.fontStyle === 'italic' || cs.fontStyle.indexOf('oblique') === 0,
      size: Math.max(1, px(cs.fontSize) * scale),
      color: parseColor(cs.color) || { r: 0, g: 0, b: 0, a: 1 },
      lh: lh, ls: ls,
      deco: deco.indexOf('underline') > -1 ? 'UNDERLINE' : deco.indexOf('line-through') > -1 ? 'STRIKETHROUGH' : 'NONE',
      tcase: tt === 'uppercase' ? 'UPPER' : tt === 'lowercase' ? 'LOWER' : tt === 'capitalize' ? 'TITLE' : 'ORIGINAL'
    };
  }

  // ---------- the capturer ----------
  function Capturer(win, opts) {
    this.win = win; this.doc = win.document; this.opts = opts || {};
    this.images = {}; this.imgCount = 0; this.pending = [];
    this.stats = { frames: 0, texts: 0, images: 0, svgs: 0 };
  }

  Capturer.prototype.cs = function (el, pseudo) { return this.win.getComputedStyle(el, pseudo || null); };

  Capturer.prototype.addImage = function (url) {
    var self = this;
    for (var k in this.images) if (this.images[k].url === url) return k;
    var id = 'img' + (this.imgCount++);
    this.images[id] = { url: url };
    this.pending.push(loadImage(url, this.win).then(function (r) {
      self.images[id] = r ? Object.assign({ url: url }, r) : { url: url, failed: true };
    }));
    return id;
  };

  // Turn ::before / ::after into real spans so they can be measured.
  Capturer.prototype.materializePseudos = function () {
    var doc = this.doc, self = this;
    var style = doc.createElement('style');
    style.textContent = '.__f2f_nb::before{content:none!important}.__f2f_na::after{content:none!important}';
    doc.head.appendChild(style);
    var all = Array.prototype.slice.call(doc.body.querySelectorAll('*'));
    all.unshift(doc.body);
    var skipTags = { IMG: 1, INPUT: 1, TEXTAREA: 1, SELECT: 1, BR: 1, HR: 1, SVG: 1, svg: 1, VIDEO: 1, CANVAS: 1, IFRAME: 1 };
    var jobs = [];
    all.forEach(function (el) {
      if (skipTags[el.tagName] || el.closest('svg')) return;
      ['::before', '::after'].forEach(function (p) {
        var cs = self.cs(el, p);
        var content = cs.content;
        if (!content || content === 'none' || content === 'normal') return;
        if (cs.display === 'none') return;
        var txt = '';
        var m = content.match(/^"([\s\S]*)"$/) || content.match(/^'([\s\S]*)'$/);
        if (m) txt = m[1].replace(/\\([0-9a-fA-F]{1,6})\s?/g, function (_, h) { return String.fromCodePoint(parseInt(h, 16)); }).replace(/\\(.)/g, '$1');
        else if (/^url\(/.test(content)) txt = '';
        else if (/counter|attr/.test(content)) return; // rare; skip
        var decl = '';
        for (var i = 0; i < cs.length; i++) {
          var prop = cs[i];
          if (prop === 'content') continue;
          decl += prop + ':' + cs.getPropertyValue(prop) + ';';
        }
        jobs.push({ el: el, p: p, txt: txt, decl: decl, url: (content.match(/^url\(["']?(.*?)["']?\)$/) || [])[1] });
      });
    });
    jobs.forEach(function (j) {
      var span = doc.createElement('f2f-pseudo');
      span.setAttribute('style', j.decl);
      span.setAttribute('data-f2f-name', j.p.replace('::', ''));
      if (j.url) { var im = doc.createElement('img'); im.src = j.url; im.style.cssText = 'display:block;width:100%;height:100%'; span.appendChild(im); }
      else if (j.txt) span.textContent = j.txt;
      if (j.p === '::before') { j.el.insertBefore(span, j.el.firstChild); j.el.classList.add('__f2f_nb'); }
      else { j.el.appendChild(span); j.el.classList.add('__f2f_na'); }
    });
    return jobs.length;
  };

  Capturer.prototype.capture = function () {
    var doc = this.doc, win = this.win;
    var width = this.opts.width || doc.documentElement.clientWidth;
    var height = Math.max(doc.documentElement.scrollHeight, doc.body ? doc.body.scrollHeight : 0, this.opts.viewportHeight || 0);
    if (this.opts.fixedHeight) height = this.opts.viewportHeight;
    var bodyCs = this.cs(doc.body), htmlCs = this.cs(doc.documentElement);
    var bg = parseColor(bodyCs.backgroundColor) || parseColor(htmlCs.backgroundColor) || { r: 1, g: 1, b: 1, a: 1 };
    var root = {
      t: 'frame', name: this.opts.name || (doc.title || 'Claude Design') + ' — ' + width,
      x: 0, y: 0, w: width, h: height, fills: [solid(bg)], clip: true, children: []
    };
    var rootFills = this.backgroundFills(doc.body, bodyCs, { left: 0, top: 0, width: width, height: height }, 1, true);
    if (rootFills.length) root.fills = root.fills.concat(rootFills);
    this.walkChildren(doc.body, root, 1);
    this.stats.frames++;
    return root;
  };

  function ownScale(t) {
    if (!t || t === 'none') return 1;
    var m = t.match(/^matrix\(([^)]+)\)$/);
    if (m) { var v = m[1].split(',').map(parseFloat); return Math.sqrt(v[0] * v[0] + v[1] * v[1]) || 1; }
    m = t.match(/^matrix3d\(([^)]+)\)$/);
    if (m) { var w = m[1].split(',').map(parseFloat); return Math.sqrt(w[0] * w[0] + w[1] * w[1]) || 1; }
    return 1;
  }

  Capturer.prototype.isHidden = function (el, cs) {
    if (cs.display === 'none') return true;
    if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return 'self'; // children may be visible
    if (parseFloat(cs.opacity) === 0 && !this.opts.keepInvisible) return true;
    return false;
  };

  Capturer.prototype.walkChildren = function (el, parentNode, inheritedScale) {
    var kids = el.childNodes;
    this._scale = inheritedScale;
    var textOnly = false;
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.nodeType === 1) { this.walkElement(k, parentNode, inheritedScale); this._scale = inheritedScale; }
      else if (k.nodeType === 3 && !textOnly) this.walkLooseText(k, el, parentNode);
    }
  };

  // ---- text block detection: element containing only text and plain inline elements
  var INLINE_OK = { B: 1, STRONG: 1, I: 1, EM: 1, SPAN: 1, A: 1, U: 1, S: 1, SMALL: 1, MARK: 1, CODE: 1, SUB: 1, SUP: 1, BR: 1, ABBR: 1, CITE: 1, Q: 1, KBD: 1, TIME: 1, LABEL: 1, DEL: 1, INS: 1, FONT: 1, 'F2F-PSEUDO': 1 };
  Capturer.prototype.hasVisuals = function (el, cs) {
    if (parseColor(cs.backgroundColor)) return true;
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return true;
    if (cs.boxShadow && cs.boxShadow !== 'none') return true;
    var sides = ['Top', 'Right', 'Bottom', 'Left'];
    for (var i = 0; i < 4; i++) {
      var s = sides[i];
      if (px(cs['border' + s + 'Width']) > 0 && cs['border' + s + 'Style'] !== 'none' && cs['border' + s + 'Style'] !== 'hidden' && parseColor(cs['border' + s + 'Color'])) return true;
    }
    return false;
  };
  Capturer.prototype.textBlockSegments = function (el) {
    if (el.tagName === 'svg' || el.closest && el.closest('svg')) return null;
    var hasText = false, ok = true, self = this;
    (function check(node, depth) {
      for (var i = 0; i < node.childNodes.length && ok; i++) {
        var c = node.childNodes[i];
        if (c.nodeType === 3) { if (/\S/.test(c.nodeValue)) hasText = true; }
        else if (c.nodeType === 1) {
          if (!INLINE_OK[c.tagName.toUpperCase()]) { ok = false; return; }
          var cs = self.cs(c);
          if (cs.display === 'none') continue;
          if (depth > 0 || node === el) {
            if (!/^inline$|^contents$/.test(cs.display) && c.tagName !== 'BR') { ok = false; return; }
            if (cs.position === 'absolute' || cs.position === 'fixed') { ok = false; return; }
            if (self.hasVisuals(c, cs) || px(cs.paddingLeft) + px(cs.paddingRight) > 2) { ok = false; return; }
          }
          check(c, depth + 1);
        }
      }
    })(el, 0);
    return ok && hasText ? true : null;
  };

  function collapseWS(s, ws) {
    if (/^pre/.test(ws) || ws === 'break-spaces') return s;
    if (ws === 'pre-line') return s.replace(/[ \t]+/g, ' ');
    return s.replace(/\s+/g, ' ');
  }

  Capturer.prototype.collectSegments = function (el, scale) {
    var segs = [], self = this;
    (function rec(node) {
      for (var i = 0; i < node.childNodes.length; i++) {
        var c = node.childNodes[i];
        if (c.nodeType === 3) {
          var cs = self.cs(node);
          var t = collapseWS(c.nodeValue, cs.whiteSpace);
          if (t) segs.push({ text: t, style: fontSpec(cs, scale), href: node.tagName === 'A' ? node.href : null });
        } else if (c.nodeType === 1) {
          if (self.cs(c).display === 'none') continue;
          if (c.tagName === 'BR') segs.push({ text: '\n', style: fontSpec(self.cs(node), scale) });
          else rec(c);
        }
      }
    })(el);
    // trim / merge spaces across boundaries
    var out = [], prevEnd = '\n';
    segs.forEach(function (s) {
      var t = s.text;
      if (/[ \n]$/.test(prevEnd) && t[0] === ' ') t = t.replace(/^ +/, '');
      if (prevEnd === ' ' && t[0] === '\n' && out.length) { out[out.length - 1].text = out[out.length - 1].text.replace(/ +$/, ''); }
      if (!t) return;
      out.push({ text: t, style: s.style });
      prevEnd = t[t.length - 1];
    });
    if (out.length) out[out.length - 1].text = out[out.length - 1].text.replace(/[ ]+$/, '');
    return out.filter(function (s) { return s.text.length; });
  };

  function lineCount(range) {
    var rects = range.getClientRects(), lines = [];
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i]; if (r.width === 0) continue;
      var hit = lines.some(function (L) {
        var ov = Math.min(L.b, r.bottom) - Math.max(L.t, r.top);
        if (ov > 0.5 * Math.min(L.b - L.t, r.height)) { L.t = Math.min(L.t, r.top); L.b = Math.max(L.b, r.bottom); return true; }
        return false;
      });
      if (!hit) lines.push({ t: r.top, b: r.bottom });
    }
    return lines.length;
  }
  // Browsers report the glyph box; Figma lays text out on line boxes. Shift by half-leading.
  function leadingAdjust(node, range, segs) {
    var lh = segs[0].style.lh; if (!lh) return;
    var rects = range.getClientRects(), first = null;
    for (var i = 0; i < rects.length; i++) if (rects[i].width > 0) { first = rects[i]; break; }
    if (!first) return;
    var half = (lh - first.height) / 2;
    if (Math.abs(half) < 0.25) return;
    node.y -= half; node.h += 2 * half;
  }

  Capturer.prototype.makeText = function (el, cs, range, segs, scale, nameHint) {
    var r = range.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    var lines = lineCount(range);
    var align = cs.textAlign;
    var node = {
      t: 'text', name: (nameHint || segs.map(function (s) { return s.text; }).join('')).slice(0, 40).replace(/\s+/g, ' ').trim() || 'Text',
      x: r.left + this.sx, y: r.top + this.sy, w: r.width, h: r.height,
      segments: segs,
      align: align === 'center' ? 'CENTER' : (align === 'right' || align === 'end') ? 'RIGHT' : align === 'justify' ? 'JUSTIFIED' : 'LEFT',
      autoResize: 'WIDTH_AND_HEIGHT'
    };
    var hasNewline = segs.some(function (s) { return s.text.indexOf('\n') > -1; });
    if (lines > 1 || /^pre/.test(cs.whiteSpace) && hasNewline) {
      node.autoResize = 'HEIGHT';
      var flexish = /flex|grid/.test(cs.display);
      if (!flexish && el.getBoundingClientRect) {
        var er = el.getBoundingClientRect();
        var cl = er.left + (px(cs.borderLeftWidth) + px(cs.paddingLeft)) * scale;
        var cr = er.right - (px(cs.borderRightWidth) + px(cs.paddingRight)) * scale;
        if (cr - cl >= r.width - 1) { node.x = cl + this.sx; node.w = cr - cl; }
      }
      node.w += 1; // Figma text metrics are a hair wider than Chrome's
    } else if (cs.whiteSpace !== 'nowrap' && lines === 1) {
      node.autoResize = 'WIDTH_AND_HEIGHT';
    }
    if (cs.textOverflow === 'ellipsis' && cs.overflow !== 'visible') { node.truncate = true; node.autoResize = 'NONE'; }
    leadingAdjust(node, range, segs);
    if (this.opts.svgLines) { try { node.lines = computeLines(this, range, scale); } catch (e) {} }
    this.stats.texts++;
    return node;
  };

  // Per-line text layout (only needed for the SVG export used outside Figma).
  function computeLines(cap, range, scale) {
    var root = range.commonAncestorContainer, nodes = [];
    if (root.nodeType === 3) nodes = [root];
    else { var tw = cap.doc.createTreeWalker(root, 4 /* SHOW_TEXT */); var n; while ((n = tw.nextNode())) nodes.push(n); }
    var lines = [], r = cap.doc.createRange();
    nodes.forEach(function (tn) {
      var pe = tn.parentElement; if (!pe) return;
      var pcs = cap.cs(pe); if (pcs.display === 'none' || pcs.visibility === 'hidden') return;
      var st = fontSpec(pcs, scale), text = tn.nodeValue, re = /\S+/g, m;
      while ((m = re.exec(text))) {
        r.setStart(tn, m.index); r.setEnd(tn, m.index + m[0].length);
        var rects = r.getClientRects(); if (!rects.length) continue;
        var pieces = [{ t: m[0], b: rects[0] }];
        if (rects.length > 1 && Math.abs(rects[rects.length - 1].top - rects[0].top) > 2) {
          // the word itself wraps (hyphen / soft hyphen): split it where the line changes
          pieces = []; var cur = '', curRect = null, start = m.index;
          for (var ci = 0; ci < m[0].length; ci++) {
            r.setStart(tn, m.index + ci); r.setEnd(tn, m.index + ci + 1);
            var crs = r.getClientRects(), cr = crs[crs.length - 1]; // at a break the hyphen glyph is reported first
            if (cr && curRect && Math.abs(cr.top - curRect.top) > 2) { pieces.push({ t: cur, b: curRect }); cur = ''; curRect = null; }
            cur += m[0][ci];
            if (cr && cr.width > 0) {
              if (!curRect) curRect = { left: cr.left, right: cr.right, top: cr.top, bottom: cr.bottom, height: cr.height };
              else { curRect.right = Math.max(curRect.right, cr.right); curRect.bottom = Math.max(curRect.bottom, cr.bottom); }
            }
          }
          if (cur) pieces.push({ t: cur, b: curRect || rects[rects.length - 1] });
          pieces.forEach(function (p, pi) { if (pi < pieces.length - 1 && /\u00AD$/.test(p.t)) p.t = p.t.replace(/\u00AD$/, '-'); });
        }
        for (var pi2 = 0; pi2 < pieces.length; pi2++) {
        var b = pieces[pi2].b, wt = pieces[pi2].t.replace(/\u00AD/g, '');
        if (!wt) continue;
        var line = null;
        for (var i = 0; i < lines.length; i++) {
          var L = lines[i], ov = Math.min(L.bottom, b.bottom) - Math.max(L.top, b.top);
          if (ov > 0.5 * Math.min(L.bottom - L.top, b.height)) { line = L; break; }
        }
        if (!line) { line = { top: b.top, bottom: b.bottom, words: [] }; lines.push(line); }
        else { line.top = Math.min(line.top, b.top); line.bottom = Math.max(line.bottom, b.bottom); }
        line.words.push({ t: wt, x: b.left, r: b.right, top: b.top, h: b.height, st: Object.assign({}, st) });
        }
      }
    });
    lines.sort(function (a, b) { return a.top - b.top; });
    return lines.map(function (L) {
      L.words.sort(function (a, b) { return a.x - b.x; });
      var runs = [], baseline = 0;
      L.words.forEach(function (w, i) {
        baseline = Math.max(baseline, w.top + w.h * 0.8);
        var prev = L.words[i - 1];
        var sep = prev && (w.x - prev.r) > w.st.size * 0.12 ? ' ' : '';
        var last = runs[runs.length - 1];
        var same = last && JSON.stringify(last.st) === JSON.stringify(w.st);
        if (same) last.text += sep + w.t;
        else runs.push({ text: (sep && last ? ' ' : '') + w.t, st: w.st, x: w.x + cap.sx });
      });
      return { x: L.words[0].x + cap.sx, baseline: baseline + cap.sy, runs: runs };
    });
  }

  Capturer.prototype.walkLooseText = function (textNode, parentEl, parentNode) {
    if (!/\S/.test(textNode.nodeValue)) return;
    var cs = this.cs(parentEl);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    var range = this.doc.createRange(); range.selectNodeContents(textNode);
    var scale = this._scale || 1;
    var txt = collapseWS(textNode.nodeValue, cs.whiteSpace).trim();
    if (!txt) return;
    var node = this.makeText(parentEl, cs, range, [{ text: txt, style: fontSpec(cs, scale) }], scale);
    if (node) { node.autoResize = lineCount(range) > 1 ? 'HEIGHT' : 'WIDTH_AND_HEIGHT'; node.x = range.getBoundingClientRect().left + this.sx; node.w = range.getBoundingClientRect().width + 1; parentNode.children.push(node); }
  };

  Capturer.prototype.nameFor = function (el) {
    var n = el.getAttribute('data-f2f-name') || el.getAttribute('aria-label') || el.getAttribute('data-name') || el.id;
    var cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(function (c) { return c && c.indexOf('__f2f') !== 0; })[0] : '';
    var tag = el.tagName.toLowerCase();
    var friendly = { nav: 'Nav', header: 'Header', footer: 'Footer', section: 'Section', main: 'Main', button: 'Button', a: 'Link', ul: 'List', li: 'List item', img: 'Image', input: 'Input', form: 'Form', aside: 'Aside', article: 'Article', h1: 'H1', h2: 'H2', h3: 'H3', h4: 'H4', p: 'Paragraph', svg: 'Icon', 'f2f-pseudo': 'Pseudo' };
    return n || (friendly[tag] ? friendly[tag] + (cls ? ' .' + cls : '') : (cls ? '.' + cls : tag));
  };

  Capturer.prototype.backgroundFills = function (el, cs, rect, scale, skipColor) {
    var fills = [];
    var c = parseColor(cs.backgroundColor);
    if (c && !skipColor) fills.push(solid(c));
    var bi = cs.backgroundImage;
    if (bi && bi !== 'none') {
      var layers = splitTop(bi, ',');
      var sizes = splitTop(cs.backgroundSize || '', ',');
      var layerFills = [];
      for (var i = 0; i < layers.length; i++) {
        var L = layers[i], f = null;
        var m;
        if ((m = L.match(/^(?:-webkit-)?(repeating-)?linear-gradient\(([\s\S]*)\)$/))) f = parseLinear(m[2], rect.width, rect.height);
        else if ((m = L.match(/^(?:-webkit-)?(repeating-)?radial-gradient\(([\s\S]*)\)$/))) f = parseRadial(m[2], rect.width, rect.height);
        else if ((m = L.match(/^url\(["']?([\s\S]*?)["']?\)$/))) {
          var sz = (sizes[i] || sizes[0] || 'auto').trim();
          var mode = sz === 'contain' ? 'FIT' : sz === 'cover' ? 'FILL' : (/repeat/.test(cs.backgroundRepeat) && sz === 'auto' && !/no-repeat/.test(cs.backgroundRepeat)) ? 'TILE' : 'FILL';
          f = { type: 'IMAGE', imageId: this.addImage(m[1]), scaleMode: mode };
        }
        if (f) layerFills.push(f);
      }
      // CSS: first layer is on top. Figma: last fill is on top.
      fills = fills.concat(layerFills.reverse());
    }
    return fills;
  };

  Capturer.prototype.decorate = function (node, el, cs, rect, scale) {
    var fills = this.backgroundFills(el, cs, rect, scale, false);
    if (fills.length) node.fills = fills;
    // borders
    var sides = ['Top', 'Right', 'Bottom', 'Left'], W = {}, col = null, dashed = false, any = false;
    sides.forEach(function (s) {
      var w = px(cs['border' + s + 'Width']), st = cs['border' + s + 'Style'], c = parseColor(cs['border' + s + 'Color']);
      if (w > 0 && st !== 'none' && st !== 'hidden' && c) { W[s] = w * scale; any = true; if (!col) col = c; if (st === 'dashed' || st === 'dotted') dashed = st; }
      else W[s] = 0;
    });
    if (any) {
      node.strokes = [solid(col)];
      node.strokeWeights = { t: W.Top, r: W.Right, b: W.Bottom, l: W.Left };
      if (dashed) { var bw = Math.max(W.Top, W.Right, W.Bottom, W.Left); node.dash = dashed === 'dotted' ? [bw, bw] : [bw * 3, bw * 2]; }
    }
    // outline (focus rings etc.)
    if (cs.outlineStyle && cs.outlineStyle !== 'none' && px(cs.outlineWidth) > 0 && !any) {
      var oc = parseColor(cs.outlineColor);
      if (oc) { node.strokes = [solid(oc)]; node.strokeWeights = { t: px(cs.outlineWidth) * scale, r: px(cs.outlineWidth) * scale, b: px(cs.outlineWidth) * scale, l: px(cs.outlineWidth) * scale }; node.strokeAlign = 'OUTSIDE'; }
    }
    // radius
    var rad = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map(function (k) {
      var v = (cs['border' + k + 'Radius'] || '0').split(/\s+/)[0];
      var n = /%$/.test(v) ? parseFloat(v) / 100 * Math.min(rect.width, rect.height) * (parseFloat(v) >= 50 ? 1 : 1) : px(v) * scale;
      return Math.min(n, Math.min(rect.width, rect.height) / 2);
    });
    if (rad.some(function (r) { return r > 0; })) node.radius = rad;
    // effects
    var fx = parseShadows(cs.boxShadow, scale);
    var blur = (cs.filter || '').match(/blur\(([\d.]+)px\)/);
    if (blur) fx.push({ type: 'LAYER_BLUR', radius: parseFloat(blur[1]) * 2 * scale, visible: true });
    var bblur = (cs.backdropFilter || cs.webkitBackdropFilter || '').match(/blur\(([\d.]+)px\)/);
    if (bblur) fx.push({ type: 'BACKGROUND_BLUR', radius: parseFloat(bblur[1]) * 2 * scale, visible: true });
    if (fx.length) node.effects = fx;
    var op = parseFloat(cs.opacity);
    if (op < 1) node.opacity = op;
    if (/hidden|clip|auto|scroll/.test(cs.overflowX + cs.overflowY)) node.clip = true;
    if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') node.blend = cs.mixBlendMode;
    var rot = rotationOf(cs.transform);
    if (rot) node.rotation = rot;
  };

  function rotationOf(t) {
    if (!t || t === 'none') return 0;
    var m = t.match(/^matrix\(([^)]+)\)$/);
    if (!m) return 0;
    var v = m[1].split(',').map(parseFloat);
    var deg = Math.atan2(v[1], v[0]) * 180 / Math.PI;
    return Math.abs(deg) > 0.5 ? deg : 0;
  }

  // Unrotated layout box for rotated elements (bounding rect is axis-aligned)
  function layoutRect(el, rect, rot, scale) {
    if (!rot || !el.offsetWidth) return rect;
    var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    var w = el.offsetWidth * (scale || 1), h = el.offsetHeight * (scale || 1);
    return { left: cx - w / 2, top: cy - h / 2, width: w, height: h, right: cx + w / 2, bottom: cy + h / 2 };
  }

  // List markers (bullets / numbers) are not in the DOM — draw them as text.
  var _mctx = null;
  function toAlpha(n, upper) { var s = ''; while (n > 0) { n--; s = String.fromCharCode(97 + n % 26) + s; n = Math.floor(n / 26); } return upper ? s.toUpperCase() : s; }
  function toRoman(n) { var r = '', m = [[1000,'m'],[900,'cm'],[500,'d'],[400,'cd'],[100,'c'],[90,'xc'],[50,'l'],[40,'xl'],[10,'x'],[9,'ix'],[5,'v'],[4,'iv'],[1,'i']]; m.forEach(function (p) { while (n >= p[0]) { r += p[1]; n -= p[0]; } }); return r; }
  Capturer.prototype.addMarker = function (el, cs, parentNode, scale) {
    if (cs.display !== 'list-item' || cs.listStyleType === 'none' || cs.listStyleImage !== 'none') return;
    var type = cs.listStyleType, idx = 1;
    var list = el.parentElement;
    if (list) {
      var start = list.tagName === 'OL' && list.hasAttribute('start') ? parseInt(list.getAttribute('start'), 10) : 1;
      var lis = Array.prototype.filter.call(list.children, function (c) { return c.tagName === 'LI'; });
      idx = start + lis.indexOf(el);
      if (list.hasAttribute('reversed')) idx = start + lis.length - 1 - lis.indexOf(el);
    }
    var txt = type === 'disc' ? '•' : type === 'circle' ? '◦' : type === 'square' ? '▪' :
      type === 'decimal' ? idx + '.' : type === 'decimal-leading-zero' ? (idx < 10 ? '0' : '') + idx + '.' :
      /lower-(alpha|latin)/.test(type) ? toAlpha(idx) + '.' : /upper-(alpha|latin)/.test(type) ? toAlpha(idx, true) + '.' :
      type === 'lower-roman' ? toRoman(idx) + '.' : type === 'upper-roman' ? toRoman(idx).toUpperCase() + '.' : /^"/.test(type) ? type.slice(1, -1) : '•';
    var mcs = this.cs(el, '::marker');
    var st = fontSpec(mcs && mcs.fontSize ? mcs : cs, scale);
    if (mcs && parseColor(mcs.color)) st.color = parseColor(mcs.color);
    if (!_mctx) _mctx = document.createElement('canvas').getContext('2d');
    _mctx.font = st.weight + ' ' + st.size + 'px ' + cs.fontFamily;
    var mw = _mctx.measureText(txt + ' ').width;
    // first line box of the item
    var range = this.doc.createRange(); range.selectNodeContents(el);
    var rects = range.getClientRects(); var first = rects[0] || el.getBoundingClientRect();
    var er = el.getBoundingClientRect();
    var contentLeft = er.left + (px(cs.borderLeftWidth) + px(cs.paddingLeft)) * scale;
    var inside = cs.listStylePosition === 'inside';
    if (inside) return; // inside markers are part of the text flow; rare in designs
    var lh = st.lh || first.height;
    parentNode.children.push({ t: 'text', name: 'Marker', x: contentLeft - mw + this.sx, y: first.top - (lh - first.height) / 2 + this.sy, w: mw, h: lh,
      segments: [{ text: txt, style: st }], align: 'LEFT', autoResize: 'WIDTH_AND_HEIGHT' });
    this.stats.texts++;
  };

  Capturer.prototype.walkElement = function (el, parentNode, inheritedScale) {
    var tag = el.tagName.toUpperCase();
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE' || tag === 'HEAD' || tag === 'META' || tag === 'LINK' || tag === 'TITLE' || tag === 'BR') return;
    var cs = this.cs(el);
    var hidden = this.isHidden(el, cs);
    if (hidden === true) return;
    if (cs.display === 'contents') { this.walkChildren(el, parentNode, inheritedScale); return; }
    var brect = el.getBoundingClientRect();
    var rot = rotationOf(cs.transform);
    var scale = inheritedScale * ownScale(cs.transform);
    var rect = layoutRect(el, brect, rot, scale);
    var node;

    // screen-reader-only content (visually hidden): 1px clipped boxes
    if ((brect.width <= 1.5 && brect.height <= 1.5 && /hidden|clip/.test(cs.overflow)) || /rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)/.test(cs.clip) || /inset\(50%\)/.test(cs.clipPath)) return;

    if (hidden === 'self') { // invisible box, but children may show
      this.walkChildren(el, parentNode, scale);
      return;
    }

    if (tag === 'SVG') {
      if (rect.width < 0.5 || rect.height < 0.5) return;
      node = { t: 'svg', name: this.nameFor(el), x: rect.left + this.sx, y: rect.top + this.sy, w: rect.width, h: rect.height, svg: serializeSvg(el, this.win, rect) };
      if (parseFloat(cs.opacity) < 1) node.opacity = parseFloat(cs.opacity);
      this.stats.svgs++;
      parentNode.children.push(node);
      return;
    }

    node = { t: 'frame', name: this.nameFor(el), x: rect.left + this.sx, y: rect.top + this.sy, w: rect.width, h: rect.height, children: [] };
    this.decorate(node, el, cs, rect, scale);
    if (tag === 'LI') this.addMarker(el, cs, parentNode, scale);

    if (tag === 'IMG' || tag === 'PICTURE' && el.querySelector('img')) {
      var img = tag === 'IMG' ? el : el.querySelector('img');
      var src = img.currentSrc || img.src;
      if (src) {
        var fit = cs.objectFit;
        node.fills = (node.fills || []).concat([{ type: 'IMAGE', imageId: this.addImage(src), scaleMode: fit === 'contain' || fit === 'scale-down' ? 'FIT' : fit === 'fill' ? 'STRETCH' : 'FILL' }]);
        node.name = img.alt ? 'Image: ' + img.alt.slice(0, 30) : 'Image';
        this.stats.images++;
      }
      node.children = [];
      if (rect.width > 0 && rect.height > 0) parentNode.children.push(node);
      return;
    }
    if (tag === 'CANVAS') {
      try { var du = el.toDataURL('image/png'); node.fills = [{ type: 'IMAGE', imageId: this.addImage(du), scaleMode: 'FILL' }]; } catch (e) { node.fills = [solid({ r: .9, g: .9, b: .9, a: 1 })]; }
      parentNode.children.push(node); return;
    }
    if (tag === 'VIDEO') {
      if (el.poster) node.fills = [{ type: 'IMAGE', imageId: this.addImage(el.poster), scaleMode: 'FILL' }];
      else node.fills = [solid({ r: .1, g: .1, b: .1, a: 1 })];
      node.name = 'Video'; parentNode.children.push(node); return;
    }
    if (tag === 'IFRAME') {
      var sub = null;
      try { if (el.contentDocument && el.contentDocument.body) sub = { win: el.contentWindow, doc: el.contentDocument }; } catch (e) { sub = null; }
      node.name = el.getAttribute('title') || el.getAttribute('name') || 'Embed';
      node.clip = true;
      if (!sub) { node.fills = (node.fills || []).concat([solid({ r: .93, g: .93, b: .93, a: 1 })]); node.name += ' (embed not readable)'; parentNode.children.push(node); return; }
      // the embedded page's own background
      var ics = sub.win.getComputedStyle(sub.doc.body), hcs = sub.win.getComputedStyle(sub.doc.documentElement);
      var ibg = parseColor(hcs.backgroundColor) || null, bbg = parseColor(ics.backgroundColor) || null;
      var bgs = [];
      if (ibg) bgs.push(solid(ibg));
      if (bbg) bgs.push(solid(bbg));
      if (!bgs.length && !node.fills) bgs.push(solid({ r: 1, g: 1, b: 1, a: 1 }));
      if (bgs.length) node.fills = (node.fills || []).concat(bgs);
      var ox = node.x + (px(cs.borderLeftWidth) + px(cs.paddingLeft)) * scale;
      var oy = node.y + (px(cs.borderTopWidth) + px(cs.paddingTop)) * scale;
      var subC = new Capturer(sub.win, this.opts);
      subC.images = this.images; subC.pending = this.pending; subC.stats = this.stats; subC.addImage = this.addImage.bind(this);
      subC.sx = 0; subC.sy = 0;
      try { subC.materializePseudos(); } catch (e) {}
      var holder = { children: [] };
      subC.walkChildren(sub.doc.body, holder, 1);
      holder.children.forEach(function (ch) { transformTree(ch, scale, ox, oy); node.children.push(ch); });
      node.artboard = true;
      this.stats.frames++;
      parentNode.children.push(node); return;
    }
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      var type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'hidden') return;
      if (type === 'checkbox' || type === 'radio') {
        if (!node.strokes) { node.strokes = [solid({ r: .5, g: .5, b: .5, a: 1 })]; node.strokeWeights = { t: 1, r: 1, b: 1, l: 1 }; }
        if (type === 'radio') node.radius = [rect.width / 2, rect.width / 2, rect.width / 2, rect.width / 2];
        else if (!node.radius) node.radius = [2, 2, 2, 2];
        if (el.checked) node.fills = [solid(parseColor(cs.accentColor) || { r: .1, g: .45, b: .95, a: 1 })];
        parentNode.children.push(node); return;
      }
      var val = tag === 'SELECT' ? (el.options[el.selectedIndex] || {}).text : el.value;
      var isPh = !val;
      if (isPh) val = el.getAttribute('placeholder') || '';
      if (type === 'range') { parentNode.children.push(node); return; }
      if (val) {
        var tcs = isPh ? this.cs(el, '::placeholder') : cs;
        var st = fontSpec(cs, scale);
        if (isPh) st.color = parseColor(tcs.color) || { r: .6, g: .6, b: .6, a: 1 };
        var padL = (px(cs.paddingLeft) + px(cs.borderLeftWidth)) * scale;
        var lh = st.lh || st.size * 1.2;
        var ty = tag === 'TEXTAREA' ? rect.top + (px(cs.paddingTop) + px(cs.borderTopWidth)) * scale : rect.top + (rect.height - lh) / 2;
        var tn = { t: 'text', name: isPh ? 'Placeholder' : 'Value', x: rect.left + padL + this.sx, y: ty + this.sy, w: rect.width - padL * 2, h: lh, segments: [{ text: val, style: st }], align: cs.textAlign === 'center' ? 'CENTER' : cs.textAlign === 'right' ? 'RIGHT' : 'LEFT', autoResize: tag === 'TEXTAREA' ? 'HEIGHT' : 'NONE' };
        if (tn.w < 1) tn.w = 1;
        if (!st.lh) st.lh = lh;
        node.children.push(tn); this.stats.texts++;
      }
      node.name = tag === 'TEXTAREA' ? 'Textarea' : tag === 'SELECT' ? 'Select' : 'Input';
      parentNode.children.push(node); this.stats.frames++; return;
    }
    if (tag === 'HR') { parentNode.children.push(node); return; }

    // text block: one Figma text layer for the whole element
    if (this.textBlockSegments(el)) {
      var segs = this.collectSegments(el, scale);
      if (segs.length) {
        var range = this.doc.createRange(); range.selectNodeContents(el);
        var textNode = this.makeText(el, cs, range, segs, scale, null);
        if (textNode) {
          var padded = (tag === 'BUTTON' || tag === 'A') && (px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.paddingTop) + px(cs.paddingBottom)) >= 8;
          var visuals = node.fills || node.strokes || node.effects || node.opacity !== undefined || padded;
          if (!visuals && !node.clip) { // plain text element: emit text only
            textNode.name = this.nameFor(el) === el.tagName.toLowerCase() ? textNode.name : textNode.name;
            if (node.rotation) textNode.rotation = node.rotation;
            parentNode.children.push(textNode); return;
          }
          node.children.push(textNode);
          parentNode.children.push(node); this.stats.frames++; return;
        }
      }
    }

    this.walkChildren(el, node, scale);

    var visible = node.fills || node.strokes || node.effects;
    if (!visible && node.children.length === 0) return; // empty spacer
    if (!visible && (rect.width < 0.5 || rect.height < 0.5)) { // zero-size wrapper: hoist children
      for (var i = 0; i < node.children.length; i++) {
        if (node.opacity !== undefined) node.children[i].opacity = (node.children[i].opacity === undefined ? 1 : node.children[i].opacity) * node.opacity;
        parentNode.children.push(node.children[i]);
      }
      return;
    }
    if (this.opts.autoLayout) this.tryAutoLayout(node, el, cs, rect, scale);
    parentNode.children.push(node); this.stats.frames++;
  };

  // ---------- auto layout inference (only when it is safe) ----------
  Capturer.prototype.tryAutoLayout = function (node, el, cs, rect, scale) {
    if (!/flex/.test(cs.display)) return;
    if (cs.flexWrap && cs.flexWrap !== 'nowrap') return;
    if (node.rotation) return;
    var kids = node.children;
    if (kids.length === 0) return;
    // all DOM children must be in-flow
    for (var i = 0; i < el.children.length; i++) {
      var ccs = this.cs(el.children[i]);
      if (ccs.position === 'absolute' || ccs.position === 'fixed') return;
      if (rotationOf(ccs.transform)) return;
    }
    if (kids.some(function (k) { return k.rotation; })) return;
    var row = /^row/.test(cs.flexDirection);
    var reverse = /reverse/.test(cs.flexDirection);
    var ordered = kids.slice().sort(function (a, b) { return row ? a.x - b.x : a.y - b.y; });
    if (reverse) return;
    // order must match DOM order (no `order:` tricks)
    for (i = 0; i < kids.length; i++) if (kids[i] !== ordered[i]) return;
    var bl = (px(cs.borderLeftWidth)) * scale, bt = px(cs.borderTopWidth) * scale, br = px(cs.borderRightWidth) * scale, bb = px(cs.borderBottomWidth) * scale;
    var x0 = node.x + bl, y0 = node.y + bt, x1 = node.x + node.w - br, y1 = node.y + node.h - bb;
    var gaps = [];
    for (i = 1; i < kids.length; i++) {
      var a = kids[i - 1], b = kids[i];
      var g = row ? b.x - (a.x + a.w) : b.y - (a.y + a.h);
      if (g < -0.5) return; // overlap
      gaps.push(g);
    }
    var gap = gaps.length ? gaps[0] : 0;
    var uniform = gaps.every(function (g) { return Math.abs(g - gap) < 1.5; });
    var jc = cs.justifyContent;
    var primaryAlign = 'MIN';
    if (/space-between/.test(jc)) primaryAlign = 'SPACE_BETWEEN';
    else if (!uniform) return;
    var first = kids[0], last = kids[kids.length - 1];
    var padL = px(cs.paddingLeft) * scale, padR = px(cs.paddingRight) * scale, padT = px(cs.paddingTop) * scale, padB = px(cs.paddingBottom) * scale;
    // check start position matches padding; otherwise derive alignment
    var startDelta = row ? first.x - (x0 + padL) : first.y - (y0 + padT);
    var endDelta = row ? (x1 - padR) - (last.x + last.w) : (y1 - padB) - (last.y + last.h);
    if (primaryAlign !== 'SPACE_BETWEEN') {
      if (Math.abs(startDelta) < 1.5) primaryAlign = 'MIN';
      else if (Math.abs(endDelta) < 1.5) primaryAlign = 'MAX';
      else if (Math.abs(startDelta - endDelta) < 1.5) primaryAlign = 'CENTER';
      else return;
    } else if (Math.abs(startDelta) > 1.5 || Math.abs(endDelta) > 1.5) return;
    // counter axis
    var counterSize = row ? (y1 - y0 - padT - padB) : (x1 - x0 - padL - padR);
    var cStart = row ? y0 + padT : x0 + padL;
    var aligns = kids.map(function (k) {
      var ks = row ? k.y : k.x, kz = row ? k.h : k.w;
      var d0 = ks - cStart, d1 = (cStart + counterSize) - (ks + kz);
      if (Math.abs(d0) < 1.5 && Math.abs(d1) < 1.5) return 'STRETCH';
      if (Math.abs(d0) < 1.5) return 'MIN';
      if (Math.abs(d1) < 1.5) return 'MAX';
      if (Math.abs(d0 - d1) < 1.5) return 'CENTER';
      return null;
    });
    if (aligns.some(function (a) { return a === null; })) return;
    var nonStretch = aligns.filter(function (a) { return a !== 'STRETCH'; });
    var counterAlign = nonStretch.length ? nonStretch[0] : 'MIN';
    if (nonStretch.some(function (a) { return a !== counterAlign; })) return;
    node.layout = {
      mode: row ? 'HORIZONTAL' : 'VERTICAL',
      gap: primaryAlign === 'SPACE_BETWEEN' ? 0 : Math.max(0, gap),
      pad: [padT + bt, padR + br, padB + bb, padL + bl].map(function (v) { return Math.max(0, v); }),
      primary: primaryAlign, counter: counterAlign
    };
    kids.forEach(function (k, idx) { if (aligns[idx] === 'STRETCH' && counterAlign !== 'STRETCH') k.layoutAlign = 'STRETCH'; });
    if (counterAlign === 'STRETCH') { node.layout.counter = 'MIN'; kids.forEach(function (k) { k.layoutAlign = 'STRETCH'; }); }
  };

  // ---------- SVG serialisation ----------
  var SVG_DEFAULTS = { 'opacity': '1', 'fill-opacity': '1', 'stroke-opacity': '1', 'stroke-dasharray': 'none', 'fill-rule': 'nonzero', 'clip-rule': 'nonzero', 'stroke-linecap': 'butt', 'stroke-linejoin': 'miter', 'stop-opacity': '1' };
  var SVG_SHAPE_PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'clip-rule'];
  var SVG_TEXT_PROPS = ['font-family', 'font-size', 'font-weight', 'text-anchor'];
  function serializeSvg(svg, win, rect) {
    var clone = svg.cloneNode(true);
    var src = [svg].concat(Array.prototype.slice.call(svg.querySelectorAll('*')));
    var dst = [clone].concat(Array.prototype.slice.call(clone.querySelectorAll('*')));
    for (var i = 0; i < src.length; i++) {
      var cs = win.getComputedStyle(src[i]);
      var d = dst[i], tag = d.tagName.toLowerCase();
      if (cs.display === 'none') { d.setAttribute('display', 'none'); continue; }
      var props = tag === 'stop' ? ['stop-color', 'stop-opacity'] : SVG_SHAPE_PROPS.concat(tag === 'text' || tag === 'tspan' ? SVG_TEXT_PROPS : []);
      props.forEach(function (p) {
        var v = cs.getPropertyValue(p);
        if (!v) return;
        if (SVG_DEFAULTS[p] === v) { d.removeAttribute(p); return; }
        if (p === 'stroke-width' || p === 'font-size') v = String(parseFloat(v));
        if ((p === 'fill' || p === 'stroke' || p === 'stop-color') && /^rgba?\(/.test(v)) {
          var c = parseColor(v);
          if (!c) v = 'none';
          else {
            v = 'rgb(' + Math.round(c.r * 255) + ',' + Math.round(c.g * 255) + ',' + Math.round(c.b * 255) + ')';
            if (c.a < 1) d.setAttribute(p === 'stop-color' ? 'stop-opacity' : p + '-opacity', String(c.a));
          }
        }
        d.setAttribute(p, v);
      });
      if (cs.visibility === 'hidden') d.setAttribute('visibility', 'hidden');
      d.removeAttribute('style');
      d.removeAttribute('class');
    }
    clone.setAttribute('width', rect.width);
    clone.setAttribute('height', rect.height);
    if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    // inline <use href="#id"> targets that live outside this svg
    Array.prototype.forEach.call(clone.querySelectorAll('use'), function (u) {
      var href = u.getAttribute('href') || u.getAttribute('xlink:href');
      if (href && href[0] === '#' && !clone.querySelector(href)) {
        var target = svg.ownerDocument.querySelector(href);
        if (target) { var defs = clone.querySelector('defs') || clone.insertBefore(document.createElementNS('http://www.w3.org/2000/svg', 'defs'), clone.firstChild); defs.appendChild(target.cloneNode(true)); }
      }
    });
    return new XMLSerializer().serializeToString(clone);
  }

  // ---------- image loading ----------
  function sniff(bytes) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png';
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) return 'jpg';
    if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'gif';
    var head = new TextDecoder().decode(bytes.slice(0, 300)).trim();
    if (/^(<\?xml|<svg|<!--)/i.test(head) && /<svg/i.test(new TextDecoder().decode(bytes.slice(0, 2000)))) return 'svg';
    return 'other';
  }
  function loadImage(url, win) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then(function (buf) {
        var bytes = new Uint8Array(buf);
        var kind = sniff(bytes);
        if (kind === 'svg') return { svg: new TextDecoder().decode(bytes) };
        var blobUrl = URL.createObjectURL(new Blob([bytes]));
        return new Promise(function (res) {
          var im = new Image();
          im.onload = function () {
            var w = im.naturalWidth, h = im.naturalHeight;
            if ((kind === 'png' || kind === 'jpg' || kind === 'gif') && w <= 4096 && h <= 4096) { URL.revokeObjectURL(blobUrl); return res({ bytes: bytes, w: w, h: h }); }
            var s = Math.min(1, 4096 / Math.max(w, h));
            var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
            c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
            c.toBlob(function (b) {
              URL.revokeObjectURL(blobUrl);
              if (!b) return res(null);
              b.arrayBuffer().then(function (ab) { res({ bytes: new Uint8Array(ab), w: c.width, h: c.height }); });
            }, 'image/png');
          };
          im.onerror = function () { URL.revokeObjectURL(blobUrl); res(null); };
          im.src = blobUrl;
        });
      })
      .catch(function () { return null; });
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // Move/scale a captured subtree (used for content of embedded frames).
  function transformTree(n, s, ox, oy) {
    n.x = ox + n.x * s; n.y = oy + n.y * s; n.w *= s; n.h *= s;
    if (s !== 1) {
      if (n.segments) n.segments.forEach(function (g) { g.style.size *= s; if (g.style.lh) g.style.lh *= s; if (g.style.ls) g.style.ls *= s; });
      if (n.strokeWeights) for (var k in n.strokeWeights) n.strokeWeights[k] *= s;
      if (n.radius) n.radius = n.radius.map(function (r) { return r * s; });
      if (n.dash) n.dash = n.dash.map(function (r) { return r * s; });
      if (n.effects) n.effects.forEach(function (e) { e.radius *= s; if (e.offset) { e.offset.x *= s; e.offset.y *= s; } if (e.spread) e.spread *= s; });
      if (n.layout) { n.layout.gap *= s; n.layout.pad = n.layout.pad.map(function (v) { return v * s; }); }
    }
    if (n.lines) n.lines.forEach(function (L) {
      L.x = ox + L.x * s; L.baseline = oy + L.baseline * s;
      L.runs.forEach(function (r) { r.x = ox + r.x * s; if (s !== 1) { r.st.size *= s; if (r.st.ls) r.st.ls *= s; } });
    });
    if (n.children) n.children.forEach(function (c) { transformTree(c, s, ox, oy); });
  }
  // Shift a tree's absolute coordinates (no scaling)
  function shiftTree(n, dx, dy) { n.x += dx; n.y += dy; if (n.lines) n.lines.forEach(function (L) { L.x += dx; L.baseline += dy; L.runs.forEach(function (r) { r.x += dx; }); }); if (n.children) n.children.forEach(function (c) { shiftTree(c, dx, dy); }); }

  function frameDocs(win, out) {
    out = out || [];
    var doc; try { doc = win.document; } catch (e) { return out; }
    if (!doc) return out;
    out.push(win);
    var frames = doc.querySelectorAll('iframe');
    for (var i = 0; i < frames.length; i++) {
      try { if (frames[i].contentWindow && frames[i].contentDocument) frameDocs(frames[i].contentWindow, out); } catch (e) {}
    }
    return out;
  }
  var PRELUDE_CSS = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important}html{scroll-behavior:auto!important}';
  function ensurePrelude(win) {
    var doc = win.document;
    if (!doc || !doc.documentElement || doc.getElementById('__f2f_prelude2')) return;
    var st = doc.createElement('style'); st.id = '__f2f_prelude2'; st.textContent = PRELUDE_CSS;
    (doc.head || doc.documentElement).appendChild(st);
  }
  // Wait until the page (and embedded pages) stop changing — bundled exports unpack themselves asynchronously.
  async function settle(win, maxMs) {
    var start = Date.now(), last = -1, stable = 0;
    while (Date.now() - start < maxMs) {
      var wins = frameDocs(win), count = 0, loading = false;
      wins.forEach(function (w) {
        var d = w.document;
        count += d.getElementsByTagName('*').length + 1000 * (d.body ? 1 : 0);
        if (d.readyState !== 'complete') loading = true;
        if (d.getElementById('__bundler_loading') || d.getElementById('__bundler_placeholder')) loading = true;
        if (d.location && d.location.href === 'about:blank' && w !== win) loading = true;
      });
      if (!loading && count === last) { if (++stable >= 3) return; } else stable = 0;
      last = count;
      await sleep(250);
    }
  }
  function unfoldScrollers(win, vh) {
    var doc = win.document, n = 0;
    var all = doc.body ? doc.body.querySelectorAll('*') : [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i], cs = win.getComputedStyle(el);
      if (!/(auto|scroll)/.test(cs.overflowY)) continue;
      if (el.scrollHeight <= el.clientHeight + 4) continue;
      if (el.clientHeight < vh * 0.5) continue; // leave small scroll boxes (dropdowns, code blocks) alone
      el.style.setProperty('overflow', 'visible', 'important');
      el.style.setProperty('height', 'auto', 'important');
      el.style.setProperty('max-height', 'none', 'important');
      n++;
    }
    if (n) [doc.documentElement, doc.body].forEach(function (e) { e.style.setProperty('height', 'auto', 'important'); e.style.setProperty('overflow', 'visible', 'important'); });
    return n;
  }
  async function prepareAndRun(win, opts) {
    var doc = win.document, vh = opts.viewportHeight;
    await settle(win, 20000);
    var wins = frameDocs(win);
    wins.forEach(ensurePrelude);
    for (var i = 0; i < wins.length; i++) { try { await Promise.race([wins[i].document.fonts.ready, sleep(5000)]); } catch (e) {} }
    await sleep(opts.wait || 0);
    if (opts.expand) unfoldScrollers(win, vh);
    if (!opts.fixedHeight) { // scroll through so lazy images / scroll-reveal animations fire
      var H = doc.documentElement.scrollHeight;
      for (var y = 0; y < H; y += Math.round(vh * 0.8)) { win.scrollTo(0, y); await sleep(40); }
      win.scrollTo(0, 0); await sleep(250);
    }
    await settle(win, 5000);
    wins = frameDocs(win);
    wins.forEach(ensurePrelude);
    for (i = 0; i < wins.length; i++) {
      var d = wins[i].document;
      try { await Promise.race([d.fonts.ready, sleep(3000)]); } catch (e) {}
      var imgs = Array.prototype.slice.call(d.images).filter(function (im) { return !im.complete; });
      if (imgs.length) await Promise.race([Promise.all(imgs.map(function (im) { return new Promise(function (r) { im.onload = im.onerror = r; }); })), sleep(6000)]);
      if (wins[i] !== win) try { wins[i].scrollTo(0, 0); } catch (e) {}
    }
    await sleep(100);
    return global.F2FCapture.run(win, opts);
  }

  global.F2FCapture = {
    prepareAndRun: prepareAndRun,
    gradientLayers: gradientLayers,
    run: function (win, opts) {
      var c = new Capturer(win, opts);
      c.sx = win.scrollX || 0; c.sy = win.scrollY || 0;
      c.materializePseudos();
      var tree = c.capture();
      // Claude Design canvases put each artboard in its own embedded page: hand them back separately.
      var artboards = [];
      (function find(n) { if (n.artboard && n.w >= 100 && n.h >= 100) { artboards.push(n); return; } (n.children || []).forEach(find); })(tree);
      if (artboards.length) {
        var minX = Math.min.apply(null, artboards.map(function (a) { return a.x; }));
        var minY = Math.min.apply(null, artboards.map(function (a) { return a.y; }));
        artboards = artboards.map(function (a) {
          var r = { tree: a, x: a.x - minX, y: a.y - minY };
          delete a.artboard;
          a.effects = undefined; // canvas drop-shadow is presentation, not part of the artboard
          shiftTree(a, -a.x, -a.y);
          return r;
        });
      }
      return Promise.all(c.pending).then(function () {
        var imgs = {};
        for (var k in c.images) { var im = c.images[k]; imgs[k] = im.bytes ? { bytes: im.bytes, w: im.w, h: im.h } : im.svg ? { svg: im.svg } : { failed: true }; }
        return { tree: tree, images: imgs, stats: c.stats, artboards: artboards.length ? artboards : null };
      });
    },
    _parse: { parseColor: parseColor, parseLinear: parseLinear, parseShadows: parseShadows, splitTop: splitTop }
  };
  // When injected into a rendered design: answer capture requests from the plugin window.
  if (global.parent && global.parent !== global) {
    global.addEventListener('message', function (e) {
      var m = e.data;
      if (!m || m.f2f !== 'run') return;
      prepareAndRun(global, m.opts).then(function (res) { e.source.postMessage({ f2f: 'result', res: res }, '*'); },
        function (err) { e.source.postMessage({ f2f: 'result', error: String(err && err.message || err) }, '*'); });
    });
  }
})(typeof window !== 'undefined' ? window : this);
