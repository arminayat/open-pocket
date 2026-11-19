import AppKit
import CoreText
import SwiftUI

// Values from the OpenPocket for Mac design canvas (light), with dark-mode equivalents.

extension NSColor {
    convenience init(hex: UInt32) {
        self.init(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                  blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}

extension Color {
    static func dyn(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? NSColor(hex: dark) : NSColor(hex: light)
        })
    }
}

enum Palette {
    static let ink = Color.dyn(0x1D1D1F, 0xF5F5F7)
    static let body = Color.dyn(0x44444C, 0xC7C7CC)
    static let muted = Color.dyn(0x5C5C66, 0xA1A1AA)
    static let faint = Color.dyn(0x8A8A93, 0x76767E)
    static let background = Color.dyn(0xFFFFFF, 0x1E1E20)
    static let sidebar = Color.dyn(0xF6F6F7, 0x262629)
    static let border = Color.dyn(0xE5E5E8, 0x3A3A3E)
    static let divider = Color.dyn(0xEEEEF0, 0x323236)
    static let selected = Color.dyn(0xE4E4E8, 0x38383C)
    static let field = Color.dyn(0xF8F8FA, 0x2C2C2F)
    static let controlBorder = Color.dyn(0xDADADF, 0x48484D)
    static let segment = Color.dyn(0xEEEEF1, 0x2E2E32)

    static let green = Color(nsColor: NSColor(hex: 0x22A04B))
    static let chipGreenText = Color.dyn(0x1A7A3C, 0x5EE08F)
    static let chipGreenBg = Color.dyn(0xE3F5E9, 0x1D3A27)
    static let chipGreyText = Color.dyn(0x5C5C66, 0xA1A1AA)
    static let chipGreyBg = Color.dyn(0xEEEEF1, 0x2E2E32)

    static let orange = Color(nsColor: NSColor(hex: 0xC2410C))
    static let orangeText = Color.dyn(0xA33A0B, 0xFB923C)
    static let orangeRing = Color.dyn(0xFBDCCD, 0x5A2A18)
    static let listeningBg = Color.dyn(0xFFF4EE, 0x34201A)
    static let listeningBorder = Color.dyn(0xF6D3C2, 0x6B3420)
    static let barIdle = Color.dyn(0xF2C3AC, 0x6B3420)

    static let tintBg = Color.dyn(0xF3F6FB, 0x1E2632)
    static let tintBorder = Color.dyn(0xDDE5F1, 0x33405A)
    static let link = Color.dyn(0x0B63CE, 0x5AA2FF)
    static let warn = Color.dyn(0xA14A00, 0xF59E0B)
    static let warnBg = Color.dyn(0xFFF3E6, 0x3A2A14)
}

enum Typeface {
    static let serifName = "InstrumentSerif-Regular"

    /// Registers the bundled Instrument Serif. Call once at launch.
    static func register() {
        guard let url = Bundle.main.url(forResource: "InstrumentSerif-Regular", withExtension: "ttf") else { return }
        CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
    }

    static func serif(_ size: CGFloat) -> Font {
        NSFont(name: serifName, size: size) != nil ? .custom(serifName, size: size) : .system(size: size, design: .serif)
    }
}

// MARK: - Building blocks

struct Card<Content: View>: View {
    var padding: CGFloat = 16
    var radius: CGFloat = 16
    @ViewBuilder var content: Content
    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: radius).fill(Palette.background))
            .overlay(RoundedRectangle(cornerRadius: radius).strokeBorder(Palette.border))
    }
}

struct SectionLabel: View {
    var text: String
    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 12, weight: .semibold))
            .tracking(0.6)
            .foregroundStyle(Palette.muted)
            .padding(.horizontal, 4)
    }
}

struct Chip: View {
    enum Tone { case green, grey, orange }
    var text: String
    var tone: Tone
    var body: some View {
        Text(text)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(tone == .green ? Palette.chipGreenText : tone == .orange ? Palette.orangeText : Palette.chipGreyText)
            .padding(.horizontal, 10).padding(.vertical, 3)
            .background(Capsule().fill(tone == .green ? Palette.chipGreenBg : tone == .orange ? Palette.listeningBg : Palette.chipGreyBg))
    }
}

/// A grouped-list row: title, one description line, trailing control.
struct Row<Trailing: View>: View {
    var title: String
    var detail: String?
    var showDivider = true
    @ViewBuilder var trailing: Trailing
    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: 16) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: 14, weight: .semibold)).foregroundStyle(Palette.ink)
                    if let detail {
                        Text(detail).font(.system(size: 13)).foregroundStyle(Palette.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 12)
                trailing
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            if showDivider { Rectangle().fill(Palette.divider).frame(height: 1) }
        }
    }
}

struct RowGroup<Content: View>: View {
    var title: String
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: title)
            VStack(spacing: 0) { content }
                .background(RoundedRectangle(cornerRadius: 16).fill(Palette.background))
                .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Palette.border))
                .clipShape(RoundedRectangle(cornerRadius: 16))
        }
    }
}

/// The design's green switch.
struct Switch: View {
    @Binding var isOn: Bool
    var label: String
    var body: some View {
        Button { isOn.toggle() } label: {
            ZStack(alignment: isOn ? .trailing : .leading) {
                Capsule().fill(isOn ? Palette.green : Color.dyn(0xC7C7CE, 0x48484D)).frame(width: 44, height: 26)
                Circle().fill(.white).frame(width: 20, height: 20).shadow(color: .black.opacity(0.25), radius: 1, y: 1)
                    .padding(3)
            }
        }
        .buttonStyle(.plain)
        .animation(.easeOut(duration: 0.15), value: isOn)
        .accessibilityLabel(label)
        .accessibilityValue(isOn ? "On" : "Off")
        .accessibilityAddTraits(.isButton)
    }
}

struct Segmented<T: Hashable>: View {
    @Binding var selection: T
    var options: [(T, String)]
    var body: some View {
        HStack(spacing: 3) {
            ForEach(options, id: \.0) { value, label in
                Button { selection = value } label: {
                    Text(label)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(selection == value ? Palette.ink : Palette.body)
                        .padding(.horizontal, 12).frame(height: 30)
                        .background(RoundedRectangle(cornerRadius: 8).fill(selection == value ? Palette.background : .clear)
                            .shadow(color: .black.opacity(selection == value ? 0.15 : 0), radius: 1, y: 1))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selection == value ? .isSelected : [])
            }
        }
        .padding(3)
        .background(RoundedRectangle(cornerRadius: 10).fill(Palette.segment))
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    var color: Color = Palette.ink
    var foreground: Color = Palette.background
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(foreground)
            .padding(.horizontal, 18).frame(minHeight: 44)
            .background(RoundedRectangle(cornerRadius: 10).fill(color))
            .opacity(configuration.isPressed ? 0.8 : 1)
            .contentShape(Rectangle())
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    var compact = false
    var destructive = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(destructive ? Color.dyn(0xA12B1F, 0xF87171) : Palette.ink)
            .padding(.horizontal, 14).frame(minHeight: compact ? 34 : 40)
            .background(RoundedRectangle(cornerRadius: compact ? 8 : 10).fill(Palette.background))
            .overlay(RoundedRectangle(cornerRadius: compact ? 8 : 10).strokeBorder(Palette.controlBorder))
            .opacity(configuration.isPressed ? 0.7 : 1)
            .contentShape(Rectangle())
    }
}

/// The OpenPocket mark: a dashed outline of a serif "P", from the bundled font's glyph.
struct LogoP: Shape {
    func path(in rect: CGRect) -> Path {
        let font = CTFontCreateWithName(Typeface.serifName as CFString, 100, nil)
        var unichar: UniChar = 0x50   // "P"
        var glyph = CGGlyph(0)
        guard CTFontGetGlyphsForCharacters(font, &unichar, &glyph, 1),
              let cg = CTFontCreatePathForGlyph(font, glyph, nil) else { return Path() }
        let box = cg.boundingBoxOfPath
        let scale = min(rect.width / box.width, rect.height / box.height)
        var t = CGAffineTransform(translationX: rect.minX, y: rect.maxY)
            .scaledBy(x: scale, y: -scale)
            .translatedBy(x: -box.minX, y: -box.minY)
        return Path(cg.copy(using: &t) ?? cg)
    }
}

struct Logo: View {
    var body: some View {
        HStack(spacing: 8) {
            LogoP()
                .stroke(Palette.ink, style: StrokeStyle(lineWidth: 1.1, dash: [2.2, 1.9]))
                .frame(width: 20, height: 26)
            Text("OpenPocket").font(Typeface.serif(24)).foregroundStyle(Palette.ink)
        }
    }
}
