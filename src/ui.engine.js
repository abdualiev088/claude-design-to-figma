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
      var stage = $('stage'); stage.innerHTML = '';
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
    if (direct && !window.__f2fForceMessage) return F2FCapture.prepareAndRun(f.contentWindow, copts);
    return captureViaMessage(f, copts);
  }

  var waiting = null;
  window.onmessage = function (e) {
    var m = e.data && e.data.pluginMessage; if (!m) return;
    if (m.type === 'status') setStatus(m.text);
    if (m.type === 'progress') setStatus('Building layers… ' + m.built + ' so far');
    if ((m.type === 'done' || m.type === 'error') && waiting) { var w = waiting; waiting = null; w(m); }
  };
  function build(payload) { return new Promise(function (res) { waiting = res; toFigma(payload); }); }