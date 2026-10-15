  // ---------- zip support: rewrite relative asset paths to blob: URLs ----------
  var MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', jsx: 'text/javascript', ts: 'text/javascript', tsx: 'text/javascript', json: 'application/json', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', mp4: 'video/mp4', webm: 'video/webm', html: 'text/html', htm: 'text/html' };
  function ext(p) { return (p.split('.').pop() || '').toLowerCase(); }
  function dirOf(p) { var i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i + 1); }
  function resolvePath(base, ref) {
    if (/^(https?:|data:|blob:|mailto:|tel:|#|\/\/|javascript:)/i.test(ref)) return null;
    ref = ref.split('#')[0].split('?')[0];
    try { ref = decodeURIComponent(ref); } catch (e) {}
    var parts = (ref[0] === '/' ? ref.slice(1) : base + ref).split('/'), out = [];
    parts.forEach(function (s) { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); });
    return out.join('/');
  }
  var REF_RE = /(["'`(=]\s*)((?:\.{0,2}\/)?[^"'`()<>\s:]*?\.(?:png|jpe?g|gif|webp|avif|svg|ico|css|m?js|jsx|tsx?|json|woff2?|ttf|otf|mp4|webm))((?:[?#][^"'`()\s]*)?)(?=\s*["'`)])/gi;
  function rewrite(text, filePath, urls) {
    var base = dirOf(filePath);
    return text.replace(REF_RE, function (m, pre, ref, tail) {
      var p = resolvePath(base, ref);
      if (p && urls[p]) return pre + urls[p];
      if (p) { // tolerate a common root folder
        for (var k in urls) if (k.length > p.length && k.slice(-p.length - 1) === '/' + p) return pre + urls[k];
      }
      return m;
    });
  }
  function readZip(file) {
    return JSZip.loadAsync(file).then(function (zip) {
      var entries = [];
      zip.forEach(function (path, f) { if (!f.dir && !/(^|\/)(__MACOSX|\.DS_Store)/.test(path)) entries.push({ path: path, f: f }); });
      var urls = {};
      var binary = entries.filter(function (e) { return !/^(css|m?js|jsx|tsx?|html?|json)$/.test(ext(e.path)); });
      var css = entries.filter(function (e) { return ext(e.path) === 'css'; });
      var js = entries.filter(function (e) { return /^(m?js|jsx|tsx?|json)$/.test(ext(e.path)); });
      var html = entries.filter(function (e) { return /^html?$/.test(ext(e.path)); });
      if (!html.length) throw new Error('no .html file inside the zip');
      function blobFor(e, data) { urls[e.path] = URL.createObjectURL(new Blob([data], { type: MIME[ext(e.path)] || 'application/octet-stream' })); }
      return Promise.all(binary.map(function (e) { return e.f.async('uint8array').then(function (d) { blobFor(e, d); }); }))
        .then(function () { return Promise.all(css.map(function (e) { return e.f.async('string').then(function (t) { blobFor(e, rewrite(t, e.path, urls)); }); })); })
        .then(function () { return Promise.all(js.map(function (e) { return e.f.async('string').then(function (t) { blobFor(e, rewrite(t, e.path, urls)); }); })); })
        .then(function () { return Promise.all(html.map(function (e) { return e.f.async('string').then(function (t) { return { path: e.path, html: rewrite(t, e.path, urls) }; }); })); })
        .then(function (pages) {
          pages.sort(function (a, b) { return (/(^|\/)index\.html?$/i.test(b.path) ? 1 : 0) - (/(^|\/)index\.html?$/i.test(a.path) ? 1 : 0) || a.path.localeCompare(b.path); });
          return { kind: 'zip', pages: pages, name: file.name };
        });
    });
  }

  // ---------- render + capture ----------
  var CAPTURE_TAG = '<script>' + document.getElementById('capsrc').textContent + '<\/script>';
  var PRELUDE_CSS = '<style id="__f2f_prelude">*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important}html{scroll-behavior:auto!important}</style>';
  // Claude Design bundles mount each artboard from an HTML blob URL, which the browser treats as a separate
  // (unreadable) origin when the host page is sandboxed — as Figma plugin windows are. This patch loads the
  // same HTML via srcdoc instead, which keeps the artboard readable. It re-injects itself into nested pages.
  function framePatch() {
    if (window.__f2fPatched) return; window.__f2fPatched = true;
    var blobs = {};
    var oc = URL.createObjectURL;
    URL.createObjectURL = function (b) { var u = oc.apply(URL, arguments); try { if (b && /html/.test(b.type)) blobs[u] = b; } catch (e) {} return u; };
    var self = '<script>(' + framePatch.toString() + ')()<\/script>';
    var css = document.getElementById('__f2f_prelude');
    var cssTag = css ? css.outerHTML : '';
    function mount(el, v) {
      var key = String(v).split('#')[0], b = blobs[key];
      if (!b) return false;
      el.setAttribute('data-f2f-src', v);
      b.text().then(function (t) {
        var inj = cssTag + self;
        if (/<head(\s[^>]*)?>/i.test(t)) t = t.replace(/<head(\s[^>]*)?>/i, function (m) { return m + inj; });
        else t = inj + t;
        el.srcdoc = t;
      });
      return true;
    }
    var d = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
    Object.defineProperty(HTMLIFrameElement.prototype, 'src', { configurable: true, enumerable: true, get: d.get, set: function (v) { if (!mount(this, v)) d.set.call(this, v); } });
    var sa = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (n, v) { if (this instanceof HTMLIFrameElement && String(n).toLowerCase() === 'src' && mount(this, v)) return; return sa.apply(this, arguments); };
  }
  var PATCH_TAG = '<script>(' + framePatch.toString() + ')()<\/script>';
  var PRELUDE = PRELUDE_CSS + PATCH_TAG + CAPTURE_TAG;
  function injectPrelude(html) {
    if (/<head(\s[^>]*)?>/i.test(html)) return html.replace(/<head(\s[^>]*)?>/i, function (m) { return m + PRELUDE; });
    if (/<html(\s[^>]*)?>/i.test(html)) return html.replace(/<html(\s[^>]*)?>/i, function (m) { return m + '<head>' + PRELUDE + '</head>'; });
    return '<!doctype html><html><head><meta charset="utf-8">' + PRELUDE + '</head><body>' + html + '</body></html>';
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function render(html, width, vh) {
    return new Promise(function (resolve, reject) {
      var stage = $('stage');
      // Browser mode keeps earlier pages alive (parked off-screen) so they can all be converted in one go at the end.
      if (IN_FIGMA) stage.innerHTML = '';
      else Array.prototype.forEach.call(stage.children, function (old) { old.style.position = 'absolute'; old.style.left = '-200000px'; old.style.top = '0'; });
      var f = document.createElement('iframe');
      f.style.width = width + 'px'; f.style.height = vh + 'px';
      var box = stage.parentNode, scale = Math.min((box.clientWidth || 112) / width, 1);
      stage.style.transform = 'scale(' + scale + ')';
      var done = false;
      f.srcdoc = injectPrelude(html);   // set before inserting so the first load event is the design itself
      f.addEventListener('load', function () {
        var href = '';
        try { href = f.contentWindow.location.href; } catch (e) { href = 'about:srcdoc'; } // cross-origin = not about:blank
        if (href === 'about:blank' || done) return;
        done = true; resolve(f);
      });
      setTimeout(function () { if (!done) { done = true; resolve(f); } }, 20000);
      stage.appendChild(f);
    });
  }

  function captureViaMessage(f, opts) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { window.removeEventListener('message', on); reject(new Error('The design did not respond (timeout).')); }, 90000);
      function on(e) {
        if (e.source !== f.contentWindow || !e.data || e.data.f2f !== 'result') return;
        clearTimeout(t); window.removeEventListener('message', on);
        if (e.data.error) reject(new Error(e.data.error)); else resolve(e.data.res);
      }
      window.addEventListener('message', on);
      f.contentWindow.postMessage({ f2f: 'run', opts: opts }, '*');
    });
  }

  async function prepareAndCapture(html, width, name, opts) {
    var copts = { width: width, viewportHeight: opts.vh, fixedHeight: opts.first, autoLayout: opts.autoLayout, expand: opts.expand, wait: opts.wait, svgLines: opts.svgLines, name: name };
    var f = await render(html, width, opts.vh);
    onRendered();
    var direct = false;
    try { direct = !!(f.contentWindow.document && f.contentWindow.document.body); } catch (e) { direct = false; }
    var res = direct && !window.__f2fForceMessage ? await F2FCapture.prepareAndRun(f.contentWindow, copts) : await captureViaMessage(f, copts);
    res.frameEl = direct ? f : null;
    return res;
  }

  var waiting = null;
  window.onmessage = function (e) {
    var m = e.data && e.data.pluginMessage; if (!m) return;
    if (m.type === 'status') setStatus(m.text);
    if (m.type === 'progress') setStatus('Building layers… ' + m.built + ' so far');
    if ((m.type === 'done' || m.type === 'error') && waiting) { var w = waiting; waiting = null; w(m); }
  };
  function build(payload) { return new Promise(function (res) { waiting = res; toFigma(payload); }); }

  // ---------- native Figma clipboard (browser mode) ----------
  // Pages that were captured stay alive in the stage; at the end they are converted together into
  // Figma's own clipboard format, so a paste gives real frames, auto layout and editable text.
  function liveDocs(win) {
    var out = [];
    try { Array.prototype.forEach.call(win.document.querySelectorAll('iframe'), function (f) { try { if (f.contentDocument && f.contentDocument.body) out.push(f); } catch (e) {} }); } catch (e) {}
    return out;
  }
  // Frames to convert for one captured page: either its artboards (Claude Design canvas) or the page itself.
  function nativeFrames(res, offsetX, label) {
    var f = res.frameEl; if (!f || !window.F2FFigit) return [];
    var win = f.contentWindow, doc = win.document;
    if (res.artboards) {
      var boards = liveDocs(win).filter(function (b) { var w = b.contentWindow; return w.innerWidth >= 100 && w.innerHeight >= 100; });
      return boards.map(function (b, i) {
        var a = res.artboards[i] || { x: i * 900, y: 0, tree: {} };
        var w = b.contentWindow;
        return { element: b.contentDocument.body, width: Math.round(w.innerWidth), height: Math.round(w.innerHeight), x: Math.round(offsetX + a.x), y: Math.round(a.y), name: b.getAttribute('title') || a.tree.name || ('Artboard ' + (i + 1)) };
      });
    }
    return [{ element: doc.body, width: Math.round(res.tree.w), height: Math.round(res.tree.h), x: Math.round(offsetX), y: 0, name: label }];
  }

  function textChars(frames) {
    var set = {}, s = '';
    for (var c = 32; c < 127; c++) set[String.fromCharCode(c)] = 1;
    frames.forEach(function (fr) {
      var d = fr.element.ownerDocument, t = (fr.element.innerText || '') + (fr.element.textContent || '');
      Array.prototype.forEach.call(d.querySelectorAll('input,textarea'), function (i) { t += (i.value || '') + (i.placeholder || ''); });
      Array.prototype.forEach.call(d.querySelectorAll('*'), function (el) {
        ['::before', '::after'].forEach(function (p) { var ct = d.defaultView.getComputedStyle(el, p).content; if (ct && ct !== 'none' && ct !== 'normal') t += ct; });
      });
      t += t.toUpperCase() + t.toLowerCase();
      Array.from(t).forEach(function (ch) { if (ch.codePointAt(0) >= 32) set[ch] = 1; });
    });
    Object.keys(set).forEach(function (k) { s += k; });
    return s + '…–—«»“”‘’•·';
  }

  var FONT_ALIAS = {
      'arial': ['Arimo'], 'helvetica': ['Arimo'], 'helvetica neue': ['Arimo'], 'liberation sans': ['Arimo'],
      'times': ['Tinos'], 'times new roman': ['Tinos'], 'georgia': ['Gelasio'], 'courier': ['Cousine'], 'courier new': ['Cousine'],
      'system-ui': ['Inter', 'Inter'], '-apple-system': ['Inter', 'Inter'], 'blinkmacsystemfont': ['Inter', 'Inter'], 'segoe ui': ['Inter', 'Inter'],
      'sans-serif': ['Inter', 'Inter'], 'ui-sans-serif': ['Inter', 'Inter'], 'verdana': ['Inter', 'Inter'], 'tahoma': ['Inter', 'Inter'],
      'serif': ['Noto Serif', 'Noto Serif'], 'ui-serif': ['Noto Serif', 'Noto Serif'],
      'monospace': ['Roboto Mono', 'Roboto Mono'], 'ui-monospace': ['Roboto Mono', 'Roboto Mono'], 'menlo': ['Roboto Mono', 'Roboto Mono'], 'monaco': ['Roboto Mono', 'Roboto Mono'],
      'consolas': ['Roboto Mono', 'Roboto Mono'], 'sfmono-regular': ['Roboto Mono', 'Roboto Mono'], 'sf mono': ['Roboto Mono', 'Roboto Mono']
    };

  // Last resort when Google Fonts is unreachable: Inter served by this site.
  var INTER_FILES = { 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold' };
  async function bundledInter(req) {
    var w = req.weight <= 450 ? 400 : req.weight <= 550 ? 500 : req.weight <= 650 ? 600 : 700;
    var name = req.italic && w === 400 ? 'Italic' : INTER_FILES[w];
    try {
      var r = await fetch('fonts/Inter-' + name + '.woff2');
      if (!r.ok) return null;
      return { bytes: await r.arrayBuffer(), resolvedWeight: w, resolvedItalic: name === 'Italic', resolvedFamily: 'Inter' };
    } catch (e) { return null; }
  }

  // Google Fonts can cut a font down to exactly the characters used (any script, any weight) in a single file.
  function googleFontLoader(chars, fallback) {
    var missing = {};
    function css(family, weight, italic) {
      var fam = encodeURIComponent(family.replace(/['"]/g, '').trim()).replace(/%20/g, '+');
      return 'https://fonts.googleapis.com/css2?family=' + fam + ':ital,wght@' + (italic ? 1 : 0) + ',' + weight + '&text=' + encodeURIComponent(chars);
    }
    async function grab(family, weight, italic) {
      var r = await fetch(css(family, weight, italic));
      if (!r.ok) return null;
      var m = (await r.text()).match(/url\((['"]?)(https:[^)'"]+)\1\)/);
      if (!m) return null;
      var fr = await fetch(m[2]);
      return fr.ok ? fr.arrayBuffer() : null;
    }
    // System and generic families aren't on Google Fonts: use a metric-compatible stand-in so line breaks match.
    var ALIAS = FONT_ALIAS;

    async function viaGoogle(family, req) {
      var tries = [[req.weight, req.italic]];
      if (req.italic) tries.push([req.weight, false]);
      if (req.weight !== 400) tries.push([400, false]);
      for (var i = 0; i < tries.length; i++) {
        try {
          var bytes = await grab(family, tries[i][0], tries[i][1]);
          if (bytes) return { bytes: bytes, resolvedWeight: tries[i][0], resolvedItalic: tries[i][1] };
        } catch (e) {}
      }
      return null;
    }
    return async function (req) {
      var key = req.family.replace(/['"]/g, '').trim().toLowerCase();
      var alias = ALIAS[key], got;
      if (alias) {
        got = await viaGoogle(alias[0], req);
        if (got) { if (alias[1]) got.resolvedFamily = alias[1]; return got; }
      }
      if (!alias && !missing[key]) {
        got = await viaGoogle(req.family, req);
        if (got) return got;
        missing[key] = 1;
      }
      if (!alias) F2FNative.missingFonts[req.family] = 1;
      got = await viaGoogle('Inter', req);
      if (got) { got.resolvedFamily = 'Inter'; return got; }
      got = await bundledInter(req);
      if (got) return got;
      return fallback(req);
    };
  }

  // ---------- tidy the layer tree ----------
  // Web pages wrap things in layers of plain <div>s. A wrapper that has no look of its own and exactly one
  // child frame of the same size and position adds nothing in Figma, so the child is folded into it.
  var CHILD_PROPS = { guid: 1, phase: 1, parentIndex: 1, type: 1, name: 1, size: 1, transform: 1, visible: 1, stackChildPrimaryGrow: 1, stackChildAlignSelf: 1, stackPositioning: 1, opacity: 1 };
  var GENERIC = /^(container|frame|div|group|wrapper|span|section|main|body|html|box|unnamed)$/i;
  function hasLook(n) {
    var vis = function (p) { return p && p.visible !== false && (p.opacity === undefined || p.opacity > 0) && !(p.color && p.color.a === 0 && p.type === 'SOLID'); };
    return (n.fillPaints || []).some(vis) || (n.strokePaints || []).some(vis) && n.strokeWeight > 0 || (n.effects || []).some(function (e) { return e.visible !== false; });
  }
  function fillsOnly(n) { return !hasLook({ strokePaints: n.strokePaints, strokeWeight: n.strokeWeight, effects: n.effects }); }
  function covers(c) {
    var f = (c.fillPaints || []).filter(function (p) { return p.visible !== false; });
    var top = f[f.length - 1];
    var square = !(c.cornerRadius > 0) && !c.rectangleCornerRadiiIndependent;
    return !!top && top.type === 'SOLID' && (top.opacity === undefined || top.opacity >= 1) && top.color && top.color.a >= 1 && (c.opacity === undefined || c.opacity >= 1) && square;
  }
  function noPadding(n) { return !(n.stackHorizontalPadding || n.stackVerticalPadding || n.stackPaddingRight || n.stackPaddingBottom); }
  function tidy(doc) {
    var nc = doc.nodeChanges, key = function (g) { return g.sessionID + ':' + g.localID; };
    var byId = {}, kids = {}, changed = 0;
    nc.forEach(function (n) { byId[key(n.guid)] = n; });
    function rebuild() { kids = {}; nc.forEach(function (n) { if (n.parentIndex && !n.__gone) (kids[key(n.parentIndex.guid)] = kids[key(n.parentIndex.guid)] || []).push(n); }); }
    rebuild();
    var again = true;
    while (again) {
      again = false;
      for (var i = 0; i < nc.length; i++) {
        var n = nc[i];
        if (n.__gone || n.type !== 'FRAME' || !noPadding(n)) continue;
        var ks = kids[key(n.guid)] || [];
        if (ks.length !== 1) continue;
        var c = ks[0];
        if (c.type !== 'FRAME' || c.stackPositioning === 'ABSOLUTE') continue;
        // a wrapper with only a background is fine to fold when the child's own opaque, square background hides it;
        // a plain child (no look of its own) can always hand its layout and children up to a styled parent
        var plainChild = !hasLook(c) && c.frameMaskDisabled !== false;
        if (hasLook(n) && !plainChild && !(fillsOnly(n) && covers(c))) continue;
        var t = c.transform || {};
        if (Math.abs(t.m02 || 0) > 0.5 || Math.abs(t.m12 || 0) > 0.5 || Math.abs((t.m00 === undefined ? 1 : t.m00) - 1) > 1e-3 || Math.abs(t.m01 || 0) > 1e-3) continue;
        if (Math.abs(c.size.x - n.size.x) > 0.5 || Math.abs(c.size.y - n.size.y) > 0.5) continue;
        // fold c into n: n keeps its place in the parent, takes c's look, layout and children
        var clip = n.frameMaskDisabled === false, keepEls = (n.__els || []).concat(c.__els || []);
        if (plainChild && hasLook(n)) {
          // keep the parent's look, take the child's auto layout
          Object.keys(n).forEach(function (k) { if (/^stack/.test(k) && !CHILD_PROPS[k]) delete n[k]; });
          Object.keys(c).forEach(function (k) { if (/^stack/.test(k) && !CHILD_PROPS[k]) n[k] = c[k]; });
        } else {
          Object.keys(n).forEach(function (k) { if (!CHILD_PROPS[k] && k !== '__gone') delete n[k]; });
          Object.keys(c).forEach(function (k) { if (!CHILD_PROPS[k]) n[k] = c[k]; });
        }
        if (clip) n.frameMaskDisabled = false;
        if (c.opacity !== undefined) n.opacity = (n.opacity === undefined ? 1 : n.opacity) * c.opacity;
        if (GENERIC.test(n.name || '') && !GENERIC.test(c.name || '')) n.name = c.name;
        n.__els = keepEls;
        (kids[key(c.guid)] || []).forEach(function (g) { g.parentIndex = { guid: n.guid, position: g.parentIndex.position }; });
        c.__gone = true; changed++; again = true;
        rebuild();
      }
    }
    // frames holding only vector shapes are icons
    nc.forEach(function (n) {
      if (n.__gone || n.type !== 'FRAME' || !GENERIC.test(n.name || '')) return;
      var ks = kids[key(n.guid)] || [];
      if (ks.length && ks.every(function (k) { return k.type === 'VECTOR' || k.type === 'ELLIPSE' || k.type === 'ROUNDED_RECTANGLE' && !kids[key(k.guid)]; }) && n.size.x <= 64 && n.size.y <= 64) { n.name = 'Icon'; changed++; }
    });
    if (changed) doc.nodeChanges = nc.filter(function (n) { return !n.__gone; });
    return changed;
  }


  // ---------- link layers back to the page ----------
  function gkey(g) { return g.sessionID + ':' + g.localID; }
  function treeOf(nc) {
    var byId = {}, kids = {};
    nc.forEach(function (n) { if (!n.__gone) byId[gkey(n.guid)] = n; });
    nc.forEach(function (n) { if (n.__gone || !n.parentIndex) return; (kids[gkey(n.parentIndex.guid)] = kids[gkey(n.parentIndex.guid)] || []).push(n); });
    Object.keys(kids).forEach(function (k) { kids[k].sort(function (a, b) { return a.parentIndex.position < b.parentIndex.position ? -1 : a.parentIndex.position > b.parentIndex.position ? 1 : 0; }); });
    return { byId: byId, kids: function (n) { return kids[gkey(n.guid)] || []; }, parent: function (n) { return n.parentIndex ? byId[gkey(n.parentIndex.guid)] : null; } };
  }
  function attachElements(doc, trace, frames) {
    if (!trace || !trace.entries) return;
    var nc = doc.nodeChanges, t = treeOf(nc);
    var canvas = nc.filter(function (n) { return n.type === 'CANVAS'; })[0];
    var tops = canvas ? t.kids(canvas) : [];
    var rootFor = {};
    tops.forEach(function (top, i) {
      var f = frames.filter(function (fr) { return fr.name === top.name; })[0] || frames[i];
      if (f) rootFor[gkey(top.guid)] = f.element;
    });
    function topOf(n) { var p = n; while (p && p.parentIndex && t.parent(p) && t.parent(p).type !== 'CANVAS') p = t.parent(p); return p; }
    trace.entries.forEach(function (e) {
      var n = t.byId[gkey(e.guid)]; if (!n) return;
      var top = topOf(n), root = top && rootFor[gkey(top.guid)]; if (!root) return;
      var path = e.domPath.replace(/::text\[\d+\]$/, '');
      var el = null;
      try { el = path === ':scope' ? root : root.querySelector(path); } catch (err) { el = null; }
      if (el) n.__els = (n.__els || []).concat([el]);
    });
  }

  // ---------- auto layout for every remaining frame ----------
  // Frames the converter left with free positioning get auto layout too: the longest run of children that
  // sits in a clean row or column (same spacing, same alignment) flows; anything else rides along as an
  // absolutely positioned layer, so nothing moves.
  function box(k) {
    var t = k.transform || {};
    return { x: t.m02 || 0, y: t.m12 || 0, w: k.size ? k.size.x : 0, h: k.size ? k.size.y : 0, rot: Math.abs(t.m01 || 0) > 1e-3 || Math.abs(t.m10 || 0) > 1e-3 };
  }
  function isPlainFrame(k) { return k.type === 'FRAME' && !hasLook(k) && k.frameMaskDisabled !== false; }
  // Grow a look-less frame on one side without moving anything inside it (absorbs uneven spacing).
  function grow(k, side, d, t) {
    if (d <= 0) return;
    var tr = k.transform = Object.assign({ m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }, k.transform || {});
    var vert = side === 'top' || side === 'bottom', lead = side === 'top' || side === 'left';
    if (vert) k.size = { x: k.size.x, y: k.size.y + d }; else k.size = { x: k.size.x + d, y: k.size.y };
    if (lead) {
      if (vert) tr.m12 -= d; else tr.m02 -= d;
      t.kids(k).forEach(function (c) { var ct = c.transform = Object.assign({ m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }, c.transform || {}); if (vert) ct.m12 += d; else ct.m02 += d; });
    }
    if (k.stackMode && k.stackMode !== 'NONE') {
      var f = { top: 'stackVerticalPadding', bottom: 'stackPaddingBottom', left: 'stackHorizontalPadding', right: 'stackPaddingRight' }[side];
      k[f] = (k[f] || 0) + d;
      if (k.stackPrimarySizing === 'RESIZE_TO_FIT' || k.stackCounterSizing === 'RESIZE_TO_FIT') { /* hugging frames grow with the padding */ }
    }
  }
  // Put a layer in a look-less auto layout frame whose padding carries the extra space on one side.
  function wrapWithPadding(k, side, d, ctx) {
    var b = box(k), vert = side === 'top' || side === 'bottom';
    var w = {
      guid: { sessionID: k.guid.sessionID, localID: ++ctx.maxId }, phase: 'CREATED',
      parentIndex: { guid: k.parentIndex.guid, position: k.parentIndex.position },
      type: 'FRAME', name: 'Container', visible: true, opacity: 1,
      size: { x: b.w + (vert ? 0 : d), y: b.h + (vert ? d : 0) },
      transform: { m00: 1, m01: 0, m02: b.x - (side === 'left' ? d : 0), m10: 0, m11: 1, m12: b.y - (side === 'top' ? d : 0) },
      cornerRadius: 0, strokeWeight: 0, strokeAlign: 'INSIDE', strokeJoin: 'MITER', fillPaints: [], strokePaints: [], effects: [],
      frameMaskDisabled: true, stackMode: vert ? 'VERTICAL' : 'HORIZONTAL', stackSpacing: 0,
      stackVerticalPadding: side === 'top' ? d : 0, stackPaddingBottom: side === 'bottom' ? d : 0,
      stackHorizontalPadding: side === 'left' ? d : 0, stackPaddingRight: side === 'right' ? d : 0,
      stackPrimarySizing: 'FIXED', stackCounterSizing: 'FIXED', stackPrimaryAlignItems: 'MIN', stackCounterAlignItems: 'MIN'
    };
    ['stackChildAlignSelf', 'stackChildPrimaryGrow'].forEach(function (f) { if (f in k) { w[f] = k[f]; delete k[f]; } });
    k.parentIndex = { guid: w.guid, position: '!' };
    k.transform = Object.assign({}, k.transform || { m00: 1, m01: 0, m10: 0, m11: 1 }, { m02: side === 'left' ? d : 0, m12: side === 'top' ? d : 0 });
    ctx.inserts.push({ before: k, node: w });
    return w;
  }
  function layoutRest(doc) {
    var nc = doc.nodeChanges, t = treeOf(nc), tol = 1.5;
    var ctx = { maxId: Math.max.apply(null, nc.map(function (n) { return n.guid.localID; })), inserts: [] };
    nc.forEach(function (n) {
      if (n.__gone || n.type !== 'FRAME' || (n.stackMode && n.stackMode !== 'NONE')) return;
      var ks = t.kids(n); if (!ks.length) return;
      if (ks.every(function (k) { return /^(VECTOR|ELLIPSE|BOOLEAN_OPERATION|LINE|STAR|REGULAR_POLYGON)$/.test(k.type); })) return; // icon artwork stays as drawn
      var W = n.size.x, H = n.size.y;
      var cand = ks.filter(function (k) {
        var b = box(k);
        return k.stackPositioning !== 'ABSOLUTE' && !b.rot && b.x >= -0.5 && b.y >= -0.5;
      });
      if (!cand.length) return;
      var plans = [true, false].map(function (v) {
        var st = function (k) { var b = box(k); return v ? b.y : b.x; }, en = function (k) { var b = box(k); return v ? b.y + b.h : b.x + b.w; };
        var lo = function (k) { var b = box(k); return v ? b.x : b.y; }, hi = function (k) { var b = box(k); return (v ? W : H) - (v ? b.x + b.w : b.y + b.h); };
        // main axis: everything that doesn't overlap the previous item flows
        var run = [], last = -Infinity;
        cand.slice().sort(function (a, b) { return st(a) - st(b); }).forEach(function (k) { if (st(k) >= last - 0.5) { run.push(k); last = en(k); } });
        // counter axis: the most common alignment wins
        var groups = [];
        run.forEach(function (k) {
          var full = v ? W : H, size = full - lo(k) - hi(k);
          [['MIN', lo(k)], ['MAX', hi(k)], ['CENTER', lo(k) + size / 2]].forEach(function (pair) {
            var g = groups.filter(function (gr) { return gr.mode === pair[0] && Math.abs(gr.v - pair[1]) <= tol; })[0];
            if (!g) groups.push(g = { mode: pair[0], v: pair[1], n: 0 });
            g.n++;
          });
        });
        groups.sort(function (a, b) { return b.n - a.n || (a.mode === 'MIN' ? -1 : b.mode === 'MIN' ? 1 : a.mode === 'CENTER' ? -1 : 1); });
        var g = groups[0], fits = 0, abs = [];
        if (g.mode === 'MIN') g.v = Math.min.apply(null, run.map(lo).filter(function (x) { return x >= g.v - tol; }).concat([g.v]));
        if (g.mode === 'MAX') g.v = Math.min.apply(null, run.map(hi).filter(function (x) { return x >= g.v - tol; }).concat([g.v]));
        var fixes = [];
        run.forEach(function (k) {
          var d = g.mode === 'MIN' ? lo(k) - g.v : g.mode === 'MAX' ? hi(k) - g.v : (lo(k) + ((v ? W : H) - lo(k) - hi(k)) / 2) - g.v;
          if (Math.abs(d) <= tol) { fits++; return; }
          if (g.mode !== 'CENTER' && d > 0) { fixes.push([k, g.mode === 'MIN' ? (v ? 'left' : 'top') : (v ? 'right' : 'bottom'), d]); fits++; return; }
          abs.push(k);
        });
        return { v: v, run: run.filter(function (k) { return abs.indexOf(k) < 0; }), abs: abs, g: g, fixes: fixes, score: fits * 10 + (v === (H >= W) ? 1 : 0), st: st, en: en, lo: lo, hi: hi };
      });
      var P = plans[0].score >= plans[1].score ? plans[0] : plans[1], v = P.v;
      var run = P.run.slice();
      P.fixes.forEach(function (f) {
        if (isPlainFrame(f[0])) grow(f[0], f[1], f[2], t);
        else { var w = wrapWithPadding(f[0], f[1], f[2], ctx); run[run.indexOf(f[0])] = w; }
      });
      // main axis spacing: one gap for all; uneven extra space is absorbed by a look-less neighbour's padding,
      // or by a padded wrapper around the next item
      var changed = true;
      while (changed) {
        changed = false;
        var gaps = []; for (var i = 1; i < run.length; i++) gaps.push(P.st(run[i]) - P.en(run[i - 1]));
        var gap = gaps.length ? Math.max(0, Math.min.apply(null, gaps)) : 0;
        for (i = 1; i < run.length; i++) {
          var extra = P.st(run[i]) - P.en(run[i - 1]) - gap;
          if (extra <= 0.5) continue;
          if (isPlainFrame(run[i])) grow(run[i], v ? 'top' : 'left', extra, t);
          else if (isPlainFrame(run[i - 1])) grow(run[i - 1], v ? 'bottom' : 'right', extra, t);
          else { run[i] = wrapWithPadding(run[i], v ? 'top' : 'left', extra, ctx); changed = true; break; }
        }
      }
      gaps = []; for (i = 1; i < run.length; i++) gaps.push(P.st(run[i]) - P.en(run[i - 1]));
      gap = gaps.length ? Math.max(0, gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length) : 0;
      var full = v ? W : H, padStart = Math.max(0, P.st(run[0])), padEnd = Math.max(0, (v ? H : W) - P.en(run[run.length - 1]));
      var cStart, cEnd, g = P.g;
      if (g.mode === 'MIN') { cStart = g.v; cEnd = Math.min.apply(null, run.map(P.hi)); }
      else if (g.mode === 'MAX') { cEnd = g.v; cStart = Math.min.apply(null, run.map(P.lo)); }
      else { cStart = g.v <= full / 2 ? 0 : 2 * g.v - full; cEnd = g.v <= full / 2 ? full - 2 * g.v : 0; }
      cStart = Math.max(0, cStart); cEnd = Math.max(0, cEnd);
      n.stackMode = v ? 'VERTICAL' : 'HORIZONTAL';
      n.stackSpacing = Math.round(gap * 100) / 100;
      n.stackPrimarySizing = 'FIXED'; n.stackCounterSizing = 'FIXED';
      n.stackPrimaryAlignItems = 'MIN'; n.stackCounterAlignItems = g.mode;
      if (v) { n.stackVerticalPadding = padStart; n.stackPaddingBottom = padEnd; n.stackHorizontalPadding = cStart; n.stackPaddingRight = cEnd; }
      else { n.stackHorizontalPadding = padStart; n.stackPaddingRight = padEnd; n.stackVerticalPadding = cStart; n.stackPaddingBottom = cEnd; }
      var inner = full - cStart - cEnd, inRun = {};
      run.forEach(function (k) {
        inRun[gkey(k.guid)] = 1;
        var b = box(k), sz = v ? b.w : b.h;
        if (k.type === 'FRAME' && Math.abs(sz - inner) <= 0.5 && Math.abs(P.lo(k) - cStart) <= 0.5) k.stackChildAlignSelf = 'STRETCH';
      });
      ks.forEach(function (k) { if (!inRun[gkey(k.guid)] && k.parentIndex && gkey(k.parentIndex.guid) === gkey(n.guid)) k.stackPositioning = 'ABSOLUTE'; });
      // flow order follows position on the main axis; absolute layers keep their stacking slots
      var slots = run.map(function (k) { return k.parentIndex.position; }).sort();
      run.forEach(function (k, idx) { k.parentIndex = { guid: k.parentIndex.guid, position: slots[idx] }; });
    });
    ctx.inserts.forEach(function (ins) { var i = nc.indexOf(ins.before); nc.splice(i < 0 ? nc.length : i, 0, ins.node); });
  }

  // ---------- layer names ----------
  function clip(s, n) { s = String(s || '').replace(/\u00AD/g, '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trim() + '…' : s; }
  function nameLayers(doc) {
    var nc = doc.nodeChanges, t = treeOf(nc);
    var GEN = /^(container|frame|div|group|wrapper|span|box|unnamed)$/i;
    function els(n) { return n.__els || []; }
    function tagSet(n) { return els(n).map(function (e) { return (e.tagName || '').toLowerCase(); }); }
    function attr(n, a) { for (var i = 0; i < els(n).length; i++) { var v = els(n)[i].getAttribute && els(n)[i].getAttribute(a); if (v) return v; } return ''; }
    function texts(n, out) { out = out || []; t.kids(n).forEach(function (k) { if (k.type === 'TEXT') out.push(k); else texts(k, out); }); return out; }
    function firstText(n) { var ts = texts(n); return ts.length ? clip(ts[0].textData ? ts[0].textData.characters : ts[0].name, 24) : ''; }
    function heading(n) {
      var ts = texts(n); var h = ts.filter(function (x) { return els(x).some(function (e) { return /^h[1-6]$/i.test(e.tagName); }); })[0];
      if (!h) { var big = ts.slice().sort(function (a, b) { return (b.fontSize || 0) - (a.fontSize || 0); })[0]; if (big && ts.length > 1 && big.fontSize >= 16) h = big; }
      return h ? clip(h.textData ? h.textData.characters : h.name, 24) : '';
    }
    function look(n) { return hasLook(n); }
    function radius(n) { return n.cornerRadius || n.rectangleTopLeftCornerRadius || 0; }
    function isIcon(n) { return n.name === 'Icon'; }
    function similar(ks) {
      if (ks.length < 3) return false;
      var w = ks[0].size.x, h = ks[0].size.y;
      return ks.every(function (k) { return k.type === ks[0].type && Math.abs(k.size.x - w) <= 2 && Math.abs(k.size.y - h) <= 2; });
    }
    var bottomOf = {};
    var canvas = nc.filter(function (n) { return n.type === 'CANVAS'; })[0];
    // positions relative to each artboard, to spot top/bottom bars
    function absY(n) { var y = 0, p = n; while (p && p.type !== 'CANVAS' && t.parent(p) && t.parent(p).type !== 'CANVAS') { y += (p.transform ? p.transform.m12 : 0); p = t.parent(p); } return { y: y, top: p }; }
    void bottomOf; void canvas;
    nc.forEach(function (n) {
      if (n.__gone || n.type !== 'FRAME' || !n.parentIndex || !t.parent(n) || t.parent(n).type === 'CANVAS') return;
      var ks = t.kids(n), tags = tagSet(n), label = attr(n, 'aria-label') || attr(n, 'title') || attr(n, 'alt');
      var txt = firstText(n), head = heading(n), base = null, detail = '';
      var generic = GEN.test(n.name || '') || n.name === 'Container';
      var has = function (tg) { return tags.indexOf(tg) > -1; };
      var pos = absY(n), artH = pos.top && pos.top.size ? pos.top.size.y : 0, artW = pos.top && pos.top.size ? pos.top.size.x : 0;
      var wide = artW && n.size.x >= artW - 2;
      if (isIcon(n)) return;
      if (has('button') || n.name === 'Button') {
        var only = ks.length === 1 && isIcon(ks[0]);
        base = only ? 'Icon button' : 'Button'; detail = label || txt;
      } else if (has('nav') || n.name === 'Navigation') {
        base = wide && artH && pos.y + n.size.y >= artH - 2 ? 'Tab bar' : 'Navigation';
      } else if (has('header') || n.name === 'Header') { base = 'Header'; detail = head; }
      else if (has('footer') || n.name === 'Footer') base = 'Footer';
      else if (has('main')) base = 'Content';
      else if (has('section') || has('article') || n.name === 'Section') { base = 'Section'; detail = head; }
      else if ((has('input') || has('textarea') || has('select')) && !has('label')) { base = has('select') ? 'Select' : 'Input'; detail = ''; }
      else if (has('label') && els(n).some(function (e) { return e.querySelector && e.querySelector('input,textarea,select'); }) || has('input') || has('textarea')) {
        var inp = null; els(n).forEach(function (e) { inp = inp || (e.matches && e.matches('input,textarea') ? e : e.querySelector && e.querySelector('input,textarea')); });
        var ph = inp ? (inp.getAttribute('placeholder') || '') : '';
        base = inp && (inp.type === 'search' || /поиск|search|найти|искать/i.test(ph + label)) ? 'Search field' : 'Input field';
      }
      else if (has('a')) { base = look(n) ? 'Button' : 'Link'; detail = label || txt; }
      else if (has('ul') || has('ol')) base = 'List';
      else if (has('li')) { base = 'List item'; detail = txt; }
      else if (has('img') || (n.fillPaints || []).some(function (p) { return p.type === 'IMAGE'; })) { base = 'Image'; detail = attr(n, 'alt'); }
      else if (!generic) return; // the converter already gave it a meaningful name
      if (!base) {
        var allText = ks.length && ks.every(function (k) { return k.type === 'TEXT'; });
        var r = radius(n), minSide = Math.min(n.size.x, n.size.y);
        if (look(n) && ks.length === 1 && isIcon(ks[0])) base = r >= minSide / 2 - 1 ? 'Icon circle' : 'Icon tile';
        else if (look(n) && ks.length === 1 && ks[0].type === 'TEXT' && n.size.y <= 40) { base = r >= n.size.y / 2 - 1 ? 'Chip' : 'Tag'; detail = txt; }
        else if (look(n) && r > 0 && texts(n).length >= 1 && ks.length >= 2) { base = 'Card'; detail = head || txt; }
        else if (similar(ks)) base = n.stackWrap === 'WRAP' ? 'Grid' : n.stackMode === 'HORIZONTAL' ? 'Row' : 'List';
        else if (allText && ks.length >= 2) { base = 'Text block'; detail = txt; }
        else if (allText && texts(n).some(function (x) { return els(x).some(function (e) { return /^h[1-6]$/i.test(e.tagName); }); })) { base = 'Title'; detail = txt; }
        else if (allText) { base = 'Label'; detail = txt; }
        else if (!ks.length && !look(n)) base = 'Spacer';
        else if (head && n.stackMode === 'HORIZONTAL' && n.size.y <= 64) { base = 'Title row'; detail = head; }
        else if (head && texts(n).length > 1) { base = 'Group'; detail = head; }
        else if (look(n)) base = wide ? 'Bar' : 'Box';
        else base = n.stackMode === 'HORIZONTAL' ? 'Row' : n.stackMode === 'VERTICAL' ? 'Column' : 'Group';
      }
      detail = clip(detail, 24);
      n.name = detail && detail !== base ? base + ' · ' + detail : base;
    });
  }

  var F2FNative = window.F2FNative = {
    tidy: tidy,
    missingFonts: {},
    frames: nativeFrames,
    convert: async function (frames, canvasName) {
      if (!frames.length || !window.F2FFigit) return null;
      F2FNative.missingFonts = {};
      var chars = textChars(frames);
      var fallback = F2FFigit.createFontsourceLoader();
      var conv = F2FFigit.createFigmaConverter({ fontLoader: googleFontLoader(chars, fallback), trace: true });
      var res = await conv.convert(frames.length > 1 ? { frames: frames, canvasName: canvasName || 'Claude Design' } : frames[0]);
      // Fonts Figma doesn't know by that name (system-ui, sans-serif, Segoe UI…) get the stand-in's name.
      var renamed = false; void renamed;
      (function walk(o) {
        if (!o || typeof o !== 'object') return;
        if (ArrayBuffer.isView(o)) return;
        if (typeof o.family === 'string') {
          var a = FONT_ALIAS[o.family.replace(/['"]/g, '').trim().toLowerCase()];
          if (a && a[1]) { o.family = a[1]; if ('postscript' in o) o.postscript = ''; renamed = true; }
        }
        for (var k in o) if (o[k] && typeof o[k] === 'object') walk(o[k]);
      })(res.document.nodeChanges);
      try { attachElements(res.document, res.trace, frames); } catch (e) { console.warn('trace', e); }
      tidy(res.document);
      try { layoutRest(res.document); } catch (e) { console.warn('layout', e); }
      tidy(res.document);
      try { nameLayers(res.document); } catch (e) { console.warn('names', e); }
      res.document.nodeChanges.forEach(function (n) { Object.keys(n).forEach(function (k) { if (k.indexOf('__') === 0) delete n[k]; }); });
      var html = F2FFigit.composeClipboardHtml(F2FFigit.encodeFigmaData(res.document).base64);
      return { html: html, document: res.document };
    }
  };