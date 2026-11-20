import AppKit
import Foundation

/// The Pocket Mic virtual microphone, bundled inside the app and installed into
/// /Library/Audio/Plug-Ins/HAL with an administrator password prompt.
enum PocketMicDriver {
    static let bundleName = "Pocket Mic.driver"
    static let installedPath = "/Library/Audio/Plug-Ins/HAL/\(bundleName)"

    static var bundled: URL? { Bundle.main.url(forResource: "Pocket Mic", withExtension: "driver") }

    static var isLoaded: Bool { AudioDevices.pocketMic != nil }

    static var installedVersion: String? { version(atPath: installedPath) }
    static var bundledVersion: String? { bundled.flatMap { version(atPath: $0.path) } }

    private static func version(atPath path: String) -> String? {
        let plist = URL(fileURLWithPath: path).appendingPathComponent("Contents/Info.plist")
        guard let dict = NSDictionary(contentsOf: plist) else { return nil }
        return dict["CFBundleShortVersionString"] as? String
    }

    /// Returns an error message, or nil on success. Asks for the admin password.
    /// The sandboxed TestFlight build can't write to /Library: it shows the driver and the folder
    /// in Finder instead, and returns what to do next.
    static func install() -> String? {
        guard let source = bundled?.path else { return "This build doesn't include Pocket Mic." }
        if Distribution.appStore { return showForManualInstall(source) }
        let shell = [
            "rm -rf \(quote(installedPath))",
            "cp -R \(quote(source)) /Library/Audio/Plug-Ins/HAL/",
            "chown -R root:wheel \(quote(installedPath))",
            "killall coreaudiod",
        ].joined(separator: " && ")
        let escaped = shell.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
        var error: NSDictionary?
        NSAppleScript(source: "do shell script \"\(escaped)\" with administrator privileges")?.executeAndReturnError(&error)
        if let error {
            if (error[NSAppleScript.errorNumber] as? Int) == -128 { return "Cancelled." }
            return error[NSAppleScript.errorMessage] as? String ?? "Install failed."
        }
        return nil
    }

    private static func showForManualInstall(_ source: String) -> String {
        NSWorkspace.shared.open(URL(fileURLWithPath: "/Library/Audio/Plug-Ins/HAL", isDirectory: true))
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: source)])
        return "Drag Pocket Mic into the HAL folder that just opened (Finder asks for your password), then restart your Mac."
    }

    private static func quote(_ s: String) -> String { "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'" }
}
