(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var source = null; // { kind:'html', html, name, size, boards } | { kind:'zip', pages:[{path, html}], name, size }
  var mode = 'file';
  var IN_FIGMA = window.parent !== window;
  document.documentElement.classList.add(IN_FIGMA ? 'in-figma' : 'standalone');

  // ---------- small helpers ----------
  function setStatus(t, cls) { var s = $('status'); s.textContent = t || ''; s.className = 'status' + (cls ? ' ' + cls : ''); }
  function setBar(p) { $('bar').style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + '%'; }
  function toFigma(msg) { parent.postMessage({ pluginMessage: msg }, '*'); }
  var toastT;
  function toast(t) { var el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove('show'); }, 2600); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function fmtBytes(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function show(id, on) { $(id).classList.toggle('hidden', !on); }
  function onRendered() { setPhase(1); }

  // ---------- mode label ----------
  if (!IN_FIGMA) {
    $('modeTag').textContent = 'Browser mode';
    $('goLabel').textContent = 'Convert for Figma';
    $('phase2').textContent = 'Preparing layers to paste';
    $('s3title').textContent = 'Convert';
    show('standaloneNote', true);
  } else {
    $('modeTag').classList.add('plugin');
  }

  // ---------- step state / button hint ----------
  function boardsActive() { return mode === 'file' && source && source.boards && source.boards.length; }
  function refresh() {
    var has = mode === 'paste' ? $('paste').value.trim().length > 20 : !!source;
    var ws = widths();
    var okSize = boardsActive() || ws.length > 0;
    $('go').disabled = !has || !okSize;
    $('why').textContent = !has ? 'Add a design to start' : !okSize ? 'Pick at least one frame size' :
      boardsActive() ? plural(source.boards.length, 'frame') + ', one per artboard' :
      plural(pageCount() * ws.length, 'frame') + ' will be created';
    $('step1').classList.toggle('done', has);
    $('step2').classList.toggle('done', has && okSize);
    if (mode === 'paste') {
      var n = $('paste').value.trim().length;
      $('pasteInfo').textContent = n > 20 ? Math.round(n / 1024 * 10) / 10 + ' KB of HTML ready' : 'Waiting for code';
    }
  }
  function pageCount() {
    if (mode !== 'file' || !source || source.kind !== 'zip') return 1;
    return Math.max(1, document.querySelectorAll('#pages input:checked').length);
  }

  // ---------- sizes ----------
  Array.prototype.forEach.call(document.querySelectorAll('.w'), function (c) { c.onchange = refresh; });
  $('customOn').onchange = function () { if (this.checked && !$('customW').value) $('customW').focus(); refresh(); };
  $('customW').oninput = function () { $('customOn').checked = !!this.value; refresh(); };
  $('customW').onclick = function (e) { e.stopPropagation(); };
  $('pages').onchange = refresh;

  // ---------- design input ----------
  $('tabPaste').onclick = function () { mode = 'paste'; show('dropArea', false); show('fileBox', false); show('panePaste', true); setBoards(null); $('paste').focus(); refresh(); };
  $('tabFile').onclick = function () { mode = 'file'; show('panePaste', false); show('dropArea', !source); show('fileBox', !!source); setBoards(source && source.boards); refresh(); };
  $('paste').oninput = refresh;

  var drop = $('drop');
  drop.onclick = function () { $('fileInput').click(); };
  $('fileInput').onchange = function () { if (this.files[0]) loadFile(this.files[0]); };
  ['dragenter', 'dragover'].forEach(function (ev) { document.addEventListener(ev, function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') > -1) { e.preventDefault(); drop.classList.add('over'); } }); });
  document.addEventListener('dragleave', function (e) { if (!e.relatedTarget) drop.classList.remove('over'); });
  document.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) { if (mode === 'paste') $('tabFile').click(); loadFile(e.dataTransfer.files[0]); } });
  // ⌘V anywhere: a copied file, or HTML code
  document.addEventListener('paste', function (e) {
    if (e.target && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT')) return;
    var cd = e.clipboardData; if (!cd) return;
    if (cd.files && cd.files[0]) { e.preventDefault(); if (mode === 'paste') $('tabFile').click(); loadFile(cd.files[0]); return; }
    var t = cd.getData('text/plain') || cd.getData('text/html');
    if (t && /<\w+[\s>]/.test(t)) { e.preventDefault(); $('tabPaste').click(); $('paste').value = t; refresh(); toast('HTML pasted'); }
  });
  $('clearFile').onclick = function () { source = null; show('fileBox', false); show('dropArea', true); show('pagesBox', false); $('fileInput').value = ''; setBoards(null); refresh(); drop.focus(); };

  // Claude Design canvas bundles list their artboards in a template — show them before importing
  function detectBoards(html) {
    var m = html.match(/<script type="__bundler\/template">\s*([\s\S]*?)\s*<\/script>/);
    var tpl = null;
    if (m) { try { tpl = JSON.parse(m[1]); } catch (e) { tpl = null; } }
    if (!tpl) return null;
    var out = [];
    tpl.replace(/<iframe\b[^>]*>/gi, function (tag) {
      var w = (tag.match(/\bwidth="(\d+)"/) || [])[1], h = (tag.match(/\bheight="(\d+)"/) || [])[1], ti = (tag.match(/\btitle="([^"]*)"/) || [])[1];
      if (w && h) out.push({ w: +w, h: +h, title: ti || 'Artboard ' + (out.length + 1) });
    });
    return out.length ? out : null;
  }
  function setBoards(boards) {
    var on = !!(boards && boards.length);
    show('sizePicker', !on); show('boardsBox', on);
    $('s2title').textContent = on ? 'Artboards' : 'Frame size';
    $('s2aside').textContent = on ? plural(boards.length, 'artboard') + ' found' : 'pick one or more';
    if (!on) return;
    var max = Math.max.apply(null, boards.map(function (b) { return Math.max(b.w, b.h); }));
    $('boards').innerHTML = boards.map(function (b) {
      var k = 22 / max, w = Math.max(5, Math.round(b.w * k)), h = Math.max(5, Math.round(b.h * k));
      return '<div class="board"><span class="thumb"><i style="width:' + w + 'px;height:' + h + 'px"></i></span><span class="t">' + esc(b.title) + '</span><span class="d">' + b.w + ' × ' + b.h + '</span></div>';
    }).join('');
  }

  function loadFile(file) {
    if (!/\.(html?|zip)$/i.test(file.name) && !/html|zip/.test(file.type)) { toast('Please choose an .html or .zip file'); return; }
    setStatus('Reading ' + file.name + '…');
    var isZip = /\.zip$/i.test(file.name) || /zip/.test(file.type);
    var p = isZip ? readZip(file) : file.text().then(function (t) { return { kind: 'html', html: t, name: file.name, boards: detectBoards(t) }; });
    p.then(function (src) {
      source = src; mode = 'file';
      src.size = file.size;
      $('fileName').textContent = file.name;
      $('fileExt').textContent = isZip ? 'zip' : 'html';
      var info = [fmtBytes(file.size)];
      if (src.boards) info.push('<b>Claude Design canvas</b>');
      else if (src.kind === 'zip') info.push(plural(src.pages.length, 'page'));
      else info.push('Web page');
      $('fileInfo').innerHTML = info.map(function (x) { return '<span>' + x + '</span>'; }).join('');
      show('dropArea', false); show('panePaste', false); show('fileBox', true);
      if (src.kind === 'zip' && src.pages.length > 1) {
        var box = $('pages'); box.innerHTML = '';
        src.pages.forEach(function (pg, i) {
          var l = document.createElement('label');
          l.innerHTML = '<input type="checkbox" data-i="' + i + '"' + (/(^|\/)index\.html?$/i.test(pg.path) || src.pages.length <= 4 ? ' checked' : '') + '><span class="p"></span>';
          l.querySelector('.p').textContent = pg.path;
          box.appendChild(l);
        });
        if (!box.querySelector('input:checked')) box.querySelector('input').checked = true;
        show('pagesBox', true);
      } else show('pagesBox', false);
      setBoards(src.boards);
      setStatus('Ready.');
      refresh();
      $('go').focus({ preventScroll: true });
    }).catch(function (e) { setStatus('Could not read file: ' + e.message, 'err'); toast('Could not read that file: ' + e.message); });
  }

  // ---------- progress view ----------
  function setPhase(i) {
    Array.prototype.forEach.call($('phases').children, function (li, k) { li.className = k < i ? 'ok' : k === i ? 'now' : ''; });
  }
  function view(which) { // 'ready' | 'work' | 'done'
    show('readyBox', which === 'ready'); show('workBox', which === 'work'); show('doneBox', which === 'done');
    $('work').classList.toggle('finished', which !== 'work');
    var lock = which === 'work';
    ['step1', 'step2'].forEach(function (id) { $(id).style.opacity = lock ? .55 : ''; $(id).style.pointerEvents = lock ? 'none' : ''; });
  }

/*ENGINE*/

  // ---------- run ----------
  function widths() {
    var w = [];
    Array.prototype.forEach.call(document.querySelectorAll('.w'), function (c) { if (c.checked) w.push(+c.value); });
    var cw = parseInt($('customW').value, 10);
    if ($('customOn').checked && cw >= 200 && w.indexOf(cw) < 0) w.push(cw);
    return w;
  }

  var lastSvg = '', lastSvgName = 'design.svg';

  $('go').onclick = async function () {
    var opts = { vh: Math.max(300, +$('optVH').value || 900), wait: Math.max(0, +$('optWait').value || 0), autoLayout: $('optAL').checked, expand: $('optExpand').checked, first: $('optFirst').checked, svgLines: !IN_FIGMA };
    var pages;
    if (mode === 'paste') pages = [{ path: 'Pasted design', html: $('paste').value }];
    else if (source.kind === 'html') pages = [{ path: source.name.replace(/\.html?$/i, ''), html: source.html }];
    else {
      var picked = Array.prototype.map.call(document.querySelectorAll('#pages input:checked'), function (c) { return source.pages[+c.dataset.i]; });
      pages = picked.length ? picked : [source.pages[0]];
    }
    var ws = boardsActive() ? [widths()[0] || 1440] : widths();
    view('work'); setPhase(0); setBar(0.03);
    $('step3').scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    var x = 0, missing = {}, total = 0, frames = 0, failed = 0, tries = 0, canvasNote = false, lastErr = '';
    var svgRoots = [], svgImages = {}, imgSeq = 0;
    var jobsTotal = pages.length * ws.length, jobsDone = 0;

    // Rename image ids so results from several captures can share one SVG
    function mergeImages(res) {
      var map = {};
      Object.keys(res.images).forEach(function (k) { var nk = 'i' + (imgSeq++); map[k] = nk; svgImages[nk] = res.images[k]; });
      (function walk(n) { (n.fills || []).forEach(function (f) { if (f.imageId) f.imageId = map[f.imageId]; }); (n.children || []).forEach(walk); })(res.tree);
      (res.artboards || []).forEach(function (a) { (function walk(n) { (n.fills || []).forEach(function (f) { if (f.imageId && !svgImages[f.imageId]) f.imageId = map[f.imageId]; }); (n.children || []).forEach(walk); })(a.tree); });
    }

    for (var pi = 0; pi < pages.length; pi++) {
      var page = pages[pi];
      for (var wi = 0; wi < ws.length; wi++) {
        var w = ws[wi], base = page.path.replace(/\.html?$/i, '').split('/').pop(), label = base + ' — ' + w;
        var isLast = pi === pages.length - 1 && wi === ws.length - 1;
        var slice = 1 / jobsTotal, start = jobsDone / jobsTotal;
        tries++;
        try {
          setPhase(0);
          $('pvLabel').textContent = boardsActive() ? base : label;
          setStatus(jobsTotal > 1 ? 'Frame ' + (jobsDone + 1) + ' of ' + jobsTotal + ' · ' + label : label);
          setBar(start + slice * 0.1);
          var tick = setInterval(function () { var cur = parseFloat($('bar').style.width) / 100; if (cur < start + slice * 0.6) setBar(cur + slice * 0.04); }, 400);
          var res;
          try { res = await prepareAndCapture(page.html, w, label, opts); } finally { clearInterval(tick); }
          setPhase(2); setBar(start + slice * 0.7);
          // Claude Design canvas: each artboard becomes its own frame at its own size; width choice doesn't apply.
          var items = res.artboards ? res.artboards : [{ tree: res.tree, x: 0, y: 0 }];
          var span = items.reduce(function (m, it) { return Math.max(m, it.x + it.tree.w); }, 0);
          if (!IN_FIGMA) {
            mergeImages(res);
            items.forEach(function (it) { svgRoots.push({ tree: it.tree, x: x + it.x, y: it.y }); });
            frames += items.length;
            total += res.stats.frames + res.stats.texts + res.stats.svgs;
          } else {
            for (var k = 0; k < items.length; k++) {
              setStatus('Building ' + (items.length > 1 ? '“' + items[k].tree.name + '” (' + (k + 1) + '/' + items.length + ')' : label) + '…');
              var r = await build({ type: 'build', tree: items[k].tree, images: res.images, offsetX: x + items[k].x, offsetY: items[k].y, totalWidth: span, first: frames === 0, last: isLast && k === items.length - 1 });
              if (r.type === 'error') throw new Error(r.text);
              total += r.built; frames++; Object.assign(missing, r.missing || {});
              setBar(start + slice * (0.7 + 0.3 * (k + 1) / items.length));
            }
          }
          x += span + 200;
          if (res.artboards) { canvasNote = true; jobsDone = jobsTotal; break; } // artboards have fixed sizes: one pass is enough
        } catch (err) {
          failed++; lastErr = err && err.message || String(err); console.error(err);
          setStatus('Failed on ' + label + ': ' + lastErr, 'err');
          await sleep(900);
        }
        jobsDone++;
        setBar(jobsDone / jobsTotal);
      }
    }

    if (!IN_FIGMA && svgRoots.length) {
      setStatus('Packing layers…');
      await sleep(30);
      lastSvg = F2FSvg.render(svgRoots, svgImages);
      lastSvgName = (pages[0].path.replace(/\.html?$/i, '').split('/').pop() || 'design') + '.svg';
    }
    setPhase(3); setBar(1);
    await sleep(250);
    finish({ ok: failed < tries && (IN_FIGMA || svgRoots.length > 0), frames: frames, total: total, missing: missing, canvas: canvasNote, failed: failed, err: lastErr });
  };

  function finish(r) {
    view('done');
    var badge = $('badge');
    badge.className = 'badge' + (r.ok ? '' : ' err');
    badge.innerHTML = r.ok ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
      : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 7v6M12 17h.01"/></svg>';
    var notes = '';
    if (!r.ok) {
      $('doneTitle').textContent = 'That didn’t work';
      $('doneSum').textContent = r.err ? r.err : 'The design could not be read.';
      $('doneStats').innerHTML = '';
      notes += '<div class="note"><b>Try this:</b> raise <b>Load wait</b> under Fine-tune to 4000, or export from Claude Design as a .zip instead of a single file.</div>';
      show('svgActions', false);
      setStatus('Import failed.', 'err');
    } else {
      var what = plural(r.frames, 'frame') + (r.canvas ? ' (one per artboard)' : '');
      if (IN_FIGMA) {
        $('doneTitle').textContent = 'It’s on your canvas';
        $('doneSum').textContent = 'The new ' + (r.frames > 1 ? 'frames are' : 'frame is') + ' selected and in view.';
        show('svgActions', false);
        toFigma({ type: 'notify', text: 'Imported ' + r.total + ' layers from Claude Design' });
        setStatus('Done — ' + r.total + ' layers in ' + what + '.', 'ok');
      } else {
        $('doneTitle').textContent = 'Ready to paste';
        $('doneSum').textContent = 'Copy it, then paste it into any Figma file.';
        show('svgActions', true);
        $('copyLabel').textContent = 'Copy for Figma';
        setStatus('Ready — ' + what + '. Copy it and paste into Figma, or download the file and drag it in.', 'ok');
      }
      $('doneStats').innerHTML = '<span><b>' + r.frames + '</b> ' + (r.frames === 1 ? 'frame' : 'frames') + '</span><span><b>' + r.total + '</b> layers</span>' + (r.failed ? '<span><b>' + r.failed + '</b> skipped</span>' : '');
      var miss = Object.keys(r.missing || {});
      if (miss.length) notes += '<div class="note"><b>' + (miss.length === 1 ? 'A font was' : 'Some fonts were') + ' swapped</b> because Figma doesn’t have ' + miss.map(function (k) { return '“' + esc(k) + '”'; }).join(', ') + '. Install ' + (miss.length === 1 ? 'it' : 'them') + ' on your computer and import again for an exact match.</div>';
      if (r.failed) notes += '<div class="note">' + plural(r.failed, 'frame') + ' could not be read: ' + esc(r.err) + '</div>';
    }
    $('noteBox').innerHTML = notes;
    $('again').textContent = r.ok ? 'Import another design' : 'Back';
    if (!r.ok) $('again').focus({ preventScroll: true });
  }

  $('again').onclick = function () {
    view('ready'); setBar(0); setStatus('');
    if (!$('badge').classList.contains('err')) { $('clearFile').click(); $('paste').value = ''; if (mode === 'paste') $('tabFile').click(); }
    refresh();
  };

  $('copySvg').onclick = function () {
    var ok = function () { $('copyLabel').textContent = 'Copied!'; setStatus('Copied. Now open Figma and press ⌘V (Ctrl+V) on the canvas.', 'ok'); toast('Copied. Now press ⌘V in Figma'); setTimeout(function () { $('copyLabel').textContent = 'Copy again'; }, 1800); };
    function fallback() { var t = document.createElement('textarea'); t.value = lastSvg; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); try { document.execCommand('copy') ? ok() : bad(); } catch (e) { bad(); } t.remove(); }
    function bad() { toast('Your browser blocked copying. Use the .svg button instead'); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(lastSvg).then(ok, fallback); else fallback();
  };
  $('dlSvg').onclick = function () {
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lastSvg], { type: 'image/svg+xml' })); a.download = lastSvgName; document.body.appendChild(a); a.click(); a.remove();
    setStatus('Downloaded ' + lastSvgName + '. Drag it onto your Figma canvas.', 'ok');
    toast('Saved ' + lastSvgName + '. Drag it into Figma');
  };

  refresh();
})();
