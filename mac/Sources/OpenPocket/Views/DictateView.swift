import SwiftUI

struct DictateView: View {
    @EnvironmentObject private var model: AppModel
    @StateObject private var recentBox = Box<[DictationEntry]>([])

    private var listening: Bool { model.dictation.phase != .idle }
    private var appName: String { model.settings.app.name }

    var body: some View {
        Page {
            PageHeader(
                title: listening ? "Listening" : "Dictate",
                subtitle: listening
                    ? "\(appName) is recording from Pocket Mic. Your usual mic comes back when you finish."
                    : "Press the Pocket's side button, talk, press again. \(appName) types it where your cursor is.")

            if let notice = model.dictation.notice { Notice(text: notice) }

            if listening {
                livePanel
                liveCards
            } else {
                HStack(alignment: .top, spacing: 16) {
                    recorderCard.frame(minWidth: 340, maxHeight: .infinity, alignment: .top)
                    appCard.frame(minWidth: 280, maxHeight: .infinity, alignment: .top)
                }
                .fixedSize(horizontal: false, vertical: true)
                pressPanel
                recentSection
            }
        }
        .onAppear(perform: reload)
        .onChange(of: model.dictation.phase) { _, phase in
            if phase == .idle { DispatchQueue.main.asyncAfter(deadline: .now() + 4, execute: reload) }
        }
    }

    private func reload() {
        recentBox.value = History.recent(readOpenWhispr: model.settings.appID == "openwhispr")
    }

    // MARK: Ready

    private var recorderCard: some View {
        Card {
            HStack(alignment: .top, spacing: 16) {
                PocketDeviceView(finish: Finish(deviceName: model.ble.name), connected: model.ble.status == .connected)
                    .frame(width: 84)
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Chip(text: model.ble.status.label, tone: model.ble.status == .connected ? .green : .grey)
                        Spacer()
                        Menu {
                            Button("Reconnect") { model.ble.reconnect(with: model.key) }
                            Button("Settings") { model.pane = .settings }
                        } label: {
                            Image(systemName: "ellipsis").font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(Palette.muted).frame(width: 32, height: 28).contentShape(Rectangle())
                        }
                        .menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden).fixedSize()
                        .accessibilityLabel("Recorder actions")
                    }
                    Text(shortName).font(.system(size: 17, weight: .semibold)).foregroundStyle(Palette.ink)
                    Text(model.ble.mode == .call ? "Switch: Call (contact mic)" : "Switch: Normal (voice)")
                        .font(.system(size: 13)).foregroundStyle(model.ble.mode == .call ? Palette.warn : Palette.body)
                    Spacer(minLength: 0)
                    Text(deviceLine).font(.system(size: 13)).foregroundStyle(Palette.muted)
                }
                .frame(minHeight: 131, maxHeight: .infinity)
            }
        }
    }

    private var appCard: some View {
        Card(padding: 18) {
            VStack(alignment: .leading, spacing: 8) {
                Text("DICTATION APP").font(.system(size: 12, weight: .semibold)).tracking(0.6).foregroundStyle(Palette.muted)
                Text(appName).font(Typeface.serif(28)).foregroundStyle(Palette.ink)
                Text("\(model.settings.shortcut?.display ?? "No hotkey") · \(model.settings.style.label.lowercased())")
                    .font(.system(size: 13)).foregroundStyle(Palette.body)
                Text(model.micInstalled ? "Microphone: System default · Pocket Mic ready" : "Pocket Mic isn't installed")
                    .font(.system(size: 13)).foregroundStyle(model.micInstalled ? Palette.body : Palette.warn)
                Spacer(minLength: 0)
                Button("Change") { model.pane = .settings }
                    .buttonStyle(.plain).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.link)
            }
            .frame(maxHeight: .infinity, alignment: .top)
        }
        .frame(maxHeight: .infinity)
    }

    private var pressPanel: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(model.settings.paused ? "Dictation is paused" : "Press the side button to start")
                .font(Typeface.serif(28)).foregroundStyle(Palette.ink)
            Text(model.settings.paused
                 ? "Resume from the menu-bar icon or Settings. Until then, presses just record on the Pocket."
                 : "Hold the Pocket a few centimetres from your mouth and start talking right after the press.")
                .font(.system(size: 14)).foregroundStyle(Palette.body).lineSpacing(3)
        }
        .padding(.horizontal, 28).padding(.vertical, 24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16).fill(Palette.tintBg))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Palette.tintBorder))
    }

    private var recentSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: "Recent dictations")
            if recentBox.value.isEmpty {
                Card { Text("Nothing yet. Your Pocket dictations show up here.").font(.system(size: 14)).foregroundStyle(Palette.muted) }
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(recentBox.value.enumerated()), id: \.element.id) { i, entry in
                        HStack(alignment: .firstTextBaseline, spacing: 16) {
                            Text(entry.text ?? "Dictation").font(.system(size: 14))
                                .foregroundStyle(entry.text == nil ? Palette.muted : Palette.ink)
                                .lineLimit(2)
                            Spacer()
                            Text("\(entry.date.formatted(date: .omitted, time: .shortened)) · \(String(format: "%.1f s", entry.seconds))")
                                .font(.system(size: 13)).foregroundStyle(Palette.muted).monospacedDigit()
                        }
                        .padding(.horizontal, 16).padding(.vertical, 12)
                        if i < recentBox.value.count - 1 { Rectangle().fill(Palette.divider).frame(height: 1) }
                    }
                }
                .background(RoundedRectangle(cornerRadius: 14).fill(Palette.background))
                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Palette.border))
                Text(model.settings.appID == "openwhispr"
                     ? "From OpenWhispr's history. Other dictation apps show time and length only."
                     : "Time and length only. Text comes from OpenWhispr's history when you use OpenWhispr.")
                    .font(.system(size: 12)).foregroundStyle(Palette.muted).padding(.horizontal, 4)
            }
        }
    }

    // MARK: Listening

    private var livePanel: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack(spacing: 32) {
                HStack(spacing: 14) {
                    Circle().fill(Palette.orange).frame(width: 14, height: 14)
                        .background(Circle().fill(Palette.orangeRing).frame(width: 26, height: 26))
                    TimelineView(.periodic(from: .now, by: 0.5)) { context in
                        Text(elapsed(at: context.date)).font(Typeface.serif(56)).monospacedDigit().foregroundStyle(Palette.ink)
                    }
                }
                LevelBars(levels: Array(model.dictation.levels.suffix(30)))
            }
            HStack(alignment: .center, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(model.dictation.phase == .finishing ? "Sending to \(appName)…" : "Press the side button again to finish")
                        .font(Typeface.serif(26)).foregroundStyle(Palette.ink)
                    if let target = model.dictation.targetApp {
                        (Text("Text goes into ") + Text(target).fontWeight(.semibold) + Text(", the app in front."))
                            .font(.system(size: 14)).foregroundStyle(Palette.body)
                    }
                }
                Spacer()
                Button("Finish now") { model.dictation.finishNow() }
                    .buttonStyle(PrimaryButtonStyle(color: Palette.orange, foreground: .white))
                    .disabled(model.dictation.phase == .finishing)
            }
        }
        .padding(.horizontal, 32).padding(.vertical, 28)
        .background(RoundedRectangle(cornerRadius: 18).fill(Palette.listeningBg))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Palette.listeningBorder))
    }

    private var liveCards: some View {
        HStack(spacing: 12) {
            statusCard("Pocket", "Streaming", "Voice mic\(model.ble.battery.map { " · \($0)%" } ?? "")", accent: true)
            statusCard("Mac input", AudioDevices.pocketMicName, "Back to \(InputSwitch.restoreName) after", accent: false)
            statusCard("Dictation app", "\(appName) recording", "Started with \(model.settings.shortcut?.display ?? "its hotkey")", accent: true)
        }
    }

    private func statusCard(_ label: String, _ value: String, _ detail: String, accent: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased()).font(.system(size: 12, weight: .semibold)).tracking(0.6).foregroundStyle(Palette.muted)
            Text(value).font(.system(size: 15, weight: .semibold)).foregroundStyle(accent ? Palette.orangeText : Palette.ink)
            Text(detail).font(.system(size: 13)).foregroundStyle(Palette.muted).lineLimit(1)
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14).fill(Palette.background))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Palette.border))
    }

    // MARK: Helpers

    private var shortName: String {
        (model.ble.name ?? "Pocket").replacingOccurrences(of: #"_[0-9a-fA-F]{6,}$"#, with: "", options: .regularExpression)
    }

    private var deviceLine: String {
        [model.ble.battery.map { "\($0)%" }, model.ble.firmware.map { "firmware \($0)" }].compactMap { $0 }.joined(separator: " · ")
    }

    private func elapsed(at date: Date) -> String {
        let s = max(0, Int(date.timeIntervalSince(model.dictation.startedAt ?? date)))
        return String(format: "%d:%02d", s / 60, s % 60)
    }
}
