# Claude Design → Figma

Turn a Claude Design export (.html or .zip) into editable Figma layers: frames, text, images,
icons, gradients, shadows, borders, rounded corners and auto layout. Canvases with several
artboards become one Figma frame per artboard. Everything runs locally; nothing is uploaded.

Live site: https://claude-design-to-figma.netlify.app · Code: https://github.com/abdualiev088/claude-design-to-figma

## Two ways to use it

**Website (no install, works with Figma in the browser)**
Open the site, drop your export, click *Convert for Figma*, then *Copy for Figma* and press
Cmd+V (Ctrl+V) on your Figma canvas. The copy is in Figma's own clipboard format, so you get
real frames with auto layout, editable text and vector icons, with plain wrapper `<div>`s folded
away. The *.svg* button is still there if you want a flat picture.

**Figma plugin (works inside Figma)**
Download `claude-design-to-figma.zip` from the site (or run `python3 build.py` and use the `plugin/` folder), unzip, then in
the Figma desktop app: Plugins → Development → Import plugin from manifest → pick `manifest.json`.

## Project layout

```
src/       sources: UI shell, controller, capture engine, SVG export, JSZip
src/ui.body.html, ui.site.css, ui.canvas.js  page markup, the browser-mode workbench styles and canvas
src/icons.json  interface icons from Iconify: Solar (CC BY 4.0, 480 Design) and Logos (GitHub, Figma marks)
src/vendor the Figma clipboard encoder (@figit/dom-to-figma, MIT), see src/vendor/README.md
plugin/    the Figma plugin (manifest.json, code.js; ui.html is generated)
build.py   builds plugin/ui.html and site/ (the website + plugin zip) from src/
```

Netlify runs `npm install` and `python3 build.py` on every push to `main` and publishes `site/`. To try changes
locally, run `npm install && python3 build.py` and serve `site/` (for example `python3 -m http.server -d site`).
Needs Python 3 and Node. The website's motion uses GSAP and Lenis (bundled from npm); the plugin window stays static. The build also downloads the fallback font (Inter) from npm.
