# Galaxy S23+ Android 0.1.1 preview follow-up

Date: 2026-11-05. Evidence consists of the repository owner's manual acceptance report and six copied **Test info** reports. The tester reported that all requested cases worked, and noted that the check described as waiting five seconds displayed its result in approximately one second. No ADB logs, frame captures, measured latency series or assistive-technology report accompanied this follow-up.

Outcome: the selected showcase, large-workload and provider-fault/recovery procedure passed as reported on this device. This is distinct from the [earlier APK's device/WhatsApp test](2026-11-05-galaxy-s23-plus.md); it does not establish a new WhatsApp transfer measurement or independent external approval.

## Configuration and build

| Field | Value |
| --- | --- |
| Device | Samsung Galaxy S23+, reported model `samsung SM-S916B` |
| Android | `17 (API 37)`, copied from the app report |
| WebView | `156.0.8078.47`, copied from the app report |
| Viewer | `0.1.1-preview`, copied from the app report |
| Supplied release | [v0.1.1-preview.1](https://github.com/almonder01/iimg/releases/tag/v0.1.1-preview.1) |
| Source head | `893ca5195a5de4d1b81799fe6614e5985e8dcd0e` |
| Tested CI checkout | `6442ad8d7ad1a80cf7a165c81c06929589ce5c6b`, same Git tree as the source head |
| Published viewer APK SHA-256 | `0c3730de2f3a42ed2081c15bdbe1b55b34a77639a870b6750b0cd9dc72168aca` |
| Published test-source APK SHA-256 | `6364440d57efb64a5b1d4cad16e8234a33c69c1d0209b5f747d3b1ef38b714ba` |

The published APKs were checked before distribution. The pasted phone reports identify the viewer version and selected document bytes, but do not measure the installed APK's digest. The APK association relies on the supplied download/install procedure and tester's report. Firmware, One UI and TalkBack versions were not supplied.

## Reported acceptance

The tester's blanket success confirmation applies to the preceding manual procedure; individual button logs and timings were not supplied.

| Requested check | Evidence |
| --- | --- |
| Open the three showcase posters; operate named controls and image hotspots; reset | Reported passed as part of the complete procedure |
| Repeat without internet; confirm readable controls and portrait scrolling | Reported passed as part of the complete procedure |
| Open the 2048×2048 workload, activate the central tile and reset | Reported passed; selected-file size and SHA-256 also match below |
| Open the valid two-control provider fixture | Reported passed; selected-file size and SHA-256 also match below |
| Read failure clears prior content and reports an error | Reported passed as part of the complete procedure |
| Oversized stream reports the 16 MiB limit | Reported passed as part of the complete procedure |
| Slow provider reports its deadline while the UI stays usable | Reported passed; exact deadline duration was not measured in the supplied evidence |
| Delayed static then valid retains the final interactive image | Reported passed; tester observed approximately one second to display the result |
| Reopen the valid image after each fault | Reported passed as part of the complete procedure |

### Why the replacement need not wait five seconds

In `FaultCases.java`, **Delayed static then valid** sends a delayed static source and schedules the valid interactive source after **500 ms**. The static provider in `FixtureProvider.java` normally waits **2500 ms**, and accepts cancellation. The requested **3–5 second observation window** checks that an older result does not subsequently replace the valid image. It is not a minimum display delay. Approximately one second to the valid result is consistent with the intended sequence; the report does not establish a precise scheduling measurement.

**Slow provider** is a separate case: its source waits up to 30 seconds and the viewer applies a 15-second delivery deadline. Do not interpret the replacement case's short display time as a measurement of that timeout.

## Copied phone samples

The reports were supplied in the following order. They did not identify which fault button preceded each sample, so the table does not assign an error type to the empty-document entries.

| Sample | Current document bytes | SHA-256 | Host process PSS (KiB) |
| --- | ---: | --- | ---: |
| 1 | None | Not reported | 179840 |
| 2 | None | Not reported | 233491 |
| 3 | 641 | `1bc5d8a89b712fa4096553f59073be66d30519bb41eea33bd873510faefeda1d` | 201291 |
| 4 | None | Not reported | 198881 |
| 5 | 641 | `1bc5d8a89b712fa4096553f59073be66d30519bb41eea33bd873510faefeda1d` | 248360 |
| 6 | 129604 | `1674f517f120e50c0be50bf6480cff7538dd2db7635f3e748bb9a56cb29a4d11` | 275841 |

The 641-byte digest matches the checked-in `tests/fixtures/v0.2/two-controls.iimg` bundled by the test-source app. The 129604-byte digest matches the published `workload-2048.iimg`. These comparisons verify the reported selected bytes' identity; no phone filesystem copy or on-device pixel dump was supplied. Phone digests for the three promotional posters were not included.

The PSS readings span approximately **175.6–269.4 MiB**. They are individual host-process samples, not renderer-process totals, peak app memory or memory attributable solely to a document. `No current document` records the absence of a selected native pending document; it does not mean process memory has returned to a baseline. These unlabelled snapshots do not establish either a leak or stable memory behavior. A controlled repeated-load/reset/idle measurement with renderer accounting remains open.

## Remaining evidence

- Explicit large-font/zoom and TalkBack name, state, focus and announcement checks remain open; general usability success is not assistive-technology certification.
- Broader physical devices/Android versions and recipients/transport paths remain open.
- Controlled phone latency and process-tree/peak memory measurements remain open.
- Independent external review and the other stable-release gates remain separate from this owner-operated device test.
