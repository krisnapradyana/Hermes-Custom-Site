/**
 * Guard rails for filesystem work against the Drive FUSE mount.
 *
 * Node performs fs calls on a small libuv threadpool (4 threads by default,
 * raised via UV_THREADPOOL_SIZE in the Dockerfile). A slow or dead mount can
 * pin those threads and starve EVERY request in the process — so Drive-facing
 * routes must (a) cap their own concurrency and (b) give up after a timeout
 * instead of hanging a request forever.
 */

/** Run fn over items with at most `limit` in flight at once. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

export const DRIVE_TIMEOUT_MS = 15_000;

/**
 * Resolve with the promise, or reject with "drive-timeout" after ms. The
 * underlying fs work keeps running (it can't be cancelled) but the HTTP
 * request is freed to answer 503 instead of hanging the client.
 */
export function withDriveTimeout<T>(p: Promise<T>, ms = DRIVE_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      const t = setTimeout(() => reject(new Error("drive-timeout")), ms);
      // Don't keep the process alive just for this timer.
      if (typeof t === "object" && "unref" in t) t.unref();
    }),
  ]);
}

export const isDriveTimeout = (err: unknown): boolean =>
  err instanceof Error && err.message === "drive-timeout";
