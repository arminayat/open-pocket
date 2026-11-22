import AppKit
import SwiftUI

/// `OpenPocket --snapshot <dir>`: renders each screen offscreen to PNG with sample
/// device state, for comparing against the design without screen-recording access.
enum Snapshots {
    @MainActor static func render(model: AppModel, to dir: URL) {
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        NSApp.appearance = NSAppearance(named: .aqua)
        model.ble.applyPreview(name: "PKT01_BLUE_2617502a", battery: 72, firmware: "1.8", mode: .normal)
        let shots: [(String, Pane, Bool, Bool)] = [
            ("1-dictate", .dictate, false, true),
            ("2-listening", .dictate, true, true),
            ("3-setup", .setup, false, false),
            ("4-settings", .settings, false, true),
            ("5-recordings", .recordings, false, true),
            ("6-gestures", .gestures, false, true),
            ("7-gesture-actions", .gestureActions, false, true),
            ("8-calibration-taps", .gestureCalibration, false, true),
            ("9-calibration-results", .gestureCalibration, true, true),
            ("10-recordings-signed-out", .recordings, true, true),
        ]
        model.gestures.applyPreview()
        model.rules.rules = [
            GestureRule(gesture: .tap1, location: nil, minConfidence: 0.6, action: .keys(.openWhispr)),
            GestureRule(gesture: .tap2, location: .top, minConfidence: 0.7, action: .media(.playPause)),
            GestureRule(gesture: .tap3, location: nil, minConfidence: 0.6, action: .runShortcut(name: "Focus")),
            GestureRule(gesture: .swipe, location: nil, minConfidence: 0.6, action: .keys(nil), enabled: false),
        ]
        for (name, pane, listening, setupDone) in shots {
            model.applyPreview(key: "RRABCDEFGHIJKLFE", accessibility: setupDone, micInstalled: true)
            model.pane = pane
            if pane == .recordings {
                model.recordings.applyPreview(status: listening ? .signedOut : .ready,
                                              snapshot: listening ? LibrarySnapshot() : sampleLibrary)
            }
            if pane == .gestureCalibration {
                model.gestures.calibration.applyPreview(results: listening)
                model.dictation.applyPreview(listening: false)
            } else {
                model.dictation.applyPreview(listening: listening && pane != .recordings)
            }
            let view = ShellView()
                .environmentObject(model)
                .frame(width: 1280, height: pane == .settings ? 1180 : pane == .gestures ? 940 : 820)
                .environment(\.colorScheme, .light)
                .environment(\.isSnapshot, true)
            let renderer = ImageRenderer(content: view)
            renderer.scale = 1
            guard let image = renderer.nsImage, let tiff = image.tiffRepresentation,
                  let rep = NSBitmapImageRep(data: tiff),
                  let png = rep.representation(using: .png, properties: [:]) else { continue }
            try? png.write(to: dir.appendingPathComponent("\(name).png"))
            print("wrote \(name).png")
        }
    }

    /// Three made-up recordings over two days: AI title, folder title, and neither.
    private static var sampleLibrary: LibrarySnapshot {
        func manifest(_ date: String, _ time: String, _ minutes: Double, _ n: Int) -> RecordingArchive.Manifest {
            let ts = date.replacingOccurrences(of: "-", with: "") + time
            return .init(id: "\(date)/\(ts)", date: date, timestamp: ts, durationSeconds: minutes * 60 + 7,
                         bytes: Int(minutes * 480_000), sha256: String(repeating: "\(n)", count: 64))
        }
        let at = "2026-11-21T15:02:11.000Z"
        return LibrarySnapshot(recordings: [
            LibraryRecording(
                manifest: manifest("2026-11-21", "140500", 23, 1),
                summary: .init(kind: .summary, text: "Agreed to ship the Mac beta with Recordings read from iCloud. The list groups recordings by day; the detail shows the summary, transcript and notes, with audio that downloads when you press play.", updatedAt: at, title: "Mac beta review", provider: "openai", model: "gpt-5-mini"),
                transcript: .init(kind: .transcript, text: "Okay, let's go through the Mac beta. Recordings now come straight from the iPhone's iCloud folder, so there's nothing to set up on the Mac besides signing in to iCloud with the same account…", updatedAt: at, provider: "openai", model: "whisper-1"),
                note: .init(kind: .note, text: "Follow up: TestFlight notes for the next build.", updatedAt: at, revision: "8a6f0c2e-3b1d-4c5e-9f7a-2d4b6c8e0f1a"),
                audioPath: "2026-11-21/14.05 – Mac beta review/audio.mp3"),
            LibraryRecording(manifest: manifest("2026-11-21", "093000", 4, 2), folderTitle: "Standup",
                             audioPath: "2026-11-21/09.30 – Standup/audio.mp3"),
            LibraryRecording(manifest: manifest("2026-11-20", "181200", 1, 3), audioPath: "2026-11-20/18.12/audio.mp3"),
        ], pending: 2)
    }
}
