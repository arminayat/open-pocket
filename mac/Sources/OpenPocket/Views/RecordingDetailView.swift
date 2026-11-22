import SwiftUI

/// One recording: title, audio, then its summary, transcript and notes as the iPhone last saved them.
struct RecordingDetailView: View {
    var recording: LibraryRecording?
    @ObservedObject var player: RecordingPlayer

    var body: some View {
        Scrolling {
            if let recording {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(recording.title).font(Typeface.serif(36)).foregroundStyle(Palette.ink)
                            .fixedSize(horizontal: false, vertical: true)
                        Text([recording.day.formatted(.dateTime.weekday(.wide).day().month(.wide).year()),
                              recording.manifest.time, recording.duration].joined(separator: " · "))
                            .font(.system(size: 15)).foregroundStyle(Palette.muted)
                    }
                    PlayerCard(player: player, bytes: recording.manifest.bytes)
                    if let summary = recording.summary {
                        section("Summary", summary.text, footnote: "AI summary\(summary.model.map { " · \($0)" } ?? "")")
                    }
                    if let transcript = recording.transcript {
                        section("Transcript", transcript.text, footnote: transcript.provider.map { "Transcribed with \(Self.providerNames[$0] ?? $0)" })
                    }
                    if let note = recording.note, !note.text.isEmpty {
                        section("Notes", note.text, footnote: nil)
                    }
                    Text(recording.summary == nil && recording.transcript == nil && (recording.note?.text ?? "").isEmpty
                         ? "No summary, transcript or notes yet. Add them in Open Pocket on your iPhone; they show up here after it syncs."
                         : "Read only. Change transcripts and notes in Open Pocket on your iPhone.")
                        .font(.system(size: 12)).foregroundStyle(Palette.muted).padding(.horizontal, 4)
                }
                .padding(.horizontal, 40).padding(.top, 44).padding(.bottom, 40)
                .frame(maxWidth: 820, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .background(Palette.background)
    }

    private static let providerNames = ["openai": "OpenAI", "deepgram": "Deepgram", "assemblyai": "AssemblyAI",
                                        "elevenlabs": "ElevenLabs", "groq": "Groq"]

    private func section(_ title: String, _ text: String, footnote: String?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: title)
            Card(padding: 18) {
                Text(text).font(.system(size: 14)).foregroundStyle(Palette.ink).lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            }
            if let footnote {
                Text(footnote).font(.system(size: 12)).foregroundStyle(Palette.muted).padding(.horizontal, 4)
            }
        }
    }
}

private struct PlayerCard: View {
    @ObservedObject var player: RecordingPlayer
    var bytes: Int

    var body: some View {
        Card(padding: 16) {
            HStack(spacing: 14) {
                Button(action: player.toggle) {
                    ZStack {
                        Circle().fill(enabled ? Palette.ink : Palette.selected).frame(width: 44, height: 44)
                        Image(systemName: icon).font(.system(size: 16, weight: .semibold)).foregroundStyle(Palette.background)
                    }
                    .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .disabled(!enabled)
                .accessibilityLabel(label)
                VStack(alignment: .leading, spacing: 8) {
                    Track(fraction: player.duration > 0 ? player.position / player.duration : 0, seekable: seekable,
                          seek: player.seek(to:))
                    HStack {
                        Text(clock(player.position)).monospacedDigit()
                        Spacer()
                        Text(status).foregroundStyle(failed ? Palette.warn : Palette.muted).monospacedDigit().lineLimit(2)
                            .multilineTextAlignment(.trailing)
                    }
                    .font(.system(size: 12)).foregroundStyle(Palette.muted)
                }
            }
        }
    }

    private var enabled: Bool {
        switch player.state {
        case .ready, .playing, .inCloud, .failed: return true
        case .missing, .downloading, .checking: return false
        }
    }

    private var seekable: Bool { player.state == .ready || player.state == .playing }
    private var failed: Bool { if case .failed = player.state { return true } else { return false } }

    private var icon: String {
        switch player.state {
        case .playing: return "pause.fill"
        case .inCloud, .failed: return "icloud.and.arrow.down"
        case .downloading, .checking: return "ellipsis"
        case .ready, .missing: return "play.fill"
        }
    }

    private var label: String {
        switch player.state {
        case .playing: return "Pause"
        case .inCloud, .failed: return "Download and play"
        default: return "Play"
        }
    }

    private var status: String {
        switch player.state {
        case .missing: return "The audio isn't in iCloud yet."
        case .inCloud: return "In iCloud · \(ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)) · downloads when you press play"
        case .downloading(let percent): return "Downloading from iCloud…\(percent.map { " \($0)%" } ?? "")"
        case .checking: return "Checking the audio…"
        case .ready, .playing: return clock(player.duration)
        case .failed(let message): return message
        }
    }

    private func clock(_ t: TimeInterval) -> String {
        let s = max(0, Int(t.rounded(.down)))
        return s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60) : String(format: "%d:%02d", s / 60, s % 60)
    }
}

/// The playback bar; click or drag to seek.
private struct Track: View {
    var fraction: Double
    var seekable: Bool
    var seek: (Double) -> Void

    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Palette.segment)
                Capsule().fill(Palette.orange).frame(width: max(6, g.size.width * min(1, max(0, fraction))))
            }
            .frame(height: 6)
            .frame(maxHeight: .infinity)
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { value in
                if seekable && g.size.width > 0 { seek(value.location.x / g.size.width) }
            })
        }
        .frame(height: 16)
        .accessibilityElement()
        .accessibilityLabel("Playback position")
        .accessibilityValue("\(Int(fraction * 100)) percent")
    }
}
