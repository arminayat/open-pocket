import AppKit
import ApplicationServices
import CoreGraphics

struct Shortcut: Codable, Equatable {
    var keyCode: UInt16
    var modifiers: UInt64   // CGEventFlags raw value
    var display: String

    static let openWhispr = Shortcut(
        keyCode: 47,
        modifiers: CGEventFlags([.maskCommand, .maskShift]).rawValue,
        display: "⌘⇧.")

    /// From a key press captured in the shortcut recorder.
    init?(event: NSEvent) {
        let flags = event.modifierFlags.intersection([.command, .shift, .option, .control])
        guard !flags.isEmpty || event.keyCode >= 96 /* F-keys */ else { return nil }
        var cg = CGEventFlags()
        var text = ""
        if flags.contains(.control) { cg.insert(.maskControl); text += "⌃" }
        if flags.contains(.option) { cg.insert(.maskAlternate); text += "⌥" }
        if flags.contains(.shift) { cg.insert(.maskShift); text += "⇧" }
        if flags.contains(.command) { cg.insert(.maskCommand); text += "⌘" }
        let key = Shortcut.keyNames[event.keyCode]
            ?? (event.charactersIgnoringModifiers ?? "?").uppercased()
        self.init(keyCode: event.keyCode, modifiers: cg.rawValue, display: text + key)
    }

    init(keyCode: UInt16, modifiers: UInt64, display: String) {
        self.keyCode = keyCode
        self.modifiers = modifiers
        self.display = display
    }

    private static let keyNames: [UInt16: String] = [
        49: "Space", 36: "↩", 48: "⇥", 53: "⎋", 51: "⌫",
        122: "F1", 120: "F2", 99: "F3", 118: "F4", 96: "F5", 97: "F6",
        98: "F7", 100: "F8", 101: "F9", 109: "F10", 103: "F11", 111: "F12",
    ]
}

enum HotkeyStyle: String, Codable, CaseIterable, Identifiable {
    case toggle, hold
    var id: String { rawValue }
    var label: String { self == .toggle ? "Press to start and stop" : "Hold while talking" }
}

/// Presses the dictation app's hotkey. Needs Accessibility permission.
enum Hotkey {
    static func isTrusted(prompt: Bool = false) -> Bool {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        return AXIsProcessTrustedWithOptions([key: prompt] as CFDictionary)
    }

    static func openAccessibilitySettings() {
        _ = isTrusted(prompt: true)
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(url)
        }
    }

    private static func post(_ s: Shortcut, down: Bool) {
        let source = CGEventSource(stateID: .hidSystemState)
        guard let event = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(s.keyCode), keyDown: down) else { return }
        event.flags = CGEventFlags(rawValue: s.modifiers)
        event.post(tap: .cghidEventTap)
    }

    static func begin(_ s: Shortcut, style: HotkeyStyle) {
        post(s, down: true)
        if style == .toggle { post(s, down: false) }
    }

    static func end(_ s: Shortcut, style: HotkeyStyle) {
        if style == .toggle { post(s, down: true) }
        post(s, down: false)
    }
}
