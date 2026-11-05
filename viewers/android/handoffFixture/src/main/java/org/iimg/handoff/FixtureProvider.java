package org.iimg.handoff;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.net.Uri;
import java.io.FileNotFoundException;
import java.io.IOException;

public final class FixtureProvider extends ContentProvider {
    static final Uri DOCUMENT = Uri.parse("content://org.iimg.handoff.fixture/two-controls.iimg");
    static final String MIME = "application/octet-stream";

    @Override public boolean onCreate() { return true; }

    @Override public String getType(Uri uri) {
        return DOCUMENT.equals(uri) ? MIME : null;
    }

    @Override public AssetFileDescriptor openAssetFile(Uri uri, String mode) throws FileNotFoundException {
        if (!DOCUMENT.equals(uri) || !"r".equals(mode)) throw new FileNotFoundException();
        try {
            return getContext().getAssets().openFd("two-controls.iimg");
        } catch (IOException error) {
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
