package org.iimg.viewer;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/** Executable contract tests without Android, test frameworks or extra dependencies. */
public final class DocumentReaderTest {
    static final class Result implements DocumentReader.Listener {
        final CountDownLatch done = new CountDownLatch(1);
        byte[] bytes;
        DocumentReader.Failure error;
        final AtomicInteger calls = new AtomicInteger();
        public void loaded(byte[] value) { bytes = value; calls.incrementAndGet(); done.countDown(); }
        public void failed(DocumentReader.Failure value) { error = value; calls.incrementAndGet(); done.countDown(); }
        void await() throws Exception { check(done.await(3, TimeUnit.SECONDS), "No timely completion"); }
    }
    static final class OwnerQueue implements Executor {
        final LinkedBlockingQueue<Runnable> queue = new LinkedBlockingQueue<>();
        public void execute(Runnable task) { queue.add(task); }
        void next() throws Exception {
            Runnable task = queue.poll(3, TimeUnit.SECONDS);
            check(task != null, "No queued owner callback"); task.run();
        }
    }
    static final class HeldSource implements DocumentReader.Source {
        final CountDownLatch opened = new CountDownLatch(1);
        final CountDownLatch release = new CountDownLatch(1);
        final CountDownLatch exited = new CountDownLatch(1);
        public InputStream open() {
            opened.countDown();
            try {
                while (true) {
                    try { release.await(); break; }
                    catch (InterruptedException ignored) { }
                }
                return new ByteArrayInputStream(new byte[]{9});
            } finally { exited.countDown(); }
        }
        void awaitOpen() throws Exception { check(opened.await(3, TimeUnit.SECONDS), "Source did not open"); }
        void free() throws Exception { release.countDown(); check(exited.await(3, TimeUnit.SECONDS), "Source did not leave"); }
    }
    static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
    static Result once(DocumentReader.Source source) throws Exception {
        try (DocumentReader reader = new DocumentReader(4, 500, Runnable::run)) {
            Result result = new Result(); reader.load(source, result); result.await();
            check(result.calls.get() == 1, "Duplicate callback"); return result;
        }
    }
    public static void main(String[] ignored) throws Exception {
        check(Arrays.equals(once(() -> new ByteArrayInputStream(new byte[]{1,2,3,4})).bytes,
                new byte[]{1,2,3,4}), "Exact bound rejected");
        check(once(() -> new ByteArrayInputStream(new byte[0])).bytes.length == 0, "Empty stream rejected by host");
        check(once(() -> new ByteArrayInputStream(new byte[5])).error == DocumentReader.Failure.TOO_LARGE,
                "Oversized input accepted");
        check(once(() -> { throw new IOException("Permission denied"); }).error == DocumentReader.Failure.READ,
                "Read failure not reported");
        check(once(() -> new InputStream() {
            public int read() { return 0; }
            public int read(byte[] b, int o, int n) { return 0; }
        }).error == DocumentReader.Failure.READ, "Zero-progress provider spun indefinitely");

        OwnerQueue owner = new OwnerQueue();
        try (DocumentReader reader = new DocumentReader(4, 500, owner)) {
            Result old = new Result(); reader.load(() -> new ByteArrayInputStream(new byte[]{1}), old);
            check(owner.queue.peek() != null || waitForQueue(owner), "No first delivery");
            Result latest = new Result(); reader.load(() -> new ByteArrayInputStream(new byte[]{2}), latest);
            owner.next(); owner.next(); latest.await();
            check(old.calls.get() == 0 && latest.bytes[0] == 2, "Stale queued result escaped");
        }
        DocumentReader closing = new DocumentReader(4, 500, owner);
        try {
            Result closed = new Result(); closing.load(() -> new ByteArrayInputStream(new byte[]{1}), closed);
            check(waitForQueue(owner), "No close test delivery"); closing.close(); owner.next();
            check(closed.calls.get() == 0, "Destroyed owner received a callback");
        } finally { closing.close(); }

        HeldSource held = new HeldSource();
        try (DocumentReader reader = new DocumentReader(4, 100, Runnable::run)) {
            Result timed = new Result(); reader.load(held, timed); held.awaitOpen(); timed.await();
            check(timed.error == DocumentReader.Failure.TIMEOUT, "Deadline did not expire");
            Result recovered = new Result(); reader.load(() -> new ByteArrayInputStream(new byte[]{3}), recovered);
            recovered.await(); check(recovered.bytes[0] == 3, "One stalled provider blocked a new read");
        } finally { held.free(); }

        List<DocumentReader> readers = new ArrayList<>();
        HeldSource first = new HeldSource(), second = new HeldSource();
        try {
            for (int i = 0; i < 4; i++) readers.add(new DocumentReader(4, 2000, Runnable::run));
            readers.get(0).load(first, new Result()); first.awaitOpen();
            readers.get(1).load(second, new Result()); second.awaitOpen();
            readers.get(2).load(() -> new ByteArrayInputStream(new byte[]{4}), new Result());
            Result busy = new Result(); readers.get(3).load(() -> new ByteArrayInputStream(new byte[]{5}), busy);
            busy.await(); check(busy.error == DocumentReader.Failure.BUSY, "Unbounded queued reader work");
        } finally {
            for (DocumentReader reader : readers) reader.close();
            first.free(); second.free();
        }
        System.out.println("DocumentReader: 10 bound, failure, deadline, stale-result, lifecycle and backpressure cases passed.");
    }
    static boolean waitForQueue(OwnerQueue owner) throws Exception {
        Runnable task = owner.queue.poll(3, TimeUnit.SECONDS);
        if (task == null) return false;
        owner.queue.add(task); return true;
    }
}
