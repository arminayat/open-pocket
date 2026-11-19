import SwiftUI

enum Pane: Hashable { case setup, dictate, recordings, gestures, gestureActions, gestureCalibration, settings }

struct RootView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        ShellView()
            .ignoresSafeArea()
            .onAppear {
                model.openMainWindow = { openWindow(id: "main") }
                if !model.setupComplete { model.pane = .setup }
            }
            .onChange(of: model.setupComplete) { _, done in
                if done && model.pane == .setup { model.pane = .dictate }
            }
    }
}

struct ShellView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        HStack(spacing: 0) {
            Sidebar().frame(width: 232)
            Rectangle().fill(Palette.border).frame(width: 1)
            Group {
                switch model.pane {
                case .setup: SetupView()
                case .dictate: DictateView()
                case .recordings: RecordingsView()
                case .gestures: GesturesView()
                case .gestureActions: GestureActionsView()
                case .gestureCalibration: GestureCalibrationView()
                case .settings: SettingsView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Palette.background)
    }
}

struct Sidebar: View {
    @EnvironmentObject private var model: AppModel

    private var listening: Bool { model.dictation.phase != .idle }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Logo().padding(.horizontal, 10).padding(.top, 46).padding(.bottom, 18)
            if !model.setupComplete {
                item(.setup, "Set up", "checklist", badge: model.setupStepsLeft)
            }
            item(.dictate, "Dictate", "mic")
            item(.recordings, "Recordings", "waveform.path")
            item(.gestures, "Gestures", "hand.tap", also: [.gestureActions, .gestureCalibration])
            item(.settings, "Settings", "gearshape")
            Spacer()
            HStack(spacing: 8) {
                Circle()
                    .fill(listening ? Palette.orange : model.ble.status == .connected ? Palette.green : Palette.faint)
                    .frame(width: 8, height: 8)
                Text(listening ? "Listening" : footer)
                    .font(.system(size: 12, weight: listening ? .semibold : .regular))
                    .foregroundStyle(listening ? Palette.orangeText : Palette.muted)
                    .lineLimit(1)
            }
            .padding(.horizontal, 10)
        }
        .padding(.horizontal, 12).padding(.bottom, 18)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Palette.sidebar)
    }

    private var footer: String {
        guard model.ble.status == .connected else { return model.ble.status.label }
        let name = (model.ble.name ?? "Pocket").replacingOccurrences(of: #"_[0-9a-fA-F]{6,}$"#, with: "", options: .regularExpression)
        return [name, model.ble.battery.map { "\($0)%" }].compactMap { $0 }.joined(separator: " · ")
    }

    private func item(_ pane: Pane, _ title: String, _ icon: String, badge: Int = 0, also: [Pane] = []) -> some View {
        let selected = model.pane == pane || also.contains(model.pane)
        return Button { model.pane = pane } label: {
            HStack(spacing: 10) {
                Image(systemName: icon).font(.system(size: 15, weight: .regular)).frame(width: 18)
                Text(title).font(.system(size: 14, weight: selected ? .semibold : .regular))
                Spacer()
                if badge > 0 {
                    Text("\(badge)").font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                        .padding(.horizontal, 7).padding(.vertical, 2)
                        .background(Capsule().fill(Palette.warn))
                }
            }
            .foregroundStyle(Palette.ink)
            .padding(.horizontal, 10).padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: 8).fill(selected ? Palette.selected : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

struct RecordingsView: View {
    var body: some View {
        Page(maxWidth: 820) {
            PageHeader(title: "Recordings",
                       subtitle: "The same library as OpenPocket on your iPhone: recordings, transcripts, summaries and notes.")
            Card(padding: 24) {
                HStack(alignment: .top, spacing: 16) {
                    Image(systemName: "icloud").font(.system(size: 26)).foregroundStyle(Palette.muted)
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Coming with the signed build").font(Typeface.serif(24)).foregroundStyle(Palette.ink)
                        Text("Your library syncs through iCloud Drive › OpenPocket. Reading it needs this app signed by the OpenPocket team, which isn't set up on this Mac yet.")
                            .font(.system(size: 14)).foregroundStyle(Palette.body).lineSpacing(3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }
}
