# Claude Design → Figma

Turn a Claude Design export (.html or .zip) into editable Figma layers: frames, text, images,
icons, gradients, shadows, borders, rounded corners and auto layout. Canvases with several
artboards become one Figma frame per artboard. Everything runs locally; nothing is uploaded.

Live site: https://claude-design-to-figma.netlify.app · Code: https://github.com/abdualiev088/claude-design-to-figma

## Two ways to use it

**Website (no install, works with Figma in the browser)**
Open the site, drop your export, click *Convert for Figma*, then *Copy for Figma* and press
Cmd+V (Ctrl+V) on your Figma canvas. You get editable text and shapes (no auto layout).

**Figma plugin (best result: auto layout, real fonts)**
Download `claude-design-to-figma.zip` from the site (or run `python3 build.py` and use the `plugin/` folder), unzip, then in
the Figma desktop app: Plugins → Development → Import plugin from manifest → pick `manifest.json`.

## Project layout

```
src/       sources: UI shell, controller, capture engine, SVG export, JSZip
plugin/    the Figma plugin (manifest.json, code.js; ui.html is generated)
build.py   builds plugin/ui.html and site/ (the website + plugin zip) from src/
```

Netlify runs `python3 build.py` on every push to `main` and publishes `site/`. To try changes
locally, run the same command and open `site/index.html`. Python 3 only, no dependencies.
