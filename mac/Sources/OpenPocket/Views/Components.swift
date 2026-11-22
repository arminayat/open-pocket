import AppKit
import SwiftUI

/// Front view of the Pocket: a credit-card slab (54 × 86 mm) with LED, side button and engraved
/// wordmark. Same drawing and finishes as Open Pocket on iPhone (PocketDevice).
struct PocketDeviceView: View {
    var finish: Finish
    var connected: Bool

    private var palette: (light: Color, mid: Color, dark: Color, edge: Color) {
        switch finish {
        case .grey: return (Color(nsColor: NSColor(hex: 0x6A6D73)), Color(nsColor: NSColor(hex: 0x4F5257)), Color(nsColor: NSColor(hex: 0x3C3E42)), Color(nsColor: NSColor(hex: 0x2F3134)))
        case .blue: return (Color(nsColor: NSColor(hex: 0xA9C8EA)), Color(nsColor: NSColor(hex: 0x86AAD6)), Color(nsColor: NSColor(hex: 0x6688B5)), Color(nsColor: NSColor(hex: 0x56769F)))
        case .pink: return (Color(nsColor: NSColor(hex: 0xE6BCCB)), Color(nsColor: NSColor(hex: 0xCF9FB1)), Color(nsColor: NSColor(hex: 0xB08292)), Color(nsColor: NSColor(hex: 0x9A6F7F)))
        }
    }

    var body: some View {
        GeometryReader { g in
            let s = g.size.width / 55
            let p = palette
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 0.8 * s).fill(p.dark)
                    .frame(width: 1.6 * s, height: 9 * s)
                    .offset(x: 53.4 * s, y: 13 * s)
                RoundedRectangle(cornerRadius: 4.5 * s)
                    .fill(LinearGradient(colors: [p.light, p.mid, p.dark], startPoint: .topLeading, endPoint: .bottomTrailing))
                    .overlay(RoundedRectangle(cornerRadius: 4.5 * s).strokeBorder(p.edge, lineWidth: s))
                    .overlay(RoundedRectangle(cornerRadius: 3.6 * s).strokeBorder(.white.opacity(0.1), lineWidth: 0.6 * s).padding(1.1 * s))
                    .frame(width: 53 * s, height: 85 * s)
                    .offset(x: 0.5 * s, y: 0.5 * s)
                Circle()
                    .fill(connected ? Color(nsColor: NSColor(hex: 0x4ADE80)) : Color(nsColor: NSColor(hex: 0x26272A)))
                    .frame(width: 2.4 * s, height: 2.4 * s)
                    .offset(x: 7.6 * s, y: 7.6 * s)
                // Engraving: reads bottom to top along the right side.
                Text("Pocket")
                    .font(.custom("Georgia", size: 24 * s))
                    .foregroundStyle(.black.opacity(0.16))
                    .fixedSize()
                    .frame(width: 80 * s, height: 30 * s, alignment: .leading)
                    .rotationEffect(.degrees(-90))
                    .position(x: 39 * s, y: 46 * s)
            }
        }
        .aspectRatio(55.0 / 86.0, contentMode: .fit)
        .accessibilityLabel("Pocket recorder")
    }
}

struct LevelBars: View {
    var levels: [Float]
    var body: some View {
        HStack(alignment: .center, spacing: 6) {
            ForEach(Array(levels.enumerated()), id: \.offset) { _, v in
                let quiet = v < 0.08
                RoundedRectangle(cornerRadius: 3)
                    .fill(quiet ? Palette.barIdle : Palette.orange)
                    .frame(width: 6, height: max(6, CGFloat(v) * 52))
            }
        }
        .frame(height: 56)
        .animation(.linear(duration: 0.08), value: levels)
        .accessibilityLabel("Input level")
    }
}

/// Click, then press the dictation app's hotkey. Esc cancels.
struct ShortcutRecorder: View {
    @Binding var shortcut: Shortcut?
    @StateObject private var recording = Box(false)
    @StateObject private var monitor = Box<Any?>(nil)

    var body: some View {
        Button { recording.value ? stop() : start() } label: {
            Text(recording.value ? "Press keys…" : (shortcut?.display ?? "Set hotkey"))
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(recording.value ? Palette.link : Palette.ink)
                .frame(width: 110, height: 36)
                .background(RoundedRectangle(cornerRadius: 8).fill(Palette.field))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(recording.value ? Palette.link : Palette.controlBorder))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Dictation hotkey, \(shortcut?.display ?? "not set")")
        .onDisappear(perform: stop)
    }

    private func start() {
        recording.value = true
        monitor.value = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            if event.keyCode == 53 { stop(); return nil }
            if let s = Shortcut(event: event) { shortcut = s; stop(); return nil }
            return event
        }
    }

    private func stop() {
        recording.value = false
        if let m = monitor.value { NSEvent.removeMonitor(m) }
        monitor.value = nil
    }
}

/// A select box listing dictation apps.
struct DictationAppMenu: View {
    @EnvironmentObject private var model: AppModel
    var body: some View {
        Menu {
            ForEach(DictationApp.all) { app in
                Button(app.name) { model.settings.choose(app: app) }
            }
        } label: {
            HStack {
                Text(model.settings.app.name).font(.system(size: 14, weight: .medium)).foregroundStyle(Palette.ink)
                Spacer()
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.muted)
            }
            .padding(.horizontal, 10)
            .frame(width: 190, height: 36)
            .background(RoundedRectangle(cornerRadius: 8).fill(Palette.background))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Palette.controlBorder))
            .contentShape(Rectangle())
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .accessibilityLabel("Dictation app, \(model.settings.app.name)")
    }
}

struct Notice: View {
    var text: String
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Palette.warn)
            Text(text).font(.system(size: 14)).foregroundStyle(Palette.ink).fixedSize(horizontal: false, vertical: true)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(Palette.warnBg))
    }
}

struct PageHeader: View {
    var title: String
    var subtitle: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(Typeface.serif(44)).foregroundStyle(Palette.ink)
            if let subtitle {
                Text(subtitle).font(.system(size: 15)).foregroundStyle(Palette.muted).lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

private struct SnapshotKey: EnvironmentKey { static let defaultValue = false }
extension EnvironmentValues {
    /// Offscreen renders can't draw scroll views, so pages lay out flat.
    var isSnapshot: Bool {
        get { self[SnapshotKey.self] }
        set { self[SnapshotKey.self] = newValue }
    }
}

/// The scrolling page every screen sits in.
struct Page<Content: View>: View {
    var maxWidth: CGFloat = 1000
    @ViewBuilder var content: Content
    @Environment(\.isSnapshot) private var isSnapshot

    private var column: some View {
        VStack(alignment: .leading, spacing: 24) { content }
            .padding(.horizontal, 40).padding(.top, 36).padding(.bottom, 40)
            .frame(maxWidth: maxWidth, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    var body: some View {
        if isSnapshot {
            column.frame(maxHeight: .infinity, alignment: .top).background(Palette.background)
        } else {
            ScrollView { column }
                .scrollContentBackground(.hidden)
                .background(Palette.background)
        }
    }
}
