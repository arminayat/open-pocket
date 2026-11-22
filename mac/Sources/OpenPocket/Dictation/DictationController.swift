import AVFoundation
import AppKit
import Combine

/// Press, talk, press: the Pocket becomes the dictation app's microphone.
///
/// On the Pocket's STA: switch the default input to Pocket Mic, press the
/// dictation app's hotkey, then play the Pocket's live MP3 into Pocket Mic
/// (buffered from the press, so the first words survive while the app opens
/// its mic). On STO: let the audio drain, press the hotkey again, restore the input.
final class DictationController: ObservableObject {
    enum Phase: Equatable { case idle, starting, listening, finishing }

    @Published private(set) var phase: Phase = .idle
    @Published private(set) var startedAt: Date?
    @Published private(set) var levels: [Float] = Array(repeating: 0, count: 48)
    @Published private(set) var targetApp: String?
    @Published var notice: String?

    private let settings: SettingsStore
    private let ble: PocketBLE
    private var talking = false
    private var live = false
    private var buffered: [Data] = []
    private var decoder: MP3Decoder?
    private var player: PocketMicPlayer?
    private var startTask: Task<Void, Never>?
    private var finishing = false

    private static let settleMs = 150    // let CoreAudio apply the input switch
    private static let micOpenMs = 350   // the dictation app needs a moment to open its mic
    private static let tailMs = 400      // audio still arriving after STO

    init(settings: SettingsStore, ble: PocketBLE) {
        self.settings = settings
        self.ble = ble
        InputSwitch.recover()
    }

    /// True while gestures own call mode; side-button presses there aren't dictation.
    var gesturesActive: () -> Bool = { false }

    /// What stops dictation from working right now, if anything.
    func blocker() -> String? {
        if AudioDevices.pocketMic == nil { return "Pocket Mic isn't installed. Install it in Setup." }
        if !Hotkey.isTrusted() { return "Open Pocket can't press the hotkey yet. Allow it under Accessibility in Setup." }
        if settings.shortcut == nil { return "Set your dictation app's hotkey in Settings." }
        return nil
    }

    func finishNow() { ble.stopRecording() }

    /// Sample state for `--snapshot` renders.
    func applyPreview(listening: Bool) {
        phase = listening ? .listening : .idle
        startedAt = listening ? Date().addingTimeInterval(-6) : nil
        targetApp = listening ? "Terminal" : nil
        levels = listening ? (0..<levels.count).map { i in i < 30 ? Float(abs(sin(Double(i) * 1.7))) * 0.9 + 0.1 : 0.05 } : levels
    }

    func handle(event: String) {
        if event.hasPrefix("MCU&STA") {
            begin()
        } else if event.hasPrefix("MCU&STO") {
            Task { await finish(reason: "button") }
        } else if event == "DISCONNECTED", talking {
            Task { await finish(reason: "disconnected") }
        }
    }

    func handle(audio data: Data) {
        guard talking else { return }
        if live, let decoder { decoder.feed(data) } else { buffered.append(data) }
    }

    private func begin() {
        guard !talking, !finishing, !settings.paused else { return }
        if ble.mode == .call {
            if gesturesActive() { return }
            notice = "The switch is in call mode (contact mic), so this is saved as a recording, not dictated. Slide it to normal for voice."
            return
        }
        if let problem = blocker() {
            notice = problem
            ble.stopRecording()
            return
        }
        guard let mic = AudioDevices.pocketMic, let shortcut = settings.shortcut else { return }
        talking = true
        live = false
        buffered = []
        notice = nil
        phase = .starting
        startedAt = Date()
        targetApp = NSWorkspace.shared.frontmostApplication?.localizedName
        let style = settings.style
        log.info("dictation start")
        startTask = Task { @MainActor in
            InputSwitch.engage(mic)
            await sleep(ms: Self.settleMs)
            Hotkey.begin(shortcut, style: style)
            await sleep(ms: Self.micOpenMs)
            self.startPlayback(into: mic)
        }
    }

    private func startPlayback(into mic: AudioDeviceID) {
        let decoder = MP3Decoder()
        let player = PocketMicPlayer()
        decoder.onPCM = { [weak self, weak player] buffer in
            guard let self, let player else { return }
            if !player.isRunning {
                do {
                    try player.start(device: mic, format: buffer.format, reduceBoom: self.settings.reduceBoom)
                } catch {
                    self.notice = error.localizedDescription
                    return
                }
            }
            player.schedule(buffer)
            self.levels.removeFirst()
            self.levels.append(min(1, PocketMicPlayer.rms(buffer) * 6))
        }
        self.decoder = decoder
        self.player = player
        for chunk in buffered { decoder.feed(chunk) }
        buffered = []
        live = true
        phase = .listening
    }

    @MainActor
    private func finish(reason: String) async {
        guard talking, !finishing else { return }
        finishing = true
        phase = .finishing
        await sleep(ms: Self.tailMs)
        await startTask?.value
        talking = false
        live = false
        await player?.drain(timeout: 5)
        if let shortcut = settings.shortcut { Hotkey.end(shortcut, style: settings.style) }
        await sleep(ms: 300)
        player?.stop()
        player = nil
        decoder = nil
        InputSwitch.release()
        if let startedAt { History.record(start: startedAt, end: Date()) }
        log.info("dictation sent (\(reason, privacy: .public))")
        phase = .idle
        startedAt = nil
        levels = Array(repeating: 0, count: levels.count)
        finishing = false
    }

    /// Debug: play an MP3 file through the same path in live-sized chunks, with no hotkey.
    func loopbackTest(file: URL) async -> String {
        guard let mic = AudioDevices.pocketMic else { return "Pocket Mic not installed" }
        guard let data = try? Data(contentsOf: file) else { return "cannot read \(file.path)" }
        talking = true
        startPlayback(into: mic)
        let t0 = Date()
        var i = 0
        while i < data.count {
            handle(audio: data.subdata(in: i..<min(i + 134, data.count)))
            i += 134
            await sleep(ms: 33)
        }
        let fed = Date().timeIntervalSince(t0)
        await player?.drain(timeout: 5)
        let done = Date().timeIntervalSince(t0)
        player?.stop()
        talking = false
        live = false
        phase = .idle
        return String(format: "fed %.2fs, played out at %.2fs", fed, done)
    }
}
