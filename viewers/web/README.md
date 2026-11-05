# Experimental IIMG web viewer

The packaged web viewer includes `iimg_web.wasm`. Serve the extracted directory with `python -m http.server --bind 127.0.0.1 8000` from that directory. For a source checkout, build the engine using the commands below.

The viewer reads selected files locally. After its first successful load on localhost or HTTPS, the service worker caches the page, script and engine so the viewer can reload offline. Selected files stay in memory and are not cached.

```powershell
rustup target add wasm32-unknown-unknown
cargo build --locked --release --target wasm32-unknown-unknown -p iimg-web
Copy-Item target/wasm32-unknown-unknown/release/iimg_web.wasm viewers/web/iimg_web.wasm
python -m http.server --bind 127.0.0.1 --directory viewers/web 8000
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

The CI matrix uses the headless Chromium revision selected by the locked Playwright dependency. To use the same browser locally, run `node viewers/web/node_modules/playwright-core/cli.js install --only-shell chromium` after `npm ci` and set `IIMG_PLAYWRIGHT_CHROMIUM=1` before the test. Linux CI installs Chromium's system dependencies with the Playwright installer.

Bump the shell cache version in `offline.js` when deploying a change to the page, script or WASM. Deploy the matching files together.
