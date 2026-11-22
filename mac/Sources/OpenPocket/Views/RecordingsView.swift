import SwiftUI

/// The iPhone's library from iCloud, read only: recordings by day on the left, the selected one on the right.
struct RecordingsView: View {
    @EnvironmentObject private var model: AppModel
    var body: some View { RecordingsScreen(store: model.recordings) }
}

private struct RecordingsScreen: View {
    @ObservedObject var store: RecordingsStore

    var body: some View {
        Group {
            if store.status == .ready && !store.snapshot.recordings.isEmpty {
                HStack(spacing: 0) {
                    listColumn.frame(width: 340)
                    Rectangle().fill(Palette.border).frame(width: 1)
                    RecordingDetailView(recording: store.selected, player: store.player)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            } else {
                Page(maxWidth: 820) {
                    PageHeader(title: "Recordings", subtitle: subtitle)
                    message
                    if store.status == .ready { footnotes }
                }
            }
        }
        .background(Palette.background)
        .onAppear { store.open() }
    }

    private let subtitle = "The same library as Open Pocket on your iPhone: recordings, transcripts, summaries and notes."

    // MARK: List

    private var listColumn: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Recordings").font(Typeface.serif(44)).foregroundStyle(Palette.ink)
                Text("From Open Pocket on your iPhone, through iCloud.").font(.system(size: 14)).foregroundStyle(Palette.muted)
            }
            .padding(.horizontal, 24).padding(.top, 36).padding(.bottom, 16)
            Scrolling {
                VStack(alignment: .leading, spacing: 18) {
                    ForEach(store.snapshot.days, id: \.date) { day in
                        VStack(alignment: .leading, spacing: 6) {
                            SectionLabel(text: day.recordings[0].day
                                .formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).year()))
                            VStack(spacing: 2) { ForEach(day.recordings) { row($0) } }
                        }
                    }
                    footnotes.padding(.horizontal, 4)
                }
                .padding(.horizontal, 16).padding(.bottom, 24)
            }
        }
        .background(Palette.sidebar)
    }

    private func row(_ recording: LibraryRecording) -> some View {
        let selected = store.selection == recording.id
        return Button { store.select(recording.id) } label: {
            VStack(alignment: .leading, spacing: 3) {
                Text(recording.title).font(.system(size: 14, weight: .semibold)).foregroundStyle(Palette.ink)
                    .lineLimit(2).multilineTextAlignment(.leading)
                Text("\(recording.manifest.time) · \(recording.duration)")
                    .font(.system(size: 13)).foregroundStyle(Palette.muted).monospacedDigit()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12).padding(.vertical, 9)
            .background(RoundedRectangle(cornerRadius: 8).fill(selected ? Palette.selected : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    @ViewBuilder private var footnotes: some View {
        let s = store.snapshot
        if s.pending > 0 || s.unreadable > 0 {
            VStack(alignment: .leading, spacing: 4) {
                if s.pending > 0 { Text("Downloading \(s.pending) \(s.pending == 1 ? "file" : "files") from iCloud…") }
                if s.unreadable > 0 { Text("\(s.unreadable) \(s.unreadable == 1 ? "file isn't" : "files aren't") readable and \(s.unreadable == 1 ? "is" : "are") skipped.") }
            }
            .font(.system(size: 12)).foregroundStyle(Palette.muted)
        }
    }

    // MARK: Messages

    private var message: some View {
        let (icon, title, text) = copy
        return Card(padding: 24) {
            HStack(alignment: .top, spacing: 16) {
                Image(systemName: icon).font(.system(size: 26)).foregroundStyle(Palette.muted).frame(width: 32)
                VStack(alignment: .leading, spacing: 6) {
                    Text(title).font(Typeface.serif(24)).foregroundStyle(Palette.ink)
                    Text(text).font(.system(size: 14)).foregroundStyle(Palette.body).lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private var copy: (String, String, String) {
        switch store.status {
        case .notInThisBuild:
            return ("icloud.slash", "Recordings are in the TestFlight build",
                    "This download can't open Open Pocket's iCloud folder. Install Open Pocket for Mac from TestFlight to see your iPhone recordings here, or open them in Finder under iCloud Drive › Open Pocket.")
        case .signedOut:
            return ("person.crop.circle.badge.exclamationmark", "Sign in to iCloud",
                    "In System Settings, sign in with the same Apple Account as your iPhone and turn on iCloud Drive. Your recordings show up here after that.")
        case .unavailable:
            return ("icloud.slash", "iCloud Drive isn't available",
                    "In System Settings, open your Apple Account, then iCloud, and turn on iCloud Drive. If it's already on, check that Open Pocket may use it.")
        case .idle, .looking:
            return ("icloud", "Looking for recordings…", "Checking iCloud Drive › Open Pocket.")
        case .ready:
            return ("tray", "No recordings yet",
                    "In Open Pocket on your iPhone, turn on iCloud sync in Settings. Recordings show up here once your iPhone uploads them; Apple decides when that happens.")
        }
    }
}

/// A scroll view, or a plain clipped stack in offscreen snapshot renders, which can't draw scroll views.
struct Scrolling<Content: View>: View {
    @ViewBuilder var content: Content
    @Environment(\.isSnapshot) private var isSnapshot

    var body: some View {
        if isSnapshot {
            VStack(spacing: 0) { content }.frame(maxHeight: .infinity, alignment: .top).clipped()
        } else {
            ScrollView { content }.scrollContentBackground(.hidden)
        }
    }
}
