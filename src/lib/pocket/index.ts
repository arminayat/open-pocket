import { PocketConnection, connectionError } from './connection';
import { bluetoothTransfer } from './bluetooth-transfer';
import { wifiTransfer } from './wifi-transfer';
import { delay } from './inbox';
import { cancelledError, disconnectedError, PocketError, validateDeviceKey, validateDirectories, validateListing } from './protocol';
import type { DiagnosticLogger, PocketClient, Recording } from './types';

export function createPocketClient(log: DiagnosticLogger): PocketClient {
  const connection = new PocketConnection(log);
  let busy = false;
  let authenticated = false;
  let activeTransfer: AbortController | null = null;
  let activeWork: Promise<unknown> | null = null;
  connection.onDisconnect(() => { authenticated = false; activeTransfer?.abort(); });
  const exclusive = async <T,>(operation: () => Promise<T>): Promise<T> => {
    if (busy) throw new PocketError('busy', 'Wait for the current Pocket operation to finish or cancel it first.');
    busy = true;
    try { return await operation(); } finally { busy = false; }
  };
  const requireConnection = () => { if (!authenticated || !connection.isConnected()) throw disconnectedError(); };
  return {
    scan: callback => connection.scan(callback),
    stopScan: () => connection.stopScan(),
    connect: (device, key) => exclusive(async () => {
      validateDeviceKey(key);
      authenticated = false;
      await connection.connect(device.id);
      const session = connection.session();
      try {
        log('authenticate', 'Checking the account key with the recorder.');
        const result = await connection.request(`SK&${key}`, 'SK', 12000);
        if (result !== 'OK') throw new PocketError('authentication', 'Pocket rejected this key. Use the account that activated this recorder, or provide its existing device key.');
        authenticated = true;
        log('authenticated', 'Pocket acknowledged authentication.');
        const batteryValue = await connection.request('BAT', 'BAT', 5000).catch(() => '');
        const battery = /^\d+$/.test(batteryValue) && Number(batteryValue) <= 100 ? Number(batteryValue) : null;
        const firmware = await connection.request('FW', 'FW', 5000).catch(() => 'unknown');
        const wifiFirmware = await connection.request('WF', 'WF', 5000).catch(() => 'unknown');
        requireConnection();
        // Report firmware only if it resembles a version, never arbitrary responses.
        log('device-info', 'Read recorder information.', { battery, firmware: /^[A-Za-z0-9.-]{1,32}$/.test(firmware) ? firmware : 'unknown', wifiFirmware: /^[A-Za-z0-9.-]{1,32}$/.test(wifiFirmware) ? wifiFirmware : 'unknown' });
        return { battery, firmware, wifiFirmware };
      } catch (error) { await connection.disconnectIfCurrent(session); throw connectionError(error); }
    }),
    listRecordings: () => exclusive(async () => {
      requireConnection();
      log('listing', 'Reading recording directories.');
      const mark = connection.inbox.mark();
      const count = await connection.request('LIST_DIRS', 'DIRS_SUM', 20000);
      const directories = validateDirectories(connection.inbox.after(mark), count);
      const recordings: Recording[] = [];
      for (const date of directories) {
        const listingMark = connection.inbox.mark();
        const fileCount = await connection.request(`LIST&${date}`, 'LIST', 20000);
        recordings.push(...validateListing(connection.inbox.after(listingMark), fileCount, date));
        if (directories.length > 1) await delay(200);
      }
      log('listed', 'Recording counts verified.', { directories: directories.length, recordings: recordings.length });
      return recordings.sort((a, b) => {
        const time = (r: Recording) => r.timestamp.startsWith('PH') ? `20${r.timestamp.slice(2)}` : r.timestamp;
        return b.date.localeCompare(a.date) || time(b).localeCompare(time(a));
      });
    }),
    download: (recording, transport, target, onProgress) => {
      if (busy) {
        target.abort();
        return Promise.reject(new PocketError('busy', 'Wait for the current Pocket operation to finish or cancel it first.'));
      }
      const operation = exclusive(async () => {
        const session = connection.session();
        activeTransfer = new AbortController();
        const signal = activeTransfer.signal;
        log('download', 'Starting direct recorder download.', { transport });
        try {
          requireConnection();
          const bytes = transport === 'bluetooth'
            ? await bluetoothTransfer(connection, recording, target, signal, onProgress)
            : await wifiTransfer(connection, recording, target, signal, onProgress, log);
          if (signal.aborted) throw cancelledError();
          const result = await target.commit(bytes);
          log('saved', 'Recording saved locally.', { transport, bytes });
          return result;
        } catch (error) {
          target.abort();
          // There is no proven safe stop command for a transfer. Wi-Fi cleanup
          // runs first; disconnecting then gives the next attempt a clean state.
          await connection.disconnectIfCurrent(session);
          throw connectionError(error);
        } finally { activeTransfer = null; }
      });
      activeWork = operation;
      void operation.finally(() => { if (activeWork === operation) activeWork = null; }).catch(() => {});
      return operation;
    },
    cancel: async () => {
      activeTransfer?.abort();
      if (activeWork) await activeWork.catch(() => {});
    },
    disconnect: async () => {
      activeTransfer?.abort();
      await connection.disconnect();
      if (activeWork) await activeWork.catch(() => {});
    },
    onDisconnect: callback => connection.onDisconnect(callback),
  };
}

export { PocketError } from './protocol';
export type * from './types';
