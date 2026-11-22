import { BleManager, State, type Characteristic, type Device, type Subscription } from 'react-native-ble-plx';
import { fromByteArray, toByteArray } from 'base64-js';
import { deadline, ResponseInbox } from './inbox';
import { ConnectionGeneration } from './lifecycle';
import { disconnectedError, LEGACY, PocketError, PRIMARY, ResponseDecoder } from './protocol';
import type { DiagnosticLogger, PocketDevice } from './types';

export function connectionError(error: unknown): PocketError {
  if (error instanceof PocketError) return error;
  const code = typeof error === 'object' && error !== null && 'errorCode' in error ? Number(error.errorCode) : null;
  if (code === 101 || code === 601) return new PocketError('permission', 'Allow Bluetooth access for Open Pocket in iPhone Settings.');
  if (code === 102) return new PocketError('unsupported', 'Bluetooth is unavailable. Use an iPhone development build.');
  if (code === 104) return new PocketError('bluetooth-off', 'Turn on Bluetooth in iPhone Settings and retry.');
  return new PocketError('bluetooth', 'Bluetooth operation failed. Wake Pocket, close the official app, and reconnect.');
}

export class PocketConnection {
  readonly manager = new BleManager();
  inbox = new ResponseInbox();
  private device: Device | null = null;
  private channel: typeof PRIMARY = PRIMARY;
  private withoutResponse = true;
  private commandSubscription: Subscription | null = null;
  private disconnectSubscription: Subscription | null = null;
  private audioSubscription: Subscription | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private writeTail: Promise<unknown> = Promise.resolve();
  private finishScan: (() => void) | null = null;
  private disconnectListeners = new Set<() => void>();
  private connected = false;
  private lifecycle = new ConnectionGeneration();
  private scanLifecycle = new ConnectionGeneration();
  constructor(private log: DiagnosticLogger) {}

  private async poweredOn(): Promise<void> {
    const initial = await this.manager.state();
    this.checkState(initial);
    if (initial === State.PoweredOn) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { subscription.remove(); reject(new PocketError('bluetooth', 'Bluetooth is still starting. Retry in a moment.')); }, 12000);
      const finish = (state: State) => {
        try {
          this.checkState(state);
          if (state !== State.PoweredOn) return;
          clearTimeout(timer); subscription.remove(); resolve();
        } catch (error) { clearTimeout(timer); subscription.remove(); reject(error); }
      };
      const subscription = this.manager.onStateChange(finish, false);
      void this.manager.state().then(finish, error => { clearTimeout(timer); subscription.remove(); reject(connectionError(error)); });
    });
  }
  private checkState(state: State): void {
    if (state === State.Unauthorized) throw new PocketError('permission', 'Allow Bluetooth access for Open Pocket in iPhone Settings.');
    if (state === State.PoweredOff) throw new PocketError('bluetooth-off', 'Turn on Bluetooth in iPhone Settings and retry.');
    if (state === State.Unsupported) throw new PocketError('unsupported', 'Bluetooth is unavailable. Use a physical iPhone development build.');
  }

  async scan(onDevice: (device: PocketDevice) => void): Promise<void> {
    this.stopScan();
    const scanGeneration = this.scanLifecycle.capture();
    await this.poweredOn();
    if (!this.scanLifecycle.current(scanGeneration)) return;
    this.log('scan', 'Looking for nearby Pocket recorders.');
    const seen = new Set<string>();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => this.stopScan(), 12000);
      this.finishScan = () => { clearTimeout(timer); resolve(); };
      this.manager.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
        if (!this.scanLifecycle.current(scanGeneration)) return;
        if (error) { this.manager.stopDeviceScan(); this.finishScan = null; clearTimeout(timer); reject(connectionError(error)); return; }
        if (!device || seen.has(device.id)) return;
        const name = device.localName ?? device.name ?? '';
        const services = device.serviceUUIDs ?? [];
        const knownService = services.some(uuid => /^(0000)?(5536|2222)(-|$)/i.test(uuid));
        if (!name.startsWith('PKT01') && !knownService) return;
        seen.add(device.id);
        try { onDevice({ id: device.id, name: name || 'Pocket recorder', rssi: device.rssi }); }
        catch { this.manager.stopDeviceScan(); this.finishScan = null; clearTimeout(timer); reject(new PocketError('scan', 'The recorder list could not be updated. Retry scanning.')); }
      });
    });
  }
  stopScan(): void {
    this.scanLifecycle.invalidate();
    this.manager.stopDeviceScan();
    const finish = this.finishScan;
    this.finishScan = null;
    finish?.();
  }

  async connect(id: string): Promise<void> {
    const generation = this.lifecycle.invalidate();
    this.stopScan();
    try {
      this.log('connect', 'Releasing any previous Bluetooth connection.');
      await this.releaseConnection();
      this.lifecycle.assertCurrent(generation);
      this.log('connect', 'Waiting for Bluetooth to be ready.');
      await this.poweredOn();
      this.lifecycle.assertCurrent(generation);
      const inbox = new ResponseInbox();
      this.inbox = inbox;
      this.log('connect', 'Opening a Bluetooth connection.');
      let device = await this.lifecycle.adopt(generation, this.manager.connectToDevice(id, { timeout: 20000 }), late => late.cancelConnection());
      this.device = device;
      this.connected = true;
      this.disconnectSubscription = device.onDisconnected(() => { if (this.lifecycle.current(generation)) this.lost(); });
      this.log('connect', 'Bluetooth link open. Discovering Pocket services.');
      device = await device.discoverAllServicesAndCharacteristics();
      this.lifecycle.assertCurrent(generation);
      this.device = device;
      await this.selectChannels(device, generation);
      this.lifecycle.assertCurrent(generation);
      const decoder = new ResponseDecoder();
      this.commandSubscription = device.monitorCharacteristicForService(this.channel.service, this.channel.notify, (error, characteristic) => {
        if (!this.lifecycle.current(generation)) return;
        if (error) { inbox.fail(connectionError(error)); return; }
        if (!characteristic?.value) return;
        try {
          const text = String.fromCharCode(...toByteArray(characteristic.value));
          decoder.feed(text).forEach(response => inbox.push(response));
          if (this.flushTimer) clearTimeout(this.flushTimer);
          this.flushTimer = setTimeout(() => {
            if (!this.lifecycle.current(generation)) return;
            try { decoder.flush().forEach(response => inbox.push(response)); }
            catch { inbox.fail(new PocketError('protocol', 'Pocket returned an invalid control response. Reconnect.')); }
          }, 50);
        } catch { inbox.fail(new PocketError('protocol', 'Pocket returned an invalid control response. Reconnect.')); }
      });
      // Allow the native notification subscription to reach CoreBluetooth
      // before the very first authentication write.
      await new Promise(resolve => setTimeout(resolve, 150));
      this.lifecycle.assertCurrent(generation);
    } catch (error) {
      if (this.lifecycle.current(generation)) await this.disconnect();
      throw connectionError(error);
    }
  }
  private async selectChannels(device: Device, generation: number): Promise<void> {
    this.lifecycle.assertCurrent(generation);
    const services = await device.services();
    this.lifecycle.assertCurrent(generation);
    for (const candidate of [PRIMARY, LEGACY]) {
      if (!services.some(s => s.uuid.toLowerCase() === candidate.service) || !services.some(s => s.uuid.toLowerCase() === candidate.audioService)) continue;
      const controls = await device.characteristicsForService(candidate.service);
      this.lifecycle.assertCurrent(generation);
      const audio = candidate.service === candidate.audioService ? controls : await device.characteristicsForService(candidate.audioService);
      this.lifecycle.assertCurrent(generation);
      const writer = controls.find(c => c.uuid.toLowerCase() === candidate.write && (c.isWritableWithoutResponse || c.isWritableWithResponse));
      const reader = controls.find(c => c.uuid.toLowerCase() === candidate.notify && (c.isNotifiable || c.isIndicatable));
      const audioReader = audio.find(c => c.uuid.toLowerCase() === candidate.audio && (c.isNotifiable || c.isIndicatable));
      if (writer && reader && audioReader) {
        this.channel = candidate;
        // Acknowledged writes don't depend on CoreBluetooth's write-without-response ready
        // signal, which can stay false and leave unacknowledged writes pending forever.
        this.withoutResponse = writer.isWritableWithoutResponse && !writer.isWritableWithResponse;
        this.log('services', 'Found supported Pocket control and audio services.', { legacy: candidate === LEGACY, withResponse: !this.withoutResponse });
        return;
      }
    }
    throw new PocketError('services', 'This recorder does not expose the supported Pocket services. Check its model and firmware.');
  }
  async send(command: string): Promise<number> {
    const generation = this.lifecycle.capture();
    const operation = async () => {
      this.lifecycle.assertCurrent(generation);
      if (!this.connected || !this.device) throw disconnectedError();
      const mark = this.inbox.mark();
      const value = fromByteArray(Uint8Array.from(`APP&${command}`, c => c.charCodeAt(0)));
      const write = this.withoutResponse
        ? this.device.writeCharacteristicWithoutResponseForService(this.channel.service, this.channel.write, value)
        : this.device.writeCharacteristicWithResponseForService(this.channel.service, this.channel.write, value);
      await deadline(write, 5000, () => new PocketError('stalled', 'Pocket stopped accepting commands. Wake it, close the official app, and reconnect.'));
      this.lifecycle.assertCurrent(generation);
      return mark;
    };
    const next = this.writeTail.then(operation, operation);
    this.writeTail = next.catch(() => {});
    return next.catch(error => { throw connectionError(error); });
  }
  async request(command: string, answer: string, timeout = 10000, signal?: AbortSignal, accept?: (value: string) => boolean): Promise<string> {
    if (signal?.aborted) throw new PocketError('cancelled', 'Transfer cancelled.');
    const inbox = this.inbox;
    const mark = await this.send(command);
    return (await inbox.wait(answer, mark, timeout, signal, accept)).value;
  }
  async audio(onBytes: (bytes: Uint8Array) => void, onError: (error: Error) => void): Promise<() => void> {
    const generation = this.lifecycle.capture();
    if (!this.connected || !this.device) throw disconnectedError();
    this.audioSubscription?.remove();
    const subscription = this.device.monitorCharacteristicForService(this.channel.audioService, this.channel.audio, (error, characteristic: Characteristic | null) => {
      if (!this.lifecycle.current(generation)) return;
      try {
        if (error) { onError(connectionError(error)); return; }
        if (characteristic?.value) onBytes(toByteArray(characteristic.value));
      } catch { onError(new PocketError('transfer', 'Audio could not be saved. Check available iPhone storage and retry.')); }
    });
    this.audioSubscription = subscription;
    await new Promise(resolve => setTimeout(resolve, 150));
    if (!this.lifecycle.current(generation)) { subscription.remove(); throw disconnectedError(); }
    return () => { subscription.remove(); if (this.audioSubscription === subscription) this.audioSubscription = null; };
  }
  onDisconnect(callback: () => void): () => void { this.disconnectListeners.add(callback); return () => { this.disconnectListeners.delete(callback); }; }
  isConnected(): boolean { return this.connected && this.device !== null; }
  private lost(): void {
    if (!this.connected) return;
    this.connected = false;
    this.inbox.fail(disconnectedError());
    this.log('disconnected', 'Pocket disconnected.');
    for (const listener of this.disconnectListeners) { try { listener(); } catch { /* UI listeners must not escape native callbacks. */ } }
  }
  async disconnect(): Promise<void> {
    this.lifecycle.invalidate();
    await this.releaseConnection();
  }
  session(): number { return this.lifecycle.capture(); }
  async disconnectIfCurrent(generation: number): Promise<void> {
    if (this.lifecycle.current(generation)) await this.disconnect();
  }
  private async releaseConnection(): Promise<void> {
    this.stopScan();
    this.lost();
    this.commandSubscription?.remove(); this.commandSubscription = null;
    this.audioSubscription?.remove(); this.audioSubscription = null;
    this.disconnectSubscription?.remove(); this.disconnectSubscription = null;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    const device = this.device;
    this.device = null;
    if (device) { try { await device.cancelConnection(); } catch { /* Already disconnected. */ } }
  }
}
