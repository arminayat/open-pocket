import CryptoKit
import Foundation

/// The iCloud folder Open Pocket on iPhone writes, read with the same rules as its parser
/// (`src/lib/icloud/archive.ts` is the source of truth). `Documents/` holds `YYYY-MM-DD/HH.MM – Title/`
/// folders (older layouts: one top-level folder per recording), each with `recording.json`, `audio.mp3`
/// and content-addressed `transcript-|summary-|note-<sha256>.json` documents. A recording's identity is
/// the audio checksum in its `recording.json`, never the folder name. The Mac only reads.
enum RecordingArchive {
    static let maxAudioBytes = 2_000_000_000
    static let maxJSONBytes = 8_000_000

    struct Manifest: Equatable {
        let id: String
        let date: String          // YYYY-MM-DD
        let timestamp: String     // YYYYMMDDHHMMSS or PH + YYMMDDHHMMSS
        let durationSeconds: Double
        let bytes: Int
        let sha256: String

        /// The recorder's wall clock as `YYYYMMDDHHMMSS`.
        var clock: String { RecordingArchive.wallClock(timestamp) }
        /// `14:05`
        var time: String {
            let c = Array(clock)
            return "\(String(c[8...9])):\(String(c[10...11]))"
        }
    }

    enum Kind: String { case transcript, note, summary }

    struct Artifact: Equatable {
        let kind: Kind
        let text: String
        let updatedAt: String     // canonical ISO 8601, so it sorts as text
        var title: String?        // summary
        var provider: String?     // transcript, summary
        var model: String?        // transcript, summary
        var revision: String?     // note
    }

    struct Invalid: Error {}

    // MARK: Paths

    /// One folder-name component: no separators, colons, control characters or leading dot; ≤ 200 UTF-8 bytes.
    static func validComponent(_ name: String) -> Bool {
        !name.isEmpty && name.utf8.count <= 200 && !name.hasPrefix(".")
            && name.trimmingCharacters(in: .whitespacesAndNewlines) == name
            && !name.unicodeScalars.contains { "/\\:".unicodeScalars.contains($0) || isControl($0) }
    }

    /// A recording folder: `YYYY-MM-DD/<name>`, or one top-level name (older layouts, folders people made).
    static func validFolder(_ path: String) -> Bool {
        let parts = path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        return (parts.count == 1 || (parts.count == 2 && matches(datePattern, parts[0]) != nil))
            && parts.allSatisfy(validComponent)
    }

    /// Only this schema's files count; temp files and anything else people put there are ignored.
    static func archivePath(_ path: String) -> (folder: String, leaf: String)? {
        let parts = path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        guard (2...3).contains(parts.count) else { return nil }
        let folder = parts.dropLast().joined(separator: "/")
        let leaf = parts[parts.count - 1]
        guard validFolder(folder), matches(leafPattern, leaf) != nil else { return nil }
        return (folder, leaf)
    }

    static func isTextDocument(_ leaf: String) -> Bool { matches(artifactPattern, leaf) != nil }

    // MARK: Documents

    static func parseManifest(_ data: Data) throws -> Manifest {
        let item = try object(data)
        try exactKeys(item, ["schema", "id", "date", "timestamp", "durationSeconds", "bytes", "sha256"])
        guard number(item["schema"]) == 1,
              let date = item["date"] as? String, matches(datePattern, date) != nil,
              let timestamp = item["timestamp"] as? String, matches(timestampPattern, timestamp) != nil,
              wallClock(timestamp).prefix(8) == date.replacingOccurrences(of: "-", with: ""),
              item["id"] as? String == "\(date)/\(timestamp)",
              let duration = number(item["durationSeconds"]), duration.isFinite, duration >= 0, duration <= 7 * 24 * 3600,
              let bytes = number(item["bytes"]), bytes == bytes.rounded(), bytes > 0, bytes <= Double(maxAudioBytes),
              let sha = item["sha256"] as? String, isDigest(sha) else { throw Invalid() }
        let c = Array(wallClock(timestamp))
        let time = "\(date)T\(String(c[8...9])):\(String(c[10...11])):\(String(c[12...13])).000Z"
        guard canonicalDate(time) else { throw Invalid() }
        return Manifest(id: "\(date)/\(timestamp)", date: date, timestamp: timestamp,
                        durationSeconds: duration, bytes: Int(bytes), sha256: sha)
    }

    /// `leaf` is `<kind>-<sha256 of the file's bytes>.json`; a name that doesn't match its content is invalid.
    static func parseArtifact(_ data: Data, leaf: String) throws -> Artifact {
        guard let match = matches(artifactPattern, leaf), let kind = Kind(rawValue: match[1]),
              digest(data) == match[2] else { throw Invalid() }
        let item = try object(data)
        guard number(item["schema"]) == 1, item["kind"] as? String == kind.rawValue,
              let text = item["text"] as? String,
              let updatedAt = item["updatedAt"] as? String, canonicalDate(updatedAt) else { throw Invalid() }
        var artifact = Artifact(kind: kind, text: text, updatedAt: updatedAt)
        switch kind {
        case .transcript:
            try exactKeys(item, ["schema", "kind", "text", "updatedAt", "provider", "model"])
            guard text.utf16.count <= 2_000_000,
                  let provider = item["provider"] as? String, transcriptionProviders.contains(provider),
                  let model = item["model"] as? String, !model.isEmpty, model.utf16.count <= 100,
                  !model.unicodeScalars.contains(where: isControl) else { throw Invalid() }
            artifact.provider = provider
            artifact.model = model
        case .summary:
            try exactKeys(item, ["schema", "kind", "title", "text", "updatedAt", "provider", "model"])
            guard let title = item["title"] as? String, !title.isEmpty, title.utf16.count <= 80,
                  !title.unicodeScalars.contains(where: isControl),
                  !text.isEmpty, text.utf16.count <= 20_000,
                  let provider = item["provider"] as? String, aiProviders.contains(provider),
                  let model = item["model"] as? String, matches(modelPattern, model) != nil else { throw Invalid() }
            artifact.title = title
            artifact.provider = provider
            artifact.model = model
        case .note:
            try exactKeys(item, ["schema", "kind", "text", "updatedAt", "revision"])
            guard text.utf16.count <= 100_000,
                  let revision = item["revision"] as? String, matches(revisionPattern, revision) != nil else { throw Invalid() }
            artifact.revision = revision
        }
        return artifact
    }

    /// Which of two documents of the same kind wins: the later `updatedAt`, then the iPhone's tie-break.
    static func isNewer(_ a: Artifact, than b: Artifact) -> Bool {
        if a.updatedAt != b.updatedAt { return a.updatedAt > b.updatedAt }
        switch a.kind {
        case .note: return (b.revision ?? "").utf16.lexicographicallyPrecedes((a.revision ?? "").utf16)
        case .transcript: return tie(b, [\.provider, \.model]).lexicographicallyPrecedes(tie(a, [\.provider, \.model]))
        case .summary: return tie(b, [\.provider, \.model, \.title]).lexicographicallyPrecedes(tie(a, [\.provider, \.model, \.title]))
        }
    }

    // MARK: Folder titles

    /// The title a folder carries: the text after `HH.MM – ` in names Open Pocket gave it, or the whole
    /// name of a folder someone renamed in Finder. Nil for untitled and legacy checksum names.
    static func folderTitle(_ folder: String, manifest m: Manifest) -> String? {
        if folder == "\(m.date)_\(m.timestamp)-\(m.sha256)" { return nil }
        let bases = [false, true].flatMap { short in
            let clock = "\(m.clock.dropFirst(8).prefix(2)).\(m.clock.dropFirst(10).prefix(2))" + (short ? " (\(m.sha256.prefix(6)))" : "")
            return ["\(m.date)/\(clock)", "\(m.date) \(clock)"]
        }
        if bases.contains(folder) { return nil }
        if let base = bases.first(where: { folder.hasPrefix("\($0) – ") }) {
            return String(folder.dropFirst(base.count + 3))
        }
        return folder.split(separator: "/").last.map(String.init)
    }

    static func wallClock(_ timestamp: String) -> String {
        timestamp.hasPrefix("PH") ? "20" + timestamp.dropFirst(2) : timestamp
    }

    static func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    static func isDigest(_ value: String) -> Bool { matches(hashPattern, value) != nil }

    // MARK: Helpers

    static let transcriptionProviders: Set = ["openai", "deepgram", "assemblyai", "elevenlabs", "groq"]
    static let aiProviders: Set = ["chatgpt", "openai", "anthropic", "openrouter"]

    private static let hashPattern = regex("[a-f0-9]{64}")
    private static let datePattern = regex("[0-9]{4}-[0-9]{2}-[0-9]{2}")
    private static let timestampPattern = regex("[0-9]{14}|PH[0-9]{12}")
    private static let artifactPattern = regex("(transcript|note|summary)-([a-f0-9]{64})\\.json")
    private static let leafPattern = regex(
        "recording\\.json|audio\\.mp3|transcript-[a-f0-9]{64}\\.(?:json|txt)|(?:note|summary)-[a-f0-9]{64}\\.(?:json|md)")
    private static let modelPattern = regex("[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}")
    private static let revisionPattern = regex(
        "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", options: .caseInsensitive)
    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let isoPattern = regex("[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z")

    private static func regex(_ pattern: String, options: NSRegularExpression.Options = []) -> NSRegularExpression {
        // Anchored: every pattern must match the whole value, like the iPhone's /^…$/.
        try! NSRegularExpression(pattern: "^(?:\(pattern))$", options: options)
    }

    /// The capture groups (index 0 is the whole match) when `text` matches entirely.
    private static func matches(_ regex: NSRegularExpression, _ text: String) -> [String]? {
        let range = NSRange(text.startIndex..., in: text)
        guard let m = regex.firstMatch(in: text, range: range) else { return nil }
        return (0..<m.numberOfRanges).map { i in Range(m.range(at: i), in: text).map { String(text[$0]) } ?? "" }
    }

    /// Like `new Date(value).toISOString() === value` on the iPhone.
    private static func canonicalDate(_ value: String) -> Bool {
        guard matches(isoPattern, value) != nil, let date = isoFormatter.date(from: value) else { return false }
        return isoFormatter.string(from: date) == value
    }

    private static func isControl(_ s: Unicode.Scalar) -> Bool { s.value < 0x20 || s.value == 0x7F }

    private static func object(_ data: Data) throws -> [String: Any] {
        guard data.count <= maxJSONBytes, String(data: data, encoding: .utf8) != nil,
              let item = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw Invalid() }
        return item
    }

    private static func exactKeys(_ item: [String: Any], _ keys: Set<String>) throws {
        guard Set(item.keys) == keys else { throw Invalid() }
    }

    /// A JSON number; booleans (which Foundation also hands back as NSNumber) are not.
    private static func number(_ value: Any?) -> Double? {
        guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
        return n.doubleValue
    }

    /// The iPhone breaks ties on `JSON.stringify([fields…, text])`, compared as UTF-16.
    private static func tie(_ a: Artifact, _ fields: [KeyPath<Artifact, String?>]) -> [UInt16] {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .withoutEscapingSlashes
        let values = fields.map { a[keyPath: $0] ?? "" } + [a.text]
        let json = (try? encoder.encode(values)).flatMap { String(data: $0, encoding: .utf8) } ?? ""
        return Array(json.utf16)
    }
}
