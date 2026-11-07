# Viewer accessibility and manual acceptance

The current format exposes ordered, named toggle controls and pressed states. The viewer provides equivalent native HTML buttons for image hotspots. This permits operation without precisely tapping the artwork.

## Implemented and checked

- Controls and reset have minimum 48×48 CSS-pixel targets and visible keyboard focus. Android's native open/test-info controls have a 48 dp minimum height. This follows [Android's target-size guidance](https://developer.android.com/guide/topics/ui/accessibility/views/apps-views).
- Controls use real buttons, `aria-pressed`, literal text labels and automatic text direction. Long labels wrap within a narrow viewport. Canvas content has an image role and, when interactive, a description of keyboard alternatives.
- Tab follows published control order. Enter/Space activate the focused button. Pressed styling changes weight and border as well as color; the semantic pressed state is the nonvisual signal.
- The web status is a live status region; reading sets `aria-busy`. Native provider failures use a polite Android accessibility live region. Failed/cancelled loads remove previous controls and rendered content.
- Draft motion has bounded lifetimes, a pause/resume control, background suspension and a reduced-motion endpoint equivalent. No audio is supported.
- Draft sliders expose real named range inputs with minimum/maximum/step/current values and keyboard arrows/Home/End. Pointer cancellation restores the previous value. Hidden controls/ranges are excluded from interaction and accessibility presentation.
- Draft aTXT provides a bounded literal image description and document language, reset on unload. Raster text is authored into PNG pixels and needs a meaningful image description; source text hints do not replace accessible content.
- Chromium checks cover keyboard activation, pressed states, narrow-screen label wrapping, minimum button size, stale-response rejection and recovery. They supplement the native/JVM tests.

## Physical-device checklist

On the selected phone, open each showcase and use every named button, then reset. Confirm buttons are readable, reachable by scrolling and remain usable at a larger system font/display size. Verify the portrait scene is usable without horizontal scrolling.

For testers familiar with TalkBack, check that each control's name and pressed/unpressed state are announced, focus order is useful, reading/error status is announced, and reset restores unpressed state. Record Android, WebView, TalkBack versions and relevant speech-language settings. Do not enable an unfamiliar accessibility navigation mode without knowing how to turn it off.

TalkBack speech, switch access and all language/voice combinations have not been certified by automated tests. Chromium checks cover 390-pixel layouts with 200% root font size, which is distinct from real system font scaling or all browser zoom settings. The optional draft scene language does not identify per-control mixed-language speech. These remain manual/review questions. No WCAG or platform accessibility certification is claimed.
