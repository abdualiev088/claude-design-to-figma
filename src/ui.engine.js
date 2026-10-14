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
        var clip = n.frameMaskDisabled === false;
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

  var F2FNative = window.F2FNative = {
    tidy: tidy,
    missingFonts: {},
    frames: nativeFrames,
    convert: async function (frames, canvasName) {
      if (!frames.length || !window.F2FFigit) return null;
      F2FNative.missingFonts = {};
      var chars = textChars(frames);
      var fallback = F2FFigit.createFontsourceLoader();
      var conv = F2FFigit.createFigmaConverter({ fontLoader: googleFontLoader(chars, fallback) });
      var res = await conv.convert(frames.length > 1 ? { frames: frames, canvasName: canvasName || 'Claude Design' } : frames[0]);
      // Fonts Figma doesn't know by that name (system-ui, sans-serif, Segoe UI…) get the stand-in's name.
      var renamed = false;
      (function walk(o) {
        if (!o || typeof o !== 'object') return;
        if (ArrayBuffer.isView(o)) return;
        if (typeof o.family === 'string') {
          var a = FONT_ALIAS[o.family.replace(/['"]/g, '').trim().toLowerCase()];
          if (a && a[1]) { o.family = a[1]; if ('postscript' in o) o.postscript = ''; renamed = true; }
        }
        for (var k in o) if (o[k] && typeof o[k] === 'object') walk(o[k]);
      })(res.document.nodeChanges);
      var cleaned = tidy(res.document);
      var html = renamed || cleaned ? F2FFigit.composeClipboardHtml(F2FFigit.encodeFigmaData(res.document).base64) : res.toClipboardHtml();
      return { html: html, document: res.document };
    }
  };