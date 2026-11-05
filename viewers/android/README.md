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

To verify system touch separately, open the two-control fixture through the picker in a debuggable build, then run the read-only WebView checks below. Replace `emulator-5572` with the serial of the selected test device.

```powershell
$serial = "emulator-5572"
$viewerPid = (adb -s $serial shell pidof org.iimg.viewer).Trim()
$port = (adb -s $serial forward tcp:0 "localabstract:webview_devtools_remote_$viewerPid").Trim()
try {
    node scripts/test_android_webview.mjs $port initial
    Read-Host "Tap the lamp in the image, then press Enter here"
    node scripts/test_android_webview.mjs $port active
    Read-Host "Tap Reset image, then press Enter here"
    node scripts/test_android_webview.mjs $port initial
} finally {
    adb -s $serial forward --remove "tcp:$port"
}
```

Each check must exit successfully. These modes read the canvas and accessibility state without dispatching a click. Record whether the touch came from a physical device or was injected by the Android test environment.

Email and messenger transport still require separate app-level measurements.

[Android document picker](https://developer.android.com/training/data-storage/shared/documents-files?hl=en) · [Android incoming shares](https://developer.android.com/develop/ui/compose/sharing/receive)
