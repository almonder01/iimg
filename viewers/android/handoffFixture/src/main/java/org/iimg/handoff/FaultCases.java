package org.iimg.handoff;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Manual provider-boundary test sources; installed separately from the viewer. */
public final class FaultCases extends Activity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int padding = (int) (16 * getResources().getDisplayMetrics().density);
        layout.setPadding(padding, padding, padding, padding);
        TextView instructions = new TextView(this);
        instructions.setText("IIMG development test sources\nUse Back to return here. After every failure, open the valid image to check recovery.");
        layout.addView(instructions);
        add(layout, "Open valid image", () -> send("two-controls.iimg"));
        add(layout, "Read failure", () -> send("denied.iimg"));
        add(layout, "Oversized stream (16 MiB + 1)", () -> send("oversized.iimg"));
        add(layout, "Slow provider (expect 15s timeout)", () -> send("timeout.iimg"));
        add(layout, "Delayed static then valid", () -> {
            send("delayed.iimg");
            handler.postDelayed(() -> send("two-controls.iimg"), 500);
        });
        setContentView(layout);
    }
    private void add(LinearLayout layout, String label, Runnable action) {
        Button button = new Button(this);
        button.setText(label);
        button.setMinHeight((int) (48 * getResources().getDisplayMetrics().density));
        button.setOnClickListener(view -> action.run());
        layout.addView(button);
    }
    private void send(String name) {
        Uri uri = Uri.parse("content://org.iimg.handoff.fixture/" + name);
        Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, FixtureProvider.MIME)
                .setPackage("org.iimg.viewer").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        intent.setClipData(ClipData.newRawUri("IIMG test source", uri));
        try { startActivity(intent); }
        catch (android.content.ActivityNotFoundException missing) {
            new android.app.AlertDialog.Builder(this).setMessage("Install IIMG Viewer first.")
                    .setPositiveButton("OK", null).show();
        }
    }
    @Override public void onDestroy() { handler.removeCallbacksAndMessages(null); super.onDestroy(); }
}
