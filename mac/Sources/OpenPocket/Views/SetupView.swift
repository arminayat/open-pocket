import SwiftUI

struct SetupView: View {
    @EnvironmentObject private var model: AppModel
    @StateObject private var keyText = Box("")
    @StateObject private var keyError = Box<String?>(nil)

    private var done: [Bool] {
        [model.key != nil, model.ble.status == .connected, model.micInstalled, model.accessibility, model.settings.shortcut != nil]
    }
    private var current: Int { done.firstIndex(of: false) ?? 5 }

    var body: some View {
        Page(maxWidth: 860) {
            PageHeader(title: "Set up your Pocket",
                       subtitle: "Once per Mac. Your dictation app keeps its own setup: models, cleanup, dictionary.")

            VStack(alignment: .leading, spacing: 0) {
                step(0, "Your Pocket's key", detail: model.key.map { "In this Mac's Keychain (\(Keystore.masked($0)))." }) {
                    Text("A Pocket accepts one key. Paste the one from your other Mac (pocket key export) or from OpenPocket on iPhone.")
                    HStack(spacing: 10) {
                        SecureField("Key", text: $keyText.value)
                            .textFieldStyle(.plain).font(.system(size: 14))
                            .padding(.horizontal, 10).frame(width: 240, height: 36)
                            .background(RoundedRectangle(cornerRadius: 8).fill(Palette.field))
                            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Palette.controlBorder))
                        Button("Save key") {
                            keyError.value = model.importKey(keyText.value) ? nil : "That doesn't look like a Pocket key."
                            keyText.value = ""
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(keyText.value.isEmpty)
                    }
                    if let e = keyError.value { Text(e).foregroundStyle(Palette.warn) }
                }
                step(1, "Find and connect", detail: connectDetail) {
                    Text(connectDetail)
                }
                step(2, "Install Pocket Mic",
                     detail: "The virtual microphone your dictation app listens to. Installed\(PocketMicDriver.installedVersion.map { ", version \($0)" } ?? "").") {
                    Text("The virtual microphone your dictation app listens to. Installing asks for your password, and sound drops out for a second.")
                    Button(model.installing ? "Installing…" : "Install Pocket Mic") { model.installMic() }
                        .buttonStyle(PrimaryButtonStyle()).disabled(model.installing)
                    if let e = model.installError { Text(e).foregroundStyle(Palette.warn) }
                }
                step(3, "Allow Accessibility", detail: "Allowed. OpenPocket can press your dictation app's hotkey.") {
                    Text("OpenPocket presses your dictation app's hotkey for you, which macOS only allows with Accessibility. Turn on OpenPocket in the list that opens.")
                    Button("Open System Settings") { Hotkey.openAccessibilitySettings() }
                        .buttonStyle(PrimaryButtonStyle())
                }
                step(4, "Choose your dictation app",
                     detail: "OpenWhispr, Wispr Flow, Superwhisper or another app with a hotkey.") {
                    DictationAppSettings()
                }
            }

            Card(padding: 18) {
                HStack(spacing: 16) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("OPTIONAL").font(.system(size: 12, weight: .semibold)).tracking(0.6).foregroundStyle(Palette.muted)
                        Text("Recordings from your iPhone").font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.ink)
                        Text("Turn on iCloud sync to see OpenPocket's recordings, transcripts and notes here too.")
                            .font(.system(size: 13)).foregroundStyle(Palette.muted)
                    }
                    Spacer()
                    Text("Needs the signed build").font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.faint)
                }
            }
        }
    }

    private var connectDetail: String {
        switch model.ble.status {
        case .connected:
            return "\(model.ble.name ?? "Pocket") accepted the key\(model.ble.battery.map { " · \($0)%" } ?? "")\(model.ble.firmware.map { " · firmware \($0)" } ?? "")."
        case .keyRejected: return "The Pocket rejected this key. It's paired with a different one."
        case .noKey: return "Waiting for the key."
        default: return "\(model.ble.status.label). Keep the Pocket nearby and awake, and disconnect it from other devices."
        }
    }

    @ViewBuilder
    private func step<Content: View>(_ i: Int, _ title: String, detail: String?, @ViewBuilder content: () -> Content) -> some View {
        let isDone = done[i]
        let isCurrent = i == current
        let isLast = i == 4
        HStack(alignment: .top, spacing: 16) {
            VStack(spacing: 0) {
                ZStack {
                    if isDone {
                        Circle().fill(Palette.green)
                        Image(systemName: "checkmark").font(.system(size: 12, weight: .heavy)).foregroundStyle(.white)
                    } else if isCurrent {
                        Circle().fill(Palette.ink)
                        Text("\(i + 1)").font(.system(size: 13, weight: .bold)).foregroundStyle(Palette.background)
                    } else {
                        Circle().strokeBorder(Palette.faint, lineWidth: 1.5)
                        Text("\(i + 1)").font(.system(size: 13, weight: .bold)).foregroundStyle(Palette.muted)
                    }
                }
                .frame(width: 28, height: 28)
                if !isLast {
                    Rectangle().fill(isDone ? Palette.green : Palette.border).frame(width: 2).frame(minHeight: 16, maxHeight: .infinity)
                }
            }
            Group {
                if isCurrent {
                    Card(padding: 18) {
                        VStack(alignment: .leading, spacing: 10) {
                            Text(title).font(Typeface.serif(24)).foregroundStyle(Palette.ink)
                            content().font(.system(size: 14)).foregroundStyle(Palette.body).lineSpacing(3)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .padding(.bottom, isLast ? 0 : 22)
                } else {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(title).font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.ink)
                        if let detail { Text(detail).font(.system(size: 13)).foregroundStyle(isDone ? Palette.muted : Palette.body) }
                    }
                    .padding(.top, 4)
                    .padding(.bottom, isLast ? 0 : 18)
                    .opacity(isDone ? 1 : 0.5)
                }
            }
            Spacer(minLength: 0)
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Step \(i + 1), \(title), \(isDone ? "done" : isCurrent ? "current" : "upcoming")")
    }
}

/// Dictation app, hotkey and hotkey style. Used in Setup and Settings.
struct DictationAppSettings: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) { DictationAppMenu(); ShortcutRecorder(shortcut: shortcut) }
            Segmented(selection: style, options: HotkeyStyle.allCases.map { ($0, $0.label) })
            Text("Set the app's microphone to System default. OpenPocket swaps in Pocket Mic while you talk.")
                .font(.system(size: 13)).foregroundStyle(Palette.muted)
        }
    }

    private var shortcut: Binding<Shortcut?> {
        Binding(get: { model.settings.shortcut }, set: { model.settings.shortcut = $0 })
    }
    private var style: Binding<HotkeyStyle> {
        Binding(get: { model.settings.style }, set: { model.settings.style = $0 })
    }
}
