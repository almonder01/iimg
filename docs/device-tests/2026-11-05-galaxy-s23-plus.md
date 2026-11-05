# Samsung Galaxy S23+ manual device test

Date: 2026-11-05. Evidence source: the repository owner's reports while following the physical-device test instructions. These results are manually reported, without ADB logs, captured reference frames or on-device checksum measurements.

## Configuration

| Field | Recorded value |
| --- | --- |
| Device | Samsung Galaxy S23+ |
| Android | 17, reported by the tester |
| WhatsApp | 2.26.42.74, reported by the tester |
| Chat route | Self-chat on the same phone, explicitly confirmed by the tester |
| WebView / One UI / firmware build | Not yet recorded |
| Application | [Experimental Android device-test APK](https://github.com/almonder01/iimg/releases/tag/android-device-test-2026-11-05) |
| APK source | GitHub Android workflow at `047d3e60817efb115d8a24beb6c7c17f2d71be91`; identical source tree to merged `82d903460a50434d3c3927600ef5c86eca4d4e9a` |
| Published APK SHA-256 | `ce178c2bd3b3b35ba415438481d1f37e8e49e4df356746667be4ac153c1230e0` |
| Fixture | `tests/fixtures/v1.0/raster-toggle.iimg`, 657 bytes |
| Published fixture SHA-256 | `1b0a3e62cc31cc792c459f03f8ffd3fdfa38ceb49858b6eaddef7988c86f3834` |

The published downloads were retrieved without authentication and matched these digests before the links were provided. The digests describe the published files; the tester has not measured the downloaded phone copies. No system-service changes were requested for this device test.

## Reported observations

| Check | Result |
| --- | --- |
| Install the APK and open the candidate through **Open IIMG document** | Passed, tester reported the initial procedure worked |
| Tap the yellow circle to change its color and tap again to restore it | Passed as part of the reported initial procedure |
| Enable airplane mode, disable Wi-Fi, close and reopen the application, then reopen the same file | Passed, tester confirmed the offline procedure worked |
| Activate the circle while offline | Passed as part of the reported offline procedure |
| Select **Reset image** to restore the yellow initial state | Passed as part of the reported offline procedure |
| Tap the IIMG attachment in WhatsApp, select IIMG Viewer and open the image | Passed, tester explicitly reported the app appeared and the image opened in it |
| Activate the image after opening it from WhatsApp | Passed, tester subsequently confirmed interaction worked |

The WhatsApp check used self-chat on the same phone. It establishes attachment handoff, image opening and interaction in IIMG Viewer on this phone. Reset was reported successful in the earlier offline procedure and was not separately reported for this handoff. Delivery to a separate recipient and received-file digests have not yet been recorded. Self-chat opening can use a local copy, so it does not independently verify a network transfer or interactive rendering inside WhatsApp itself.

## Remaining evidence

- Record the WebView version and versions of any additional source apps tested.
- Record actual messenger/email delivery to a separate client or recipient and received-file byte integrity; self-chat attachment handoff, image opening and interaction from WhatsApp 2.26.42.74 have been reported successful.
- Test physical-device file-manager VIEW/SEND routing, unsupported-capability fallback, corrupt-file rejection and recovery.
- Run accessibility checks and broader device/OS coverage. These initial observations do not establish complete Android acceptance or stable-release readiness.
