# Viewer accessibility and manual acceptance

The current format exposes ordered, named toggle controls and pressed states. The viewer provides equivalent native HTML buttons for image hotspots. This permits operation without precisely tapping the artwork.

## Implemented and checked

- Controls and reset have minimum 48×48 CSS-pixel targets and visible keyboard focus. Android's native open/test-info controls have a 48 dp minimum height. This follows [Android's target-size guidance](https://developer.android.com/guide/topics/ui/accessibility/views/apps-views).
- Controls use real buttons, `aria-pressed`, literal text labels and automatic text direction. Long labels wrap within a narrow viewport. Canvas content has an image role and, when interactive, a description of keyboard alternatives.
- Tab follows published control order. Enter/Space activate the focused button. Pressed styling changes weight and border as well as color; the semantic pressed state is the nonvisual signal.
- The web status is a live status region; reading sets `aria-busy`. Native provider failures use a polite Android accessibility live region. Failed/cancelled loads remove previous controls and rendered content.
- There is no automatic animation in this Core profile. No document can start unrequested motion or audio.
- Chromium checks cover keyboard activation, pressed states, narrow-screen label wrapping, minimum button size, stale-response rejection and recovery. They supplement the native/JVM tests.

## Physical-device checklist

On the selected phone, open each showcase and use every named button, then reset. Confirm buttons are readable, reachable by scrolling and remain usable at a larger system font/display size. Verify the portrait scene is usable without horizontal scrolling.

For testers familiar with TalkBack, check that each control's name and pressed/unpressed state are announced, focus order is useful, reading/error status is announced, and reset restores unpressed state. Record Android, WebView, TalkBack versions and relevant speech-language settings. Do not enable an unfamiliar accessibility navigation mode without knowing how to turn it off.

TalkBack speech, switch access, high zoom and all language/voice combinations have not been certified by automated tests. Labels can contain different languages; automatic text direction does not identify spoken language. The Core candidate does not yet standardize per-label language or a full alternative description of the scene. These remain specification/review questions. No WCAG or platform accessibility certification is claimed.
