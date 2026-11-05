"""Send and recover IIMG attachments through a loopback SMTP server."""

import argparse
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
import hashlib
import os
from pathlib import Path
from queue import Queue
import smtplib
import socketserver
import subprocess
import tempfile
from threading import Thread


ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "tests/fixtures/v1.0/raster-toggle.iimg"
TRACE = ROOT / "tests/fixtures/v0.2/two-controls-pointer.json"
MAX_MESSAGE = 64 * 1024


class MailSink(socketserver.StreamRequestHandler):
    """Receive one local smoke-test message with no relay or external delivery."""

    def handle(self):
        self.connection.settimeout(10)
        self.wfile.write(b"220 localhost IIMG test sink\r\n")
        while line := self.rfile.readline(1024):
            command = line.partition(b" ")[0].strip().upper()
            if command in (b"EHLO", b"HELO", b"MAIL", b"RCPT"):
                self.wfile.write(b"250 OK\r\n")
            elif command == b"DATA":
                self.wfile.write(b"354 Send message\r\n")
                message = bytearray()
                while data := self.rfile.readline(MAX_MESSAGE + 1):
                    if data == b".\r\n":
                        self.server.received.put(bytes(message))
                        self.wfile.write(b"250 Received\r\n")
                        break
                    if data.startswith(b".."):
                        data = data[1:]
                    message.extend(data)
                    if len(message) > MAX_MESSAGE:
                        self.wfile.write(b"552 Message too large\r\n")
                        return
                else:
                    return
            elif command == b"QUIT":
                self.wfile.write(b"221 Closing\r\n")
                return
            else:
                self.wfile.write(b"502 Unsupported command\r\n")


def round_trip(payload, subtype, name):
    message = EmailMessage(policy=policy.SMTP)
    message["From"] = "sender@example.invalid"
    message["To"] = "receiver@example.invalid"
    message["Subject"] = "IIMG attachment test"
    message.set_content("Local fixture transfer.")
    message.add_attachment(payload, maintype="application", subtype=subtype, filename=name)
    with socketserver.TCPServer(("127.0.0.1", 0), MailSink) as sink:
        sink.received = Queue(maxsize=1)
        thread = Thread(target=sink.serve_forever)
        thread.start()
        try:
            with smtplib.SMTP(*sink.server_address, local_hostname="localhost", timeout=10) as sender:
                sender.send_message(message)
            received = sink.received.get(timeout=10)
        finally:
            sink.shutdown()
            thread.join()
    attachments = list(BytesParser(policy=policy.default).parsebytes(received).iter_attachments())
    if len(attachments) != 1:
        raise AssertionError("expected exactly one attachment")
    attachment, = attachments
    if attachment.get_filename() != name or attachment.get_content_type() != f"application/{subtype}":
        raise AssertionError("attachment filename or MIME type changed")
    if attachment["Content-Transfer-Encoding"] != "base64":
        raise AssertionError("attachment did not use base64 transfer encoding")
    return attachment.get_payload(decode=True)


def run(cli):
    original = FIXTURE.read_bytes()
    digest = hashlib.sha256(original).hexdigest()
    with tempfile.TemporaryDirectory(prefix="iimg-mail-") as temporary:
        scratch = Path(temporary)

        def invoke(*args):
            subprocess.run([str(cli), *map(str, args)], check=True, capture_output=True, timeout=15)

        original_frame = scratch / "original.ppm"
        invoke("replay", FIXTURE, TRACE, original_frame)
        for subtype, name in (("octet-stream", "raster-toggle.iimg"), ("x-iimg", "مصباح.iimg")):
            received = round_trip(original, subtype, name)
            if received != original:
                raise AssertionError(f"application/{subtype}: attachment bytes changed")
            recovered = scratch / name
            frame = recovered.with_suffix(".ppm")
            recovered.write_bytes(received)
            invoke("validate", recovered)
            invoke("replay", recovered, TRACE, frame)
            if frame.read_bytes() != original_frame.read_bytes():
                raise AssertionError(f"application/{subtype}: interaction output changed")
            print(f"application/{subtype}: filename, SHA-256 {digest} and replay frame preserved")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    executable = "iimg-cli.exe" if os.name == "nt" else "iimg-cli"
    parser.add_argument("--cli", type=Path, default=ROOT / "target" / "debug" / executable)
    run(parser.parse_args().cli.resolve())
