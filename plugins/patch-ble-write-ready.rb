# Patches MultiplatformBleAdapter 0.2.0 (react-native-ble-plx 3.5.1) after every `pod install`.
#
# RxBluetoothKit only writes without response once `canSendWriteWithoutResponse` is true, and
# otherwise waits for `peripheralIsReady(toSendWriteWithoutResponse:)`. On a physical iPhone with
# Pocket firmware 1.8 the flag read false after the first command and iOS never sent the ready
# callback, so every later command hung. Pocket's command characteristic is write-without-response
# only, and commands are tiny one-off packets with reply timeouts in JS, so write immediately
# (as Web Bluetooth does). The canSend value is still logged at RxBluetoothKit's verbose level.
module OpenPocket
  BLE_WRITE_FILE = 'MultiplatformBleAdapter/iOS/RxBluetoothKit/Peripheral.swift'
  BLE_WRITE_MARKER = 'OpenPocket write-ready fix'
  BLE_WRITE_ORIGINAL = <<~SWIFT.gsub(/^/, '            ')
    observable = self.peripheral
        .rx_isReadyToSendWriteWithoutResponse
        .startWith(peripheral.canSendWriteWithoutResponse)
        .filter { $0 }
        .take(1)
        .map { [weak self] _ in
            self?.peripheral.writeValue(data, for: characteristic.characteristic, type: type)
            return characteristic
        }
  SWIFT
  BLE_WRITE_PATCHED = <<~SWIFT.gsub(/^/, '            ')
    // #{BLE_WRITE_MARKER}: write immediately instead of waiting on a ready flag iOS may never report.
    RxBluetoothKitLog.d("OpenPocket canSendWriteWithoutResponse=\\(peripheral.canSendWriteWithoutResponse)")
    observable = Observable<Characteristic>.deferred { [weak self] in
        self?.peripheral.writeValue(data, for: characteristic.characteristic, type: type)
        return .just(characteristic)
    }
  SWIFT

  def self.patch_ble_write_ready(installer)
    path = File.join(installer.sandbox.root.to_s, BLE_WRITE_FILE)
    source = File.read(path)
    return if source.include?(BLE_WRITE_MARKER)
    unless source.include?(BLE_WRITE_ORIGINAL)
      raise "OpenPocket: #{BLE_WRITE_FILE} changed; review plugins/patch-ble-write-ready.rb"
    end
    File.chmod(0o644, path)
    File.write(path, source.sub(BLE_WRITE_ORIGINAL, BLE_WRITE_PATCHED))
    Pod::UI.puts 'OpenPocket: patched BLE write-without-response readiness.'
  end
end
