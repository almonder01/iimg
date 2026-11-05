# Experimental IIMG Android viewer

The Android activity bundles the web viewer and the same Rust WASM engine used on desktop. Android's file picker and share receiver provide content URI streams. The activity reads at most 16 MiB and hands the bytes to the viewer through a private WebView origin. The app declares no internet or storage permission.

## Build and install

Use JDK 17, Gradle 9.6.0, Android SDK Platform 35, Build Tools 36.0.0 and platform-tools. The Windows local build also passed with the Android Studio JDK 21. The device needs an up-to-date Android System WebView. [Android Gradle Plugin compatibility](https://developer.android.com/build/releases/agp-9-5-0-release-notes)

```powershell
rustup target add wasm32-unknown-unknown
cargo build --locked --release --target wasm32-unknown-unknown -p iimg-web
gradle -p viewers/android :app:assembleDebug
adb install -r viewers/android/app/build/outputs/apk/debug/app-debug.apk
```

The Android workflow builds the debug APK, checks that it contains the expected viewer files and WASM bytes, verifies its debug signature and uploads it as a CI artifact.

The current app recognizes `application/octet-stream`, `application/x-iimg` and `image/iimg` for incoming document intents. These experimental intent filters do not imply media type registration or support in third-party apps.

## Preview 0.1.1 reader hardening

Selections clear previous content immediately and use a 15-second delivery deadline. The reader has two process-wide read workers and one queued read, cancels superseded tasks, rejects oversized/zero-progress streams, and suppresses stale or destroyed-owner callbacks. Descriptor opening uses Android cancellation signals; descriptor cancellation/close is best-effort on a separate bounded executor. Providers that permanently ignore cancellation can occupy the bounded pool; they are not forcibly terminated. This protects UI responsiveness and limits work without promising arbitrary provider behavior.

Run `python -B scripts/test_android_reader.py` with JDK 17+ and `JAVA_HOME`, or pass `--java-bin /path/to/jdk/bin`. Ten standalone JVM cases cover the exact byte bound, empty/oversized/error/zero-progress streams, queued stale delivery, lifecycle close, timeout, recovery with one non-cooperative provider, and backpressure. These tests do not execute Android Binder or WebView; the APK build and manual provider cases cover that boundary separately.

The debug viewer has a **Test info** button with app/device/Android/WebView versions, selected-file size/SHA-256 and one host-process PSS sample. **Copy** puts this report on the clipboard only after a user action. It includes no document content or URI and sends nothing. The PSS value excludes a complete renderer/process-tree accounting and is not peak app memory. This button is absent from non-debug builds.

## Test-source companion

The separately installed **IIMG test sources** app provides explicit provider cases without requiring developer options or a 17 MiB download:

1. **Open valid image**: shows the original two-control fixture.
2. **Read failure**: reports a read error and removes the earlier image/controls.
3. **Oversized stream**: generates 16 MiB + 1 in a bounded pipe. The viewer reports its size limit.
4. **Slow provider**: waits up to 30 seconds but accepts cancellation. The viewer should report its 15-second deadline.
5. **Delayed static then valid**: sends a static source that normally waits 2.5 seconds, then sends the valid interactive source after 0.5 seconds and cancels the old read. The valid image may appear promptly. Observe it for another 3–5 seconds: it must retain both controls rather than being replaced by the old result. This observation window is not a minimum loading delay; **Slow provider** tests the separate 15-second deadline.

Use Back to return to the companion between cases and reopen the valid image after failures. This app is a development fixture, not part of normal image sharing. The provider is private and grants read access to the viewer for these fixed synthetic sources. Both APKs have separate CI artifacts. Debug builds from different machines/runs can have different signing keys; Android may require uninstalling an older test APK before installing the new one.

## Device and sharing checks

1. Record Android version, device, WebView version and source app version. Push `tests/fixtures/v0.2/two-controls.iimg` to Downloads. Open it with the in-app picker and verify both controls, reset and the offline initial frame.
2. Use the system file manager to share that document to IIMG Viewer and separately try its open-with action. Record whether each source app lists the viewer and delivers a readable content URI.
3. Send the file as a document attachment over each target transport. Record the attachment's SHA-256 before sending and after download, the system handoff, and whether the receiving app renders IIMG itself. Keep these results separate.
4. Repeat with an unsupported capability fixture and a corrupt fixture. Verify the static preview for the former and a diagnostic for the latter.

The Chromium browser test exercises the JavaScript callback and synthetic origin. For an emulator or dedicated test device, build the separate handoff fixture app. Its private, grantable provider serves a single checked-in document. The sender checks its SHA-256 and sends VIEW and SEND intents with read grants through Android's resolver. The smoke test uses Node 22+ and a temporary ADB forward to the debug WebView. It checks the control names, initial pixel, changed pixel and pressed state after activation.

```powershell
gradle -p viewers/android :handoffFixture:assembleDebug
python -B scripts/test_android_handoff.py --adb "$env:ANDROID_HOME/platform-tools/adb.exe" --serial emulator-5572 --apk viewers/android/app/build/outputs/apk/debug/app-debug.apk --sender-apk viewers/android/handoffFixture/build/outputs/apk/debug/handoffFixture-debug.apk
```

To verify system touch, generate the candidate, fallback and corrupt files and independent reference frames. The output directory must be new. Use a debuggable build and replace `emulator-5580` with the selected test device serial.

```powershell
$serial = "emulator-5580"
cargo build --locked -p iimg-cli
python -B tests/conformance/android_fixtures.py --output target/android-device-fixtures
adb -s $serial push target/android-device-fixtures/candidate.iimg /sdcard/Download/candidate.iimg
adb -s $serial push target/android-device-fixtures/unsupported.iimg /sdcard/Download/unsupported.iimg
adb -s $serial push target/android-device-fixtures/corrupt.iimg /sdcard/Download/corrupt.iimg
Read-Host "Open candidate.iimg through the Android picker, then press Enter here"
$viewerPid = (adb -s $serial shell pidof org.iimg.viewer).Trim()
$port = (adb -s $serial forward tcp:0 "localabstract:webview_devtools_remote_$viewerPid").Trim()
try {
    node scripts/test_android_webview.mjs $port initial target/android-device-fixtures/initial.ppm
    Read-Host "Tap the lamp and the top-left switch in the image, then press Enter here"
    node scripts/test_android_webview.mjs $port active target/android-device-fixtures/active.ppm
    Read-Host "Tap Reset image, then press Enter here"
    node scripts/test_android_webview.mjs $port initial target/android-device-fixtures/initial.ppm
    Read-Host "Open unsupported.iimg through the picker, then press Enter here"
    node scripts/test_android_webview.mjs $port preview
    Read-Host "Open corrupt.iimg through the picker, then press Enter here"
    node scripts/test_android_webview.mjs $port invalid
    Read-Host "Open candidate.iimg again, then press Enter here"
    node scripts/test_android_webview.mjs $port initial target/android-device-fixtures/initial.ppm
} finally {
    adb -s $serial forward --remove "tcp:$port"
}
```

Each check must exit successfully. These modes read the canvas and accessibility state without dispatching a click. Record whether the touch came from a physical device or was injected by the Android test environment.

The optional PPM argument compares every canvas RGB pixel with the reference frame. The generated frame files are independently evaluated in Python. The fixture manifest records SHA-256 values and expected viewer modes. Recreate the ADB forward if Android restarts the viewer process.

## Local device evidence

On 2026-11-05, the current debug APK passed picker opening, both Android-injected pointer activations, reset, static fallback, corrupted-file diagnostics and recovery by reopening a valid document on Android API 34 with WebView 113.0.5672.136. The 32×32 initial, active and reset canvas frames matched the independent reference bytes. VIEW and SEND also passed with the separate fixture provider.

The dedicated emulator used a 720×1280 display, two cores and host GPU rendering. Google Play Services was disabled in that test emulator after Android exit records showed viewer termination caused by its dying FontsProvider. Physical-device testing with normal system services and third-party attachment delivery remain open.

The APK SHA-256 was `fc265e2af22272240ca1d3f511b37e619dffbb7dc2954cf068c8e8f5a1555395`. The candidate fixture was 637 bytes with SHA-256 `6a7804433626ae2163f447c3e66646a72642063d1d0e952547245754515992bd`.

On 2026-11-05, the repository owner reported successful installation, picker opening, touch activation, offline reopening and reset on a physical Samsung Galaxy S23+ running Android 17. See the [device record](../../docs/device-tests/2026-11-05-galaxy-s23-plus.md) for the exact published build, fixture and evidence limits. This test used the later device-test APK; it has a different digest from the emulator APK above. Physical-device fallback/recovery, VIEW/SEND, WebView version and received-file checksums remain open. Email and messenger transport still require separate app-level measurements.

The subsequent Galaxy S23+ checks passed WhatsApp 2.26.42.74 attachment handoff and interaction, plus a computer-download byte comparison against the original fixture. Screenshots confirmed static fallback for the unsupported case and rejection/clearing for the corrupt case; the tester confirmed recovery and interaction after reopening the valid file. This completes the selected device smoke procedure. Broader VIEW/SEND and device coverage and additional transport measurements remain open. The earlier build's WebView version was not captured.

The [0.1.1-preview follow-up](../../docs/device-tests/2026-11-05-galaxy-s23-plus-preview-0.1.1.md) records the owner's reported success with the showcase, 2048² workload, provider-fault and recovery procedure on `SM-S916B`, Android 17 / API 37, WebView `156.0.8078.47`. Copied Test info reports identify the valid two-control fixture and large workload by exact size/SHA-256. Six host PSS snapshots are documented separately from total/peak renderer or app memory. Explicit assistive-technology tests and broader devices remain open.

[Android document picker](https://developer.android.com/training/data-storage/shared/documents-files?hl=en) · [Android incoming shares](https://developer.android.com/develop/ui/compose/sharing/receive)
