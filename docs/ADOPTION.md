# Adoption and media-type registration

| Item | Status | Evidence needed |
| --- | --- | --- |
| Native attachment transfer | Local SMTP/MIME transfer verified for generic and experimental attachment types | Third-party app and platform versions, send mode, received SHA-256 and result |
| Android open-with and sharing | Emulator checks passed; Galaxy S23+ / Android 17 tester reported picker, touch, reset, offline reopening and WhatsApp self-chat attachment handoff/opening/interaction passed | File-manager VIEW/SEND, fallback/recovery, WebView version and received-file digests |
| In-app interactive support | Awaiting third-party integration | Public implementation or repeatable tested behavior |
| PNG carriage experiment | Research | Preservation and decode results through editing and transfer pipelines |
| Media-type registration | Preparation pending Core stability | Published specification, selected registration tree and submitted request |

Keep attachment delivery, intact bytes, operating-system handoff and in-app rendering as distinct results. Update this table with evidence as integrations are tested. Experimental MIME labels used by the Android viewer are local routing hints.

The [Galaxy S23+ device record](device-tests/2026-11-05-galaxy-s23-plus.md) captures the manual report, published build and fixture digests, and remaining checks. The phone's received-file digests and WebView version have not been measured.

## Transfer evidence

| Path | Delivery and byte integrity | OS handoff | In-app IIMG rendering |
| --- | --- | --- | --- |
| Loopback SMTP, Python 3.10 on Windows | Base64 attachments under `application/octet-stream` and `application/x-iimg` preserved filenames, including Arabic text, and SHA-256 | Outside this test | Recovered file validated and replayed in the IIMG CLI |
| Android API 34 fixture provider | Sender verified fixture SHA-256 before granting access | VIEW and SEND resolved to the IIMG activity | Android WebView showed and activated the controls |
| WhatsApp 2.26.42.74 self-chat, Galaxy S23+ / Android 17 | Same-phone self-chat; separate-client/recipient delivery and received SHA-256 not recorded | Tester reported IIMG Viewer appeared and opened the image | Tester confirmed interaction in IIMG Viewer. WhatsApp-native rendering not established |
| Third-party mail and messaging | Pending | Pending | Pending |

For a real transport check, record the sender and recipient app versions, device/OS and attachment mode. Keep the original and downloaded files. Compare their SHA-256 values, then run the viewer or CLI on the downloaded file. Record whether the recipient app itself displays the file, offers open-with, or requires saving it first. Use a dedicated test account or a consenting recipient for actual sends.

[IANA media-type registration form](https://www.iana.org/form/media-types) · [RFC 6838](https://www.rfc-editor.org/info/rfc6838/)
