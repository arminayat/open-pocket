import AppKit
import Foundation
import ServiceManagement

struct DictationApp: Identifiable, Hashable {
    let id: String
    let name: String
    let shortcut: Shortcut?
    let style: HotkeyStyle

    static let all: [DictationApp] = [
        DictationApp(id: "openwhispr", name: "OpenWhispr", shortcut: .openWhispr, style: .toggle),
        DictationApp(id: "wisprflow", name: "Wispr Flow", shortcut: nil, style: .hold),
        DictationApp(id: "superwhisper", name: "Superwhisper", shortcut: nil, style: .toggle),
        DictationApp(id: "other", name: "Other app", shortcut: nil, style: .toggle),
    ]

    static func find(_ id: String) -> DictationApp { all.first { $0.id == id } ?? all[0] }

    static func == (a: DictationApp, b: DictationApp) -> Bool { a.id == b.id }
    func hash(into h: inout Hasher) { h.combine(id) }
}

final class SettingsStore: ObservableObject {
    private let defaults = UserDefaults.standard

    @Published var appID: String { didSet { defaults.set(appID, forKey: "dictationApp") } }
    @Published var shortcut: Shortcut? { didSet { saveShortcut() } }
    @Published var style: HotkeyStyle { didSet { defaults.set(style.rawValue, forKey: "hotkeyStyle") } }
    @Published var reduceBoom: Bool { didSet { defaults.set(reduceBoom, forKey: "reduceBoom") } }
    @Published var paused: Bool { didSet { defaults.set(paused, forKey: "paused") } }
    @Published var showInDock: Bool { didSet { defaults.set(showInDock, forKey: "showInDock"); applyDockPolicy() } }
    @Published private(set) var openAtLogin: Bool = SMAppService.mainApp.status == .enabled
    @Published var loginError: String?

    var app: DictationApp { DictationApp.find(appID) }

    init() {
        let d = UserDefaults.standard
        appID = d.string(forKey: "dictationApp") ?? "openwhispr"
        style = HotkeyStyle(rawValue: d.string(forKey: "hotkeyStyle") ?? "") ?? .toggle
        reduceBoom = d.object(forKey: "reduceBoom") as? Bool ?? true
        paused = d.bool(forKey: "paused")
        showInDock = d.object(forKey: "showInDock") as? Bool ?? true
        if let data = d.data(forKey: "shortcut"), let s = try? JSONDecoder().decode(Shortcut.self, from: data) {
            shortcut = s
        } else {
            shortcut = .openWhispr
        }
    }

    func choose(app: DictationApp) {
        appID = app.id
        if let s = app.shortcut { shortcut = s }
        style = app.style
    }

    private func saveShortcut() {
        if let shortcut, let data = try? JSONEncoder().encode(shortcut) {
            defaults.set(data, forKey: "shortcut")
        } else {
            defaults.removeObject(forKey: "shortcut")
        }
    }

    func applyDockPolicy() {
        NSApp.setActivationPolicy(showInDock ? .regular : .accessory)
    }

    func setOpenAtLogin(_ on: Bool) {
        do {
            if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
            loginError = nil
        } catch {
            loginError = error.localizedDescription
        }
        openAtLogin = SMAppService.mainApp.status == .enabled
    }
}
