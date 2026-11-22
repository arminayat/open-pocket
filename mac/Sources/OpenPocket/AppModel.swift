import AppKit
import Combine
import Foundation

/// Everything the views and the menu-bar icon read.
final class AppModel: ObservableObject {
    let settings = SettingsStore()
    let ble = PocketBLE()
    let dictation: DictationController
    let rules = GestureRuleStore()
    let gestures: GestureController
    /// Not forwarded into this model's changes: playback ticks shouldn't redraw every screen.
    let recordings = RecordingsStore(source: RecordingsStore.launchSource)

    @Published private(set) var key: String?
    @Published private(set) var accessibility = Hotkey.isTrusted()
    @Published private(set) var micInstalled = PocketMicDriver.isLoaded
    @Published var installError: String?
    @Published var installing = false
    @Published var pane: Pane = .dictate

    var openMainWindow: (() -> Void)?

    /// Fills in sample state for `--snapshot` renders.
    func applyPreview(key: String, accessibility: Bool, micInstalled: Bool) {
        self.key = key
        self.accessibility = accessibility
        self.micInstalled = micInstalled
    }

    private var bag = Set<AnyCancellable>()
    private var timer: Timer?

    init() {
        dictation = DictationController(settings: settings, ble: ble)
        gestures = GestureController(ble: ble, rules: rules)
        dictation.gesturesActive = { [unowned self] in self.gestures.isActive }
        ble.onEvent = { [unowned self] e in
            self.dictation.handle(event: e)
            self.gestures.handle(event: e)
        }
        ble.onAudio = { [unowned self] d in
            self.dictation.handle(audio: d)
            self.gestures.handle(audio: d)
        }
        for publisher in [settings.objectWillChange.eraseToAnyPublisher(),
                          ble.objectWillChange.eraseToAnyPublisher(),
                          dictation.objectWillChange.eraseToAnyPublisher(),
                          gestures.objectWillChange.eraseToAnyPublisher(),
                          rules.objectWillChange.eraseToAnyPublisher(),
                          gestures.calibration.objectWillChange.eraseToAnyPublisher()] {
            publisher.receive(on: RunLoop.main).sink { [weak self] _ in self?.objectWillChange.send() }.store(in: &bag)
        }
    }

    func start() {
        // Reading the key can show a Keychain prompt; don't freeze the window while it waits.
        DispatchQueue.global(qos: .userInitiated).async {
            let loaded = Keystore.load()
            DispatchQueue.main.async {
                self.key = loaded
                self.ble.start(key: loaded)
            }
        }
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.refreshChecks() }
    }

    func refreshChecks() {
        let a = Hotkey.isTrusted()
        let m = PocketMicDriver.isLoaded
        if a != accessibility { accessibility = a }
        if m != micInstalled { micInstalled = m }
    }

    var setupComplete: Bool {
        key != nil && micInstalled && accessibility && settings.shortcut != nil
    }

    var setupStepsLeft: Int {
        [key != nil, ble.status == .connected || key == nil, micInstalled, accessibility, settings.shortcut != nil]
            .filter { !$0 }.count
    }

    @discardableResult
    func importKey(_ text: String) -> Bool {
        guard Keystore.save(text) else { return false }
        key = Keystore.load()
        ble.reconnect(with: key)
        return true
    }

    func installMic() {
        installing = true
        installError = nil
        DispatchQueue.main.async {
            self.installError = PocketMicDriver.install()
            self.installing = false
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.refreshChecks() }
        }
    }

    enum IconState { case connected, listening, disconnected, attention }

    var iconState: IconState {
        if dictation.phase != .idle { return .listening }
        if !setupComplete || ble.status == .keyRejected { return .attention }
        if ble.mode == .call && !gestures.isActive { return .attention }
        return ble.status == .connected ? .connected : .disconnected
    }

    var statusLine: String {
        guard ble.status == .connected else { return ble.status.label }
        var parts = [ble.name ?? "Pocket"]
        if let b = ble.battery { parts.append("\(b)%") }
        parts.append(ble.mode == .call ? "Call mode" : "Normal")
        return parts.joined(separator: " · ")
    }
}
