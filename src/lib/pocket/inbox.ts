import { cancelledError, PocketError, type Response } from './protocol';

interface Entry extends Response { sequence: number }
interface Waiter {
  since: number;
  accept: (response: Response) => boolean;
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
  clean: () => void;
}

/** Marks are monotonic, so old asynchronous replies cannot satisfy new commands. */
export class ResponseInbox {
  private sequence = 0;
  private entries: Entry[] = [];
  private waiters = new Set<Waiter>();
  private failure: Error | null = null;
  mark(): number { return this.sequence; }
  after(since: number): Response[] { return this.entries.filter(e => e.sequence > since); }
  push(response: Response): void {
    if (this.failure) return;
    this.entries.push({ ...response, sequence: ++this.sequence });
    this.entries = this.entries.slice(-4096);
    for (const waiter of [...this.waiters]) {
      if (this.sequence > waiter.since && waiter.accept(response)) {
        waiter.clean();
        waiter.resolve(response);
      }
    }
  }
  fail(error: Error): void {
    this.failure = error;
    for (const waiter of [...this.waiters]) { waiter.clean(); waiter.reject(error); }
  }
  wait(name: string, since: number, timeout = 10000, signal?: AbortSignal, acceptValue: (value: string) => boolean = () => true): Promise<Response> {
    const accept = (response: Response) => response.name === name && acceptValue(response.value);
    if (signal?.aborted) return Promise.reject(cancelledError());
    if (this.failure) return Promise.reject(this.failure);
    const previous = this.entries.find(e => e.sequence > since && accept(e));
    if (previous) return Promise.resolve(previous);
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { since, accept, resolve, reject, clean: () => {} };
      const abort = () => { waiter.clean(); reject(cancelledError()); };
      const timer = setTimeout(() => {
        waiter.clean();
        reject(new PocketError('timeout', `Pocket did not answer ${name}. Wake it, close the official app, and reconnect.`));
      }, timeout);
      waiter.clean = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); this.waiters.delete(waiter); };
      signal?.addEventListener('abort', abort, { once: true });
      this.waiters.add(waiter);
    });
  }
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(cancelledError());
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(cancelledError()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** Rejects if a native call never settles, e.g. a CoreBluetooth write waiting on a ready signal. */
export function deadline<T>(promise: Promise<T>, ms: number, error: () => Error): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(error()), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, cause => { clearTimeout(timer); reject(cause); });
  });
}

export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(cancelledError());
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(cancelledError()); };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
