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
            if pane == .gestureCalibration {
                model.gestures.calibration.applyPreview(results: listening)
                model.dictation.applyPreview(listening: false)
            } else {
                model.dictation.applyPreview(listening: listening)
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
}
