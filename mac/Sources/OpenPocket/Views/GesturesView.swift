import SwiftUI

/// The Pocket's back (where you tap): brushed aluminium, corner screws, the window,
/// printed name, and the side button + call/normal switch on the left edge.
struct PocketBackView: View {
    var highlight: TapLocation?
    var swipe = false
    /// Dashed ring: "tap here" (calibration).
    var ring: TapLocation? = nil

    static func zone(_ z: TapLocation) -> (Double, Double, Double, Double) {
        switch z {
        case .top: return (7, 4, 40, 18)
        case .bottom: return (7, 64, 40, 18)
        case .left: return (2, 19, 14, 48)
        case .right: return (38, 19, 14, 48)
        }
    }

    var body: some View {
        Canvas { ctx, size in
            let s = size.width / 59
            func r(_ x: Double, _ y: Double, _ w: Double, _ h: Double) -> CGRect {
                CGRect(x: (x + 2) * s, y: (y + 2) * s, width: w * s, height: h * s)
            }
            func c(_ hex: UInt32, _ o: Double = 1) -> Color { Color(nsColor: NSColor(hex: hex)).opacity(o) }
            let orange = c(0xC2410C)

            ctx.fill(Path(roundedRect: r(-1.1, 13, 1.6, 9), cornerRadius: 0.8 * s), with: .color(c(0x7D8FA8)))
            ctx.fill(Path(roundedRect: r(-0.9, 25, 1.4, 5), cornerRadius: 0.7 * s), with: .color(c(0x7D8FA8)))

            let body = Path(roundedRect: r(0.5, 0.5, 53, 85), cornerRadius: 2.5 * s)
            ctx.fill(body, with: .linearGradient(Gradient(colors: [c(0xB4C3D6), c(0x9EB0C7), c(0x8396B0)]),
                                                  startPoint: r(0.5, 0.5, 0, 0).origin, endPoint: r(53.5, 85.5, 0, 0).origin))
            ctx.stroke(body, with: .color(swipe ? orange : c(0x6F819A)), lineWidth: (swipe ? 1.6 : 0.8) * s)

            for (x, y) in [(3.4, 3.4), (50.6, 3.4), (3.4, 82.6), (50.6, 82.6)] {
                ctx.fill(Path(ellipseIn: r(x - 0.9, y - 0.9, 1.8, 1.8)), with: .color(c(0x6B7B91)))
            }
            let window = Path(roundedRect: r(14.5, 20.5, 25, 7), cornerRadius: 3.5 * s)
            ctx.fill(window, with: .color(c(0xC7D2DF)))
            ctx.stroke(window, with: .color(c(0x7D8FA8)), lineWidth: 0.4 * s)

            let ink = c(0x3C4655, 0.75)
            ctx.draw(Text("Pocket").font(.system(size: 5.5 * s, weight: .medium)).foregroundStyle(ink), at: r(27, 51, 0, 0).origin)
            ctx.stroke(Path(roundedRect: r(22.6, 55.6, 8.8, 3.6), cornerRadius: 0.8 * s), with: .color(ink), lineWidth: 0.3 * s)
            ctx.draw(Text("64GB").font(.system(size: 2.3 * s)).foregroundStyle(ink), at: r(27, 57.4, 0, 0).origin)
            for (x, y, w) in [(15.0, 62.0, 24.0), (17, 63.6, 20), (19, 65.2, 16)] {
                ctx.fill(Path(r(x, y, w, 0.5)), with: .color(c(0x3C4655, 0.25)))
            }
            ctx.draw(Text("CALL").font(.system(size: 1.6 * s)).foregroundStyle(ink), at: r(2.4, 26.3, 0, 0).origin, anchor: .leading)
            ctx.draw(Text("NORMAL").font(.system(size: 1.6 * s)).foregroundStyle(ink), at: r(2.4, 28.7, 0, 0).origin, anchor: .leading)

            if let zone = highlight {
                let z = Self.zone(zone)
                let e = r(z.0, z.1, z.2, z.3)
                ctx.fill(Path(ellipseIn: e), with: .color(orange.opacity(0.28)))
                ctx.stroke(Path(ellipseIn: e), with: .color(orange.opacity(0.7)), lineWidth: 0.8 * s)
            }
            if let zone = ring {
                let z = Self.zone(zone)
                let e = r(z.0, z.1, z.2, z.3)
                ctx.fill(Path(ellipseIn: e), with: .color(orange.opacity(0.2)))
                ctx.stroke(Path(ellipseIn: e), with: .color(orange.opacity(0.8)),
                           style: StrokeStyle(lineWidth: 0.9 * s, dash: [2 * s, 1.5 * s]))
            }
            if swipe {
                var line = Path()
                line.move(to: r(40, 14, 0, 0).origin)
                line.addLine(to: r(40, 72, 0, 0).origin)
                ctx.stroke(line, with: .color(orange), style: StrokeStyle(lineWidth: 1.6 * s, lineCap: .round, dash: [2 * s, 2 * s]))
            }
        }
        .aspectRatio(59.0 / 90.0, contentMode: .fit)
        .accessibilityLabel(swipe ? "Pocket back, swipe detected"
                            : highlight.map { "Pocket back, tap at the \($0.rawValue)" } ?? "Pocket back")
    }
}

struct GesturesView: View {
    @EnvironmentObject private var model: AppModel
    private var g: GestureController { model.gestures }

    var body: some View {
        Page {
            HStack(alignment: .bottom) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Gestures").font(Typeface.serif(44)).foregroundStyle(Palette.ink)
                    HStack(spacing: 4) {
                        Text("Tap or swipe the Pocket's back and watch what Open Pocket picks up.")
                            .font(.system(size: 15)).foregroundStyle(Palette.muted)
                        Button("Set up actions") { model.pane = .gestureActions }
                            .buttonStyle(.plain).font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.link)
                    }
                }
                Spacer()
                HStack(spacing: 10) {
                    Text("Gestures on").font(.system(size: 14, weight: .semibold)).foregroundStyle(Palette.ink)
                    Switch(isOn: Binding(get: { g.enabled }, set: { on in
                        g.setEnabled(on)
                        // Offer calibration the first time gestures are turned on.
                        if on && !UserDefaults.standard.bool(forKey: "calibrationOffered") {
                            UserDefaults.standard.set(true, forKey: "calibrationOffered")
                            model.pane = .gestureCalibration
                        }
                    }), label: "Gestures on")
                }
            }

            HStack(spacing: 14) {
                Chip(text: g.status.label, tone: g.status == .listening ? .green : g.status == .needsCallMode ? .orange : .grey)
                Text("Switch in **call mode**: the contact mic feels taps through the case.")
                    .font(.system(size: 13)).foregroundStyle(Palette.body)
                Text("The Pocket records to its storage while gestures are on.")
                    .font(.system(size: 13)).foregroundStyle(Palette.muted)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(RoundedRectangle(cornerRadius: 12).fill(Palette.sidebar))

            liveCard
            signalStrip

            HStack(alignment: .top, spacing: 16) {
                logSection.frame(minWidth: 400)
                calibrateCard.frame(width: 300)
            }
        }
    }

    // MARK: Live

    private var threshold: Double {
        guard let kind = g.last?.kind else { return 0.6 }
        return model.rules.rules.first { $0.enabled && $0.gesture == kind }?.minConfidence ?? 0.6
    }

    private var liveCard: some View {
        HStack(spacing: 0) {
            PocketBackView(highlight: g.last?.kind == .swipe ? nil : g.last?.location,
                           swipe: g.last?.kind == .swipe)
                .frame(width: 150, height: 229)
                .frame(width: 260)
                .frame(maxHeight: .infinity)
                .background(Palette.tintBg)
            Rectangle().fill(Palette.border).frame(width: 1)
            VStack(alignment: .leading, spacing: 14) {
                TimelineView(.periodic(from: .now, by: 1)) { ctx in
                    Text("LAST GESTURE · \(ago(ctx.date))").font(.system(size: 12, weight: .semibold)).tracking(0.6)
                        .foregroundStyle(Palette.muted)
                }
                Text(title).font(Typeface.serif(48)).foregroundStyle(Palette.ink)
                if let e = g.last {
                    VStack(alignment: .leading, spacing: 10) {
                        meter("Gesture", "\(Int(e.confidence * 100))% · \(e.kind.label.lowercased())", e.confidence)
                        if e.kind == .swipe {
                            meter("Location", "no location for swipes", 0)
                        } else {
                            meter("Location", e.location.map { "\(Int(e.locationConfidence * 100))% · \($0.rawValue)" } ?? "unknown", e.locationConfidence)
                        }
                        Text("Black mark: your \(Int(threshold * 100))% threshold · detected \(String(format: "%.2f", e.latency)) s after the gesture")
                            .font(.system(size: 12)).foregroundStyle(Palette.muted)
                    }
                    .frame(maxWidth: 440)
                    decision(e.outcome)
                } else {
                    Text(g.status == .listening ? "Tap the back of the Pocket once, twice or three times, or swipe."
                                                : "Turn gestures on with the switch in call mode.")
                        .font(.system(size: 14)).foregroundStyle(Palette.body)
                }
            }
            .padding(.horizontal, 28).padding(.vertical, 24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .fixedSize(horizontal: false, vertical: true)
        .background(RoundedRectangle(cornerRadius: 18).fill(Palette.background))
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Palette.border))
    }

    private var title: String {
        guard let e = g.last else { return "Waiting for a gesture" }
        if e.kind == .swipe { return "Swipe" }
        return e.kind.label + (e.location.map { " · \($0.rawValue)" } ?? "")
    }

    private func ago(_ now: Date) -> String {
        guard let d = g.last?.date else { return "none yet" }
        let s = Int(now.timeIntervalSince(d))
        return s < 2 ? "just now" : s < 60 ? "\(s) s ago" : "\(s / 60) min ago"
    }

    private func meter(_ label: String, _ value: String, _ v: Double) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.ink)
                Spacer()
                Text(value).font(.system(size: 13)).foregroundStyle(Palette.body)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Palette.segment)
                    Capsule().fill(v >= threshold ? Palette.green : Palette.warn).frame(width: geo.size.width * v)
                    Rectangle().fill(Palette.ink).frame(width: 2, height: 16).offset(x: geo.size.width * threshold - 1)
                }
            }
            .frame(height: 8)
        }
    }

    private func decision(_ o: GestureOutcome) -> some View {
        let (bg, fg): (Color, Color) = {
            switch o {
            case .ran: return (Palette.chipGreenBg, Palette.chipGreenText)
            case .unsure, .failed: return (Palette.warnBg, Palette.warn)
            default: return (Palette.chipGreyBg, Palette.body)
            }
        }()
        return (Text(o.headline).fontWeight(.bold) + Text("  ") + Text(o.text))
            .font(.system(size: 14)).foregroundStyle(fg)
            .padding(.horizontal, 14).padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 12).fill(bg))
    }

    private var signalStrip: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("CONTACT MIC · LAST 4 S").font(.system(size: 12, weight: .semibold)).tracking(0.6).foregroundStyle(Palette.muted)
                Spacer()
                Text(g.last?.detail ?? "").font(.system(size: 12)).foregroundStyle(Palette.muted)
            }
            HStack(alignment: .center, spacing: 2) {
                ForEach(Array(g.levels.enumerated()), id: \.offset) { _, v in
                    RoundedRectangle(cornerRadius: 2)
                        .fill(v > 0.74 ? Palette.orange : Color.dyn(0xD9D9DE, 0x48484D))
                        .frame(maxWidth: .infinity).frame(height: max(4, CGFloat(v) * 64))
                }
            }
            .frame(height: 64)
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
        .background(RoundedRectangle(cornerRadius: 14).fill(Palette.background))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Palette.border))
    }

    // MARK: Log and calibration

    private var logSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: "What happened")
            VStack(spacing: 0) {
                if g.log.isEmpty {
                    Text("Nothing yet.").font(.system(size: 13)).foregroundStyle(Palette.muted)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(14)
                }
                ForEach(Array(g.log.prefix(8).enumerated()), id: \.element.id) { i, e in
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text(e.date.formatted(date: .omitted, time: .standard)).font(.system(size: 13)).monospacedDigit()
                            .foregroundStyle(Palette.muted).frame(width: 74, alignment: .leading)
                        (Text(e.kind == .swipe ? "Swipe" : e.kind.label + (e.location.map { " · \($0.rawValue)" } ?? "")).fontWeight(.semibold)
                         + Text(e.kind == .swipe ? "" : "  \(Int(e.locationConfidence * 100))%").foregroundColor(Palette.muted))
                            .font(.system(size: 13)).foregroundStyle(Palette.ink)
                        Spacer()
                        badge(e.outcome)
                    }
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    if i < min(g.log.count, 8) - 1 { Rectangle().fill(Palette.divider).frame(height: 1) }
                }
            }
            .background(RoundedRectangle(cornerRadius: 14).fill(Palette.background))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Palette.border))
        }
    }

    private func badge(_ o: GestureOutcome) -> some View {
        let tone: Chip.Tone = { if case .ran = o { return .green }; if case .unsure = o { return .orange }; return .grey }()
        return Chip(text: o.short, tone: tone)
    }

    private var calibrateCard: some View {
        Card(padding: 18) {
            VStack(alignment: .leading, spacing: 10) {
                Text("Your taps").font(Typeface.serif(24)).foregroundStyle(Palette.ink)
                Text(g.location.isCalibrated
                     ? "Tap spots are trained on \(g.location.sampleCount) of your taps."
                     : "Tap spots use 48 taps from one test session. Teaching Open Pocket your grip makes taps and spots more reliable.")
                    .font(.system(size: 13)).foregroundStyle(Palette.body).lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                if let m = g.calibration.savedMessage {
                    Text(m).font(.system(size: 13)).foregroundStyle(Palette.chipGreenText).fixedSize(horizontal: false, vertical: true)
                }
                Button("Teach Open Pocket your taps · 2 min") { model.pane = .gestureCalibration }
                    .buttonStyle(PrimaryButtonStyle())
                if g.location.isCalibrated {
                    Button("Use the built-in tap spots") { g.resetCalibration() }
                        .buttonStyle(.plain).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.link)
                }
            }
        }
    }
}
