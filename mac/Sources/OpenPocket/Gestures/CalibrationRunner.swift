import Foundation

/// "Teach Open Pocket your taps": a guided session like last night's recordings.
///
/// Hold still → prompted 1/2/3 taps → swipes → grip and rub (must not count) → taps on each
/// side. Each trial is scored live. The tap-spot taps train the location model, the scores
/// give a suggested threshold, and the session (contact-mic MP3 + prompt timings, in the
/// same layout as last night's sessions) can be kept on this Mac to improve the detector.
final class CalibrationRunner: ObservableObject {
    enum Section: Int, CaseIterable {
        case still, taps, swipes, notGestures, spots, results
        var title: String {
            switch self {
            case .still: return "Hold still"
            case .taps: return "Taps"
            case .swipes: return "Swipes"
            case .notGestures: return "Not gestures"
            case .spots: return "Tap spots"
            case .results: return "Results"
            }
        }
    }

    enum Outcome: Equatable {
        case pending
        case ok(Double?)
        case miss(String, Double?)
        var isDone: Bool { self != .pending }
    }

    struct Trial: Identifiable {
        let id = UUID()
        let section: Section
        let label: String          // session mark label: still, tap1, swipe, grip, loc_top, …
        let rep: Int
        let group: String          // row in the progress panel
        let prompt: String
        let hint: String
        let expected: GestureKind?
        let spot: TapLocation?
        let window: Double
        var outcome: Outcome = .pending
    }

    struct Report {
        var taps: (ok: Int, total: Int, note: String)
        var swipes: (ok: Int, total: Int, note: String)
        var falseTriggers: (count: Int, total: Int, note: String)
        var spotAccuracy: Double?
        var spotNote: String
        var threshold: Double
        var thresholdNote: String
    }

    @Published private(set) var running = false
    @Published private(set) var trials: [Trial] = []
    @Published private(set) var index = 0
    @Published private(set) var heard: String?
    @Published private(set) var heardOK = true
    @Published private(set) var secondsLeft = 0
    @Published private(set) var report: Report?
    @Published var keepSession = true
    @Published var applyThreshold = true
    @Published private(set) var savedMessage: String?

    var current: Trial? { trials.indices.contains(index) ? trials[index] : nil }
    var section: Section? { report != nil ? .results : current?.section }
    var isCollecting: Bool { running && report == nil }

    private var timer: Timer?
    private var trialStart = Date()
    private var advancing = false
    private var spotSamples: [LocationSample] = []
    private var trialConfidence: [UUID: Double] = [:]
    private var falseConfidences: [Double] = []

    // Session recording (last night's layout: audio.mp3, chunks.jsonl, session.json).
    private var t0 = Date()
    private var audio = Data()
    private var chunkLines: [String] = []
    private var marks: [[String: Any]] = []

    // MARK: - Running

    static func plan() -> [Trial] {
        var t: [Trial] = []
        t.append(Trial(section: .still, label: "still", rep: 1, group: "Quiet", prompt: "Hold still",
                       hint: "Keep your usual grip.", expected: nil, spot: nil, window: 5))
        for (kind, n, prompt, hint) in [(GestureKind.tap1, 4, "Tap once", "Anywhere on the back."),
                                        (.tap2, 3, "Tap twice", "Anywhere on the back, like a double knock."),
                                        (.tap3, 3, "Tap three times", "Quick and even.")] {
            for r in 1...n {
                t.append(Trial(section: .taps, label: kind.rawValue, rep: r, group: kind.label, prompt: prompt,
                               hint: hint, expected: kind, spot: nil, window: 7))
            }
        }
        for r in 1...4 {
            t.append(Trial(section: .swipes, label: "swipe", rep: r, group: "Swipe", prompt: "Swipe",
                           hint: "Slide a finger along the back, any direction.", expected: .swipe, spot: nil, window: 7))
        }
        for r in 1...2 {
            t.append(Trial(section: .notGestures, label: "grip", rep: r, group: "Grip", prompt: "Shift your grip",
                           hint: "Adjust how you hold it. This should not count.", expected: nil, spot: nil, window: 5))
        }
        for r in 1...2 {
            t.append(Trial(section: .notGestures, label: "rub", rep: r, group: "Rub", prompt: "Rub the case",
                           hint: "Rub a thumb over the back. This should not count.", expected: nil, spot: nil, window: 5))
        }
        for side in TapLocation.allCases {
            for r in 1...6 {
                t.append(Trial(section: .spots, label: "loc_\(side.rawValue)", rep: r, group: side.label,
                               prompt: "Tap the \(side.rawValue)", hint: "One tap at a time, where the dashed ring is.",
                               expected: .tap1, spot: side, window: 9))
            }
        }
        return t
    }

    func start() {
        trials = Self.plan()
        index = 0
        report = nil
        savedMessage = nil
        spotSamples = []
        trialConfidence = [:]
        falseConfidences = []
        t0 = Date()
        audio = Data()
        chunkLines = []
        marks = []
        running = true
        beginTrial()
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in self?.tick() }
    }

    func stop() {
        timer?.invalidate()
        running = false
        report = nil
        trials = []
    }

    func redo() {
        guard isCollecting, trials.indices.contains(index) else { return }
        trials[index].outcome = .pending
        if !marks.isEmpty { marks.removeLast() }
        beginTrial()
    }

    private var now: Double { Date().timeIntervalSince(t0) }

    private func beginTrial() {
        guard let t = current else { return finish() }
        advancing = false
        heard = nil
        trialStart = Date()
        secondsLeft = Int(t.window.rounded(.up))
        marks.append(["label": t.label, "rep": t.rep, "t": now])
    }

    private func tick() {
        guard isCollecting, let t = current, !advancing else { return }
        let elapsed = Date().timeIntervalSince(trialStart)
        secondsLeft = max(0, Int((t.window - elapsed).rounded(.up)))
        guard elapsed >= t.window else { return }
        switch t.section {
        case .still, .notGestures:
            if t.outcome == .pending { trials[index].outcome = .ok(nil) }
        default:
            if t.outcome == .pending { trials[index].outcome = .miss("Nothing heard", nil) }
        }
        next(after: 0.3)
    }

    private func next(after delay: Double) {
        advancing = true
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self, self.isCollecting else { return }
            self.index += 1
            self.beginTrial()
        }
    }

    /// Raw MP3 from the Pocket while calibrating.
    func record(audio data: Data) {
        guard isCollecting else { return }
        chunkLines.append(String(format: "{\"t\": %.4f, \"off\": %d, \"n\": %d}", now, audio.count, data.count))
        audio.append(data)
    }

    /// A gesture the detector found during calibration.
    func handle(_ g: DetectedGesture, fingerprint: [Double]?) {
        guard isCollecting, !advancing, let t = current else { return }
        let said = "\(g.kind.label) · \(Int(g.confidence * 100))%"
        switch t.section {
        case .still, .notGestures:
            heard = "Heard \(said). That would have counted."
            heardOK = false
            if t.outcome == .pending {
                trials[index].outcome = .miss("Counted as \(g.kind.label.lowercased()) (\(Int(g.confidence * 100))%)", g.confidence)
                falseConfidences.append(g.confidence)
            }
        case .taps, .swipes:
            let ok = g.kind == t.expected
            heard = "Heard: \(said)"
            heardOK = ok
            trials[index].outcome = ok ? .ok(g.confidence) : .miss("Heard as \(g.kind.label.lowercased())", g.confidence)
            if ok { trialConfidence[t.id] = g.confidence }
            next(after: 1.0)
        case .spots:
            guard g.kind == .tap1, let fingerprint, let side = t.spot else {
                heard = "Heard \(g.kind.label.lowercased()). One tap at a time, please."
                heardOK = false
                return
            }
            spotSamples.append(LocationSample(label: side, fingerprint: fingerprint))
            heard = "Heard: 1 tap · saved as \(side.rawValue)"
            heardOK = true
            trials[index].outcome = .ok(g.confidence)
            next(after: 0.6)
        case .results:
            break
        }
    }

    // MARK: - Results

    private func finish() {
        timer?.invalidate()
        let taps = trials.filter { $0.section == .taps }
        let swipes = trials.filter { $0.section == .swipes }
        let nots = trials.filter { $0.section == .notGestures }
        func ok(_ t: [Trial]) -> Int { t.filter { if case .ok = $0.outcome { return true }; return false }.count }
        func firstMiss(_ t: [Trial]) -> String? {
            for x in t { if case .miss(let why, _) = x.outcome { return "\(x.group): \(why.lowercased())" } }
            return nil
        }
        let falseCount = nots.filter { if case .miss = $0.outcome { return true }; return false }.count

        // Tap spots: leave-one-out accuracy of a model trained on these taps.
        var accuracy: Double?
        var spotNote = "Not enough taps to measure."
        if spotSamples.count >= 8 {
            var correct = 0
            var perSide: [TapLocation: (Int, Int)] = [:]
            for i in spotSamples.indices {
                var rest = spotSamples
                let held = rest.remove(at: i)
                let m = LocationModel()
                m.train(rest)
                let right = m.predict(held.fingerprint)?.0 == held.label
                if right { correct += 1 }
                let s = perSide[held.label] ?? (0, 0)
                perSide[held.label] = (s.0 + (right ? 1 : 0), s.1 + 1)
            }
            accuracy = Double(correct) / Double(spotSamples.count)
            if let worst = perSide.min(by: { Double($0.value.0) / Double($0.value.1) < Double($1.value.0) / Double($1.value.1) }) {
                spotNote = worst.value.0 == worst.value.1 ? "Every side was told apart" : "\(worst.key.label) side is the hardest"
            }
        }

        // Threshold between your real gestures and the things that shouldn't count.
        let real = Array(trialConfidence.values)
        let minReal = real.min() ?? 0.7
        let maxFalse = falseConfidences.max()
        var threshold: Double
        var note: String
        let realText = real.isEmpty ? "" : "Your real gestures scored \(Int(minReal * 100))–\(Int((real.max() ?? 1) * 100))%."
        if let maxFalse {
            if maxFalse < minReal {
                threshold = (maxFalse + minReal) / 2
                note = "\(realText) The false trigger scored \(Int(maxFalse * 100))%. \(Int(round5(threshold) * 100))% sits between them."
            } else {
                threshold = maxFalse + 0.05
                note = "\(realText) A false trigger scored \(Int(maxFalse * 100))%, as high as real gestures. Raising the threshold will also skip some real taps."
            }
        } else {
            threshold = max(0.5, minReal - 0.1)
            note = "\(realText) Nothing false was triggered, so a lower threshold is safe."
        }
        threshold = min(0.9, max(0.4, round5(threshold)))

        report = Report(
            taps: (ok(taps), taps.count, firstMiss(taps) ?? "All recognized"),
            swipes: (ok(swipes), swipes.count, firstMiss(swipes) ?? "All recognized"),
            falseTriggers: (falseCount, nots.count, firstMiss(nots) ?? "Nothing counted"),
            spotAccuracy: accuracy, spotNote: spotNote,
            threshold: threshold, thresholdNote: note)
    }

    private func round5(_ v: Double) -> Double { (v * 20).rounded() / 20 }

    /// Applies the calibration. Returns where the session was kept, if it was.
    func save(location: LocationModel, rules: GestureRuleStore, device: String?) {
        guard let report else { return }
        var parts: [String] = []
        if spotSamples.count >= 8 {
            try? LocationModel.saveUser(spotSamples)
            location.reload()
            parts.append("Tap spots trained on \(spotSamples.count) of your taps")
        }
        if applyThreshold {
            for i in rules.rules.indices { rules.rules[i].minConfidence = report.threshold }
            parts.append("actions set to \(Int(report.threshold * 100))%")
        }
        if keepSession, let dir = writeSession(device: device) {
            parts.append("session kept in \(dir.lastPathComponent)")
            lastSessionDir = dir
        }
        savedMessage = parts.isEmpty ? "Nothing to save." : parts.joined(separator: "; ") + "."
        running = false
        self.report = nil
        trials = []
    }

    private(set) var lastSessionDir: URL?

    static var sessionsDir: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("heypocket/calibration-sessions")
    }

    private func writeSession(device: String?) -> URL? {
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyyMMdd-HHmmss"
        let dir = Self.sessionsDir.appendingPathComponent(fmt.string(from: t0))
        let meta: [String: Any] = [
            "protocol": "openpocket-calibration-1",
            "device": device ?? "",
            "started": ISO8601DateFormatter().string(from: t0),
            "events": [["t": 0.0, "msg": "MCU&STA&calibration"]],
            "marks": marks,
            "audio_bytes": audio.count,
        ]
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try audio.write(to: dir.appendingPathComponent("audio.mp3"))
            try (chunkLines.joined(separator: "\n") + "\n").write(to: dir.appendingPathComponent("chunks.jsonl"), atomically: true, encoding: .utf8)
            try JSONSerialization.data(withJSONObject: meta, options: [.prettyPrinted, .sortedKeys])
                .write(to: dir.appendingPathComponent("session.json"))
            return dir
        } catch {
            return nil
        }
    }

    /// Sample state for `--snapshot` renders.
    func applyPreview(results: Bool) {
        trials = Self.plan()
        running = true
        if results {
            report = Report(taps: (9, 10, "3 taps: heard as 2 taps"), swipes: (4, 4, "All recognized"),
                            falseTriggers: (1, 4, "Grip: counted as 1 tap (58%)"), spotAccuracy: 0.83,
                            spotNote: "Right side is the hardest", threshold: 0.65,
                            thresholdNote: "Your real gestures scored 71–98%. The false trigger scored 58%. 65% sits between them.")
        } else {
            for i in 0..<6 { trials[i].outcome = .ok(0.9) }
            index = 6
            heard = "Heard: 2 taps · 91%"
            heardOK = true
            secondsLeft = 5
        }
    }
}
