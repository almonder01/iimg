package org.iimg.viewer;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Executor;
import java.util.concurrent.FutureTask;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicBoolean;

/** Latest-selection reader with process-wide bounded workers and a UI deadline. */
public final class DocumentReader implements AutoCloseable {
    public enum Failure { READ, TOO_LARGE, TIMEOUT, BUSY }
    public interface Source {
        InputStream open() throws IOException;
        default void cancel() throws IOException {}
    }
    public interface Listener {
        void loaded(byte[] bytes);
        void failed(Failure failure);
    }

    private static ThreadFactory threads(String prefix) {
        AtomicInteger sequence = new AtomicInteger();
        return task -> {
            Thread thread = new Thread(task, prefix + sequence.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        };
    }
    private static final ThreadPoolExecutor WORKERS = new ThreadPoolExecutor(
            2, 2, 0, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(1), threads("iimg-read-"));
    // Provider cancellation/close must never block the UI or deadline thread.
    private static final ThreadPoolExecutor CLEANUP = new ThreadPoolExecutor(
            1, 1, 0, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(2), threads("iimg-close-"),
            new ThreadPoolExecutor.DiscardOldestPolicy());
    private static final ScheduledThreadPoolExecutor DEADLINES = new ScheduledThreadPoolExecutor(
            1, threads("iimg-deadline-"));
    static { DEADLINES.setRemoveOnCancelPolicy(true); }

    private final int limit;
    private final long timeoutMillis;
    private Executor delivery;
    private final Object lock = new Object();
    private Job current;
    private boolean closed;

    private static final class Job {
        final Source source;
        Listener listener;
        FutureTask<Void> task;
        ScheduledFuture<?> deadline;
        boolean finished;
        volatile boolean started;
        volatile boolean ioFinished;
        final AtomicBoolean cleanupQueued = new AtomicBoolean();
        Job(Source source, Listener listener) { this.source = source; this.listener = listener; }
    }

    /** Call load/cancel on the same owner thread used by the delivery executor. */
    public DocumentReader(int limit, long timeoutMillis, Executor delivery) {
        if (limit < 1 || limit == Integer.MAX_VALUE || timeoutMillis < 1) {
            throw new IllegalArgumentException("Invalid reader limits");
        }
        this.limit = limit;
        this.timeoutMillis = timeoutMillis;
        this.delivery = delivery;
    }

    public void load(Source source, Listener listener) {
        synchronized (lock) {
            if (closed) throw new IllegalStateException("Reader is closed");
            cancelLocked();
            Job job = new Job(source, listener);
            current = job;
            job.task = new FutureTask<>(() -> { read(job); return null; });
            job.deadline = DEADLINES.schedule(() -> finish(job, null, Failure.TIMEOUT),
                    timeoutMillis, TimeUnit.MILLISECONDS);
            try {
                WORKERS.execute(job.task);
            } catch (java.util.concurrent.RejectedExecutionException busy) {
                finish(job, null, Failure.BUSY);
            }
        }
    }

    private void read(Job job) {
        synchronized (lock) {
            if (closed || current != job || job.finished) return;
            job.started = true;
        }
        try (InputStream input = job.source.open()) {
            if (input == null) throw new IOException("Missing document stream");
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            while (!Thread.currentThread().isInterrupted()) {
                int count = input.read(buffer, 0, Math.min(buffer.length, limit - output.size() + 1));
                if (count == -1) { finish(job, output.toByteArray(), null); return; }
                if (count == 0) throw new IOException("Provider made no progress");
                if (count > limit - output.size()) { finish(job, null, Failure.TOO_LARGE); return; }
                output.write(buffer, 0, count);
            }
        } catch (IOException | RuntimeException error) {
            finish(job, null, Failure.READ);
        } finally {
            job.ioFinished = true;
        }
    }

    private void finish(Job job, byte[] bytes, Failure failure) {
        Executor owner;
        synchronized (lock) {
            if (closed || current != job || job.finished) return;
            job.finished = true;
            job.deadline.cancel(false);
            if (failure != null) {
                job.task.cancel(true);
                WORKERS.remove(job.task);
                cleanup(job);
            }
            owner = delivery;
        }
        owner.execute(() -> {
            Listener listener;
            synchronized (lock) {
                if (closed || current != job) return;
                listener = job.listener;
                job.listener = null;
            }
            if (listener != null) {
                if (failure == null) listener.loaded(bytes);
                else listener.failed(failure);
            }
        });
    }

    private static void cleanup(Job job) {
        if (!job.started || job.ioFinished || !job.cleanupQueued.compareAndSet(false, true)) return;
        CLEANUP.execute(() -> {
            if (job.ioFinished) return;
            try { job.source.cancel(); } catch (IOException | RuntimeException ignored) { }
        });
    }

    private void cancelLocked() {
        if (current == null) return;
        Job previous = current;
        current = null;
        previous.listener = null;
        previous.finished = true;
        previous.deadline.cancel(false);
        previous.task.cancel(true);
        WORKERS.remove(previous.task);
        cleanup(previous);
    }

    public void cancel() { synchronized (lock) { cancelLocked(); } }
    @Override public void close() {
        synchronized (lock) { closed = true; cancelLocked(); delivery = null; }
    }
}
