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


## Large-scene and gallery run — 2026-11-05

The [original showcase](../examples/showcase/README.md) supplies three posters and 256-shape grids at 256², 1024² and 2048². Source generation fixes letter-run ordering and LF text. Native compilation and WebAssembly verify whole initial/active RGB digests and all 14 pointer/keyboard controls.

```powershell
python -B examples/showcase/generate.py --output target/showcase
$env:IIMG_BENCH_REPETITIONS = "20"
node viewers/web/benchmark-gallery.mjs target/showcase/manifest.json
```

The [raw results](benchmarks/2026-11-05-gallery-windows.json) include input/engine hashes, every format, platform and memory methods. This run used Chromium 156.0.8078.74, Node 24.16.0, Windows 10.0.26200 and an Intel Core i5-12450H; viewport 2200×2200 at device scale 1. There were 20 repetitions per format/scene. The shared WASM was 363,260 bytes and is separate from file sizes. Inputs were already in memory.

| IIMG scene | File bytes | Initial work median / p95, ms | Reopen median / p95, ms | Activation median / p95, ms | Max WASM capacity, MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| orbital-night | 49,518 | 12.40 / 21.10 | 12.65 / 19.10 | 9.60 / 14.70 | 7.00 |
| solar-house | 37,815 | 10.80 / 22.00 | 11.45 / 13.50 | 7.85 / 9.80 | 8.12 |
| signal-garden | 41,444 | 12.15 / 24.20 | 12.75 / 15.90 | 9.80 / 12.70 | 8.12 |
| workload-256 | 57,137 | 3.20 / 12.40 | 2.60 / 3.60 | 0.90 / 1.20 | 2.00 |
| workload-1024 | 76,866 | 12.20 / 19.80 | 11.55 / 14.60 | 7.80 / 10.50 | 10.44 |
| workload-2048 | 129,604 | 47.50 / 64.60 | 41.40 / 53.10 | 26.75 / 37.10 | 37.69 |

| Scene | IIMG bytes, including PNG preview | Equivalent SVG bytes | Equivalent HTML bytes |
| --- | ---: | ---: | ---: |
| orbital-night | 49,518 | 13,058 | 13,112 |
| solar-house | 37,815 | 9,421 | 9,475 |
| signal-garden | 41,444 | 8,941 | 8,995 |
| workload-256 | 57,137 | 19,784 | 19,838 |
| workload-1024 | 76,866 | 19,948 | 20,002 |
| workload-2048 | 129,604 | 20,748 | 20,802 |

The vector-only SVG and HTML equivalents are smaller for these scenes. IIMG carries both scene data and a mandatory PNG preview. These results do not support a universal file-size advantage.

## Repeated full-viewer lifecycle

Generate the showcase into `target/showcase`, build release WASM, and run `node viewers/web/lifecycle-test.mjs target/lifecycle.json`. The harness rotates through 2048², state, motion and drag files on the actual offline viewer. It exercises controls and reset, then checks runtime and canvas clearing after each unload. It records post-GC JavaScript heap, WASM capacity, and browser/renderer process samples as separate series. The ready-time distribution includes automation overhead. CI uploads reports for each supported host. Physical Android peak memory and TalkBack speech have separate acceptance checks.

IIMG initial work includes instantiation/load/rasterization/canvas submission. Native initial work includes parsing, DOM insertion and handlers. These are different operations and their work times are not a paint-speed ranking. Both paths also record reopen/activation to the next animation-frame opportunity, which is browser scheduling rather than physical presentation. Whole IIMG RGB hashes and native painted activation pixels were checked outside timed samples.

Memory fields distinguish maximum observed WASM linear capacity, JavaScript heap after explicit GC, and current aggregate browser-process working sets/private bytes. The latter include browser/renderer overhead and can count shared pages twice; they are not transient peak, PSS or standalone image memory. Explicit GC and verification occur outside timing. The 2048² workload reached 37.69 MiB of WASM capacity; full low-memory Android/process-tree measurements remain open. Rive equivalents remain a separately tracked comparison.
