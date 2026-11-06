# Experimental IIMG web viewer

The packaged web viewer includes `iimg_web.wasm` and `serve.py`. From the extracted directory run `python serve.py` and open `http://127.0.0.1:8000`. The host binds only to the local computer and sets module/WASM MIME types explicitly; some Windows configurations otherwise serve `.mjs` as `text/plain` and browsers refuse it. Stop with Ctrl+C. For a source checkout, build the engine using the commands below.

The viewer reads selected files locally. After its first successful load on localhost or HTTPS, the service worker caches the page, script and engine so the viewer can reload offline. Selected files stay in memory and are not cached.

Open **Author an IIMG image** for the visual workspace: add rectangles/circles, select and move/resize them, edit geometry/colors, change layers, bind named color toggles, undo/redo and save/import editable source JSON. Original templates and direct bounded RGB8 PNG upload are included. **Validate and preview** tests the result in the viewer; **Download IIMG** exports it. See the [authoring guide](../../docs/AUTHORING.md) for limits and keyboard controls. The editor loads its own WASM instance only when opened and is cached offline with the shell. Recovery is opt-in, bounded and local to this browser, with explicit restore/deletion; retain source JSON as your portable backup. Compiled IIMG import is viewer-only.

```powershell
rustup target add wasm32-unknown-unknown
cargo build --locked --release --target wasm32-unknown-unknown -p iimg-web
Copy-Item target/wasm32-unknown-unknown/release/iimg_web.wasm viewers/web/iimg_web.wasm
python scripts/serve_web.py --directory viewers/web --port 8000
```

Open `http://127.0.0.1:8000` and select `tests/fixtures/v0.2/two-controls.iimg`. Click or tap each colored shape, or use Tab and Enter or Space on the corresponding buttons. The buttons expose their pressed state to assistive technology. Reset restores the original colors.

The engine smoke test runs with Node after the Rust build.

```sh
node viewers/web/smoke.mjs
```

The browser test uses installed Chrome by default. Set `IIMG_CHROMIUM` to another Chromium executable if needed. It starts its own loopback server and reads the release WASM directly from Cargo's default target directory.

```sh
npm --prefix viewers/web ci --ignore-scripts
npm --prefix viewers/web test
```

Run `npm --prefix viewers/web run test:schemas` after the WASM build and npm install to check the [machine-readable schemas](../../spec/schemas/README.md). This suite also verifies semantic and lexical failures through the Core compiler.

The CI matrix uses the headless Chromium revision selected by the locked Playwright dependency. To use the same browser locally, run `node viewers/web/node_modules/playwright-core/cli.js install --only-shell chromium` after `npm ci` and set `IIMG_PLAYWRIGHT_CHROMIUM=1` before the test. Linux CI installs Chromium's system dependencies with the Playwright installer.

Bump the shell cache version in `offline.js` when deploying a change to the page, script or WASM. Deploy the matching files together.
