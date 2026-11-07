package org.iimg.handoff;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.net.Uri;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.OutputStream;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

public final class FixtureProvider extends ContentProvider {
    static final String MIME = "application/octet-stream";
    static Uri uri(Context context, String name) {
        return new Uri.Builder().scheme("content").authority(context.getPackageName() + ".fixture")
                .appendPath(name).build();
    }
    static Uri document(Context context, String name) {
        if (name == null) name = "two-controls.iimg";
        if ("two-controls.iimg".equals(name) || "motion.iimg".equals(name) || "drag.iimg".equals(name)) {
            return uri(context, name);
        }
        return null;
    }
    private static final ThreadPoolExecutor WRITERS = new ThreadPoolExecutor(
            2, 2, 0, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(2), runnable -> {
                Thread thread = new Thread(runnable, "iimg-fixture-writer");
                thread.setDaemon(true); return thread;
            });

    @Override public boolean onCreate() { return true; }

    @Override public String getType(Uri uri) {
        return known(uri) ? MIME : null;
    }

    @Override public AssetFileDescriptor openAssetFile(Uri uri, String mode) throws FileNotFoundException {
        return openAssetFile(uri, mode, null);
    }

    private boolean known(Uri uri) {
        if (!(getContext().getPackageName() + ".fixture").equals(uri.getAuthority()) || uri.getQuery() != null) return false;
        String path = uri.getPath();
        return "/two-controls.iimg".equals(path) || "/motion.iimg".equals(path)
                || "/drag.iimg".equals(path) || "/denied.iimg".equals(path)
                || "/oversized.iimg".equals(path) || "/delayed.iimg".equals(path)
                || "/timeout.iimg".equals(path);
    }

    @Override public AssetFileDescriptor openAssetFile(Uri uri, String mode, CancellationSignal signal)
            throws FileNotFoundException {
        if (!known(uri) || !"r".equals(mode)) throw new FileNotFoundException();
        String path = uri.getPath();
        if ("/denied.iimg".equals(path)) throw new FileNotFoundException("Intentional fixture failure");
        try {
            if ("/delayed.iimg".equals(path) || "/timeout.iimg".equals(path)) {
                CountDownLatch wait = new CountDownLatch(1);
                if (signal != null) signal.setOnCancelListener(wait::countDown);
                try { wait.await("/timeout.iimg".equals(path) ? 30_000 : 2500, TimeUnit.MILLISECONDS); }
                finally { if (signal != null) signal.setOnCancelListener(null); }
                if (signal != null) signal.throwIfCanceled();
                return getContext().getAssets().openFd("lamp.iimg");
            }
            if ("/oversized.iimg".equals(path)) {
                ParcelFileDescriptor[] pipe = ParcelFileDescriptor.createPipe();
                try {
                    WRITERS.execute(() -> {
                        try (OutputStream output = new ParcelFileDescriptor.AutoCloseOutputStream(pipe[1])) {
                            byte[] zeros = new byte[8192];
                            int remaining = 16 * 1024 * 1024 + 1;
                            while (remaining > 0) {
                                int count = Math.min(remaining, zeros.length);
                                output.write(zeros, 0, count); remaining -= count;
                            }
                        } catch (IOException ignored) { }
                    });
                } catch (java.util.concurrent.RejectedExecutionException busy) {
                    pipe[0].close(); pipe[1].close(); throw new IOException("Fixture writers busy", busy);
                }
                return new AssetFileDescriptor(pipe[0], 0, AssetFileDescriptor.UNKNOWN_LENGTH);
            }
            return getContext().getAssets().openFd(path.substring(1));
        } catch (IOException | InterruptedException error) {
            if (error instanceof InterruptedException) Thread.currentThread().interrupt();
            FileNotFoundException missing = new FileNotFoundException("Missing bundled IIMG fixture");
            missing.initCause(error);
            throw missing;
        }
    }

    @Override public Cursor query(Uri uri, String[] projection, String selection,
            String[] args, String sortOrder) { throw new UnsupportedOperationException(); }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) {
        throw new UnsupportedOperationException();
    }
    @Override public int delete(Uri uri, String selection, String[] args) {
        throw new UnsupportedOperationException();
    }
}
