import AVFoundation
import Foundation

/// Command-line checks against recorded sessions (from last night's Python tools):
///   OpenPocket --gesture-test <session dir>
///   OpenPocket --train-locations <session dir> <out.json>
enum OfflineTools {
    private struct Session {
        struct Mark { let label: String; let rep: Int; let t: Double }
        let marks: [Mark]
        let tSta: Double
        let pcm: [Float]
        let chunkPCM: [[Float]]
    }

    private static func loadSession(_ dir: URL) throws -> Session {
        let meta = try JSONSerialization.jsonObject(with: Data(contentsOf: dir.appendingPathComponent("session.json"))) as! [String: Any]
        let events = meta["events"] as! [[String: Any]]
        let tSta = events.first { ($0["msg"] as! String).hasPrefix("MCU&STA") }!["t"] as! Double
        let marks = (meta["marks"] as! [[String: Any]]).map {
            Session.Mark(label: $0["label"] as! String, rep: $0["rep"] as! Int, t: $0["t"] as! Double)
        }
        let audio = try Data(contentsOf: dir.appendingPathComponent("audio.mp3"))
        let lines = try String(contentsOf: dir.appendingPathComponent("chunks.jsonl"), encoding: .utf8)
            .split(separator: "\n")
        let decoder = MP3Decoder()
        var current: [Float] = []
        decoder.onPCM = { buf in
            let p = buf.floatChannelData![0]
            current.append(contentsOf: UnsafeBufferPointer(start: p, count: Int(buf.frameLength)))
        }
        var chunks: [[Float]] = []
        for line in lines {
            let c = try JSONSerialization.jsonObject(with: Data(line.utf8)) as! [String: Any]
            let off = c["off"] as! Int, n = c["n"] as! Int
            current = []
            decoder.feed(audio.subdata(in: off..<min(off + n, audio.count)))
            chunks.append(current)
        }
        return Session(marks: marks, tSta: tSta, pcm: chunks.flatMap { $0 }, chunkPCM: chunks)
    }

    private static func expected(_ label: String) -> GestureKind?? {
        switch label {
        case "tap1", "nail1": return .some(.tap1)
        case "tap2": return .some(.tap2)
        case "tap3": return .some(.tap3)
        case "still", "grip", "rub": return .some(nil)
        default:
            if label.hasPrefix("swipe") { return .some(.swipe) }
            if label.hasPrefix("loc_") { return .some(.tap1) }
            return .some(nil)
        }
    }

    static func gestureTest(_ dir: URL) -> String {
        guard let s = try? loadSession(dir) else { return "cannot read session at \(dir.path)" }
        let detector = GestureDetector()
        let model = LocationModel()
        var found: [(DetectedGesture, (TapLocation, Double)?)] = []
        for chunk in s.chunkPCM + [[Float](repeating: 0, count: 16000)] {
            for g in detector.feed(chunk) {
                let loc = g.snippet.flatMap { model.predict(Fingerprint.compute($0)) }
                found.append((g, loc))
            }
        }
        var ok = 0, bad = 0
        var lines: [String] = []
        let a = s.marks.map { $0.t - s.tSta }
        for (i, m) in s.marks.enumerated() {
            let still = m.label == "still"
            let lo = a[i] - (still ? 0 : 0.3)
            let hi = still ? a[i] + 5 : (i + 1 < a.count ? a[i + 1] : 1e9) - 0.3
            let got = found.filter { lo <= $0.0.time && $0.0.time < hi }
            let exp = expected(m.label)!
            let good = exp.map { e in got.count == 1 && got[0].0.kind == e } ?? got.isEmpty
            if good { ok += 1 } else { bad += 1 }
            let desc = got.map { g, loc in
                "\(g.kind.rawValue) \(Int(g.confidence * 100))%" + (loc.map { " @\($0.0.rawValue) \(Int($0.1 * 100))%" } ?? "")
            }
            lines.append("\(good ? "  ok " : "  MISS") \(m.label)#\(m.rep): expected \(exp?.rawValue ?? "nothing"), got \(desc)")
        }
        var locOK = 0, locN = 0
        for (i, m) in s.marks.enumerated() where m.label.hasPrefix("loc_") {
            let lo = a[i] - 0.3, hi = (i + 1 < a.count ? a[i + 1] : 1e9) - 0.3
            if let (g, loc) = found.first(where: { lo <= $0.0.time && $0.0.time < hi }), g.kind == .tap1, let loc {
                locN += 1
                if "loc_" + loc.0.rawValue == m.label { locOK += 1 }
            }
        }
        lines.append("\(dir.lastPathComponent): \(ok)/\(ok + bad) trials correct")
        if locN > 0 { lines.append("location (model trained on this same data, optimistic): \(locOK)/\(locN)") }
        return lines.joined(separator: "\n")
    }

    /// Port of the Python training-set extraction (find_tap around each prompted tap).
    static func trainLocations(_ dir: URL, out: URL) -> String {
        guard let s = try? loadSession(dir) else { return "cannot read session at \(dir.path)" }
        let sr = Double(GestureDetector.sampleRate)
        let x = s.pcm
        let env = Fingerprint.envelope(x)
        guard let still = s.marks.first(where: { $0.label == "still" }) else { return "no 'still' mark" }
        let a0 = still.t - s.tSta
        let quiet = Array(env[Int((a0 + 0.5) * sr)..<min(env.count, Int((a0 + 4.5) * sr))]).sorted()
        let floor = Double(quiet[quiet.count / 2])

        var samples: [LocationSample] = []
        for m in s.marks where m.label.hasPrefix("loc_") {
            let a = m.t - s.tSta
            let i0 = max(0, Int((a - 0.3) * sr)), i1 = min(x.count, Int((a + 2.0) * sr))
            guard i0 < i1 else { continue }
            let seg = env[i0..<i1]
            let k = seg.indices.max { seg[$0] < seg[$1] }!
            let peakDb = 20 * log10(Double(seg[k]) / floor + 1e-12)
            let thr = seg[k] * 0.1
            var j = k
            while j > i0 && k - j < Int(0.03 * sr) && env[j] > thr { j -= 1 }
            guard peakDb >= 30, let label = TapLocation(rawValue: String(m.label.dropFirst(4))) else { continue }
            let on = j - Int(0.002 * sr)
            guard on >= 0, on + 640 <= x.count else { continue }
            samples.append(LocationSample(label: label, fingerprint: Fingerprint.compute(Array(x[on..<on + 640]))))
        }

        // Leave-one-out accuracy of the Swift model on these taps.
        var correct = 0
        for i in samples.indices {
            var rest = samples
            let held = rest.remove(at: i)
            let m = LocationModel()
            m.train(rest)
            if m.predict(held.fingerprint)?.0 == held.label { correct += 1 }
        }
        do {
            try JSONEncoder().encode(samples).write(to: out)
        } catch {
            return "write failed: \(error)"
        }
        return "kept \(samples.count) taps; leave-one-out accuracy \(correct)/\(samples.count); wrote \(out.path)"
    }
}
