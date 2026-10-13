// svg.js — turns a captured layer tree into an SVG that Figma imports as editable layers
// (used when the page is opened outside Figma: paste or drag the SVG into any Figma file).
(function (global) {
  'use strict';
  var uid = 0;
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function n2(v) { return Math.round(v * 100) / 100; }
  function rgb(c) { return 'rgb(' + Math.round(c.r * 255) + ',' + Math.round(c.g * 255) + ',' + Math.round(c.b * 255) + ')'; }
  function idFor(name, used) {
    var base = String(name || 'Layer').replace(/[\s"'<>&]+/g, '_').replace(/^[^A-Za-z_À-￿]+/, '') || 'Layer';
    base = base.slice(0, 60);
    var id = base, i = 2;
    while (used[id]) id = base + '_' + (i++);
    used[id] = 1;
    return id;
  }
  function b64(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function mimeOf(bytes) {
    if (bytes[0] === 0x89) return 'image/png';
    if (bytes[0] === 0xFF) return 'image/jpeg';
    if (bytes[0] === 0x47) return 'image/gif';
    return 'image/png';
  }
  function shapePath(x, y, w, h, r) {
    // r = [tl, tr, br, bl]
    if (!r || !(r[0] || r[1] || r[2] || r[3])) return null;
    var tl = r[0], tr = r[1], br = r[2], bl = r[3];
    return 'M' + n2(x + tl) + ' ' + n2(y) + 'H' + n2(x + w - tr) + (tr ? 'A' + n2(tr) + ' ' + n2(tr) + ' 0 0 1 ' + n2(x + w) + ' ' + n2(y + tr) : '') +
      'V' + n2(y + h - br) + (br ? 'A' + n2(br) + ' ' + n2(br) + ' 0 0 1 ' + n2(x + w - br) + ' ' + n2(y + h) : '') +
      'H' + n2(x + bl) + (bl ? 'A' + n2(bl) + ' ' + n2(bl) + ' 0 0 1 ' + n2(x) + ' ' + n2(y + h - bl) : '') +
      'V' + n2(y + tl) + (tl ? 'A' + n2(tl) + ' ' + n2(tl) + ' 0 0 1 ' + n2(x + tl) + ' ' + n2(y) : '') + 'Z';
  }
  function uniformR(r) { return r && r[0] === r[1] && r[1] === r[2] && r[2] === r[3] ? r[0] : null; }
  function shape(n, attrs) {
    var r = n.radius, ur = uniformR(r);
    if (!r || ur !== null) return '<rect x="' + n2(n.x) + '" y="' + n2(n.y) + '" width="' + n2(Math.max(n.w, 0.01)) + '" height="' + n2(Math.max(n.h, 0.01)) + '"' + (ur ? ' rx="' + n2(ur) + '"' : '') + attrs + '/>';
    return '<path d="' + shapePath(n.x, n.y, n.w, n.h, r) + '"' + attrs + '/>';
  }

  function Renderer(images) { this.images = images || {}; this.defs = []; this.used = {}; this.dataUris = {}; }

  Renderer.prototype.paintAttr = function (p, n) {
    if (p.type === 'SOLID') return ' fill="' + rgb(p.color) + '"' + (p.opacity < 1 ? ' fill-opacity="' + n2(p.opacity) + '"' : '');
    var id = 'g' + (uid++);
    var stops = p.gradientStops.map(function (s) { return '<stop offset="' + n2(s.position) + '" stop-color="' + rgb(s.color) + '"' + (s.color.a < 1 ? ' stop-opacity="' + n2(s.color.a) + '"' : '') + '/>'; }).join('');
    var t = p.gradientTransform, a = t[0][0], b = t[0][1], c = t[0][2], d = t[1][0], e = t[1][1], f = t[1][2];
    var det = a * e - b * d || 1;
    function inv(u, v) { return [(e * (u - c) - b * (v - f)) / det, (-d * (u - c) + a * (v - f)) / det]; }
    if (p.type === 'GRADIENT_LINEAR') {
      var s0 = inv(0, 0.5), s1 = inv(1, 0.5);
      this.defs.push('<linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" x1="' + n2(n.x + s0[0] * n.w) + '" y1="' + n2(n.y + s0[1] * n.h) + '" x2="' + n2(n.x + s1[0] * n.w) + '" y2="' + n2(n.y + s1[1] * n.h) + '">' + stops + '</linearGradient>');
    } else {
      var cc = inv(0.5, 0.5), ex = inv(1, 0.5), ey = inv(0.5, 1);
      var rx = Math.abs(ex[0] - cc[0]) * n.w, ry = Math.abs(ey[1] - cc[1]) * n.h;
      var cx = n.x + cc[0] * n.w, cy = n.y + cc[1] * n.h, r = Math.max(rx, 0.01);
      this.defs.push('<radialGradient id="' + id + '" gradientUnits="userSpaceOnUse" cx="' + n2(cx) + '" cy="' + n2(cy) + '" r="' + n2(r) + '" gradientTransform="translate(' + n2(cx) + ' ' + n2(cy) + ') scale(1 ' + n2(ry / r) + ') translate(' + n2(-cx) + ' ' + n2(-cy) + ')">' + stops + '</radialGradient>');
    }
    return ' fill="url(#' + id + ')"';
  };

  Renderer.prototype.imageHref = function (id) {
    if (this.dataUris[id] !== undefined) return this.dataUris[id];
    var im = this.images[id], uri = null;
    if (im && im.bytes) uri = 'data:' + mimeOf(im.bytes) + ';base64,' + b64(im.bytes);
    else if (im && im.svg) uri = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(im.svg)));
    this.dataUris[id] = uri;
    return uri;
  };

  Renderer.prototype.effectsFilter = function (n) {
    var fx = (n.effects || []).filter(function (e) { return e.type === 'DROP_SHADOW' || e.type === 'LAYER_BLUR'; });
    if (!fx.length) return '';
    var id = 'f' + (uid++), parts = '';
    fx.forEach(function (e) {
      if (e.type === 'LAYER_BLUR') parts += '<feGaussianBlur stdDeviation="' + n2(e.radius / 2) + '"/>';
      else parts += '<feDropShadow dx="' + n2(e.offset.x) + '" dy="' + n2(e.offset.y) + '" stdDeviation="' + n2(e.radius / 2) + '" flood-color="' + rgb(e.color) + '" flood-opacity="' + n2(e.color.a) + '"/>';
    });
    this.defs.push('<filter id="' + id + '" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">' + parts + '</filter>');
    return ' filter="url(#' + id + ')"';
  };

  Renderer.prototype.frame = function (n) {
    var out = '', self = this;
    var gAttrs = ' id="' + esc(idFor(n.name, this.used)) + '"';
    if (n.opacity !== undefined && n.opacity < 1) gAttrs += ' opacity="' + n2(n.opacity) + '"';
    if (n.rotation) gAttrs += ' transform="rotate(' + n2(n.rotation) + ' ' + n2(n.x + n.w / 2) + ' ' + n2(n.y + n.h / 2) + ')"';
    var body = '';
    var filt = this.effectsFilter(n);
    var fills = n.fills || [];
    if (!fills.length && filt) fills = []; // shadow without fill: nothing to cast from
    fills.forEach(function (p, i) {
      if (p.type === 'IMAGE') {
        var href = self.imageHref(p.imageId);
        if (!href) { body += shape(n, ' fill="#e1e1e6"'); return; }
        var cid = 'c' + (uid++);
        self.defs.push('<clipPath id="' + cid + '">' + shape(n, '') + '</clipPath>');
        var par = p.scaleMode === 'FIT' ? 'xMidYMid meet' : p.scaleMode === 'STRETCH' ? 'none' : 'xMidYMid slice';
        body += '<image clip-path="url(#' + cid + ')" x="' + n2(n.x) + '" y="' + n2(n.y) + '" width="' + n2(n.w) + '" height="' + n2(n.h) + '" preserveAspectRatio="' + par + '" href="' + href + '"/>';
      } else body += shape(n, self.paintAttr(p, n) + (i === 0 ? filt : ''));
    });
    if (n.strokes && n.strokes.length) {
      var w = n.strokeWeights, col = n.strokes[0], sc = ' fill="' + rgb(col.color) + '"' + (col.opacity < 1 ? ' fill-opacity="' + n2(col.opacity) + '"' : '');
      if (w.t === w.r && w.r === w.b && w.b === w.l) {
        var sw = w.t, inset = { x: n.x + sw / 2, y: n.y + sw / 2, w: Math.max(n.w - sw, 0.01), h: Math.max(n.h - sw, 0.01), radius: n.radius ? n.radius.map(function (r) { return Math.max(0, r - sw / 2); }) : null };
        body += shape(inset, ' fill="none" stroke="' + rgb(col.color) + '"' + (col.opacity < 1 ? ' stroke-opacity="' + n2(col.opacity) + '"' : '') + ' stroke-width="' + n2(sw) + '"' + (n.dash ? ' stroke-dasharray="' + n.dash.join(' ') + '"' : ''));
      } else {
        if (w.t) body += '<rect x="' + n2(n.x) + '" y="' + n2(n.y) + '" width="' + n2(n.w) + '" height="' + n2(w.t) + '"' + sc + '/>';
        if (w.b) body += '<rect x="' + n2(n.x) + '" y="' + n2(n.y + n.h - w.b) + '" width="' + n2(n.w) + '" height="' + n2(w.b) + '"' + sc + '/>';
        if (w.l) body += '<rect x="' + n2(n.x) + '" y="' + n2(n.y) + '" width="' + n2(w.l) + '" height="' + n2(n.h) + '"' + sc + '/>';
        if (w.r) body += '<rect x="' + n2(n.x + n.w - w.r) + '" y="' + n2(n.y) + '" width="' + n2(w.r) + '" height="' + n2(n.h) + '"' + sc + '/>';
      }
    }
    var kids = (n.children || []).map(function (c) { return self.node(c); }).join('');
    if (kids && n.clip) {
      var clip = 'k' + (uid++);
      this.defs.push('<clipPath id="' + clip + '">' + shape(n, '') + '</clipPath>');
      kids = '<g clip-path="url(#' + clip + ')">' + kids + '</g>';
    }
    return '<g' + gAttrs + '>' + body + kids + '</g>';
  };

  function caseText(t, c) {
    if (c === 'UPPER') return t.toUpperCase();
    if (c === 'LOWER') return t.toLowerCase();
    if (c === 'TITLE') return t.replace(/(^|\s)(\S)/g, function (m, a, b) { return a + b.toUpperCase(); });
    return t;
  }
  function fontAttrs(st) {
    var fam = st.families.map(function (f) { return /[\s,]/.test(f) ? "'" + f + "'" : f; }).join(', ');
    return ' font-family="' + esc(fam) + '" font-size="' + n2(st.size) + '" font-weight="' + st.weight + '"' + (st.italic ? ' font-style="italic"' : '') +
      ' fill="' + rgb(st.color) + '"' + (st.color.a < 1 ? ' fill-opacity="' + n2(st.color.a) + '"' : '') +
      (st.ls ? ' letter-spacing="' + n2(st.ls) + '"' : '') +
      (st.deco === 'UNDERLINE' ? ' text-decoration="underline"' : st.deco === 'STRIKETHROUGH' ? ' text-decoration="line-through"' : '');
  }

  Renderer.prototype.text = function (n) {
    var id = esc(idFor(n.name, this.used));
    var lines = n.lines;
    if (!lines || !lines.length) { // fallback: one line from segments
      var st0 = n.segments[0].style, lh = st0.lh || st0.size * 1.2;
      lines = [{ x: n.x, baseline: n.y + (lh - st0.size * 1.2) / 2 + st0.size * 0.97, runs: [{ text: n.segments.map(function (s) { return s.text; }).join('').replace(/\n/g, ' '), st: st0, x: n.x }] }];
    }
    var out = lines.map(function (L) {
      var first = L.runs[0];
      var tspans = L.runs.map(function (r, i) {
        return '<tspan' + (i === 0 ? ' x="' + n2(r.x) + '" y="' + n2(L.baseline) + '"' : '') + fontAttrs(r.st) + '>' + esc(caseText(r.text, r.st.tcase)) + '</tspan>';
      }).join('');
      return '<text xml:space="preserve"' + fontAttrs(first.st) + '>' + tspans + '</text>';
    });
    var op = n.opacity !== undefined && n.opacity < 1 ? ' opacity="' + n2(n.opacity) + '"' : '';
    if (out.length === 1) return out[0].replace('<text ', '<text id="' + id + '"' + op + ' ');
    return '<g id="' + id + '"' + op + '>' + out.join('') + '</g>';
  };

  Renderer.prototype.vector = function (n) {
    var inner = n.svg.replace(/<\?xml[^>]*>/, '');
    inner = inner.replace(/<svg\b([^>]*)>/i, function (m, attrs) {
      attrs = attrs.replace(/\s(x|y|width|height)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
      return '<svg' + attrs + ' x="' + n2(n.x) + '" y="' + n2(n.y) + '" width="' + n2(n.w) + '" height="' + n2(n.h) + '">';
    });
    var id = esc(idFor(n.name, this.used));
    return '<g id="' + id + '"' + (n.opacity !== undefined && n.opacity < 1 ? ' opacity="' + n2(n.opacity) + '"' : '') + '>' + inner + '</g>';
  };

  Renderer.prototype.node = function (n) {
    if (n.t === 'text') return this.text(n);
    if (n.t === 'svg') return this.vector(n);
    return this.frame(n);
  };

  // roots: [{ tree, x, y }] placed side by side in one SVG (each becomes a top-level group in Figma)
  global.F2FSvg = {
    render: function (roots, images) {
      var r = new Renderer(images);
      var W = 0, H = 0;
      var body = roots.map(function (o) {
        W = Math.max(W, o.x + o.tree.w); H = Math.max(H, o.y + o.tree.h);
        return '<g transform="translate(' + n2(o.x) + ' ' + n2(o.y) + ')">' + r.node(o.tree) + '</g>';
      }).join('');
      return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + n2(W) + '" height="' + n2(H) + '" viewBox="0 0 ' + n2(W) + ' ' + n2(H) + '">' +
        (r.defs.length ? '<defs>' + r.defs.join('') + '</defs>' : '') + body + '</svg>';
    }
  };
})(typeof window !== 'undefined' ? window : this);
