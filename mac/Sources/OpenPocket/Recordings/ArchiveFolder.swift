import CryptoKit
import Darwin
import Foundation

/// The folder the library lives in: the iCloud container's `Documents/`, or (for checks) a local folder laid
/// out the same way. Read only: it never creates, renames, moves or deletes anything there; it only asks
/// iCloud to download files to this Mac. Use from one queue at a time.
final class ArchiveFolder {
    let root: URL
    private let files = FileManager.default
    private var cache: [String: (stamp: String, data: Data)] = [:]

    init(root: URL) {
        self.root = root.standardizedFileURL.resolvingSymlinksInPath()
    }

    func url(_ path: String) -> URL { root.appendingPathComponent(path) }

    /// Every archive file two levels down: day folder › recording folder › file, or recording folder › file.
    func list() -> [ArchiveFile] {
        var out: [String: ArchiveFile] = [:]
        let keys: [URLResourceKey] = [.isDirectoryKey, .isSymbolicLinkKey, .fileSizeKey, .contentModificationDateKey]
        func visit(_ dir: URL, prefix: String, level: Int) {
            let children = (try? files.contentsOfDirectory(at: dir, includingPropertiesForKeys: keys)) ?? []
            for child in children.prefix(level == 0 ? 10_000 : 500) {
                var name = child.lastPathComponent
                // Older iCloud placeholders for files not downloaded yet: `.audio.mp3.icloud`.
                let placeholder = name.hasPrefix(".") && name.hasSuffix(".icloud") && name.count > 8
                if placeholder { name = String(name.dropFirst().dropLast(7)) } else if name.hasPrefix(".") { continue }
                guard let values = try? child.resourceValues(forKeys: Set(keys)), values.isSymbolicLink != true else { continue }
                let path = prefix.isEmpty ? name : "\(prefix)/\(name)"
                if values.isDirectory == true && !placeholder {
                    if level < 2 && RecordingArchive.validComponent(name) { visit(child, prefix: path, level: level + 1) }
                } else if RecordingArchive.archivePath(path) != nil {
                    let target = url(path)
                    let stamp = "\(values.fileSize ?? -1)|\(values.contentModificationDate?.timeIntervalSince1970 ?? 0)"
                    out[path] = ArchiveFile(path: path, downloaded: !placeholder && Self.isDownloaded(target),
                                            conflict: !placeholder && Self.hasConflict(target), stamp: stamp)
                }
            }
        }
        visit(root, prefix: "", level: 0)
        cache = cache.filter { out[$0.key]?.stamp == $0.value.stamp }
        return out.keys.sorted().compactMap { out[$0] }
    }

    /// A small document (≤ 8 MB). Asks iCloud to download it when only a placeholder is here.
    func read(_ file: ArchiveFile) -> ArchiveRead {
        let path = file.path
        if let hit = cache[path], hit.stamp == file.stamp { return .data(hit.data) }
        guard isDownloaded(path) else {
            startDownloading(path)
            return .pending
        }
        guard let data = coordinatedRead(path, { try Self.readRegular($0, limit: RecordingArchive.maxJSONBytes) }) else {
            return .failed
        }
        cache[path] = (file.stamp, data)
        return .data(data)
    }

    func isDownloaded(_ path: String) -> Bool { Self.isDownloaded(url(path)) }

    func startDownloading(_ path: String) {
        let target = url(path)
        guard (try? target.resourceValues(forKeys: [.isUbiquitousItemKey]))?.isUbiquitousItem == true else { return }
        try? files.startDownloadingUbiquitousItem(at: target)
    }

    /// Runs `body` inside a coordinated read of a downloaded file under `root` that isn't a symbolic link.
    func coordinatedRead<T>(_ path: String, _ body: (URL) throws -> T) -> T? {
        let target = url(path)
        guard target.standardizedFileURL.path.hasPrefix(root.path + "/"),
              (try? target.resourceValues(forKeys: [.isSymbolicLinkKey]))?.isSymbolicLink == false else { return nil }
        var result: T?
        var error: NSError?
        NSFileCoordinator().coordinate(readingItemAt: target, options: [], error: &error) { url in
            result = try? body(url)
        }
        return error == nil ? result : nil
    }

    /// Streams a file through SHA-256 in 64 KB chunks; nil unless it is a regular file of exactly `bytes`.
    static func digest(_ url: URL, bytes: Int) -> String? {
        let fd = Darwin.open(url.path, O_RDONLY | O_NOFOLLOW)
        guard fd >= 0 else { return nil }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_mode & S_IFMT == S_IFREG, info.st_size == bytes else { return nil }
        var hash = SHA256()
        var count = 0
        while let chunk = try? handle.read(upToCount: 65_536), !chunk.isEmpty {
            count += chunk.count
            guard count <= bytes else { return nil }
            hash.update(data: chunk)
        }
        guard count == bytes else { return nil }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }

    static func isDownloaded(_ url: URL) -> Bool {
        guard let values = try? url.resourceValues(forKeys: [.isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey])
        else { return false }
        if values.isUbiquitousItem != true { return FileManager.default.fileExists(atPath: url.path) }
        return values.ubiquitousItemDownloadingStatus == .current || values.ubiquitousItemDownloadingStatus == .downloaded
    }

    private static func hasConflict(_ url: URL) -> Bool {
        (try? url.resourceValues(forKeys: [.ubiquitousItemHasUnresolvedConflictsKey]))?.ubiquitousItemHasUnresolvedConflicts == true
    }

    private static func readRegular(_ url: URL, limit: Int) throws -> Data {
        let fd = Darwin.open(url.path, O_RDONLY | O_NOFOLLOW)
        guard fd >= 0 else { throw CocoaError(.fileReadNoPermission) }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_mode & S_IFMT == S_IFREG, info.st_size <= limit else {
            throw CocoaError(.fileReadTooLarge)
        }
        let data = try handle.read(upToCount: limit + 1) ?? Data()
        guard data.count <= limit, data.count == info.st_size else { throw CocoaError(.fileReadCorruptFile) }
        return data
    }
}

/// Tells the library when the container changes (the iPhone added a recording, a download finished),
/// through Spotlight's index of the app's iCloud documents. Main thread only.
final class ICloudWatcher {
    private let query = NSMetadataQuery()
    private var observers: [NSObjectProtocol] = []
    /// False until the first full pass, so a library still arriving isn't shown as empty.
    private(set) var gathered = false
    var onChange: (() -> Void)?

    func start() {
        query.searchScopes = [NSMetadataQueryUbiquitousDocumentsScope]
        query.predicate = NSPredicate(format: "%K LIKE '*'", NSMetadataItemFSNameKey)
        query.notificationBatchingInterval = 1
        for name in [Notification.Name.NSMetadataQueryDidFinishGathering, .NSMetadataQueryDidUpdate] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: query, queue: .main) { [weak self] note in
                if note.name == .NSMetadataQueryDidFinishGathering { self?.gathered = true }
                self?.onChange?()
            })
        }
        if !query.start() { gathered = true; onChange?() }
    }

    func stop() {
        observers.forEach(NotificationCenter.default.removeObserver)
        observers = []
        query.stop()
    }

    /// How much of one file iCloud has downloaded, 0–100, while it downloads.
    func percent(of url: URL) -> Double? {
        let path = url.standardizedFileURL.path
        query.disableUpdates()
        defer { query.enableUpdates() }
        for case let item as NSMetadataItem in query.results
        where (item.value(forAttribute: NSMetadataItemURLKey) as? URL)?.standardizedFileURL.path == path {
            return item.value(forAttribute: NSMetadataUbiquitousItemPercentDownloadedKey) as? Double
        }
        return nil
    }

    deinit { stop() }
}
