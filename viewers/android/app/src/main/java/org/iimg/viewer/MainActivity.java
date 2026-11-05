package org.iimg.viewer;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final String HOST = "viewer.iimg.invalid";
    private static final String HOME = "https://" + HOST + "/index.html";
    private static final int MAX_BYTES = 16 * 1024 * 1024;
    private static final int PICK_DOCUMENT = 1;

    private final ExecutorService reads = Executors.newSingleThreadExecutor();
    private WebView viewer;
    private TextView message;
    private boolean pageReady;
    private int generation;
    private volatile Pending pending;

    private static final class Pending {
        final int generation;
        final byte[] bytes;

        Pending(int generation, byte[] bytes) {
            this.generation = generation;
            this.bytes = bytes;
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        Button open = new Button(this);
        open.setText("Open IIMG document");
        open.setOnClickListener(button -> pickDocument());
        message = new TextView(this);
        viewer = new WebView(this);
        viewer.getSettings().setJavaScriptEnabled(true);
        viewer.getSettings().setAllowFileAccess(false);
        viewer.getSettings().setAllowContentAccess(false);
        viewer.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return true;
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (!"GET".equals(request.getMethod()) || !"https".equals(url.getScheme())
                        || !HOST.equals(url.getEncodedAuthority()) || url.getQuery() != null) {
                    return unavailable();
                }
                String path = url.getEncodedPath();
                if ("/index.html".equals(path)) return asset("index.html", "text/html", "UTF-8");
                if ("/viewer.mjs".equals(path)) return asset("viewer.mjs", "text/javascript", "UTF-8");
                if ("/iimg_web.wasm".equals(path)) return asset("iimg_web.wasm", "application/wasm", null);
                Pending document = pending;
                if (document != null && ("/incoming/" + document.generation).equals(path)) {
                    return new WebResourceResponse("application/octet-stream", null, 200, "OK",
                            Collections.singletonMap("Cache-Control", "no-store"),
                            new ByteArrayInputStream(document.bytes));
                }
                return unavailable();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (HOME.equals(url)) {
                    pageReady = true;
                    showPending();
                }
            }
        });
        layout.addView(open);
        layout.addView(message);
        layout.addView(viewer, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(layout);
        viewer.loadUrl(HOME);
        acceptIntent(getIntent());
    }

    private WebResourceResponse asset(String file, String mime, String encoding) {
        try {
            return new WebResourceResponse(mime, encoding, getAssets().open(file));
        } catch (IOException error) {
            return unavailable();
        }
    }

    private static WebResourceResponse unavailable() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        acceptIntent(intent);
    }

    @SuppressWarnings("deprecation")
    private void acceptIntent(Intent intent) {
        if (Intent.ACTION_VIEW.equals(intent.getAction())) {
            openDocument(intent.getData());
        } else if (Intent.ACTION_SEND.equals(intent.getAction())) {
            Uri uri;
            if (Build.VERSION.SDK_INT >= 33) {
                uri = intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
            } else {
                android.os.Parcelable value = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                uri = value instanceof Uri ? (Uri) value : null;
            }
            openDocument(uri);
        }
    }

    @SuppressWarnings("deprecation")
    private void pickDocument() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType("*/*");
        startActivityForResult(intent, PICK_DOCUMENT);
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_DOCUMENT && resultCode == RESULT_OK && data != null) {
            openDocument(data.getData());
        }
    }

    private void openDocument(Uri uri) {
        if (uri == null || !"content".equals(uri.getScheme())) {
            message.setText("Choose or share a document from an Android file provider.");
            return;
        }
        int request = ++generation;
        pending = null;
        message.setText("Reading document…");
        reads.execute(() -> {
            try {
                byte[] bytes = readBounded(uri);
                runOnUiThread(() -> {
                    if (request != generation || isDestroyed()) return;
                    pending = new Pending(request, bytes);
                    message.setText("");
                    showPending();
                });
            } catch (IOException | RuntimeException error) {
                runOnUiThread(() -> {
                    if (request == generation && !isDestroyed()) {
                        message.setText("Could not read the document. The file limit is 16 MiB.");
                    }
                });
            }
        });
    }

    private byte[] readBounded(Uri uri) throws IOException {
        try (InputStream input = getContentResolver().openInputStream(uri)) {
            if (input == null) throw new IOException("Missing document stream");
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer, 0, Math.min(buffer.length, MAX_BYTES - output.size() + 1))) != -1) {
                if (output.size() + count > MAX_BYTES) throw new IOException("Document exceeds the limit");
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        }
    }

    private void showPending() {
        Pending document = pending;
        if (pageReady && document != null) {
            viewer.evaluateJavascript("window.iimgOpenShared(" + document.generation + ")", null);
        }
    }

    @Override
    protected void onDestroy() {
        generation++;
        pending = null;
        reads.shutdownNow();
        ((LinearLayout) viewer.getParent()).removeView(viewer);
        viewer.destroy();
        super.onDestroy();
    }
}
