# Candidate performance baseline

Build the release WASM and install the locked browser-test dependency. Run the benchmark on the same Chromium executable when comparing results.

```sh
cargo build --locked --release --target wasm32-unknown-unknown -p iimg-web
npm --prefix viewers/web ci --ignore-scripts
node viewers/web/benchmark.mjs
```

The benchmark measures 50 repetitions per fixture. Inputs are already in browser memory. A cold-instance open includes WASM instantiation, document load and canvas submission. The browser can reuse internal compilation caches across repetitions. Warm open reuses one WASM instance and replaces its document. Activation measures the normalized event through RGB rendering and canvas submission. The timer excludes physical input and display presentation. Reported memory is maximum WASM linear memory capacity observed after drawing. It excludes browser process overhead and does not measure peak resident memory.

## Windows run

Windows 10.0.26200, Chromium 156.0.8078.74, Node 24.16.0 and Intel Core i5-12450H. The shared release WASM was 345,294 bytes.

| Fixture | File size | Cold-instance median / p95 | Warm median / p95 | Activation median / p95 | Max WASM memory |
| --- | ---: | ---: | ---: | ---: | ---: |
| Vector interactive lamp, 32×32 | 488 B | 1.30 / 12.80 ms | 0.10 / 0.20 ms | <0.10 / 0.10 ms | 1,179,648 B |
| Mixed raster and vector toggle, 32×32 | 657 B | 1.25 / 2.40 ms | 0.10 / 0.20 ms | <0.10 / 0.10 ms | 1,179,648 B |

The benchmark asserts the active lamp pixel to prevent timing a failed load or no-op. Median activation times were below the observed browser timer resolution.

## SVG and HTML comparison

```powershell
$env:IIMG_BENCH_REPETITIONS = "50"
node viewers/web/benchmark-native.mjs
```

The generated SVG and HTML use the same geometry, colors, interaction and embedded PNG tile as the IIMG fixtures. HTML uses inline SVG. The measured file sizes include the inline activation code. IIMG file sizes include the embedded PNG preview; its shared engine size appears separately above.

| Fixture | IIMG | SVG | HTML | SVG parse and mount median / p95 | HTML parse and mount median / p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Vector lamp | 488 B | 633 B | 652 B | 0.10 / 0.20 ms | <0.10 / 0.20 ms |
| Raster-backed lamp | 657 B | 805 B | 824 B | 0.10 / 0.20 ms | <0.10 / 0.10 ms |

Chromium 156.0.8078.74 ran 50 repetitions per format and fixture on the same Windows host. The script verifies the fill and pressed state after each activation. All activation-to-DOM medians were below timer resolution, and p95 was at most 0.10 ms.

Parse and mount covers parsing, inserting the SVG subtree and installing its input handlers. It ends before image decode or paint can be guaranteed, so the timing does not rank these formats against the IIMG load-and-render measurements.

## Shared frame-opportunity measurement

Both scripts dispatch activation inside one animation-frame callback and sample the clock inside the next. This measures one browser scheduling interval after the scripted event, including its work. It does not measure physical input, compositor presentation or display scan-out. The native benchmark additionally checks the active lamp and background or embedded tile pixels in a Chromium screenshot after its timing loop.

| Fixture | IIMG median / p95 | SVG median / p95 | HTML median / p95 |
| --- | ---: | ---: | ---: |
| Vector lamp | 16.60 / 17.10 ms | 16.70 / 18.50 ms | 16.70 / 17.10 ms |
| Raster-backed lamp | 16.65 / 18.40 ms | 16.80 / 18.50 ms | 16.70 / 17.10 ms |

The 50-repetition rerun used Chromium 156.0.8078.74 on the same Windows host. The clustered values reflect browser frame cadence. Larger files, resident memory and physical event-to-display latency remain open.

Rive requires equivalent exported files for both workloads. The Rive editor lists local `.riv` export under a paid plan. Keep this comparison open until equivalent files are available under usable test terms. [Rive export documentation](https://api-docs.rive.app/android/latest/-rive%20-android/app.rive/-rive-file/index.html) · [Rive plan details](https://rive.app/pricing)
