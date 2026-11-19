import CoreBluetooth
import Foundation

enum SwitchMode: String { case normal, call, unknown }

enum Finish {
    case grey, blue, pink
    init(deviceName: String?) {
        let n = (deviceName ?? "").uppercased()
        self = n.contains("_BLUE") ? .blue : n.contains("_PINK") ? .pink : .grey
    }
}

/// Bluetooth link to the Pocket. Uses only the documented command (001120a3) and
/// audio (001120a1) characteristics; never subscribes to the vendor's other services.
final class PocketBLE: NSObject, ObservableObject {
    enum Status: Equatable {
        case bluetoothOff, unauthorized, noKey, searching, connecting, connected, keyRejected

        var label: String {
            switch self {
            case .bluetoothOff: return "Bluetooth is off"
            case .unauthorized: return "Bluetooth not allowed"
            case .noKey: return "No key yet"
            case .searching: return "Looking for your Pocket"
            case .connecting: return "Connecting"
            case .connected: return "Connected"
            case .keyRejected: return "Pocket rejected the key"
            }
        }
    }

    @Published private(set) var status: Status = .searching
    @Published private(set) var name: String?
    @Published private(set) var battery: Int?
    @Published private(set) var firmware: String?
    @Published private(set) var mode: SwitchMode = .unknown

    /// Every `MCU&…` message, plus "DISCONNECTED" when the link drops.
    var onEvent: ((String) -> Void)?
    /// Raw MP3 bytes from the live stream.
    var onAudio: ((Data) -> Void)?

    static let cmdUUID = CBUUID(string: "001120A3-2233-4455-6677-889912345678")
    static let audioUUID = CBUUID(string: "001120A1-2233-4455-6677-889912345678")
    private static let savedPeripheral = "pocketPeripheral"

    private var central: CBCentralManager?
    private var peripheral: CBPeripheral?
    private var cmdChar: CBCharacteristic?
    private var audioChar: CBCharacteristic?
    private var key: String?
    private var retry: DispatchWorkItem?
    private var batteryTimer: Timer?

    func start(key: String?) {
        if central == nil { central = CBCentralManager(delegate: self, queue: .main) }
        self.key = key
        guard key != nil else { status = .noKey; return }
        if central?.state == .poweredOn { connectOrScan() }
    }

    func reconnect(with newKey: String?) {
        drop()
        start(key: newKey)
    }

    func send(_ command: String) {
        guard let p = peripheral, let c = cmdChar else { return }
        p.writeValue(Data("APP&\(command)".utf8), for: c, type: .withoutResponse)
    }

    func stopRecording() { send("STO") }

    /// Sample state for `--snapshot` renders.
    func applyPreview(name: String, battery: Int, firmware: String, mode: SwitchMode) {
        self.name = name; self.battery = battery; self.firmware = firmware; self.mode = mode
        status = .connected
    }

    // MARK: - Connection

    private func connectOrScan() {
        retry?.cancel()
        guard let key, !key.isEmpty else { status = .noKey; return }
        if let p = peripheral, p.state == .connected || p.state == .connecting { return }
        status = .searching
        guard let central else { return }
        if let s = UserDefaults.standard.string(forKey: Self.savedPeripheral),
           let id = UUID(uuidString: s),
           let known = central.retrievePeripherals(withIdentifiers: [id]).first {
            connect(known)   // completes whenever the Pocket comes into range
        }
        central.scanForPeripherals(withServices: nil, options: nil)
    }

    private func connect(_ p: CBPeripheral) {
        peripheral = p
        p.delegate = self
        status = .connecting
        central?.connect(p, options: nil)
    }

    private func drop() {
        retry?.cancel()
        batteryTimer?.invalidate()
        central?.stopScan()
        if let p = peripheral { central?.cancelPeripheralConnection(p) }
        peripheral = nil
        cmdChar = nil
        audioChar = nil
    }

    private func scheduleRetry(after seconds: Double) {
        retry?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.connectOrScan() }
        retry = work
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
    }

    // MARK: - Messages

    private func handle(_ text: String) {
        if text.hasPrefix("MCU&SK&") {
            if text.hasSuffix("OK") {
                status = .connected
                log.info("logged in to \(self.name ?? "Pocket", privacy: .public)")
                if let p = peripheral, let a = audioChar { p.setNotifyValue(true, for: a) }
                for (i, cmd) in ["REC&SECEN", "BAT", "FW"].enumerated() {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3 * Double(i + 1)) { [weak self] in self?.send(cmd) }
                }
                batteryTimer?.invalidate()
                batteryTimer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in self?.send("BAT") }
            } else {
                status = .keyRejected
                log.error("Pocket rejected the key")
                if let p = peripheral { central?.cancelPeripheralConnection(p) }
            }
        } else if text.hasPrefix("MCU&REC&") {
            mode = text.hasSuffix("CON") ? .normal : text.hasSuffix("CALL") ? .call : .unknown
        } else if text.hasPrefix("MCU&BAT&") {
            battery = Int(text.dropFirst("MCU&BAT&".count))
        } else if text.hasPrefix("MCU&FW&") {
            firmware = String(text.dropFirst("MCU&FW&".count))
        }
        onEvent?(text)
    }
}

extension PocketBLE: CBCentralManagerDelegate {
    func centralManagerDidUpdateState(_ c: CBCentralManager) {
        switch c.state {
        case .poweredOn: connectOrScan()
        case .unauthorized: status = .unauthorized
        case .poweredOff: status = .bluetoothOff
        default: break
        }
    }

    func centralManager(_ c: CBCentralManager, didDiscover p: CBPeripheral,
                        advertisementData ad: [String: Any], rssi: NSNumber) {
        let n = (ad[CBAdvertisementDataLocalNameKey] as? String) ?? p.name ?? ""
        guard n.uppercased().hasPrefix("PKT") else { return }
        c.stopScan()
        name = n
        if peripheral?.identifier == p.identifier, peripheral?.state == .connecting { return }
        if let old = peripheral, old.identifier != p.identifier { c.cancelPeripheralConnection(old) }
        connect(p)
    }

    func centralManager(_ c: CBCentralManager, didConnect p: CBPeripheral) {
        c.stopScan()
        UserDefaults.standard.set(p.identifier.uuidString, forKey: Self.savedPeripheral)
        if name == nil { name = p.name }
        p.discoverServices(nil)
    }

    func centralManager(_ c: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) {
        log.error("connect failed: \(error?.localizedDescription ?? "", privacy: .public)")
        peripheral = nil
        status = .searching
        scheduleRetry(after: 2)
    }

    func centralManager(_ c: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) {
        log.info("disconnected")
        cmdChar = nil
        audioChar = nil
        batteryTimer?.invalidate()
        peripheral = nil
        onEvent?("DISCONNECTED")
        if status == .keyRejected {
            scheduleRetry(after: 30)
        } else {
            status = .searching
            scheduleRetry(after: 2)
        }
    }
}

extension PocketBLE: CBPeripheralDelegate {
    func peripheral(_ p: CBPeripheral, didDiscoverServices error: Error?) {
        for s in p.services ?? [] { p.discoverCharacteristics([Self.cmdUUID, Self.audioUUID], for: s) }
    }

    func peripheral(_ p: CBPeripheral, didDiscoverCharacteristicsFor s: CBService, error: Error?) {
        for ch in s.characteristics ?? [] {
            if ch.uuid == Self.cmdUUID {
                cmdChar = ch
                p.setNotifyValue(true, for: ch)
            } else if ch.uuid == Self.audioUUID {
                audioChar = ch
            }
        }
    }

    func peripheral(_ p: CBPeripheral, didUpdateNotificationStateFor ch: CBCharacteristic, error: Error?) {
        if ch.uuid == Self.cmdUUID, ch.isNotifying, let key { send("SK&\(key)") }
    }

    func peripheral(_ p: CBPeripheral, didUpdateValueFor ch: CBCharacteristic, error: Error?) {
        guard let value = ch.value else { return }
        if ch.uuid == Self.audioUUID {
            onAudio?(value)
        } else if ch.uuid == Self.cmdUUID {
            let text = String(decoding: value, as: UTF8.self)
                .trimmingCharacters(in: CharacterSet(charactersIn: "\u{0}\r\n"))
            handle(text)
        }
    }
}
