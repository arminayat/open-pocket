import AppKit
import Foundation

enum MediaKey: String, Codable, CaseIterable, Identifiable {
    case playPause, next, previous, volumeUp, volumeDown, mute
    var id: String { rawValue }
    var label: String {
        switch self {
        case .playPause: return "Play / pause"
        case .next: return "Next track"
        case .previous: return "Previous track"
        case .volumeUp: return "Volume up"
        case .volumeDown: return "Volume down"
        case .mute: return "Mute"
        }
    }
    /// NX_KEYTYPE_* codes.
    var code: Int32 {
        switch self {
        case .playPause: return 16
        case .next: return 17
        case .previous: return 18
        case .volumeUp: return 0
        case .volumeDown: return 1
        case .mute: return 7
        }
    }
}

enum GestureAction: Codable, Equatable {
    case keys(Shortcut?)
    case openApp(path: String)
    case runShortcut(name: String)
    case media(MediaKey)
    case shell(String)

    enum Kind: String, CaseIterable, Identifiable {
        case keys, openApp, runShortcut, media, shell
        var id: String { rawValue }
        var label: String {
            switch self {
            case .keys: return "Press a keyboard shortcut"
            case .openApp: return "Open an app"
            case .runShortcut: return "Run a Shortcut"
            case .media: return "Media key"
            case .shell: return "Run a shell command"
            }
        }
        var empty: GestureAction {
            switch self {
            case .keys: return .keys(nil)
            case .openApp: return .openApp(path: "")
            case .runShortcut: return .runShortcut(name: "")
            case .media: return .media(.playPause)
            case .shell: return .shell("")
            }
        }
    }

    var kind: Kind {
        switch self {
        case .keys: return .keys
        case .openApp: return .openApp
        case .runShortcut: return .runShortcut
        case .media: return .media
        case .shell: return .shell
        }
    }

    var summary: String {
        switch self {
        case .keys(let s): return s.map { "Press \($0.display)" } ?? "Press a shortcut (not set)"
        case .openApp(let p): return p.isEmpty ? "Open an app (not set)" : "Open \(URL(fileURLWithPath: p).deletingPathExtension().lastPathComponent)"
        case .runShortcut(let n): return n.isEmpty ? "Run a Shortcut (not set)" : "Run Shortcut “\(n)”"
        case .media(let m): return m.label
        case .shell(let c): return c.isEmpty ? "Run a command (not set)" : "Run \(c)"
        }
    }

    /// Performs the action. Returns an error message, or nil.
    @discardableResult
    func run() -> String? {
        switch self {
        case .keys(let s):
            guard let s else { return "No shortcut set" }
            guard Hotkey.isTrusted() else { return "Needs Accessibility" }
            Hotkey.begin(s, style: .toggle)
        case .openApp(let path):
            guard !path.isEmpty else { return "No app chosen" }
            NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: path), configuration: .init())
        case .runShortcut(let name):
            guard !name.isEmpty else { return "No Shortcut name" }
            return launch("/usr/bin/shortcuts", ["run", name])
        case .media(let key):
            postMedia(key.code)
        case .shell(let command):
            guard !command.isEmpty else { return "No command" }
            return launch("/bin/zsh", ["-lc", command])
        }
        return nil
    }

    private func launch(_ tool: String, _ args: [String]) -> String? {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: tool)
        p.arguments = args
        do { try p.run() } catch { return error.localizedDescription }
        return nil
    }

    private func postMedia(_ code: Int32) {
        for down in [true, false] {
            let flags = NSEvent.ModifierFlags(rawValue: down ? 0xA00 : 0xB00)
            let data1 = Int((code << 16) | ((down ? 0xA : 0xB) << 8))
            NSEvent.otherEvent(with: .systemDefined, location: .zero, modifierFlags: flags, timestamp: 0,
                               windowNumber: 0, context: nil, subtype: 8, data1: data1, data2: -1)?
                .cgEvent?.post(tap: .cghidEventTap)
        }
    }
}

struct GestureRule: Codable, Identifiable, Equatable {
    var id = UUID()
    var gesture: GestureKind
    var location: TapLocation?        // nil = anywhere
    var minConfidence: Double = 0.6
    var action: GestureAction
    var enabled = true

    var whenText: String {
        "\(gesture.label) · \(location?.rawValue ?? "anywhere") · ≥ \(Int((minConfidence * 100).rounded()))%"
    }
}

/// What a gesture led to.
enum GestureOutcome: Equatable {
    case ran(String)
    case failed(String)
    case unsure(String)
    case noRule(String)
    case calibrating(String)

    var headline: String {
        switch self {
        case .ran: return "Ran"
        case .failed: return "Didn't run"
        case .unsure: return "Skipped"
        case .noRule: return "Nothing to do"
        case .calibrating: return "Calibrating"
        }
    }
    var text: String {
        switch self {
        case .ran(let t), .failed(let t), .unsure(let t), .noRule(let t), .calibrating(let t): return t
        }
    }
    var short: String {
        switch self {
        case .ran(let t): return t
        case .failed: return "Failed"
        case .unsure: return "Skipped, unsure"
        case .noRule: return "No rule"
        case .calibrating: return "Calibration"
        }
    }
}

final class GestureRuleStore: ObservableObject {
    @Published var rules: [GestureRule] { didSet { save() } }
    private static let key = "gestureRules"

    /// Defaults avoid the dictation hotkey and single taps (grip shifts look like single taps).
    static let defaults: [GestureRule] = [
        GestureRule(gesture: .tap2, location: nil, minConfidence: 0.7, action: .media(.playPause)),
        GestureRule(gesture: .tap3, location: nil, minConfidence: 0.7, action: .media(.next)),
        GestureRule(gesture: .tap1, location: nil, minConfidence: 0.6, action: .keys(nil), enabled: false),
    ]

    init() {
        if let data = UserDefaults.standard.data(forKey: Self.key),
           let saved = try? JSONDecoder().decode([GestureRule].self, from: data),
           !Self.isOldDefault(saved) {
            rules = saved
        } else {
            rules = Self.defaults
        }
    }

    /// The first build's only default (1 tap → ⌘⇧.) clashed with OpenWhispr's hotkey.
    private static func isOldDefault(_ r: [GestureRule]) -> Bool {
        r.count == 1 && r[0].gesture == .tap1 && r[0].location == nil && r[0].action == .keys(.openWhispr)
    }

    private func save() {
        if let data = try? JSONEncoder().encode(rules) { UserDefaults.standard.set(data, forKey: Self.key) }
    }

    /// The most specific enabled rule wins: one for a location beats one for anywhere.
    func decide(kind: GestureKind, confidence: Double, location: TapLocation?, locationConfidence: Double) -> (GestureRule?, GestureOutcome) {
        let candidates = rules.filter { $0.enabled && $0.gesture == kind }
            .sorted { ($0.location != nil ? 0 : 1) < ($1.location != nil ? 0 : 1) }
        if candidates.isEmpty {
            return (nil, .noRule("You have no action for \(kind.label.lowercased()). Add one under Actions."))
        }
        var unsure: GestureOutcome?
        var placeOnly = true
        for rule in candidates {
            let pct = Int((rule.minConfidence * 100).rounded())
            if let where_ = rule.location {
                guard where_ == location else { continue }
                if confidence < rule.minConfidence {
                    unsure = unsure ?? .unsure("Gesture confidence \(Int(confidence * 100))% is under \(pct)%.")
                } else if locationConfidence < rule.minConfidence {
                    unsure = unsure ?? .unsure("Sure it was the \(where_.rawValue) only \(Int(locationConfidence * 100))%, under \(pct)%.")
                } else {
                    return (rule, .ran(rule.action.summary))
                }
            } else {
                placeOnly = false
                if confidence >= rule.minConfidence { return (rule, .ran(rule.action.summary)) }
                unsure = unsure ?? .unsure("Gesture confidence \(Int(confidence * 100))% is under \(pct)%. Grip shifts and soft brushes look like this.")
            }
        }
        if let unsure { return (nil, unsure) }
        let at = location.map { " at the \($0.rawValue)" } ?? ""
        return (nil, .noRule(placeOnly
            ? "Your \(kind.label.lowercased()) actions are for other spots. Nothing set for \(kind.label.lowercased())\(at)."
            : "No action matched."))
    }
}
