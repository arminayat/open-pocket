import AppKit
import Combine
import SwiftUI

@main
struct OpenPocketApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        Window("Open Pocket", id: "main") {
            RootView()
                .environmentObject(delegate.model)
                .frame(minWidth: 900, minHeight: 620)
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1180, height: 780)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    let model = AppModel()
    private var statusItem: NSStatusItem!
    private var bag = Set<AnyCancellable>()

    func applicationWillFinishLaunching(_ notification: Notification) {
        Typeface.register()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "--gesture-test"), i + 1 < args.count {
            print(OfflineTools.gestureTest(URL(fileURLWithPath: args[i + 1])))
            exit(0)
        }
        if let i = args.firstIndex(of: "--train-locations"), i + 2 < args.count {
            print(OfflineTools.trainLocations(URL(fileURLWithPath: args[i + 1]), out: URL(fileURLWithPath: args[i + 2])))
            exit(0)
        }
        if let i = CommandLine.arguments.firstIndex(of: "--snapshot"), i + 1 < CommandLine.arguments.count {
            let dir = URL(fileURLWithPath: CommandLine.arguments[i + 1])
            MainActor.assumeIsolated { Snapshots.render(model: model, to: dir) }
            NSApp.terminate(nil)
            return
        }
        model.settings.applyDockPolicy()
        if !CommandLine.arguments.contains("--loopback-test") { model.start() }
        setUpStatusItem()
        model.objectWillChange
            .debounce(for: .milliseconds(50), scheduler: RunLoop.main)
            .sink { [weak self] in self?.updateIcon() }
            .store(in: &bag)

        if let i = CommandLine.arguments.firstIndex(of: "--loopback-test"), i + 1 < CommandLine.arguments.count {
            let file = URL(fileURLWithPath: CommandLine.arguments[i + 1])
            Task { @MainActor in
                let result = await self.model.dictation.loopbackTest(file: file)
                log.info("loopback test: \(result, privacy: .public)")
                print("loopback test:", result)
                NSApp.terminate(nil)
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        if !hasVisibleWindows { openMainWindow() }
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        InputSwitch.release()
    }

    // MARK: - Menu-bar icon

    private func setUpStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.target = self
        statusItem.button?.action = #selector(statusClicked)
        statusItem.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
        updateIcon()
    }

    private func updateIcon() {
        guard let button = statusItem?.button else { return }
        button.image = StatusIcon.image(for: model.iconState)
        button.toolTip = "Open Pocket: \(model.statusLine)"
    }

    @objc private func statusClicked() {
        if NSApp.currentEvent?.type == .rightMouseUp {
            statusItem.menu = makeMenu()
            statusItem.button?.performClick(nil)
            statusItem.menu = nil
        } else {
            openMainWindow()
        }
    }

    private func makeMenu() -> NSMenu {
        let menu = NSMenu()
        let header = NSMenuItem(title: model.statusLine, action: nil, keyEquivalent: "")
        header.isEnabled = false
        menu.addItem(header)
        menu.addItem(.separator())
        menu.addItem(withTitle: "Show Open Pocket", action: #selector(openFromMenu), keyEquivalent: "").target = self
        let pause = NSMenuItem(title: "Pause dictation", action: #selector(togglePause), keyEquivalent: "")
        pause.target = self
        pause.state = model.settings.paused ? .on : .off
        menu.addItem(pause)
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit Open Pocket", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        return menu
    }

    @objc private func openFromMenu() { openMainWindow() }
    @objc private func togglePause() { model.settings.paused.toggle() }

    func openMainWindow() {
        NSApp.activate(ignoringOtherApps: true)
        if let window = NSApp.windows.first(where: { $0.identifier?.rawValue.contains("main") == true && $0.canBecomeMain }) {
            window.makeKeyAndOrderFront(nil)
        } else {
            model.openMainWindow?()
        }
    }
}

/// The recorder's card shape with its LED, drawn for the menu bar.
enum StatusIcon {
    static func image(for state: AppModel.IconState) -> NSImage {
        let size = NSSize(width: 18, height: 18)
        let image = NSImage(size: size, flipped: false) { _ in
            let card = NSRect(x: 4, y: 0.75, width: 10.5, height: 16.5)
            let path = NSBezierPath(roundedRect: card, xRadius: 1.8, yRadius: 1.8)
            let led = NSRect(x: card.minX + 1.5, y: card.maxY - 3, width: 1.5, height: 1.5)
            switch state {
            case .connected, .listening:
                (state == .listening ? NSColor(red: 0.76, green: 0.25, blue: 0.05, alpha: 1) : .black).setFill()
                path.fill()
                NSGraphicsContext.current?.compositingOperation = .destinationOut
                NSBezierPath(ovalIn: led).fill()
            case .disconnected, .attention:
                NSColor.black.setStroke()
                let inset = NSBezierPath(roundedRect: card.insetBy(dx: 0.6, dy: 0.6), xRadius: 1.4, yRadius: 1.4)
                inset.lineWidth = 1.2
                inset.stroke()
                NSColor.black.setFill()
                NSBezierPath(ovalIn: led).fill()
                if state == .attention {
                    NSBezierPath(ovalIn: NSRect(x: 12, y: 11, width: 6, height: 6)).fill()
                }
            }
            return true
        }
        image.isTemplate = state != .listening
        return image
    }
}
