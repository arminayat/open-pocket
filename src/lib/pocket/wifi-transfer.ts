import PocketWifi from '../../../modules/pocket-wifi';
import { abortable, delay } from './inbox';
import { cancelledError, PocketError, positiveSize } from './protocol';
import type { PocketConnection } from './connection';
import type { DiagnosticLogger, DownloadProgress, DownloadTarget, Recording } from './types';

export async function wifiTransfer(
  connection: PocketConnection, recording: Recording, target: DownloadTarget,
  signal: AbortSignal, progress: (update: DownloadProgress) => void, log: DiagnosticLogger,
): Promise<number> {
  let ssid = '';
  let raised = false;
  let receivedBytes = 0;
  let expectedBytes = 0;
  let audioFailure: Error | null = null;
  let stopAudio: (() => void) | null = null;
  const report = (stage: string) => progress({ recordingId: recording.id, transport: 'wifi', stage, receivedBytes, expectedBytes });
  let nativeProgress: { remove(): void } | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  try {
    stopAudio = await connection.audio(() => {}, error => { audioFailure = error; });
    const mark = connection.inbox.mark();
    report('Starting Pocket Wi-Fi');
    raised = true;
    await connection.request('WIFIO', 'WIFIO', 15000, signal);
    heartbeat = setInterval(() => { void connection.send('WPING').catch(() => {}); }, 5000);
    const credentials = await connection.request('WIFI', 'WIFI', 10000, signal, value => value.split('&').length === 2);
    const parts = credentials.split('&');
    [ssid] = parts;
    if (!ssid || ssid.length > 32 || !parts[1] || parts[1].length < 8 || parts[1].length > 63) throw new PocketError('wifi-credentials', 'Pocket returned invalid hotspot credentials. Reconnect and retry.');
    report('Joining Pocket Wi-Fi');
    log('wifi-join', 'Joining the recorder hotspot.');
    poll = setInterval(() => { void connection.send('WIFIS').catch(() => {}); }, 2000);
    await abortable(PocketWifi.join(ssid, parts[1]), signal);
    await connection.inbox.wait('WIFIS', mark, 60000, signal, value => value.trim() === '1');
    clearInterval(poll); poll = null;
    if (audioFailure) throw audioFailure;
    report('Opening recording connection');
    await abortable(PocketWifi.openTransfer(target.uri), signal);
    nativeProgress = PocketWifi.addListener('transferProgress', update => {
      try {
        if (signal.aborted || !Number.isSafeInteger(update.bytesWritten) || update.bytesWritten < 0) return;
        receivedBytes = update.bytesWritten;
        report('Downloading over Wi-Fi');
      } catch { /* UI notification failures cannot escape the native listener. */ }
    });
    const transferMark = connection.inbox.mark();
    const size = await connection.request(`U&${recording.date}&${recording.timestamp}`, 'U', 10000, signal, value => positiveSize(value) !== null);
    expectedBytes = positiveSize(size)!;
    const nativeResult = PocketWifi.completeTransfer(expectedBytes);
    // Attach a handler immediately: the native operation can fail before BLE
    // acknowledges the switch. Its rejection is still awaited below.
    void nativeResult.catch(() => {});
    await delay(300, signal);
    if (signal.aborted) throw cancelledError();
    const switchMark = await connection.send('U&WIFI');
    await connection.inbox.wait('U', switchMark, 10000, signal, value => value === 'WIFI');
    report('Downloading over Wi-Fi');
    const result = await abortable(nativeResult, signal);
    if (audioFailure) throw audioFailure;
    if (result.bytesWritten !== expectedBytes) throw new PocketError('wifi-size', 'The Wi-Fi recording size did not match Pocket. Reconnect and retry.');
    // Require the BLE completion event too, even if the TCP marker was valid.
    await connection.inbox.wait('OFF', transferMark, 15000, signal);
    receivedBytes = result.bytesWritten;
    report('Verifying recording');
    log('wifi-complete', 'Wi-Fi bytes and completion marker verified.', { bytes: result.bytesWritten });
    return result.bytesWritten;
  } catch (error) {
    if (error instanceof PocketError) throw error;
    throw new PocketError('wifi', 'Wi-Fi transfer failed. Allow Local Network access, reconnect Pocket, and retry. You can also download over Bluetooth.');
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (poll) clearInterval(poll);
    nativeProgress?.remove();
    // Close the socket before stopping the AP, and remove partial native files.
    await PocketWifi.cancel().catch(() => {});
    if (raised && connection.isConnected()) {
      try { await connection.request('WIFIC', 'WIFIC', 5000); } catch { log('wifi-cleanup', 'Pocket did not acknowledge hotspot shutdown.'); }
    }
    stopAudio?.();
    if (ssid) await PocketWifi.leave(ssid).catch(() => { log('wifi-cleanup', 'Could not remove the temporary hotspot configuration.'); });
  }
}
