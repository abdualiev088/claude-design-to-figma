"""Builds the plugin UI and the website from src/.

    python3 build.py

Outputs:
  plugin/ui.html                  Figma plugin window
  site/index.html                 the website (same app, browser mode)
  site/claude-design-to-figma.zip the plugin, downloadable from the website
"""
import os, zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
def p(*a): return os.path.join(ROOT, *a)
def read(*a): return open(p(*a), encoding='utf-8').read()
def safe(s): return s.replace('</script', '<\\/script')

t = read('src', 'ui.shell.html')
ctrl = read('src', 'ui.controller.js').replace('/*ENGINE*/', read('src', 'ui.engine.js'))
for k, v in {'/*JSZIP*/': read('src', 'jszip.min.js'), '/*SVG*/': read('src', 'svg.js'), '/*CONTROLLER*/': ctrl}.items():
    t = t.replace(k, safe(v), 1)
t = t.replace('/*CAPTURE*/', safe(read('src', 'capture.js')))

open(p('plugin', 'ui.html'), 'w', encoding='utf-8').write(t)
os.makedirs(p('site'), exist_ok=True)
open(p('site', 'index.html'), 'w', encoding='utf-8').write(t)

with zipfile.ZipFile(p('site', 'claude-design-to-figma.zip'), 'w', zipfile.ZIP_DEFLATED) as z:
    for f in ['manifest.json', 'code.js', 'ui.html']:
        z.write(p('plugin', f), 'claude-design-to-figma/' + f)
    z.write(p('README.md'), 'claude-design-to-figma/README.md')
print('built', len(t), 'bytes')
