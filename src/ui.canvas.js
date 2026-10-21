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
      rows.push('<li class="' + (d === 0 ? 'top' : '') + '" style="padding-left:' + (12 + d * 16) + 'px">' + icon(layerIcon(n), 14) + '<span class="nm">' + esc((n.name || n.type).replace(/­/g, '')) + '</span>' + (tag ? '<span class="tg">' + tag + '</span>' : '') + '</li>');
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

  // ---------- controller events ----------
  on(document, 'f2f:state', function (e) { onState(e.detail); });
  on(document, 'f2f:view', function (e) {
    var v = e.detail.view;
    canvas.classList.toggle('working', v === 'work');
    if (v === 'work') { canvas.classList.remove('finished'); if (current !== 'plan' && lastState) { canvas.classList.remove('working'); onState(lastState); canvas.classList.add('working'); } }
    if (v === 'ready') { canvas.classList.remove('finished'); if (lastState) onState(lastState); }
  });
  on(document, 'f2f:done', function (e) {
    var d = e.detail;
    canvas.classList.remove('working');
    if (!d.ok || !d.doc) { canvas.classList.remove('finished'); return; }
    canvas.classList.add('finished');
    swap('layers', function () {
      var tops = renderLayers(d.doc);
      renderFrames($('framesMini'), tops.length ? tops : framesFor(lastState || { widths: [1440] }), { max: 6 });
    });
  });
  // re-fit the frames when the canvas changes size
  var roT = null;
  var ro = new ResizeObserver(function () {
    clearTimeout(roT);
    roT = setTimeout(function () { if (current === 'plan' && lastState && lastState.has) renderFrames($('frames'), framesFor(lastState), { anim: false }); }, 150);
  });
  ro.observe(canvas); cleanups.push(function () { ro.disconnect(); });

  // ---------- cleanup ----------
  on(window, 'pagehide', function (e) { if (e.persisted) return; while (cleanups.length) { try { cleanups.pop()(); } catch (e) {} } });
  window.F2FCanvas = { destroy: function () { while (cleanups.length) { try { cleanups.pop()(); } catch (e) {} } } };
})();
