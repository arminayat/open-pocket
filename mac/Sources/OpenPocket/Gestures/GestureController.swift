import AVFoundation
import Foundation

struct GestureEvent: Identifiable {
    let id = UUID()
    let date: Date
    let kind: GestureKind
    let confidence: Double
    let location: TapLocation?
    let locationConfidence: Double
    let latency: Double
    let detail: String
    let outcome: GestureOutcome
}

/// Live gestures from the Pocket's contact mic (side switch in call mode).
///
/// While gestures are on, the Mac starts a recording on the Pocket so its audio
/// streams (the Pocket also keeps that recording). The side button pauses and
/// resumes, as last night. Each detected gesture is matched against the rules.
final class GestureController: ObservableObject {
    enum Status: Equatable {
        case off, notConnected, needsCallMode, starting, listening, paused
        var label: String {
            switch self {
            case .off: return "Gestures off"
            case .notConnected: return "Pocket not connected"
            case .needsCallMode: return "Slide the switch to call mode"
            case .starting: return "Starting"
            case .listening: return "Listening for gestures"
            case .paused: return "Paused with the side button"
            }
        }
    }

    @Published private(set) var enabled: Bool
    @Published private(set) var status: Status = .off
    @Published private(set) var last: GestureEvent?
    @Published private(set) var log: [GestureEvent] = []
    @Published private(set) var levels: [Float] = Array(repeating: 0, count: 90)
    let calibration = CalibrationRunner()

    let rules: GestureRuleStore
    let location = LocationModel()
    private let ble: PocketBLE
    private var streaming = false
    /// A start is in flight (asked STE, or sent STA); never send a second one,
    /// the Pocket treats it like a button press and stops recording.
    private var starting = false
    /// Last switch position we saw. The Pocket repeats MCU&REC&<pos> before every
    /// MCU&STA, so only a real change to call mode may start gestures.
    private var knownMode: SwitchMode = .unknown
    private var decoder: MP3Decoder?
    private var detector: GestureDetector?
    private var streamStart: Date?
    private var levelHops = 0
    private var levelMax: Double = -100

    init(ble: PocketBLE, rules: GestureRuleStore) {
        self.ble = ble
        self.rules = rules
        enabled = UserDefaults.standard.bool(forKey: "gesturesOn")
    }

    var isActive: Bool { enabled }

    func setEnabled(_ on: Bool) {
        enabled = on
        UserDefaults.standard.set(on, forKey: "gesturesOn")
        if on {
            startIfPossible()
        } else {
            if streaming { ble.stopRecording() }
            streaming = false
            status = .off
        }
    }

    func startIfPossible() {
        guard enabled else { status = .off; return }
        guard ble.status == .connected else { status = .notConnected; return }
        guard ble.mode == .call else { status = .needsCallMode; return }
        guard !streaming, !starting else { return }
        starting = true
        status = .starting
        ble.send("STE")    // already recording? (MCU&STE&0 = idle)
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
            guard let self, self.starting else { return }
            self.starting = false
            if !self.streaming { self.status = self.enabled ? .paused : .off }
        }
    }

    // MARK: - From the Pocket

    func handle(event: String) {
        if event.hasPrefix("MCU&SK&OK") {
            knownMode = .unknown
            status = enabled ? .starting : .off
        } else if event.hasPrefix("MCU&REC&") {
            let mode: SwitchMode = event.hasSuffix("CALL") ? .call : event.hasSuffix("CON") ? .normal : .unknown
            let changed = mode != knownMode
            knownMode = mode
            guard changed else { return }          // repeated before every STA: not a switch move
            if mode == .call {
                startIfPossible()
            } else if enabled {
                if streaming { ble.stopRecording() }
                streaming = false
                starting = false
                status = .needsCallMode
            }
        } else if event.hasPrefix("MCU&STE&") {
            guard starting else { return }
            if event.hasSuffix("&0") {
                ble.send("STA")                    // idle: start a recording so audio streams
            } else {
                starting = false                   // already recording: just listen
                streaming = true
                reset()
                status = .listening
            }
        } else if event.hasPrefix("MCU&STA") {
            starting = false
            guard enabled, ble.mode == .call else { return }
            streaming = true
            reset()
            status = .listening
        } else if event.hasPrefix("MCU&STO") {
            starting = false
            guard streaming else { return }
            streaming = false
            status = enabled ? .paused : .off
        } else if event == "DISCONNECTED" {
            streaming = false
            starting = false
            knownMode = .unknown
            status = enabled ? .notConnected : .off
        }
    }

    func handle(audio: Data) {
        guard streaming else { return }
        calibration.record(audio: audio)
        decoder?.feed(audio)
    }

    private func reset() {
        let d = GestureDetector()
        d.onLevel = { [weak self] rel in self?.level(rel) }
        let dec = MP3Decoder()
        dec.onPCM = { [weak self] buf in
            guard let self, let det = self.detector, let ch = buf.floatChannelData?[0] else { return }
            if self.streamStart == nil { self.streamStart = Date() }
            let samples = Array(UnsafeBufferPointer(start: ch, count: Int(buf.frameLength)))
            for g in det.feed(samples) { self.process(g) }
        }
        detector = d
        decoder = dec
        streamStart = nil
    }

    private func level(_ rel: Double) {
        levelMax = max(levelMax, rel)
        levelHops += 1
        if levelHops >= 44 {   // 90 bars ≈ 4 s
            levels.removeFirst()
            levels.append(Float(max(0, min(1, levelMax / 65))))
            levelHops = 0
            levelMax = -100
        }
    }

    // MARK: - Gestures

    private func process(_ g: DetectedGesture) {
        let latency = streamStart.map { Date().timeIntervalSince($0) - g.time } ?? 0
        let fingerprint = g.snippet.map { Fingerprint.compute($0) }
        let loc = fingerprint.flatMap { location.predict($0) }

        let outcome: GestureOutcome
        if calibration.isCollecting {
            calibration.handle(g, fingerprint: fingerprint)
            outcome = .calibrating("Calibration in progress. Actions are paused.")
        } else {
            let (rule, decided) = rules.decide(kind: g.kind, confidence: g.confidence,
                                               location: g.kind == .swipe ? nil : loc?.0,
                                               locationConfidence: loc?.1 ?? 0)
            if let rule, let error = rule.action.run() {
                outcome = .failed(error)
            } else {
                outcome = decided
            }
        }

        let event = GestureEvent(date: Date(), kind: g.kind, confidence: g.confidence,
                                 location: g.kind == .swipe ? nil : loc?.0, locationConfidence: loc?.1 ?? 0,
                                 latency: latency, detail: g.detail, outcome: outcome)
        last = event
        log.insert(event, at: 0)
        if log.count > 30 { log.removeLast() }
        log_gesture(event)
    }

    private func log_gesture(_ e: GestureEvent) {
        OpenPocket.log.info("gesture \(e.kind.rawValue, privacy: .public) \(Int(e.confidence * 100))% loc \(e.location?.rawValue ?? "-", privacy: .public) \(Int(e.locationConfidence * 100))% → \(e.outcome.short, privacy: .public)")
    }

    // MARK: - Calibration

    func resetCalibration() {
        try? FileManager.default.removeItem(at: LocationModel.userFile)
        location.reload()
    }

    /// Sample state for `--snapshot` renders.
    func applyPreview() {
        enabled = true
        status = .listening
        levels = (0..<90).map { i in
            let base = Float(4 + (i * 37) % 7) / 65
            return (i == 70 || i == 71) ? 0.9 : base
        }
        let mk: (GestureKind, Double, TapLocation?, Double, Double, GestureOutcome, Double) -> GestureEvent = {
            GestureEvent(date: Date().addingTimeInterval(-$6), kind: $0, confidence: $1, location: $2,
                         locationConfidence: $3, latency: $4, detail: "", outcome: $5)
        }
        log = [
            mk(.tap1, 0.96, .bottom, 0.78, 0.49, .ran("Press ⌘⇧."), 2),
            mk(.swipe, 0.88, nil, 0, 0.64, .noRule("No action for swipe."), 14),
            mk(.tap2, 0.91, .bottom, 0.52, 0.68, .noRule("No action for 2 taps."), 20),
            mk(.tap1, 0.54, .left, 0.37, 0.52, .unsure("Gesture confidence 54% is under 60%."), 31),
        ]
        last = log.first
    }
}
