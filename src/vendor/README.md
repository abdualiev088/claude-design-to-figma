# vendor

`figit-entry.js` is bundled by `build.py` (with esbuild) into `figit.bundle.js`, which the website loads as
the global `F2FFigit`. It is [@figit/dom-to-figma](https://www.npmjs.com/package/@figit/dom-to-figma) and
[@figit/fig-kiwi](https://www.npmjs.com/package/@figit/fig-kiwi) (MIT, see `LICENSE-figit.txt`): they write
Figma's native clipboard format, so a paste gives real frames, auto layout and editable text.

Run `npm install` once (Netlify does this automatically), then `python3 build.py`.
