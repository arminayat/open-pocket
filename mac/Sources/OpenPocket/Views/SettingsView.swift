import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        Page(maxWidth: 820) {
            PageHeader(title: "Settings")

            RowGroup(title: "Recorder") {
                HStack(alignment: .top, spacing: 14) {
                    PocketDeviceView(finish: Finish(deviceName: model.ble.name), connected: model.ble.status == .connected)
                        .frame(width: 56)
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Chip(text: model.ble.status.label, tone: model.ble.status == .connected ? .green : .grey)
                            Spacer()
                            Button("Reconnect") { model.ble.reconnect(with: model.key) }
                                .buttonStyle(SecondaryButtonStyle(compact: true))
                        }
                        Text(model.ble.name ?? "Pocket").font(.system(size: 16, weight: .semibold)).foregroundStyle(Palette.ink)
                        Text([model.ble.battery.map { "\($0)%" }, model.ble.firmware.map { "firmware \($0)" },
                              model.key.map { "key \(Keystore.masked($0))" }].compactMap { $0 }.joined(separator: " · "))
                            .font(.system(size: 13)).foregroundStyle(Palette.muted)
                    }
                }
                .padding(14)
            }

            RowGroup(title: "Dictation") {
                Row(title: "Dictation app", detail: "Transcribes your voice. OpenPocket only hands it the audio.") {
                    DictationAppMenu()
                }
                Row(title: "Its hotkey", detail: "Same as in \(model.settings.app.name). Click, then press the keys.") {
                    ShortcutRecorder(shortcut: Binding(get: { model.settings.shortcut }, set: { model.settings.shortcut = $0 }))
                }
                Row(title: "Hotkey style", detail: "Your Pocket presses stay the same either way.") {
                    Segmented(selection: Binding(get: { model.settings.style }, set: { model.settings.style = $0 }),
                              options: HotkeyStyle.allCases.map { ($0, $0.label) })
                }
                Row(title: "Its microphone", detail: "Set to System default. OpenPocket swaps in Pocket Mic while you talk.") {
                    Text("System default").font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.chipGreenText)
                }
                Row(title: "Reduce boominess", detail: "Cuts low rumble when the Pocket is close to your mouth.") {
                    Switch(isOn: Binding(get: { model.settings.reduceBoom }, set: { model.settings.reduceBoom = $0 }), label: "Reduce boominess")
                }
                Row(title: "Pause dictation", detail: "Side-button presses just record on the Pocket.", showDivider: false) {
                    Switch(isOn: Binding(get: { model.settings.paused }, set: { model.settings.paused = $0 }), label: "Pause dictation")
                }
            }

            RowGroup(title: "Recordings") {
                Row(title: "iCloud sync", detail: "Shared with OpenPocket on your iPhone. Needs the build signed by the OpenPocket team.", showDivider: false) {
                    Text("Not available yet").font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.faint)
                }
            }

            RowGroup(title: "General") {
                Row(title: "Open at login", detail: model.settings.loginError ?? "Starts in the menu bar with the window closed.") {
                    Switch(isOn: Binding(get: { model.settings.openAtLogin }, set: { model.settings.setOpenAtLogin($0) }), label: "Open at login")
                }
                Row(title: "Show in the Dock", detail: "The menu-bar icon always opens this window.") {
                    Switch(isOn: Binding(get: { model.settings.showInDock }, set: { model.settings.showInDock = $0 }), label: "Show in the Dock")
                }
                Row(title: "Pocket Mic", detail: model.micInstalled ? "Virtual microphone · \(PocketMicDriver.installedVersion ?? "") · installed" : "Virtual microphone · not installed") {
                    Button(model.micInstalled ? "Reinstall" : "Install") { model.installMic() }
                        .buttonStyle(SecondaryButtonStyle(compact: true)).disabled(model.installing)
                }
                Row(title: "Accessibility", detail: model.accessibility ? "Allowed. Needed to press the dictation app's hotkey." : "Needed to press the dictation app's hotkey.", showDivider: false) {
                    if model.accessibility {
                        Text("Allowed").font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.chipGreenText)
                    } else {
                        Button("Open System Settings") { Hotkey.openAccessibilitySettings() }
                            .buttonStyle(SecondaryButtonStyle(compact: true))
                    }
                }
            }

            Text("OpenPocket for Mac 0.1.0 · unofficial, not affiliated with the maker of Pocket")
                .font(.system(size: 12)).foregroundStyle(Palette.muted).padding(.horizontal, 4)
        }
    }
}
