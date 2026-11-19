import AppKit
import SwiftUI
import UniformTypeIdentifiers

struct GestureActionsView: View {
    @EnvironmentObject private var model: AppModel
    @StateObject private var selected = Box<UUID?>(nil)
    @StateObject private var runResult = Box<String?>(nil)

    private var rules: [GestureRule] { model.rules.rules }
    private var current: GestureRule? {
        rules.first { $0.id == selected.value } ?? rules.first
    }

    var body: some View {
        Page {
            HStack(alignment: .bottom) {
                VStack(alignment: .leading, spacing: 4) {
                    Button("‹ Playground") { model.pane = .gestures }
                        .buttonStyle(.plain).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.link)
                    Text("Gesture actions").font(Typeface.serif(44)).foregroundStyle(Palette.ink)
                    Text("Pick a gesture, how sure OpenPocket must be, and what happens.")
                        .font(.system(size: 15)).foregroundStyle(Palette.muted)
                }
                Spacer()
                Button("Add action") {
                    let rule = GestureRule(gesture: .tap2, location: nil, minConfidence: 0.6, action: .keys(nil))
                    model.rules.rules.append(rule)
                    selected.value = rule.id
                }
                .buttonStyle(PrimaryButtonStyle())
            }

            HStack(alignment: .top, spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    VStack(spacing: 0) {
                        if rules.isEmpty {
                            Text("No actions yet.").font(.system(size: 14)).foregroundStyle(Palette.muted)
                                .frame(maxWidth: .infinity, alignment: .leading).padding(16)
                        }
                        ForEach(Array(rules.enumerated()), id: \.element.id) { i, rule in
                            ruleRow(rule)
                            if i < rules.count - 1 { Rectangle().fill(Palette.divider).frame(height: 1) }
                        }
                    }
                    .background(RoundedRectangle(cornerRadius: 16).fill(Palette.background))
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Palette.border))
                    Text("The most specific action wins: one for the top beats one for anywhere. Actions only run while gestures are on, in call mode.")
                        .font(.system(size: 12)).foregroundStyle(Palette.muted).padding(.horizontal, 4)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(minWidth: 320, maxWidth: 400)

                if let rule = current { editor(rule) }
            }
        }
    }

    private func binding(_ id: UUID) -> Binding<GestureRule> {
        Binding(
            get: { model.rules.rules.first { $0.id == id } ?? GestureRule(gesture: .tap1, action: .keys(nil)) },
            set: { new in
                if let i = model.rules.rules.firstIndex(where: { $0.id == id }) {
                    var r = new
                    if r.gesture == .swipe { r.location = nil }
                    model.rules.rules[i] = r
                }
            })
    }

    private func ruleRow(_ rule: GestureRule) -> some View {
        let isSelected = rule.id == current?.id
        return HStack(spacing: 12) {
            Button { selected.value = rule.id } label: {
                HStack(spacing: 12) {
                    Text(rule.gesture.glyph).font(Typeface.serif(22)).foregroundStyle(Palette.ink)
                        .frame(width: 40, height: 40)
                        .background(RoundedRectangle(cornerRadius: 10).fill(Palette.tintBg))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(rule.whenText).font(.system(size: 14, weight: .semibold)).foregroundStyle(Palette.ink)
                        Text("→ \(rule.action.summary)").font(.system(size: 13)).foregroundStyle(Palette.muted).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Switch(isOn: binding(rule.id).enabled, label: "Enable \(rule.whenText)")
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(isSelected ? Palette.selected.opacity(0.6) : Palette.background)
        .opacity(rule.enabled ? 1 : 0.6)
    }

    // MARK: Editor

    private func editor(_ rule: GestureRule) -> some View {
        let r = binding(rule.id)
        return VStack(alignment: .leading, spacing: 18) {
            Text(rule.gesture.label + (rule.location.map { " at the \($0.rawValue)" } ?? ""))
                .font(Typeface.serif(28)).foregroundStyle(Palette.ink)

            field("Gesture") {
                Segmented(selection: r.gesture, options: GestureKind.allCases.map { ($0, $0.label) })
            }
            field("Where on the Pocket") {
                Segmented(selection: Binding(get: { rule.location?.rawValue ?? "any" },
                                             set: { r.wrappedValue.location = TapLocation(rawValue: $0) }),
                          options: [("any", "Anywhere")] + TapLocation.allCases.map { ($0.rawValue, $0.label) })
                    .disabled(rule.gesture == .swipe)
                    .opacity(rule.gesture == .swipe ? 0.5 : 1)
                note(rule.gesture == .swipe ? "Swipes have no location: direction and position couldn't be told apart."
                     : rule.location == nil ? "Anywhere ignores where you tap, so only the gesture has to be sure."
                     : "Both the gesture and the \(rule.location!.rawValue) have to reach the threshold.")
            }
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    SectionLabel(text: "How sure").padding(.horizontal, -4)
                    Spacer()
                    Text("\(Int((rule.minConfidence * 100).rounded()))%").font(.system(size: 15, weight: .bold)).monospacedDigit()
                        .foregroundStyle(Palette.ink)
                }
                Slider(value: r.minConfidence, in: 0.3...0.95, step: 0.05).tint(Palette.ink)
                note(rule.minConfidence < 0.5 ? "Low: more grip shifts and brushes will trigger it."
                     : rule.minConfidence >= 0.8 ? "High: fewer mistakes, but some real taps will be ignored."
                     : "Balanced. Lower triggers more often, higher misses more taps.")
            }
            field("Then") {
                HStack(spacing: 10) {
                    Menu {
                        ForEach(GestureAction.Kind.allCases) { k in
                            Button(k.label) { if rule.action.kind != k { r.wrappedValue.action = k.empty } }
                        }
                    } label: {
                        selectBox(rule.action.kind.label, width: 230)
                    }
                    .menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden).fixedSize()
                    actionValue(r)
                }
                note(actionNote(rule.action.kind))
                if case .keys(let s) = rule.action, let s, s == model.settings.shortcut {
                    Text("This is your dictation hotkey. A gesture would start \(model.settings.app.name) with the Mac's own mic, because gestures only run in call mode.")
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(Palette.warn)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            HStack(spacing: 10) {
                Button("Run it now") { runResult.value = rule.action.run() ?? "Done." }
                    .buttonStyle(SecondaryButtonStyle())
                if let res = runResult.value { Text(res).font(.system(size: 13)).foregroundStyle(Palette.muted) }
                Spacer()
                Button("Delete") {
                    model.rules.rules.removeAll { $0.id == rule.id }
                    selected.value = nil
                }
                .buttonStyle(SecondaryButtonStyle(destructive: true))
            }
            .padding(.top, 12)
            .overlay(alignment: .top) { Rectangle().fill(Palette.divider).frame(height: 1) }
        }
        .padding(.horizontal, 24).padding(.vertical, 22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 18).fill(Palette.background))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Palette.border))
    }

    @ViewBuilder
    private func actionValue(_ r: Binding<GestureRule>) -> some View {
        switch r.wrappedValue.action {
        case .keys(let s):
            ShortcutRecorder(shortcut: Binding(get: { s }, set: { r.wrappedValue.action = .keys($0) }))
        case .openApp(let path):
            Button {
                let panel = NSOpenPanel()
                panel.allowedContentTypes = [.application]
                panel.directoryURL = URL(fileURLWithPath: "/Applications")
                if panel.runModal() == .OK, let url = panel.url { r.wrappedValue.action = .openApp(path: url.path) }
            } label: {
                selectBox(path.isEmpty ? "Choose app…" : URL(fileURLWithPath: path).deletingPathExtension().lastPathComponent, width: 180)
            }
            .buttonStyle(.plain)
        case .runShortcut(let name):
            textBox("Shortcut name", Binding(get: { name }, set: { r.wrappedValue.action = .runShortcut(name: $0) }))
        case .media(let key):
            Menu {
                ForEach(MediaKey.allCases) { k in Button(k.label) { r.wrappedValue.action = .media(k) } }
            } label: { selectBox(key.label, width: 170) }
                .menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden).fixedSize()
        case .shell(let cmd):
            textBox("Command", Binding(get: { cmd }, set: { r.wrappedValue.action = .shell($0) }))
        }
    }

    private func actionNote(_ k: GestureAction.Kind) -> String {
        switch k {
        case .keys: return "Click the box, then press the keys. Needs Accessibility, like dictation."
        case .openApp: return "Opens the app, or brings it to the front."
        case .runShortcut: return "The exact name of a shortcut in the Shortcuts app."
        case .media: return "Play / pause, next or previous track, volume."
        case .shell: return "Runs with your user account in zsh. Advanced."
        }
    }

    private func field<Content: View>(_ label: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: label).padding(.horizontal, -4)
            content()
        }
    }

    private func note(_ text: String) -> some View {
        Text(text).font(.system(size: 12)).foregroundStyle(Palette.muted).fixedSize(horizontal: false, vertical: true)
    }

    private func selectBox(_ text: String, width: CGFloat) -> some View {
        HStack {
            Text(text).font(.system(size: 14, weight: .medium)).foregroundStyle(Palette.ink).lineLimit(1)
            Spacer()
            Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.muted)
        }
        .padding(.horizontal, 10)
        .frame(width: width, height: 36)
        .background(RoundedRectangle(cornerRadius: 8).fill(Palette.background))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Palette.controlBorder))
        .contentShape(Rectangle())
    }

    private func textBox(_ placeholder: String, _ text: Binding<String>) -> some View {
        TextField(placeholder, text: text)
            .textFieldStyle(.plain).font(.system(size: 14))
            .padding(.horizontal, 10).frame(width: 220, height: 36)
            .background(RoundedRectangle(cornerRadius: 8).fill(Palette.field))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Palette.controlBorder))
    }
}
