package org.iimg.handoff;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.os.Bundle;
import android.widget.TextView;
import java.io.InputStream;
import java.security.MessageDigest;

public final class SendFixture extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        String action = getIntent().getStringExtra("fixture_action");
        if (!"VIEW".equals(action) && !"SEND".equals(action)) {
            fail("Expected VIEW or SEND fixture action.");
            return;
        }
        try (InputStream input = getContentResolver().openInputStream(FixtureProvider.DOCUMENT)) {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[4096];
            for (int count; (count = input.read(buffer)) != -1;) digest.update(buffer, 0, count);
            StringBuilder hex = new StringBuilder();
            for (byte value : digest.digest()) {
                hex.append(Character.forDigit((value >>> 4) & 15, 16));
                hex.append(Character.forDigit(value & 15, 16));
            }
            if (!hex.toString().equals(getIntent().getStringExtra("expected_sha256"))) {
                fail("The provider fixture SHA-256 did not match.");
                return;
            }
            Intent delivery = new Intent("VIEW".equals(action) ? Intent.ACTION_VIEW : Intent.ACTION_SEND)
                    .setPackage("org.iimg.viewer")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            delivery.setClipData(ClipData.newRawUri("IIMG fixture", FixtureProvider.DOCUMENT));
            if ("VIEW".equals(action)) {
                delivery.setDataAndType(FixtureProvider.DOCUMENT, FixtureProvider.MIME);
            } else {
                delivery.setType(FixtureProvider.MIME);
                delivery.putExtra(Intent.EXTRA_STREAM, FixtureProvider.DOCUMENT);
            }
            startActivity(delivery);
            finish();
        } catch (Exception error) {
            fail("Fixture delivery failed: " + error.getClass().getSimpleName());
        }
    }

    private void fail(String message) {
        TextView view = new TextView(this);
        view.setText(message);
        setContentView(view);
    }
}
