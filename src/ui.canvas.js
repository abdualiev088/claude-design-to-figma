// Browser-mode canvas: shows the hero first, then the frames a design will become, then the real layer tree.
// Motion: GSAP (intro, pane changes, pointer), Lenis as the only smooth-scroll engine, ScrollTrigger for
// reveals on narrow screens. Everything has a complete static state without JS or with reduced motion.
(function () {
  'use strict';
  var root = document.documentElement;
  if (!root.classList.contains('standalone')) return;
  var $ = function (id) { return document.getElementById(id); };
  var G = window.gsap || null, ST = window.ScrollTrigger || null, LenisCtor = window.Lenis || null;
  var reduceQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  var motionOK = !!G && !reduceQ.matches;
  root.classList.toggle('motion-ok', motionOK);
  var ICONS = window.F2FIcons || {};
  function icon(id, size) {
    var ic = ICONS[id]; if (!ic) return '';
    return '<svg class="ico-svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + ic.w + ' ' + ic.h + '" aria-hidden="true" focusable="false">' + ic.body + '</svg>';
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var narrow = window.matchMedia('(max-width: 980px)');

  var canvas = $('canvas'), panes = { hero: $('cvHero'), plan: $('cvPlan'), layers: $('cvLayers') };
  var current = 'hero', lastState = null, cleanups = [];
  function on(target, ev, fn, opts) { target.addEventListener(ev, fn, opts); cleanups.push(function () { target.removeEventListener(ev, fn, opts); }); }

  // ---------- hero CTA ----------
  on($('heroCta'), 'click', function () { $('drop').click(); });
  // mirror the drop target state onto the canvas
  var dropObs = new MutationObserver(function () { canvas.classList.toggle('over', $('drop').classList.contains('over')); });
  dropObs.observe($('drop'), { attributes: true, attributeFilter: ['class'] });
  cleanups.push(function () { dropObs.disconnect(); });

  // ---------- split the headline into words (accessible name stays whole) ----------
  var heroH = $('heroH'), words = [];
  if (motionOK) {
    heroH.setAttribute('aria-label', heroH.textContent.replace(/\s+/g, ' ').trim());
    var frag = document.createDocumentFragment();
    Array.prototype.slice.call(heroH.childNodes).forEach(function (n) {
      if (n.nodeType === 3) {
        n.nodeValue.split(/(\s+)/).forEach(function (part) {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
          var m = document.createElement('span'); m.className = 'split-m'; m.setAttribute('aria-hidden', 'true');
          var w = document.createElement('span'); w.className = 'split-w'; w.textContent = part;
          m.appendChild(w); frag.appendChild(m); words.push(w);
        });
      } else { // inline markup (the <em>) moves as one unit, never split
        var m2 = document.createElement('span'); m2.className = 'split-m'; m2.setAttribute('aria-hidden', 'true');
        var w2 = document.createElement('span'); w2.className = 'split-w';
        w2.appendChild(n); m2.appendChild(w2); frag.appendChild(m2); words.push(w2);
      }
    });
    heroH.textContent = ''; heroH.appendChild(frag);
  }

  // ---------- smooth scroll: Lenis (only engine), wired to ScrollTrigger ----------
  var lenis = null;
  if (motionOK && LenisCtor && ST) {
    G.registerPlugin(ST);
    lenis = new LenisCtor({ lerp: 0.12, smoothWheel: true, autoRaf: false });
    lenis.on('scroll', ST.update);
    var raf = function (t) { lenis.raf(t * 1000); };
    G.ticker.add(raf); G.ticker.lagSmoothing(0);
    cleanups.push(function () { G.ticker.remove(raf); lenis.destroy(); lenis = null; });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { ST.refresh(); });
    on(window, 'load', function () { ST.refresh(); });
  }
  function refreshScroll() { if (lenis) lenis.resize(); if (ST && motionOK) ST.refresh(); }

  // ---------- intro choreography ----------
  if (motionOK) {
    var mm = G.matchMedia();
    mm.add({ wide: '(min-width: 981px)', small: '(max-width: 980px)' }, function (ctx) {
      var wide = ctx.conditions.wide;
      var tl = G.timeline({ defaults: { ease: 'power3.out' } });
      tl.from('#topbar', { y: -10, opacity: 0, duration: 0.35 }, 0);
      if (wide) tl.from('.app > .panel-h, .app > .step, .app > .browser-tip, .app > .foot', { y: 14, opacity: 0, duration: 0.45, stagger: 0.06, clearProps: 'transform,opacity' }, 0.05);
      tl.from('#heroFrame', { y: 18, scale: 0.97, opacity: 0, duration: 0.6, clearProps: 'transform,opacity' }, 0.08)
        .from('#heroFrame .sf-h', { scale: 0.5, opacity: 0, duration: 0.3, stagger: 0.025 }, 0.3)
        .from('#heroFrame .sf-label, #heroFrame .eyebrow', { y: 6, opacity: 0, duration: 0.35, stagger: 0.05 }, 0.25)
        .from(words, { yPercent: 105, duration: 0.7, stagger: 0.06, ease: 'expo.out' }, 0.3)
        .from('#heroSub, #heroFrame .hero-cta', { y: 12, opacity: 0, duration: 0.5, stagger: 0.07, clearProps: 'transform,opacity' }, 0.6)
        .from('#heroChips li', { y: 10, opacity: 0, duration: 0.4, stagger: 0.05, clearProps: 'transform,opacity' }, 0.75);
      var size = { w: 0, h: 0 }, sizeEl = $('heroSize');
      tl.to(size, { w: 1440, h: 900, duration: 0.9, ease: 'power2.out', onUpdate: function () { sizeEl.textContent = Math.round(size.w) + ' × ' + Math.round(size.h); } }, 0.3);
      if (!wide && ST) {
        // on narrow screens the inspector sits below the hero: reveal its cards as they arrive
        G.set('.app > .step', { y: 18, opacity: 0 });
        ST.batch('.app > .step', { start: 'top 92%', once: true, onEnter: function (els) { G.to(els, { y: 0, opacity: 1, duration: 0.5, stagger: 0.07, ease: 'power3.out', clearProps: 'transform,opacity' }); } });
      }
      return function () { tl.kill(); };
    });
    cleanups.push(function () { mm.revert(); });
  }

  // ---------- pointer: a "You" cursor and a whisper of parallax (fine pointers only) ----------
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  if (motionOK && finePointer.matches) {
    var cur = $('cursor'), frame = $('heroFrame');
    var cx = G.quickTo(cur, 'x', { duration: 0.35, ease: 'power3.out' }), cy = G.quickTo(cur, 'y', { duration: 0.35, ease: 'power3.out' });
    var px = G.quickTo(frame, 'x', { duration: 0.8, ease: 'power3.out' }), py = G.quickTo(frame, 'y', { duration: 0.8, ease: 'power3.out' });
    var pending = null, visible = false;
    var hide = function () { if (visible) { visible = false; G.to(cur, { opacity: 0, duration: 0.15, overwrite: 'auto' }); } px(0); py(0); };
    on(canvas, 'pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      pending = e;
      if (pending.__queued) return;
      pending.__queued = true;
      requestAnimationFrame(function () {
        var ev = pending, r = canvas.getBoundingClientRect();
        var x = ev.clientX - r.left, y = ev.clientY - r.top;
        cx(x - 3); cy(y - 2);
        if (!visible) { visible = true; G.set(cur, { x: x - 3, y: y - 2 }); G.to(cur, { opacity: 1, duration: 0.15, overwrite: 'auto' }); }
        if (current === 'hero') { px(((x / r.width) - 0.5) * -10); py(((y / r.height) - 0.5) * -8); }
      });
    });
    on(canvas, 'pointerleave', hide);
    on(window, 'blur', hide);
    on(document, 'visibilitychange', function () { if (document.hidden) hide(); });
  }

  // ---------- panes ----------
  function swap(next, after) {
    if (next === current) { if (after) after(); return; }
    var from = panes[current], to = panes[next];
    current = next;
    canvas.classList.toggle('on-hero', next === 'hero');
    if (!motionOK) { from.classList.add('hidden'); to.classList.remove('hidden'); if (after) after(); refreshScroll(); return; }
    G.to(from, { opacity: 0, y: -8, duration: 0.18, ease: 'power2.in', overwrite: true, onComplete: function () {
      from.classList.add('hidden'); G.set(from, { clearProps: 'opacity,transform' });
      to.classList.remove('hidden');
      G.fromTo(to, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.32, ease: 'power3.out', clearProps: 'opacity,transform' });
      if (after) after();
      refreshScroll();
    } });
  }

  // ---------- frames: what the design will become ----------
  function framesFor(st) {
    if (st.boards) return st.boards.map(function (b) { return { t: b.title, w: b.w, h: b.h }; });
    var pages = st.pages && st.pages.length ? st.pages : [st.name ? st.name.replace(/\.(html?|zip)$/i, '') : 'Page'];
    var out = [];
    pages.forEach(function (p) {
      var base = String(p).split('/').pop().replace(/\.html?$/i, '');
      st.widths.forEach(function (w) { out.push({ t: base + ' — ' + w, w: w, h: w >= 1100 ? 900 : w >= 700 ? 1024 : 844, grow: true }); });
    });
    return out;
  }
  function renderFrames(el, list, opts) {
    opts = opts || {};
    var max = opts.max || 8, shown = list.slice(0, max);
    var box = el.getBoundingClientRect();
    var availW = Math.max(200, box.width || el.parentNode.clientWidth || 600), availH = Math.max(160, (box.height || 360));
    var gap = 36, sumW = shown.reduce(function (a, f) { return a + f.w; }, 0), maxH = Math.max.apply(null, shown.map(function (f) { return f.h; }));
    var s = Math.min((availW - gap * (shown.length - 1)) * 0.94 / sumW, (availH - 50) / maxH, 0.6);
    if (s < 0.06) s = Math.min(availH / maxH / 2, (availW - gap) / Math.max.apply(null, shown.map(function (f) { return f.w; })) / 2, 0.2);
    el.innerHTML = shown.map(function (f, i) {
      var w = Math.max(28, Math.round(f.w * s)), h = Math.max(36, Math.round(f.h * s));
      return '<div class="fr' + (i === 0 ? ' sel' : '') + '" style="width:' + w + 'px;height:' + h + 'px">' +
        '<span class="fr-label">' + icon('solar:frame-linear', 11) + esc(f.t) + '</span>' +
        '<div class="fr-body"><i class="sk a"></i><i class="sk b"></i><i class="sk c"></i><i class="sk d"></i><i class="sk e"></i><i class="sk f"></i><span class="fr-scan"></span><span class="fr-done">' + icon('solar:check-circle-linear', 16) + '</span></div>' +
        '<span class="fr-size">' + f.w + ' × ' + (f.grow ? 'auto' : f.h) + '</span></div>';
    }).join('') + (list.length > max ? '<span class="fr-more">+' + (list.length - max) + ' more</span>' : '');
    if (motionOK && opts.anim !== false) G.from(el.querySelectorAll('.fr'), { opacity: 0, y: 12, scale: 0.96, duration: 0.42, stagger: 0.05, ease: 'power3.out', clearProps: 'opacity,transform' });
  }

  function onState(st) {
    lastState = st;
    $('tbFile').textContent = st.has && st.name ? st.name : 'Untitled';
    if (canvas.classList.contains('working') || canvas.classList.contains('finished')) return;
    if (!st.has) { swap('hero'); return; }
    var list = framesFor(st);
    $('planKicker').textContent = list.length === 1 ? '1 frame to create' : list.length + ' frames to create';
    $('planNote').textContent = st.boards ? 'one per artboard · sizes from Claude Design' : 'height grows to fit the page';
    swap('plan', function () { renderFrames($('frames'), list); });
    if (narrow.matches && !st.__scrolled) scrollToApp();
  }
  var lastHas = false;
  function scrollToApp() {
    if (lastHas) return; lastHas = true;
    var target = $('step2');
    if (lenis) lenis.scrollTo(target, { offset: -70, duration: 0.9 }); else target.scrollIntoView({ block: 'start', behavior: reduceQ.matches ? 'auto' : 'smooth' });
  }

  // ---------- layers: the actual tree from the converted payload ----------
  function layerIcon(n) {
    if (n.type === 'TEXT') return 'solar:text-square-linear';
    if (/VECTOR|ELLIPSE|STAR|LINE|POLYGON|BOOLEAN/.test(n.type)) return 'solar:pen-new-round-linear';
    if ((n.fillPaints || []).some(function (p) { return p.type === 'IMAGE'; })) return 'solar:gallery-linear';
    if (n.stackMode === 'VERTICAL') return 'solar:align-vertical-spacing-linear';
    if (n.stackMode === 'HORIZONTAL') return n.stackWrap === 'WRAP' ? 'solar:widget-4-linear' : 'solar:align-horizontal-spacing-linear';
    return 'solar:frame-linear';
  }
  function renderLayers(doc) {
    var nc = doc && doc.nodeChanges || [];
    var key = function (g) { return g.sessionID + ':' + g.localID; }, kids = {};
    nc.forEach(function (n) { if (n.parentIndex) (kids[key(n.parentIndex.guid)] = kids[key(n.parentIndex.guid)] || []).push(n); });
    Object.keys(kids).forEach(function (k) { kids[k].sort(function (a, b) { return a.parentIndex.position < b.parentIndex.position ? -1 : 1; }); });
    var canvasNode = nc.filter(function (n) { return n.type === 'CANVAS'; })[0];
    var tops = canvasNode ? kids[key(canvasNode.guid)] || [] : [];
    var rows = [], LIMIT = 80;
    function add(n, d) {
      if (rows.length >= LIMIT) return;
      var abs = n.stackPositioning === 'ABSOLUTE';
      var tag = abs ? 'absolute' : n.stackMode === 'VERTICAL' || n.stackMode === 'HORIZONTAL' ? (n.stackWrap === 'WRAP' ? 'wrap' : 'auto') : '';
      rows.push('<li class="' + (d === 0 ? 'top' : '') + '" data-k="' + key(n.guid) + '" tabindex="-1" style="padding-left:' + (12 + d * 16) + 'px">' + icon(layerIcon(n), 14) + '<span class="nm">' + esc((n.name || n.type).replace(/­/g, '')) + '</span>' + (tag ? '<span class="tg">' + tag + '</span>' : '') + '</li>');
      var ks = kids[key(n.guid)] || [], cap = d === 0 ? 14 : d === 1 ? 6 : d === 2 ? 3 : 0;
      ks.slice(0, cap).forEach(function (c) { add(c, d + 1); });
      if (ks.length > cap && rows.length < LIMIT) rows.push('<li class="more" style="padding-left:' + (12 + (d + 1) * 16) + 'px">' + (ks.length - cap) + ' more inside</li>');
    }
    tops.forEach(function (t) { add(t, 0); });
    $('lpTree').innerHTML = rows.join('');
    var count = { al: 0, text: 0, vec: 0, abs: 0, all: 0 };
    nc.forEach(function (n) {
      if (n.type === 'DOCUMENT' || n.type === 'CANVAS') return;
      count.all++;
      if (n.stackMode === 'VERTICAL' || n.stackMode === 'HORIZONTAL') count.al++;
      if (n.type === 'TEXT') count.text++;
      if (/VECTOR|ELLIPSE|STAR|LINE|POLYGON|BOOLEAN/.test(n.type)) count.vec++;
      if (n.stackPositioning === 'ABSOLUTE') count.abs++;
    });
    $('lpCount').textContent = count.all + ' layers';
    $('lpLegend').innerHTML =
      '<span>' + icon('solar:align-vertical-spacing-linear', 12) + '<b>' + count.al + '</b> auto layout</span>' +
      '<span>' + icon('solar:text-square-linear', 12) + '<b>' + count.text + '</b> text</span>' +
      '<span>' + icon('solar:pen-new-round-linear', 12) + '<b>' + count.vec + '</b> vectors</span>' +
      (count.abs ? '<span><b>' + count.abs + '</b> absolute</span>' : '');
    if (motionOK) G.from($('lpTree').querySelectorAll('li:nth-child(-n+30)'), { opacity: 0, x: -6, duration: 0.3, stagger: 0.015, ease: 'power2.out', clearProps: 'opacity,transform' });
    return tops.map(function (t) { return { t: t.name, w: Math.round(t.size.x), h: Math.round(t.size.y) }; });
  }

  // ---------- export preview: the converted output itself, with Figma-style hover and selection ----------
  // The picture is the same SVG the ".svg" button downloads, built from the same capture as the Figma
  // layers; the boxes come from the Figma payload, so hovering or clicking shows the real layer.
  var XV = (function () {
    var view = $('xvView'), world = $('xvWorld'), img = $('xvImg'), ov = $('xvOv'), pct = $('xvPct'), tree = $('lpTree');
    var st = { s: 1, W: 0, H: 0, url: null, boxes: [], nodes: [], byKey: {}, sel: null, hov: null, auto: 'width' };
    var hovEl = null, selEl = null, frameEls = [];
    function el(cls, html) { var d = document.createElement('div'); d.className = cls; if (html) d.innerHTML = html; return d; }
    function kOf(g) { return g.sessionID + ':' + g.localID; }

    function nodesFrom(doc) {
      var nc = doc && doc.nodeChanges || [], map = {}, out = [];
      nc.forEach(function (n) { map[kOf(n.guid)] = n; });
      nc.forEach(function (n) {
        if (n.type === 'DOCUMENT' || n.type === 'CANVAS' || n.visible === false || !n.size) return;
        var x = 0, y = 0, d = 0, p = n, top = n;
        while (p && p.type !== 'CANVAS') { var t = p.transform || {}; x += t.m02 || 0; y += t.m12 || 0; d++; top = p; p = p.parentIndex ? map[kOf(p.parentIndex.guid)] : null; }
        var al = n.stackPositioning === 'ABSOLUTE' ? 'absolute' : (n.stackMode === 'VERTICAL' || n.stackMode === 'HORIZONTAL') ? (n.stackWrap === 'WRAP' ? 'wrap' : 'auto layout') : '';
        out.push({ k: kOf(n.guid), name: (n.name || n.type).replace(/­/g, ''), type: n.type, x: x, y: y, w: n.size.x, h: n.size.y, d: d, al: al, top: kOf(top.guid) });
      });
      return out;
    }
    function hit(wx, wy) {
      var best = null;
      for (var i = 0; i < st.nodes.length; i++) {
        var n = st.nodes[i];
        if (wx < n.x || wy < n.y || wx > n.x + n.w || wy > n.y + n.h) continue;
        if (!best || n.d > best.d || (n.d === best.d && n.w * n.h < best.w * best.h)) best = n;
      }
      return best;
    }
    function place(box, n) {
      if (!n) { box.style.display = 'none'; return; }
      var s = st.s;
      box.style.display = 'block';
      box.style.left = n.x * s + 'px'; box.style.top = n.y * s + 'px';
      box.style.width = Math.max(1, n.w * s) + 'px'; box.style.height = Math.max(1, n.h * s) + 'px';
    }
    function tagFor(n) {
      var t = selEl.querySelector('.xv-tag');
      t.innerHTML = '<b>' + esc(n.name) + '</b><span>' + Math.round(n.w) + ' × ' + Math.round(n.h) + (n.al ? ' · ' + n.al : '') + '</span>';
      t.classList.toggle('below', n.y * st.s < 24);
    }
    function layout() {
      var s = st.s;
      world.style.width = Math.round(st.W * s) + 'px'; world.style.height = Math.round(st.H * s) + 'px';
      st.boxes.forEach(function (b, i) {
        var f = frameEls[i]; if (!f) return;
        f.style.left = b.x * s + 'px'; f.style.top = b.y * s + 'px'; f.style.width = b.w * s + 'px'; f.style.height = b.h * s + 'px';
      });
      place(hovEl, st.hov && st.hov !== st.sel ? st.hov : null);
      place(selEl, st.sel); if (st.sel) tagFor(st.sel);
      pct.textContent = Math.round(s * 100) + '%';
    }
    function fitScale(mode) {
      var cw = Math.max(120, view.clientWidth - 48), ch = Math.max(120, view.clientHeight - 70);
      var s = cw / st.W; if (mode === 'all') s = Math.min(s, ch / st.H);
      return Math.max(0.03, Math.min(1, s));
    }
    // zoom keeping the point under (ax, ay) — viewport coords inside the view — where it is
    function zoomTo(s, ax, ay) {
      s = Math.max(0.03, Math.min(4, s));
      if (ax === undefined) { ax = view.clientWidth / 2; ay = view.clientHeight / 2; }
      var wx = (view.scrollLeft + ax - world.offsetLeft) / st.s, wy = (view.scrollTop + ay - world.offsetTop) / st.s;
      st.s = s; layout();
      view.scrollLeft = wx * s + world.offsetLeft - ax; view.scrollTop = wy * s + world.offsetTop - ay;
    }
    function fit(mode) { st.auto = mode; st.s = fitScale(mode); layout(); view.scrollLeft = 0; view.scrollTop = 0; }
    function toWorld(e) { var r = world.getBoundingClientRect(); return { x: (e.clientX - r.left) / st.s, y: (e.clientY - r.top) / st.s }; }

    function rowFor(k) { return tree.querySelector('li[data-k="' + k + '"]'); }
    function select(n, from) {
      st.sel = n;
      Array.prototype.forEach.call(tree.querySelectorAll('li.on'), function (li) { li.classList.remove('on'); li.removeAttribute('aria-current'); });
      frameEls.forEach(function (f, i) { f.querySelector('.xv-fl').classList.toggle('on', !!n && st.boxes[i].k === n.top); });
      layout();
      if (!n) return;
      var row = rowFor(n.k);
      if (row) {
        row.classList.add('on'); row.setAttribute('aria-current', 'true');
        if (from === 'preview') { var top = row.offsetTop - tree.clientHeight / 2 + row.offsetHeight / 2; tree.scrollTo({ top: Math.max(0, top), behavior: reduceQ.matches ? 'auto' : 'smooth' }); }
      }
      if (from === 'tree') { // bring the layer into view if it is off screen
        var s = st.s, x = n.x * s + world.offsetLeft, y = n.y * s + world.offsetTop;
        var vis = x >= view.scrollLeft && y >= view.scrollTop && x + n.w * s <= view.scrollLeft + view.clientWidth && y + Math.min(n.h * s, view.clientHeight) <= view.scrollTop + view.clientHeight;
        if (!vis) view.scrollTo({ left: Math.max(0, x - 40), top: Math.max(0, y - 60), behavior: reduceQ.matches ? 'auto' : 'smooth' });
      }
    }
    function hover(n) { if (n === st.hov) return; st.hov = n; place(hovEl, n && n !== st.sel ? n : null); }

    // pointer: hover = outline, click = select, mouse drag = pan, Ctrl/Cmd + wheel = zoom
    var drag = null, panned = false, raf = 0, lastMove = null;
    on(view, 'pointerdown', function (e) {
      panned = false;
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, sl: view.scrollLeft, st: view.scrollTop, id: e.pointerId };
    });
    on(view, 'pointermove', function (e) {
      if (drag) {
        var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!panned && Math.abs(dx) + Math.abs(dy) > 4) { panned = true; view.classList.add('panning'); try { view.setPointerCapture(drag.id); } catch (er) {} hover(null); }
        if (panned) { view.scrollLeft = drag.sl - dx; view.scrollTop = drag.st - dy; return; }
      }
      if (e.pointerType !== 'mouse') return;
      lastMove = e;
      if (!raf) raf = requestAnimationFrame(function () { raf = 0; var p = toWorld(lastMove); hover(hit(p.x, p.y)); });
    });
    function endDrag() { if (drag) { try { view.releasePointerCapture(drag.id); } catch (er) {} } drag = null; view.classList.remove('panning'); }
    on(view, 'pointerup', endDrag); on(view, 'pointercancel', endDrag);
    on(view, 'pointerleave', function () { if (!drag) hover(null); });
    on(view, 'click', function (e) { if (panned) { panned = false; return; } var p = toWorld(e); select(hit(p.x, p.y), 'preview'); });
    on(view, 'wheel', function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      var r = view.getBoundingClientRect();
      st.auto = null; zoomTo(st.s * Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    on(view, 'keydown', function (e) {
      if (e.key === 'Escape') { select(null); return; }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); st.auto = null; zoomTo(st.s * 1.25); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); st.auto = null; zoomTo(st.s / 1.25); }
      else if (e.key === '0') { e.preventDefault(); fit('width'); }
    });
    on($('xvIn'), 'click', function () { st.auto = null; zoomTo(st.s * 1.25); });
    on($('xvOut'), 'click', function () { st.auto = null; zoomTo(st.s / 1.25); });
    on(pct, 'click', function () { fit('width'); });
    on($('xvAll'), 'click', function () { fit('all'); });

    // layers panel drives the preview too
    function rowNode(li) { return li && li.dataset.k ? st.byKey[li.dataset.k] : null; }
    on(tree, 'click', function (e) { var li = e.target.closest('li[data-k]'); if (!li) return; li.focus({ preventScroll: true }); select(rowNode(li), 'tree'); });
    on(tree, 'mouseover', function (e) { var li = e.target.closest('li[data-k]'); hover(rowNode(li)); });
    on(tree, 'mouseleave', function () { hover(null); });
    on(tree, 'keydown', function (e) {
      var li = e.target.closest('li[data-k]'); if (!li) return;
      var rows = Array.prototype.slice.call(tree.querySelectorAll('li[data-k]')), i = rows.indexOf(li), next = null;
      if (e.key === 'ArrowDown') next = rows[i + 1]; else if (e.key === 'ArrowUp') next = rows[i - 1];
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(rowNode(li), 'tree'); return; }
      if (next) { e.preventDefault(); li.tabIndex = -1; next.tabIndex = 0; next.focus(); hover(rowNode(next)); }
    });

    function clear() {
      if (st.url) { URL.revokeObjectURL(st.url); st.url = null; }
      img.removeAttribute('src'); world.classList.remove('loaded'); ov.innerHTML = ''; frameEls = []; st.sel = st.hov = null;
    }
    function load(svg, boxes, doc) {
      clear();
      st.nodes = nodesFrom(doc); st.byKey = {};
      st.nodes.forEach(function (n) { st.byKey[n.k] = n; });
      // match each captured frame to its top-level Figma frame (same order, same offsets)
      var tops = st.nodes.filter(function (n) { return n.d === 1; });
      st.boxes = boxes.map(function (b, i) {
        var t = tops.filter(function (n) { return Math.abs(n.x - b.x) < 2 && Math.abs(n.y - b.y) < 2; })[0] || tops[i];
        return { name: t ? t.name : b.name, x: b.x, y: b.y, w: b.w, h: b.h, k: t ? t.k : '' };
      });
      var m = /width="([\d.]+)"\s+height="([\d.]+)"/.exec(svg.slice(0, 400));
      st.W = m ? +m[1] : Math.max.apply(null, boxes.map(function (b) { return b.x + b.w; }).concat([1]));
      st.H = m ? +m[2] : Math.max.apply(null, boxes.map(function (b) { return b.y + b.h; }).concat([1]));
      st.boxes.forEach(function (b) {
        var f = el('xv-frame', '<span class="xv-fl">' + icon('solar:frame-linear', 11) + '<span class="nm">' + esc(b.name) + '</span><span class="sz">' + Math.round(b.w) + ' × ' + Math.round(b.h) + '</span></span>');
        ov.appendChild(f); frameEls.push(f);
      });
      hovEl = el('xv-hov'); selEl = el('xv-sel', '<i></i><i></i><i></i><i></i><span class="xv-tag"></span>');
      ov.appendChild(hovEl); ov.appendChild(selEl);
      var firstRow = tree.querySelector('li[data-k]'); if (firstRow) firstRow.tabIndex = 0;
      $('xvSub').textContent = st.boxes.length > 1 ? st.boxes.length + ' frames · exactly what lands in Figma' : 'Exactly what lands in Figma';
      if (svg) {
        st.url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        img.onload = function () { world.classList.add('loaded'); };
        img.src = st.url;
      }
      fit('width');
      if (motionOK) G.from(world, { opacity: 0, y: 14, duration: 0.5, ease: 'power3.out', clearProps: 'opacity,transform' });
    }
    function resize() { if (current === 'layers' && st.W && st.auto) { st.s = fitScale(st.auto); layout(); } }
    cleanups.push(clear);
    return { load: load, clear: clear, resize: resize };
  })();

  // ---------- controller events ----------
  on(document, 'f2f:state', function (e) { onState(e.detail); });
  on(document, 'f2f:view', function (e) {
    var v = e.detail.view;
    canvas.classList.toggle('working', v === 'work');
    if (v === 'work') { canvas.classList.remove('finished'); if (current !== 'plan' && lastState) { canvas.classList.remove('working'); onState(lastState); canvas.classList.add('working'); } }
    if (v === 'ready') { canvas.classList.remove('finished'); XV.clear(); if (lastState) onState(lastState); }
  });
  on(document, 'f2f:done', function (e) {
    var d = e.detail;
    canvas.classList.remove('working');
    if (!d.ok || !d.doc) { canvas.classList.remove('finished'); return; }
    canvas.classList.add('finished');
    swap('layers', function () {
      renderLayers(d.doc);
      XV.load(d.svg, d.boxes || [], d.doc);
    });
  });
  // re-fit the frames when the canvas changes size
  var roT = null;
  var ro = new ResizeObserver(function () {
    clearTimeout(roT);
    roT = setTimeout(function () { if (current === 'plan' && lastState && lastState.has) renderFrames($('frames'), framesFor(lastState), { anim: false }); XV.resize(); }, 150);
  });
  ro.observe(canvas); cleanups.push(function () { ro.disconnect(); });

  // ---------- cleanup ----------
  on(window, 'pagehide', function (e) { if (e.persisted) return; while (cleanups.length) { try { cleanups.pop()(); } catch (e) {} } });
  window.F2FCanvas = { destroy: function () { while (cleanups.length) { try { cleanups.pop()(); } catch (e) {} } } };
})();
