import { disconnectedError } from './protocol';

/** Invalidates in-flight native work without letting a late result revive it. */
export class ConnectionGeneration {
  private generation = 0;
  capture(): number { return this.generation; }
  invalidate(): number { return ++this.generation; }
  current(generation: number): boolean { return this.generation === generation; }
  assertCurrent(generation: number): void {
    if (!this.current(generation)) throw disconnectedError();
  }
  async adopt<T>(generation: number, operation: Promise<T>, release: (resource: T) => Promise<unknown>): Promise<T> {
    const resource = await operation;
    if (!this.current(generation)) {
      try { await release(resource); } catch { /* Release failures must not revive stale work. */ }
      throw disconnectedError();
    }
    return resource;
  }
}
