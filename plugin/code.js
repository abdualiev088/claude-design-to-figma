// Claude Design → Figma — main thread (Figma sandbox).
// Receives a captured layer tree from the UI and builds real Figma nodes.

figma.showUI(__html__, { width: 400, height: 720, themeColors: true });

var FONT_CACHE = {};      // "fams|weight|italic" -> FontName
var AVAILABLE = null;     // familyLower -> { family, styles: [] }
var LOADED = {};          // "family::style" -> true
var built = 0;

function post(type, data) { figma.ui.postMessage(Object.assign({ type: type }, data || {})); }

// ---------------- fonts ----------------
var GENERIC = {
  'sans-serif': ['Inter', 'Roboto', 'Arial', 'Helvetica'],
  'system-ui': ['SF Pro Text', 'SF Pro', 'Inter', 'Roboto'],
  '-apple-system': ['SF Pro Text', 'SF Pro', 'Inter'],
  'blinkmacsystemfont': ['SF Pro Text', 'SF Pro', 'Inter'],
  'ui-sans-serif': ['Inter', 'Roboto'],
  'segoe ui': ['Segoe UI', 'Inter'],
  'serif': ['Georgia', 'Times New Roman', 'Noto Serif', 'Playfair Display'],
  'ui-serif': ['Georgia', 'Noto Serif'],
  'monospace': ['JetBrains Mono', 'Roboto Mono', 'SF Mono', 'Menlo', 'Courier New'],
  'ui-monospace': ['SF Mono', 'JetBrains Mono', 'Roboto Mono', 'Menlo'],
  'sfmono-regular': ['SF Mono', 'Roboto Mono'],
  'cursive': ['Comic Sans MS', 'Inter'],
  'emoji': [], 'apple color emoji': [], 'segoe ui emoji': [], 'noto color emoji': []
};

var WEIGHT_WORDS = [
  ['extralight', 200], ['ultralight', 200], ['extrabold', 800], ['ultrabold', 800], ['semibold', 600], ['demibold', 600],
  ['hairline', 100], ['thin', 100], ['light', 300], ['regular', 400], ['normal', 400], ['book', 400], ['roman', 400],
  ['medium', 500], ['bold', 700], ['black', 900], ['heavy', 900]
];
function styleWeight(style) {
  var s = style.toLowerCase().replace(/[\s_-]/g, '');
  for (var i = 0; i < WEIGHT_WORDS.length; i++) if (s.indexOf(WEIGHT_WORDS[i][0]) > -1) return WEIGHT_WORDS[i][1];
  return 400;
}
function styleItalic(style) { return /italic|oblique/i.test(style); }

async function ensureAvailable() {
  if (AVAILABLE) return;
  AVAILABLE = {};
  var list = await figma.listAvailableFontsAsync();
  list.forEach(function (f) {
    var k = f.fontName.family.toLowerCase();
    if (!AVAILABLE[k]) AVAILABLE[k] = { family: f.fontName.family, styles: [] };
    AVAILABLE[k].styles.push(f.fontName.style);
  });
}

function pickStyle(styles, weight, italic) {
  var best = null, bestScore = 1e9;
  styles.forEach(function (st) {
    var w = styleWeight(st), it = styleItalic(st);
    var score = Math.abs(w - weight) + (it !== italic ? 1000 : 0);
    if (/condensed|expanded|narrow|wide|display|caption|text|variable/i.test(st) && !/^(regular|italic|bold)/i.test(st)) score += 5; // prefer plain cuts
    if (score < bestScore) { bestScore = score; best = st; }
  });
  return best;
}

function resolveFont(spec) {
  var key = spec.families.join(',') + '|' + spec.weight + '|' + spec.italic;
  if (FONT_CACHE[key]) return FONT_CACHE[key];
  var candidates = [];
  spec.families.forEach(function (f) {
    var low = f.toLowerCase();
    if (GENERIC[low]) candidates = candidates.concat(GENERIC[low]);
    else candidates.push(f);
  });
  candidates.push('Inter', 'Roboto', 'Arial');
  var found = null;
  for (var i = 0; i < candidates.length && !found; i++) {
    var a = AVAILABLE[candidates[i].toLowerCase()];
    if (a) found = { family: a.family, style: pickStyle(a.styles, spec.weight, spec.italic) };
  }
  if (!found) found = { family: 'Inter', style: 'Regular' };
  FONT_CACHE[key] = found;
  return found;
}

async function loadFont(fn) {
  var k = fn.family + '::' + fn.style;
  if (LOADED[k] !== undefined) return LOADED[k];
  try { await figma.loadFontAsync(fn); LOADED[k] = true; }
  catch (e) { LOADED[k] = false; }
  return LOADED[k];
}

async function prepareFonts(tree, missing) {
  var specs = [];
  (function walk(n) {
    if (n.t === 'text') n.segments.forEach(function (s) { specs.push(s.style); });
    if (n.children) n.children.forEach(walk);
  })(tree);
  for (var i = 0; i < specs.length; i++) {
    var fn = resolveFont(specs[i]);
    var ok = await loadFont(fn);
    if (!ok) {
      var fb = { family: 'Inter', style: pickStyle(['Thin', 'Extra Light', 'Light', 'Regular', 'Medium', 'Semi Bold', 'Bold', 'Extra Bold', 'Black', 'Italic', 'Bold Italic'], specs[i].weight, specs[i].italic) || 'Regular' };
      if (!(await loadFont(fb))) fb = { family: 'Inter', style: 'Regular' };
      await loadFont(fb);
      FONT_CACHE[specs[i].families.join(',') + '|' + specs[i].weight + '|' + specs[i].italic] = fb;
      fn = fb;
    }
    var wanted = specs[i].families[0];
    if (wanted && fn.family.toLowerCase() !== wanted.toLowerCase() && !GENERIC[wanted.toLowerCase()]) missing[wanted] = fn.family;
  }
}

// ---------------- paints ----------------
var IMAGE_HASH = {};
function makePaints(list, images) {
  var out = [];
  (list || []).forEach(function (p) {
    if (p.type === 'SOLID') out.push({ type: 'SOLID', color: p.color, opacity: p.opacity === undefined ? 1 : p.opacity });
    else if (p.type === 'GRADIENT_LINEAR' || p.type === 'GRADIENT_RADIAL') out.push({ type: p.type, gradientTransform: p.gradientTransform, gradientStops: p.gradientStops });
    else if (p.type === 'IMAGE') {
      var img = images[p.imageId];
      if (!img || img.failed || img.svg) return;
      var hash = IMAGE_HASH[p.imageId];
      if (!hash) {
        try { hash = figma.createImage(img.bytes).hash; IMAGE_HASH[p.imageId] = hash; }
        catch (e) { return; }
      }
      var paint = { type: 'IMAGE', imageHash: hash, scaleMode: p.scaleMode || 'FILL' };
      if (p.scaleMode === 'TILE') paint.scalingFactor = 1;
      out.push(paint);
    }
  });
  return out;
}

function blendMode(css) {
  var m = String(css).toUpperCase().replace(/-/g, '_');
  var ok = ['MULTIPLY', 'SCREEN', 'OVERLAY', 'DARKEN', 'LIGHTEN', 'COLOR_DODGE', 'COLOR_BURN', 'HARD_LIGHT', 'SOFT_LIGHT', 'DIFFERENCE', 'EXCLUSION', 'HUE', 'SATURATION', 'COLOR', 'LUMINOSITY'];
  return ok.indexOf(m) > -1 ? m : null;
}

function placeRotated(node, d, px, py) {
  // d.x/y/w/h is the unrotated box; CSS rotates clockwise around the centre.
  var r = -d.rotation * Math.PI / 180;
  var c = Math.cos(r), s = Math.sin(r);
  var cx = d.x + d.w / 2 - px, cy = d.y + d.h / 2 - py;
  var w = node.width, h = node.height;
  var tx = cx - (c * w / 2 + s * h / 2), ty = cy - (-s * w / 2 + c * h / 2);
  node.relativeTransform = [[c, s, tx], [-s, c, ty]];
}

async function tick() {
  built++;
  if (built % 150 === 0) {
    post('progress', { built: built });
    await new Promise(function (r) { setTimeout(r, 0); });
  }
}

// ---------------- node builders ----------------
async function buildNode(d, parent, px, py, images) {
  await tick();
  var node;
  if (d.t === 'text') node = buildText(d);
  else if (d.t === 'svg') node = buildSvg(d.svg, d.w, d.h, d.name);
  else node = await buildFrame(d, images);
  if (!node) return null;
  parent.appendChild(node);
  if (d.rotation) placeRotated(node, d, px, py);
  else { node.x = d.x - px; node.y = d.y - py; }
  if (d.opacity !== undefined && d.t !== 'frame') node.opacity = d.opacity;
  return node;
}

// Give the root <svg> the target size (adding a viewBox if needed) so content scales instead of being cropped.
function fitSvg(svg, w, h) {
  if (!(w > 0 && h > 0)) return svg;
  return svg.replace(/<svg\b([^>]*)>/i, function (m, attrs) {
    var vb = /\bviewBox\s*=/i.test(attrs);
    var ow = (attrs.match(/\swidth\s*=\s*["']?([\d.]+)(px)?["']?/i) || [])[1];
    var oh = (attrs.match(/\sheight\s*=\s*["']?([\d.]+)(px)?["']?/i) || [])[1];
    attrs = attrs.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    if (!vb && ow && oh) attrs += ' viewBox="0 0 ' + ow + ' ' + oh + '"';
    return '<svg' + attrs + ' width="' + round2(w) + '" height="' + round2(h) + '">';
  });
}

function buildSvg(svg, w, h, name) {
  try {
    var n = figma.createNodeFromSvg(fitSvg(svg, w, h));
    n.name = name || 'Vector';
    if (w > 0 && h > 0 && (Math.abs(n.width - w) > 0.5 || Math.abs(n.height - h) > 0.5)) n.resize(Math.max(w, 0.01), Math.max(h, 0.01));
    n.fills = [];
    n.clipsContent = false;
    return n;
  } catch (e) {
    var r = figma.createRectangle();
    r.name = (name || 'Vector') + ' (unsupported SVG)';
    r.resize(Math.max(w, 1), Math.max(h, 1));
    r.fills = [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.85 } }];
    return r;
  }
}

function buildText(d) {
  var t = figma.createText();
  var chars = d.segments.map(function (s) { return s.text; }).join('');
  var first = FONT_CACHE[key(d.segments[0].style)] || { family: 'Inter', style: 'Regular' };
  t.fontName = first;
  t.characters = chars;
  var pos = 0;
  d.segments.forEach(function (s) {
    var end = pos + s.text.length;
    if (end > pos) {
      var st = s.style;
      t.setRangeFontName(pos, end, FONT_CACHE[key(st)] || first);
      t.setRangeFontSize(pos, end, round2(st.size));
      t.setRangeFills(pos, end, [{ type: 'SOLID', color: { r: st.color.r, g: st.color.g, b: st.color.b }, opacity: st.color.a }]);
      if (st.ls) t.setRangeLetterSpacing(pos, end, { value: round2(st.ls), unit: 'PIXELS' });
      if (st.lh) t.setRangeLineHeight(pos, end, { value: round2(st.lh), unit: 'PIXELS' });
      if (st.deco !== 'NONE') t.setRangeTextDecoration(pos, end, st.deco);
      if (st.tcase !== 'ORIGINAL') t.setRangeTextCase(pos, end, st.tcase);
    }
    pos = end;
  });
  t.name = d.name || chars.slice(0, 40);
  t.textAlignHorizontal = d.align || 'LEFT';
  if (d.autoResize === 'HEIGHT') { t.textAutoResize = 'HEIGHT'; t.resize(Math.max(d.w, 1), t.height); }
  else if (d.autoResize === 'NONE') {
    t.textAutoResize = 'NONE'; t.resize(Math.max(d.w, 1), Math.max(d.h, 1));
    t.textAlignVertical = 'CENTER';
    if (d.truncate) { try { t.textTruncation = 'ENDING'; } catch (e) {} }
  }
  else t.textAutoResize = 'WIDTH_AND_HEIGHT';
  return t;
}
function key(st) { return st.families.join(',') + '|' + st.weight + '|' + st.italic; }
function round2(n) { return Math.round(n * 100) / 100; }

async function buildFrame(d, images) {
  var f = figma.createFrame();
  f.name = d.name || 'Frame';
  f.resize(Math.max(d.w, 0.01), Math.max(d.h, 0.01));
  f.fills = makePaints(d.fills, images);
  f.clipsContent = !!d.clip;
  if (d.strokes) {
    f.strokes = makePaints(d.strokes, images);
    var w = d.strokeWeights;
    f.strokeAlign = d.strokeAlign || 'INSIDE';
    if (w.t === w.r && w.r === w.b && w.b === w.l) f.strokeWeight = w.t;
    else { f.strokeTopWeight = w.t; f.strokeRightWeight = w.r; f.strokeBottomWeight = w.b; f.strokeLeftWeight = w.l; }
    if (d.dash) f.dashPattern = d.dash;
  }
  if (d.radius) {
    var r = d.radius;
    if (r[0] === r[1] && r[1] === r[2] && r[2] === r[3]) f.cornerRadius = r[0];
    else { f.topLeftRadius = r[0]; f.topRightRadius = r[1]; f.bottomRightRadius = r[2]; f.bottomLeftRadius = r[3]; }
  }
  if (d.effects) { try { f.effects = d.effects; } catch (e) {} }
  if (d.opacity !== undefined) f.opacity = d.opacity;
  if (d.blend) { var bm = blendMode(d.blend); if (bm) f.blendMode = bm; }

  // SVG images or images that failed to load
  (d.fills || []).forEach(function (p) {
    if (p.type !== 'IMAGE') return;
    var img = images[p.imageId];
    if (img && img.svg) {
      var v = buildSvg(img.svg, d.w, d.h, 'Image (svg)');
      f.appendChild(v); v.x = 0; v.y = 0;
    } else if (!img || img.failed) {
      f.fills = f.fills.concat([{ type: 'SOLID', color: { r: 0.88, g: 0.88, b: 0.9 } }]);
      f.name = f.name + ' (image unavailable)';
    }
  });

  var kids = d.children || [];
  var made = [];
  for (var i = 0; i < kids.length; i++) {
    var c = await buildNode(kids[i], f, d.x, d.y, images);
    if (c) made.push({ node: c, data: kids[i] });
  }

  if (d.layout) {
    var L = d.layout;
    try {
      f.layoutMode = L.mode;
      f.primaryAxisSizingMode = 'FIXED';
      f.counterAxisSizingMode = 'FIXED';
      f.itemSpacing = L.gap;
      f.paddingTop = L.pad[0]; f.paddingRight = L.pad[1]; f.paddingBottom = L.pad[2]; f.paddingLeft = L.pad[3];
      f.primaryAxisAlignItems = L.primary;
      f.counterAxisAlignItems = L.counter;
      made.forEach(function (m) { if (m.data.layoutAlign === 'STRETCH') m.node.layoutAlign = 'STRETCH'; });
      f.resize(Math.max(d.w, 0.01), Math.max(d.h, 0.01));
    } catch (e) { f.layoutMode = 'NONE'; }
  }
  return f;
}

// ---------------- entry ----------------
figma.ui.onmessage = async function (msg) {
  if (msg.type === 'resize') { figma.ui.resize(msg.w, msg.h); return; }
  if (msg.type === 'notify') { figma.notify(msg.text); return; }
  if (msg.type !== 'build') return;
  try {
    built = 0;
    IMAGE_HASH = {};
    await ensureAvailable();
    var missing = {};
    post('status', { text: 'Loading fonts…' });
    await prepareFonts(msg.tree, missing);
    post('status', { text: 'Building layers…' });
    var center = figma.viewport.center;
    var offsetX = msg.offsetX || 0;
    var root = await buildNode(msg.tree, figma.currentPage, 0, 0, msg.images);
    root.x = Math.round(center.x - (msg.totalWidth || root.width) / 2 + offsetX);
    root.y = Math.round(center.y - 300 + (msg.offsetY || 0));
    var sel = msg.first ? [] : figma.currentPage.selection.filter(function (n) { return !n.removed; });
    sel.push(root);
    figma.currentPage.selection = sel;
    if (msg.last) figma.viewport.scrollAndZoomIntoView(sel);
    post('done', { id: root.id, built: built, missing: missing });
  } catch (e) {
    post('error', { text: String(e && e.message || e) });
  }
};
