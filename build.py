"""Builds the plugin UI and the website from src/.

    python3 build.py

Outputs:
  plugin/ui.html                  Figma plugin window
  site/index.html                 the website (same app, browser mode)
  site/claude-design-to-figma.zip the plugin, downloadable from the website
"""
import io, json, os, re, subprocess, tarfile, urllib.request, zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
def p(*a): return os.path.join(ROOT, *a)
def read(*a): return open(p(*a), encoding='utf-8').read()
def safe(s): return s.replace('</script', '<\\/script')

# Figma clipboard encoder for the website: bundled from npm (Netlify runs `npm install` first).
BUNDLE = p('src', 'vendor', 'figit.bundle.js')
esbuild = p('node_modules', '.bin', 'esbuild')
if os.path.exists(esbuild):
    subprocess.run([esbuild, p('src', 'vendor', 'figit-entry.js'), '--bundle', '--format=iife', '--global-name=F2FFigit',
                    '--minify', '--platform=browser', '--legal-comments=inline', '--log-level=warning', '--outfile=' + BUNDLE], check=True)
elif not os.path.exists(BUNDLE):
    raise SystemExit('Run `npm install` first: the website needs the Figma clipboard encoder from npm.')

MOTION = p('src', 'vendor', 'motion.bundle.js')
if os.path.exists(esbuild):
    subprocess.run([esbuild, p('src', 'vendor', 'motion-entry.js'), '--bundle', '--format=iife', '--minify', '--platform=browser',
                    '--legal-comments=inline', '--log-level=warning', '--outfile=' + MOTION], check=True)
elif not os.path.exists(MOTION):
    raise SystemExit('Run `npm install` first: the website needs GSAP and Lenis from npm.')

# Interface icons: Solar (CC BY 4.0, 480 Design) and Iconify Logos, extracted into src/icons.json.
ICONS = json.load(open(p('src', 'icons.json'), encoding='utf-8'))
def svg_icon(m):
    ident, size = m.group(1), m.group(2)
    ic = ICONS[ident]
    cls = 'ico-svg ico-' + ident.replace(':', '-')
    return ('<svg class="%s" width="%s" height="%s" viewBox="0 0 %s %s" aria-hidden="true" focusable="false">%s</svg>'
            % (cls, size, size, ic['w'], ic['h'], ic['body']))

t = read('src', 'ui.shell.html').replace('<!--BODY-->', read('src', 'ui.body.html'), 1)
t = t.replace('/*SITECSS*/', read('src', 'ui.site.css'), 1)
t = re.sub(r'<!--icon:([a-z0-9-]+:[a-z0-9-]+):(\d+)-->', svg_icon, t)
ctrl = read('src', 'ui.controller.js').replace('/*ENGINE*/', read('src', 'ui.engine.js'))
for k, v in {'/*JSZIP*/': read('src', 'jszip.min.js'), '/*SVG*/': read('src', 'svg.js'), '/*CONTROLLER*/': ctrl}.items():
    t = t.replace(k, safe(v), 1)
t = t.replace('/*CAPTURE*/', safe(read('src', 'capture.js')))

# The plugin builds layers itself; only the website needs the Figma clipboard encoder.
site_js = (read('src', 'vendor', 'motion.bundle.js') + '\n;window.F2FIcons=' + json.dumps(ICONS) + ';\n' + read('src', 'ui.canvas.js'))
open(p('plugin', 'ui.html'), 'w', encoding='utf-8').write(t.replace('/*FIGIT*/', '', 1).replace('/*SITEJS*/', '', 1))
os.makedirs(p('site'), exist_ok=True)
open(p('site', 'index.html'), 'w', encoding='utf-8').write(t.replace('/*FIGIT*/', safe(read('src', 'vendor', 'figit.bundle.js')), 1).replace('/*SITEJS*/', safe(site_js), 1))

# Fallback font for the clipboard encoder when Google Fonts can't be reached (Inter, full glyph set, OFL).
INTER = 'https://registry.npmjs.org/inter-ui/-/inter-ui-4.1.1.tgz'
WANT = ['Regular', 'Italic', 'Medium', 'SemiBold', 'Bold']
os.makedirs(p('site', 'fonts'), exist_ok=True)
if not all(os.path.exists(p('site', 'fonts', 'Inter-%s.woff2' % w)) for w in WANT):
    try:
        data = urllib.request.urlopen(INTER, timeout=60).read()
        with tarfile.open(fileobj=io.BytesIO(data)) as tz:
            for w in WANT:
                open(p('site', 'fonts', 'Inter-%s.woff2' % w), 'wb').write(tz.extractfile('package/web/Inter-%s.woff2' % w).read())
            open(p('site', 'fonts', 'LICENSE.txt'), 'wb').write(tz.extractfile('package/LICENSE.txt').read())
    except Exception as e:
        print('warning: could not fetch the fallback font:', e)

with zipfile.ZipFile(p('site', 'claude-design-to-figma.zip'), 'w', zipfile.ZIP_DEFLATED) as z:
    for f in ['manifest.json', 'code.js', 'ui.html']:
        z.write(p('plugin', f), 'claude-design-to-figma/' + f)
    z.write(p('README.md'), 'claude-design-to-figma/README.md')
print('built', len(t), 'bytes')
