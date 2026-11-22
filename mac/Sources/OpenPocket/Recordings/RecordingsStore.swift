import Foundation

/// The Recordings screen's state: the iPhone's library read from iCloud, kept current while the app runs.
/// Nothing is read until the screen first opens. Main thread.
final class RecordingsStore: ObservableObject {
    enum Source: Equatable {
        case iCloud(String)
        /// A local folder laid out like the container's `Documents/` (`--recordings-folder`).
        case folder(URL)
        /// The Developer ID download has no iCloud container.
        case none
    }

    enum Status: Equatable { case idle, notInThisBuild, signedOut, unavailable, looking, ready }

    /// Shared with Open Pocket on iPhone (plugins/with-icloud.js).
    static let containerID = "iCloud.com.nestorcodecrafters.openpocket"

    /// `--recordings-folder <dir>`, else iCloud in the TestFlight build, else nothing.
    static var launchSource: Source {
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "--recordings-folder"), i + 1 < args.count {
            return .folder(URL(fileURLWithPath: args[i + 1]))
        }
        return Distribution.appStore ? .iCloud(containerID) : .none
    }

    @Published private(set) var status: Status
    @Published private(set) var snapshot = LibrarySnapshot()
    @Published private(set) var selection: String?
    let player = RecordingPlayer()

    private let source: Source
    private var folder: ArchiveFolder?
    private var watcher: ICloudWatcher?
    private var identityObserver: NSObjectProtocol?
    private let queue = DispatchQueue(label: "recordings.scan", qos: .userInitiated)
    private var scanning = false
    private var scanAgain = false

    init(source: Source) {
        self.source = source
        status = source == .none ? .notInThisBuild : .idle
    }

    var selected: LibraryRecording? { snapshot.recordings.first { $0.id == selection } }

    /// False in the Developer ID download, which has no iCloud container.
    var available: Bool { source != .none }

    /// Called whenever the screen appears: connects the first time, rescans after.
    func open() {
        if status == .idle { connect() } else { scan() }
    }

    func select(_ id: String) {
        selection = id
        player.select(selected, in: folder, watcher: watcher)
    }

    private func connect() {
        switch source {
        case .none:
            status = .notInThisBuild
        case .folder(let url):
            folder = ArchiveFolder(root: url)
            status = .looking
            scan()
        case .iCloud(let id):
            if identityObserver == nil {
                identityObserver = NotificationCenter.default.addObserver(forName: .NSUbiquityIdentityDidChange,
                                                                          object: nil, queue: .main) { [weak self] _ in
                    self?.disconnect()
                    self?.connect()
                }
            }
            guard FileManager.default.ubiquityIdentityToken != nil else { status = .signedOut; return }
            status = .looking
            // Apple says not to look the container up on the main thread; it can take a while.
            queue.async {
                let container = FileManager.default.url(forUbiquityContainerIdentifier: id)
                DispatchQueue.main.async { self.attach(container) }
            }
        }
    }

    private func attach(_ container: URL?) {
        guard status == .looking, folder == nil else { return }
        guard let container else { status = .unavailable; return }
        // The iPhone creates Documents/ with its first upload; until then the library is just empty.
        folder = ArchiveFolder(root: container.appendingPathComponent("Documents", isDirectory: true))
        let watcher = ICloudWatcher()
        watcher.onChange = { [weak self] in self?.scan() }
        self.watcher = watcher
        watcher.start()
        scan()
    }

    private func disconnect() {
        watcher?.stop()
        watcher = nil
        folder = nil
        snapshot = LibrarySnapshot()
        selection = nil
        player.select(nil, in: nil, watcher: nil)
    }

    /// Lists and reads on a background queue; changes that arrive meanwhile get one more pass.
    private func scan() {
        guard let folder else { return }
        if scanning { scanAgain = true; return }
        scanning = true
        queue.async {
            let next = LibraryBuilder.build(files: folder.list(), read: folder.read)
            DispatchQueue.main.async {
                self.scanning = false
                guard self.folder === folder else { return }
                if next != self.snapshot { self.snapshot = next }
                if self.watcher?.gathered ?? true || !next.recordings.isEmpty { self.status = .ready }
                if self.selected == nil { self.selection = next.recordings.first?.id }
                self.player.select(self.selected, in: folder, watcher: self.watcher)
                if self.scanAgain {
                    self.scanAgain = false
                    self.scan()
                }
            }
        }
    }

    /// Sample state for `--snapshot` renders.
    func applyPreview(status: Status, snapshot: LibrarySnapshot = LibrarySnapshot()) {
        self.status = status
        self.snapshot = snapshot
        selection = snapshot.recordings.first?.id
        player.applyPreview(duration: selected?.manifest.durationSeconds ?? 0)
    }
}
