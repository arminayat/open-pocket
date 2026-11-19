import Foundation

/// Gestures the contact mic can tell apart. Swipes have no direction or location.
enum GestureKind: String, Codable, CaseIterable, Identifiable {
    case tap1, tap2, tap3, swipe
    var id: String { rawValue }
    var label: String {
        switch self {
        case .tap1: return "1 tap"
        case .tap2: return "2 taps"
        case .tap3: return "3 taps"
        case .swipe: return "Swipe"
        }
    }
    var glyph: String {
        switch self {
        case .tap1: return "1×"
        case .tap2: return "2×"
        case .tap3: return "3×"
        case .swipe: return "↕"
        }
    }
}

/// Where on the Pocket's back a tap landed.
enum TapLocation: String, Codable, CaseIterable, Identifiable {
    case top, bottom, left, right
    var id: String { rawValue }
    var label: String { rawValue.capitalized }
}

struct DetectedGesture {
    let kind: GestureKind
    /// Seconds of audio from the start of the stream to the gesture's first onset.
    let time: Double
    /// How clearly this looked like the gesture (0…1). New: last night's detector had none.
    let confidence: Double
    let detail: String
    /// 40 ms of audio from the first tap's onset, for the location model.
    let snippet: [Float]?
}

/// Port of last night's `pocket_gestures.Detector` (contact mic, call mode, 16 kHz mono).
///
/// Works on a 1 ms level track (dB over the running noise floor). Each loud local peak
/// gets an attack (ms to rise the last 20 dB) and sustain (ms within 12 dB of its peak):
/// taps are sharp (attack ~1–6 ms, sustain ~3–8 ms), swipes broad (sustain 25+ ms).
/// Peaks closer than `groupGapMs` form one cluster, classified as a whole.
final class GestureDetector {
    struct Params {
        var peakDb = 48.0          // candidate peaks must exceed floor + this
        var localMs = 40           // ... and be the max within ± this
        var lookaheadMs = 90       // delay before judging a peak
        var sharpAttackMs = 8
        var sharpSustainMs = 10
        var broadSustainMs = 25
        var broadAttackMs = 30     // slow rise into the peak = friction, not a tap
        var swipeMinDb = 52.0
        var mergeMs = 100          // sharp peaks closer than this are one tap
        var tapRelDb = 8.0         // taps within this of the loudest count; weaker = rebound
        var groupGapMs = 300       // cluster ends after this long without a peak
        var swipeMaxExtentMs = 550
        var swipeMaxBroad = 2
        var maxTaps = 3
    }

    struct Peak {
        let hop: Int
        let db: Double
        let attack: Int
        let sustain: Int
        let onsetHop: Int
    }

    static let sampleRate = 16000
    private static let hop = 16      // 1 ms at 16 kHz

    let p = Params()
    /// Level over the noise floor, once per 1 ms hop (for the live strip).
    var onLevel: ((Double) -> Void)?

    private var x: [Float] = []
    private var x0 = 0               // sample index of x[0]
    private var n = 0                // next hop's first sample
    private var hist: [(hop: Int, db: Double)] = []
    private var rawHist: [Double] = []
    private var floor: Double?
    private var cluster: [Peak] = []

    func feed(_ samples: [Float]) -> [DetectedGesture] {
        var out: [DetectedGesture] = []
        x.append(contentsOf: samples)
        let h = Self.hop
        while n + h <= x0 + x.count {
            var sum: Float = 0
            for i in (n - x0)..<(n - x0 + h) { sum += x[i] * x[i] }
            let raw = 20 * log10(Double((sum / Float(h)).squareRoot()) + 1e-9)
            out += step(n / h, raw)
            n += h
        }
        let keep = 3 * Self.sampleRate
        if x.count > keep {
            let drop = x.count - keep
            x.removeFirst(drop)
            x0 += drop
        }
        return out
    }

    // MARK: - Level track and peak picking

    private func step(_ h: Int, _ raw: Double) -> [DetectedGesture] {
        if raw < -120 { return [] }                  // digital silence at stream start
        guard let fl = floor else {
            pushRaw(raw)
            if rawHist.count >= 500 { floor = percentile30(rawHist) }
            return []
        }
        let rel = raw - fl
        if rel < 15 {
            pushRaw(raw)
            if h % 250 == 0 { floor = percentile30(rawHist) }
        }
        hist.append((h, rel))
        if hist.count > 5000 { hist.removeFirst(1000) }
        onLevel?(rel)

        var out: [DetectedGesture] = []
        if hist.count > p.lookaheadMs + p.localMs + 1 {
            let i = hist.count - 1 - p.lookaheadMs
            let (hk, vk) = hist[i]
            if vk > p.peakDb {
                let lo = max(0, i - p.localMs), hi = min(hist.count, i + p.localMs + 1)
                var isMax = true
                for j in lo..<hi where hist[j].db > vk { isMax = false; break }
                if isMax {
                    for j in lo..<i where hist[j].db >= vk { isMax = false; break }
                }
                if isMax { addPeak(i, hk, vk) }
            }
        }
        if let last = cluster.last, h - last.hop - p.lookaheadMs > p.groupGapMs {
            out += close()
        }
        return out
    }

    private func pushRaw(_ v: Double) {
        rawHist.append(v)
        if rawHist.count > 3000 { rawHist.removeFirst(rawHist.count - 3000) }
    }

    private func percentile30(_ a: [Double]) -> Double {
        let s = a.sorted()
        let pos = 0.3 * Double(s.count - 1)
        let lo = Int(pos), hi = min(lo + 1, s.count - 1)
        return s[lo] + (s[hi] - s[lo]) * (pos - Double(lo))
    }

    private func addPeak(_ i: Int, _ hk: Int, _ vk: Double) {
        var j = i
        while j > 0 && hist[j].db > vk - 20 && i - j < 200 { j -= 1 }
        var l = i
        while l > 0 && hist[l].db > vk - 12 { l -= 1 }
        var r = i
        while r < hist.count - 1 && hist[r].db > vk - 12 { r += 1 }
        cluster.append(Peak(hop: hk, db: vk, attack: i - j, sustain: r - l, onsetHop: hist[j].hop))
    }

    // MARK: - Classifying a cluster

    private func close() -> [DetectedGesture] {
        let cl = cluster
        cluster = []
        guard let first = cl.first, let lastPeak = cl.last else { return [] }
        let extent = lastPeak.hop - first.hop
        let broad = cl.filter { $0.sustain >= p.broadSustainMs || $0.attack >= p.broadAttackMs }
        let loud = cl.map(\.db).max() ?? 0

        if !broad.isEmpty {
            let top = broad.max { $0.db < $1.db }!
            guard broad.count <= p.swipeMaxBroad, extent <= p.swipeMaxExtentMs, top.db >= p.swipeMinDb else {
                return []                            // rub / grip / handling noise
            }
            let conf = 0.4 + 0.6 * clamp((top.db - 50) / 12)
            return [DetectedGesture(kind: .swipe, time: Double(first.onsetHop) / 1000, confidence: conf,
                                    detail: "\(top.sustain) ms sustain, \(Int(top.db)) dB, \(cl.count) peaks", snippet: nil)]
        }

        var taps: [Peak] = []
        for c in cl {
            if c.db < loud - p.tapRelDb { continue }                                   // weak rebound
            if let t = taps.last, c.hop - t.hop < p.mergeMs { continue }               // bounce of the same tap
            if !taps.isEmpty && c.attack > p.sharpAttackMs { continue }                // soft follow-up = lift-off
            taps.append(c)
        }
        guard (1...p.maxTaps).contains(taps.count) else { return [] }
        let kind: GestureKind = taps.count == 1 ? .tap1 : taps.count == 2 ? .tap2 : .tap3
        return [DetectedGesture(kind: kind, time: Double(taps[0].onsetHop) / 1000,
                                confidence: tapConfidence(taps),
                                detail: taps.map { "\(Int($0.db)) dB a\($0.attack) s\($0.sustain)" }.joined(separator: ", "),
                                snippet: snippet(onsetSample: taps[0].onsetHop * Self.hop))]
    }

    /// New: how clearly this was a tap gesture. Loud, crisp, evenly spaced taps score high;
    /// soft brushes and grip shifts near the detection threshold score low.
    private func tapConfidence(_ taps: [Peak]) -> Double {
        let loudness = clamp(((taps.map(\.db).min() ?? 0) - 46) / 12)
        let attack = Double(taps.map(\.attack).max() ?? 0)
        let sustain = Double(taps.map(\.sustain).max() ?? 0)
        let sharpness = clamp(1 - (attack - 2) / 10) * clamp(1 - (sustain - 4) / 12)
        var rhythm = 1.0
        if taps.count > 1 {
            let gaps = zip(taps.dropFirst(), taps).map { $0.hop - $1.hop }
            rhythm = gaps.allSatisfy { (110...360).contains($0) } ? 1 : 0.6
        }
        return 0.25 + 0.75 * (0.5 * loudness + 0.3 * sharpness + 0.2 * rhythm)
    }

    private func clamp(_ v: Double) -> Double { min(1, max(0, v)) }

    // MARK: - Location snippet

    private func seg(_ a: Int, _ b: Int) -> ArraySlice<Float> {
        let lo = max(0, a - x0), hi = min(x.count, max(0, b - x0))
        return lo < hi ? x[lo..<hi] : []
    }

    /// 40 ms from the tap's onset, located the same way as in training.
    private func snippet(onsetSample start: Int) -> [Float]? {
        let sr = Self.sampleRate
        let a = start - sr * 5 / 1000
        let s = Array(seg(a, start + sr * 30 / 1000))
        guard s.count >= 10 else { return nil }
        let env = Fingerprint.envelope(s)
        guard let k = env.indices.max(by: { env[$0] < env[$1] }) else { return nil }
        let thr = env[k] * 0.1
        var j = k
        while j > 0 && k - j < sr * 30 / 1000 && env[j] > thr { j -= 1 }
        let on = a + j
        let pre = sr * 2 / 1000, length = sr * 40 / 1000
        let snip = Array(seg(on - pre, on - pre + length))
        return snip.count == length ? snip : nil
    }
}

/// Port of `pocket_location_analyze.fingerprint`: 40 log-spaced band energies (60 Hz–4 kHz)
/// of a Hann-windowed 40 ms snippet, mean-removed so it describes shape, not tap strength.
enum Fingerprint {
    static let nfft = 1024
    static let edges: [Double] = (0...40).map { 60 * pow(4000.0 / 60.0, Double($0) / 40) }

    /// 1 ms RMS envelope, `np.convolve(x**2, ones(16)/16, "same")` then sqrt.
    static func envelope(_ x: [Float]) -> [Float] {
        let n = 16, off = (n - 1) / 2
        var out = [Float](repeating: 0, count: x.count)
        for i in 0..<x.count {
            var s: Float = 0
            for k in 0..<n {
                let idx = i + off - k
                if idx >= 0 && idx < x.count { s += x[idx] * x[idx] }
            }
            out[i] = (s / Float(n)).squareRoot()
        }
        return out
    }

    static func compute(_ snip: [Float]) -> [Double] {
        let m = snip.count
        let sr = Double(GestureDetector.sampleRate)
        let w: [Double] = (0..<m).map { i in Double(snip[i]) * (0.5 - 0.5 * cos(2 * .pi * Double(i) / Double(m - 1))) }
        let maxBin = Int(edges.last! / (sr / Double(nfft))) + 1
        var power = [Double](repeating: 0, count: maxBin + 1)
        for k in 0...maxBin {
            var re = 0.0, im = 0.0
            let step = -2 * Double.pi * Double(k) / Double(nfft)
            for i in 0..<m {
                re += w[i] * cos(step * Double(i))
                im += w[i] * sin(step * Double(i))
            }
            power[k] = re * re + im * im
        }
        var bands = [Double](repeating: 0, count: 40)
        for k in 0...maxBin {
            let f = Double(k) * sr / Double(nfft)
            for b in 0..<40 where f >= edges[b] && f < edges[b + 1] { bands[b] += power[k] }
        }
        let db = bands.map { 10 * log10($0 + 1e-14) }
        let mean = db.reduce(0, +) / Double(db.count)
        return db.map { $0 - mean }
    }
}
