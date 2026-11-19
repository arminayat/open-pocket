import Foundation

struct LocationSample: Codable {
    let label: TapLocation
    let fingerprint: [Double]
}

/// Which side of the Pocket a tap hit: softmax logistic regression on standardized
/// fingerprints. Trained from your own calibration taps, else last night's 48 taps.
final class LocationModel {
    private(set) var sampleCount = 0
    private(set) var isCalibrated = false
    private var mean: [Double] = []
    private var std: [Double] = []
    private var weights: [[Double]] = []   // [class][feature + bias]
    private let classes = TapLocation.allCases

    static var userFile: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("heypocket/location-samples.json")
    }

    init() { reload() }

    func reload() {
        if let user = Self.load(Self.userFile), !user.isEmpty {
            train(user)
            isCalibrated = true
        } else if let url = Bundle.main.url(forResource: "location-samples-default", withExtension: "json"),
                  let def = Self.load(url) {
            train(def)
            isCalibrated = false
        }
    }

    static func load(_ url: URL) -> [LocationSample]? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode([LocationSample].self, from: data)
    }

    static func saveUser(_ samples: [LocationSample]) throws {
        try FileManager.default.createDirectory(at: userFile.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(samples).write(to: userFile)
    }

    var isReady: Bool { !weights.isEmpty }

    func train(_ samples: [LocationSample]) {
        guard let dim = samples.first?.fingerprint.count, samples.count >= 8 else { return }
        sampleCount = samples.count
        mean = (0..<dim).map { d in samples.map { $0.fingerprint[d] }.reduce(0, +) / Double(samples.count) }
        std = (0..<dim).map { d in
            let v = samples.map { pow($0.fingerprint[d] - mean[d], 2) }.reduce(0, +) / Double(samples.count)
            return max(v.squareRoot(), 1e-6)
        }
        let X = samples.map { standardize($0.fingerprint) + [1] }
        let y = samples.map { s in classes.firstIndex(of: s.label)! }
        var W = [[Double]](repeating: [Double](repeating: 0, count: dim + 1), count: classes.count)
        let lr = 0.1, l2 = 0.02
        for _ in 0..<600 {
            var grad = [[Double]](repeating: [Double](repeating: 0, count: dim + 1), count: classes.count)
            for (xi, yi) in zip(X, y) {
                let p = softmax(W.map { dot($0, xi) })
                for c in 0..<classes.count {
                    let e = p[c] - (c == yi ? 1 : 0)
                    for d in 0...dim { grad[c][d] += e * xi[d] }
                }
            }
            for c in 0..<classes.count {
                for d in 0...dim {
                    let reg = d < dim ? l2 * W[c][d] : 0
                    W[c][d] -= lr * (grad[c][d] / Double(X.count) + reg)
                }
            }
        }
        weights = W
    }

    func predict(_ fingerprint: [Double]) -> (TapLocation, Double)? {
        guard isReady else { return nil }
        let p = softmax(weights.map { dot($0, standardize(fingerprint) + [1]) })
        let i = p.indices.max { p[$0] < p[$1] }!
        return (classes[i], p[i])
    }

    private func standardize(_ f: [Double]) -> [Double] { zip(zip(f, mean), std).map { ($0.0 - $0.1) / $1 } }
    private func dot(_ a: [Double], _ b: [Double]) -> Double { zip(a, b).reduce(0) { $0 + $1.0 * $1.1 } }
    private func softmax(_ z: [Double]) -> [Double] {
        let m = z.max() ?? 0
        let e = z.map { exp($0 - m) }
        let s = e.reduce(0, +)
        return e.map { $0 / s }
    }
}
