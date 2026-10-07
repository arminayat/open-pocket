import { abortable, delay } from './inbox';
import { cancelledError, PocketError, positiveSize, TransferCounter } from './protocol';
import type { PocketConnection } from './connection';
import type { DownloadProgress, DownloadTarget, Recording } from './types';

export async function bluetoothTransfer(
  connection: PocketConnection, recording: Recording, target: DownloadTarget,
  signal: AbortSignal, progress: (update: DownloadProgress) => void,
): Promise<number> {
  const counter = new TransferCounter();
  let failure: Error | null = null;
  let lastDataAt = Date.now();
  let lastProgressAt = 0;
  const offController = new AbortController();
  const abortOff = () => offController.abort();
  signal.addEventListener('abort', abortOff, { once: true });
  const report = () => progress({ recordingId: recording.id, transport: 'bluetooth', stage: 'Downloading over Bluetooth', receivedBytes: counter.bytes, expectedBytes: counter.expected ?? 0 });
  let stopAudio: (() => void) | null = null;
  try {
    stopAudio = await connection.audio(bytes => {
      if (signal.aborted || failure) return;
      try {
        counter.add(bytes.length);
        target.write(bytes);
        lastDataAt = Date.now();
        if (Date.now() - lastProgressAt > 150) { lastProgressAt = Date.now(); report(); }
      } catch (error) { failure = error instanceof PocketError ? error : new PocketError('storage', 'Recording could not be saved. Check available iPhone storage and retry.'); }
    }, error => { failure = error; });
    if (signal.aborted) throw cancelledError();
    const mark = connection.inbox.mark();
    const size = await connection.request(`U&${recording.date}&${recording.timestamp}`, 'U', 10000, signal, value => positiveSize(value) !== null);
    counter.expect(positiveSize(size)!);
    report();
    let ended = false;
    let endFailure: Error | null = null;
    const end = connection.inbox.wait('OFF', mark, 60 * 60 * 1000, offController.signal)
      .then(() => { ended = true; }, error => { endFailure = error; });
    let endedAt = 0;
    while (!ended || counter.bytes !== counter.expected) {
      if (failure) throw failure;
      if (endFailure) throw endFailure;
      if (signal.aborted) throw cancelledError();
      if (Date.now() - lastDataAt > 30000) throw new PocketError('transfer-stalled', 'Pocket stopped sending audio. Reconnect and restart the download.');
      if (ended) {
        endedAt ||= Date.now();
        if (Date.now() - endedAt > 1000) throw new PocketError('transfer-incomplete', 'Pocket ended the recording before all bytes arrived. Reconnect and retry.');
      }
      await delay(50, signal);
    }
    await abortable(end, signal);
    if (failure) throw failure;
    const bytes = counter.finish();
    report();
    return bytes;
  } finally { stopAudio?.(); offController.abort(); signal.removeEventListener('abort', abortOff); }
}
