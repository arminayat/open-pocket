import AppKit
import SwiftUI

struct GestureCalibrationView: View {
    @EnvironmentObject private var model: AppModel
    private var cal: CalibrationRunner { model.gestures.calibration }
    private var ready: Bool { model.gestures.status == .listening }

    var body: some View {
        Page {
            VStack(alignment: .leading, spacing: 4) {
                Button("‹ Playground") {
                    if cal.isCollecting { cal.stop() }
                    model.pane = .gestures
                }
                .buttonStyle(.plain).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.link)
                Text("Teach Open Pocket your taps").font(Typeface.serif(44)).foregroundStyle(Palette.ink)
                Text("About 2 minutes. Hold the Pocket the way you usually do. You can run this again any time.")
                    .font(.system(size: 15)).foregroundStyle(Palette.muted)
            }

            stepChips

            if !cal.running {
                intro
            } else if let report = cal.report {
                results(report)
            } else if let trial = cal.current {
                prompt(trial)
                progress(trial.section)
            }
        }
    }

    // MARK: Steps

    private var stepChips: some View {
        let current = cal.running ? cal.section?.rawValue ?? -1 : -1
        return HStack(spacing: 6) {
            ForEach(CalibrationRunner.Section.allCases, id: \.rawValue) { s in
                let done = s.rawValue < current, now = s.rawValue == current
                HStack(spacing: 8) {
                    Text(done ? "✓" : "\(s.rawValue + 1)")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(now ? Palette.ink : done ? .white : Palette.muted)
                        .frame(width: 22, height: 22)
                        .background(Circle().fill(now ? Palette.background : done ? Palette.green : Palette.background))
                    Text(s.title).font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(now ? Palette.background : done ? Palette.chipGreenText : Palette.muted)
                }
                .padding(.leading, 6).padding(.trailing, 12).padding(.vertical, 6)
                .background(Capsule().fill(now ? Palette.ink : done ? Palette.chipGreenBg : Palette.chipGreyBg))
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Step \(current + 1) of \(CalibrationRunner.Section.allCases.count)")
    }

    // MARK: Before starting

    private var intro: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("What happens").font(Typeface.serif(30)).foregroundStyle(Palette.ink)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 10)], alignment: .leading, spacing: 10) {
                tile("1 · Hold still", "5 s, so Open Pocket learns how quiet your grip is.")
                tile("2 · Taps", "1, 2 and 3 taps, a few times each, when asked.")
                tile("3 · Swipes", "4 swipes, any direction.")
                tile("4 · Not gestures", "Shift your grip and rub the case. These should not count.")
                tile("5 · Tap spots", "6 taps on each side: top, bottom, left, right.")
            }
            HStack(spacing: 12) {
                Chip(text: ready ? "Call mode · ready" : model.gestures.status.label, tone: ready ? .green : .orange)
                Text(ready ? "Actions are paused while you calibrate." : "Turn gestures on, with the switch in call mode.")
                    .font(.system(size: 13)).foregroundStyle(Palette.muted)
                Spacer()
                Button("Skip for now") { model.pane = .gestures }.buttonStyle(SecondaryButtonStyle())
                Button("Start") { cal.start() }.buttonStyle(PrimaryButtonStyle()).disabled(!ready).opacity(ready ? 1 : 0.5)
            }
        }
        .padding(.horizontal, 28).padding(.vertical, 26)
        .background(RoundedRectangle(cornerRadius: 18).fill(Palette.background))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Palette.border))
    }

    private func tile(_ title: String, _ text: String) -> some View {
        (Text(title + "\n").fontWeight(.semibold).foregroundColor(Palette.ink) + Text(text).foregroundColor(Palette.body))
            .font(.system(size: 13)).lineSpacing(3)
            .padding(14)
            .frame(maxWidth: .infinity, minHeight: 76, alignment: .topLeading)
            .background(RoundedRectangle(cornerRadius: 12).fill(Palette.sidebar))
    }

    // MARK: During

    private func prompt(_ t: CalibrationRunner.Trial) -> some View {
        let groupTrials = cal.trials.filter { $0.label == t.label }
        let n = groupTrials.firstIndex { $0.id == t.id }.map { $0 + 1 } ?? 1
        let kicker: String = {
            switch t.section {
            case .still: return "Step 1 · hold still"
            case .taps: return "Step 2 · taps · \(t.group.lowercased()), trial \(n) of \(groupTrials.count)"
            case .swipes: return "Step 3 · swipes · \(n) of \(groupTrials.count)"
            case .notGestures: return "Step 4 · not gestures · \(t.group.lowercased()), \(n) of \(groupTrials.count)"
            case .spots: return "Step 5 · tap spots · \(t.spot?.rawValue ?? ""), \(n) of \(groupTrials.count)"
            case .results: return ""
            }
        }()
        return HStack(spacing: 0) {
            PocketBackView(highlight: nil, ring: t.spot)
                .frame(width: 130, height: 198)
                .frame(width: 240)
                .frame(maxHeight: .infinity)
            VStack(alignment: .leading, spacing: 14) {
                Text(kicker.uppercased()).font(.system(size: 12, weight: .semibold)).tracking(0.6).foregroundStyle(Palette.orangeText)
                Text(t.prompt).font(Typeface.serif(54)).foregroundStyle(Palette.ink)
                Text(t.section == .still || t.section == .notGestures
                     ? "\(t.hint) \(cal.secondsLeft) s left."
                     : t.hint)
                    .font(.system(size: 15)).foregroundStyle(Palette.body)
                if let heard = cal.heard {
                    Text(heard).font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(cal.heardOK ? Palette.chipGreenText : Palette.warn)
                } else {
                    Text(t.section == .still ? "Listening to the background…" : "Listening…")
                        .font(.system(size: 14)).foregroundStyle(Palette.muted)
                }
                HStack(spacing: 10) {
                    Button("Redo this one") { cal.redo() }.buttonStyle(SecondaryButtonStyle())
                    Button("Stop") { cal.stop() }.buttonStyle(SecondaryButtonStyle())
                }
                .padding(.top, 4)
            }
            .padding(.horizontal, 30).padding(.vertical, 26)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .fixedSize(horizontal: false, vertical: true)
        .background(RoundedRectangle(cornerRadius: 18).fill(Palette.listeningBg))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Palette.listeningBorder))
    }

    private func progress(_ section: CalibrationRunner.Section) -> some View {
        let inSection = cal.trials.filter { $0.section == section }
        var groups: [String] = []
        for t in inSection where !groups.contains(t.group) { groups.append(t.group) }
        let currentID = cal.current?.id
        return VStack(alignment: .leading, spacing: 12) {
            ForEach(groups, id: \.self) { group in
                HStack(spacing: 14) {
                    Text(group).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.ink).frame(width: 90, alignment: .leading)
                    HStack(spacing: 6) {
                        ForEach(inSection.filter { $0.group == group }) { t in
                            trialBox(t.outcome, now: t.id == currentID)
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 18).padding(.vertical, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14).fill(Palette.background))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Palette.border))
    }

    private func trialBox(_ o: CalibrationRunner.Outcome, now: Bool) -> some View {
        let (mark, fg, bg): (String, Color, Color) = {
            switch o {
            case .ok: return ("✓", Palette.chipGreenText, Palette.chipGreenBg)
            case .miss: return ("✕", Palette.warn, Palette.warnBg)
            case .pending: return (now ? "•" : "", Palette.orange, now ? Palette.background : Palette.chipGreyBg)
            }
        }()
        return Text(mark).font(.system(size: 14, weight: .bold)).foregroundStyle(fg)
            .frame(width: 30, height: 30)
            .background(RoundedRectangle(cornerRadius: 8).fill(bg))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(now ? Palette.orange : .clear, lineWidth: 2))
    }

    // MARK: Results

    private func results(_ r: CalibrationRunner.Report) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                stat("Taps", "\(r.taps.ok) of \(r.taps.total)", r.taps.note, warn: false)
                stat("Swipes", "\(r.swipes.ok) of \(r.swipes.total)", r.swipes.note, warn: false)
                stat("Not gestures", "\(r.falseTriggers.count) of \(r.falseTriggers.total)", r.falseTriggers.note, warn: r.falseTriggers.count > 0)
                stat("Tap spots", r.spotAccuracy.map { "\(Int(($0 * 100).rounded()))%" } ?? "–", r.spotNote, warn: false)
            }

            HStack(spacing: 20) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Suggested threshold for your hand: \(Int(r.threshold * 100))%")
                        .font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.ink)
                    Text(r.thresholdNote).font(.system(size: 13)).foregroundStyle(Palette.muted).lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                HStack(spacing: 10) {
                    Text("Use \(Int(r.threshold * 100))% for my actions").font(.system(size: 14, weight: .semibold)).foregroundStyle(Palette.ink)
                    Switch(isOn: Binding(get: { cal.applyThreshold }, set: { cal.applyThreshold = $0 }), label: "Use suggested threshold")
                }
            }
            .padding(.horizontal, 20).padding(.vertical, 18)
            .background(RoundedRectangle(cornerRadius: 16).fill(Palette.background))
            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Palette.border))

            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 10) {
                    Switch(isOn: Binding(get: { cal.keepSession }, set: { cal.keepSession = $0 }), label: "Keep this session")
                    Text("Keep this session to improve detection").font(.system(size: 14, weight: .semibold)).foregroundStyle(Palette.ink)
                }
                Text("Saves the contact-mic recording and the prompt timings on this Mac, the same way last night's tests were recorded. Nothing is uploaded. You can open the folder and share it if you want to.")
                    .font(.system(size: 13)).foregroundStyle(Palette.muted).lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.leading, 54)
                Button("Show the sessions folder") {
                    try? FileManager.default.createDirectory(at: CalibrationRunner.sessionsDir, withIntermediateDirectories: true)
                    NSWorkspace.shared.open(CalibrationRunner.sessionsDir)
                }
                .buttonStyle(.plain).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.link)
                .padding(.leading, 54)
            }
            .padding(.horizontal, 20).padding(.vertical, 18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 16).fill(Palette.background))
            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Palette.border))

            HStack(spacing: 10) {
                Spacer()
                Button("Run again") { cal.start() }.buttonStyle(SecondaryButtonStyle())
                Button("Save calibration") {
                    cal.save(location: model.gestures.location, rules: model.rules, device: model.ble.name)
                    model.pane = .gestures
                }
                .buttonStyle(PrimaryButtonStyle())
            }
        }
    }

    private func stat(_ label: String, _ value: String, _ note: String, warn: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased()).font(.system(size: 12, weight: .semibold)).tracking(0.6).foregroundStyle(Palette.muted)
            Text(value).font(Typeface.serif(34)).foregroundStyle(Palette.ink)
            Text(note).font(.system(size: 13)).foregroundStyle(warn ? Palette.warn : Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 14).fill(Palette.background))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Palette.border))
    }
}
