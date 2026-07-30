/**
 * Minimal in-process async mutex, keyed by resource name.
 *
 * The app runs as a single Node process (Next standalone in one container),
 * so serializing read-modify-write cycles here is sufficient to stop the
 * lost-update races on the shared JSON stores (projects.json, the
 * conversations index). If we ever scale to multiple processes, the stores
 * move to SQLite and this file goes away.
 */

const queues = new Map<string, Promise<unknown>>();

export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  // Chain regardless of the previous task's outcome.
  const run = prev.then(fn, fn);
  // Keep the chain alive but swallow errors for the *next* waiter's chain;
  // the caller of THIS run still gets the real rejection from `run`.
  queues.set(
    key,
    run.catch(() => {})
  );
  return run;
}
