package org.iimg.viewer;

import android.app.Activity;
import android.content.Intent;
import android.content.ContentResolver;
import android.content.res.AssetFileDescriptor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.view.View;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Collections;

public final class MainActivity extends Activity {
    private static final String HOST = "viewer.iimg.invalid";
    private static final String HOME = "https://" + HOST + "/index.html";
    private static final int MAX_BYTES = 16 * 1024 * 1024;
    private static final int PICK_DOCUMENT = 1;

    private DocumentReader reads;
    private WebView viewer;
    private TextView message;
    private boolean pageReady;
    private int generation;
    private volatile Pending pending;
    private boolean reading;

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
        open.setMinHeight((int) (48 * getResources().getDisplayMetrics().density));
        open.setOnClickListener(button -> pickDocument());
        message = new TextView(this);
        message.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        reads = new DocumentReader(MAX_BYTES, 15_000, this::runOnUiThread);
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
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setOrientation(LinearLayout.HORIZONTAL);
        toolbar.addView(open, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            Button info = new Button(this);
            info.setText("Test info");
            info.setMinHeight((int) (48 * getResources().getDisplayMetrics().density));
            info.setOnClickListener(button -> showTestInfo());
            toolbar.addView(info);
        }
        layout.addView(toolbar);
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
        int request = ++generation;
        reads.cancel();
        pending = null;
        reading = false;
        if (uri == null || !"content".equals(uri.getScheme())) {
            message.setText("Choose or share a document from an Android file provider.");
            showPending();
            return;
        }
        reading = true;
        message.setText("Reading document…");
        showPending();
        ContentResolver resolver = getApplicationContext().getContentResolver();
        reads.load(new ContentSource(resolver, uri), new DocumentReader.Listener() {
            @Override public void loaded(byte[] bytes) {
                if (request != generation || isDestroyed()) return;
                reading = false;
                pending = new Pending(request, bytes);
                message.setText("");
                showPending();
            }
            @Override public void failed(DocumentReader.Failure failure) {
                if (request != generation || isDestroyed()) return;
                reading = false;
                pending = null;
                String error;
                switch (failure) {
                    case TOO_LARGE: error = "This document exceeds 16 MiB."; break;
                    case TIMEOUT: error = "The file provider did not respond within 15 seconds."; break;
                    case BUSY: error = "Document readers are busy. Wait for the file provider and try again."; break;
                    default: error = "Could not read this document.";
                }
                message.setText(error);
                showPending();
            }
        });
    }

    private static final class ContentSource implements DocumentReader.Source {
        final ContentResolver resolver;
        final Uri uri;
        final CancellationSignal signal = new CancellationSignal();
        AssetFileDescriptor descriptor;
        boolean cancelled;
        ContentSource(ContentResolver resolver, Uri uri) { this.resolver = resolver; this.uri = uri; }
        @Override public InputStream open() throws IOException {
            AssetFileDescriptor opened = resolver.openAssetFileDescriptor(uri, "r", signal);
            if (opened == null) throw new IOException("Missing document stream");
            synchronized (this) {
                if (cancelled) { opened.close(); throw new IOException("Cancelled document"); }
                descriptor = opened;
                try { return opened.createInputStream(); }
                catch (IOException | RuntimeException error) { descriptor = null; opened.close(); throw error; }
            }
        }
        @Override public void cancel() throws IOException {
            AssetFileDescriptor opened;
            synchronized (this) { cancelled = true; opened = descriptor; descriptor = null; }
            try { signal.cancel(); } finally { if (opened != null) opened.close(); }
        }
    }

    private void showPending() {
        Pending document = pending;
        if (pageReady && generation > 0) {
            if (document != null) {
                viewer.evaluateJavascript("window.iimgOpenShared(" + document.generation + ")", null);
            } else {
                viewer.evaluateJavascript("window.iimgClearShared(" + generation + "," + reading + ")", null);
            }
        }
    }

    @SuppressWarnings("deprecation")
    private void showTestInfo() {
        String webVersion = "not reported";
        if (Build.VERSION.SDK_INT >= 26) {
            android.content.pm.PackageInfo web = WebView.getCurrentWebViewPackage();
            if (web != null) webVersion = web.versionName;
        }
        String appVersion = "not reported";
        try { appVersion = getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
        catch (android.content.pm.PackageManager.NameNotFoundException ignored) { }
        Pending document = pending;
        String file = "No current document";
        if (document != null) {
            try {
                byte[] digest = MessageDigest.getInstance("SHA-256").digest(document.bytes);
                StringBuilder hex = new StringBuilder();
                for (byte value : digest) {
                    hex.append(Character.forDigit((value >>> 4) & 15, 16));
                    hex.append(Character.forDigit(value & 15, 16));
                }
                file = "Document bytes: " + document.bytes.length + "\nSHA-256: " + hex;
            } catch (java.security.NoSuchAlgorithmException ignored) { file = "SHA-256 unavailable"; }
        }
        String report = "IIMG Android test report\nApp: " + appVersion
                + "\nDevice: " + Build.MANUFACTURER + " " + Build.MODEL
                + "\nAndroid: " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")"
                + "\nWebView: " + webVersion + "\n" + file
                + "\nHost process PSS: " + android.os.Debug.getPss() + " KiB"
                + "\nPSS is one host-process sample, not total/peak renderer or app memory.";
        new android.app.AlertDialog.Builder(this).setTitle("Test info").setMessage(report)
                .setPositiveButton("Copy", (dialog, which) -> {
                    android.content.ClipboardManager clipboard = (android.content.ClipboardManager)
                            getSystemService(CLIPBOARD_SERVICE);
                    clipboard.setPrimaryClip(android.content.ClipData.newPlainText("IIMG test report", report));
                }).setNegativeButton("Close", null).show();
    }

    @Override
    protected void onDestroy() {
        generation++;
        pending = null;
        reads.close();
        ((LinearLayout) viewer.getParent()).removeView(viewer);
        viewer.destroy();
        super.onDestroy();
    }
}
