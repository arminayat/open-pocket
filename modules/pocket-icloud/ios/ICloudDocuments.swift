import Foundation

final class ICloudDocuments {
  private static let accountIdentity = ICloudAccountIdentity()
  private let files = FileManager.default
  private let rootsLock = NSLock()
  private var roots: [String: URL] = [:]
  private let gate = ICloudSessionGate(identity: ICloudDocuments.account)
  private let change: () -> Void
  private lazy var discovery = ICloudDiscovery(change: change)
  private var identityObserver: NSObjectProtocol?

  init(change: @escaping () -> Void) {
    self.change = change
    _ = discovery
    identityObserver = NotificationCenter.default.addObserver(forName: .NSUbiquityIdentityDidChange,
      object: nil, queue: nil) { [weak self] _ in
      self?.close()
      self?.change()
    }
  }

  deinit {
    if let identityObserver { NotificationCenter.default.removeObserver(identityObserver) }
    discovery.stop()
  }

  static func account() -> String? {
    accountIdentity.identifier(for: FileManager.default.ubiquityIdentityToken)
  }

  private func container() -> URL? {
    guard let id = Bundle.main.object(forInfoDictionaryKey: "OpenPocketICloudContainerIdentifier") as? String,
      id.hasPrefix("iCloud."), id.count <= 255 else { return nil }
    return files.url(forUbiquityContainerIdentifier: id)?.standardizedFileURL.resolvingSymlinksInPath()
  }

  func status() -> [String: Any] {
    guard let account = Self.account() else {
      return ["available": false, "accountId": NSNull(), "reason": "Sign in to iCloud and enable iCloud Drive in Apple Settings."]
    }
    guard container() != nil else {
      return ["available": false, "accountId": account, "reason": ICloudError.unavailable.localizedDescription]
    }
    guard Self.account() == account else {
      return ["available": false, "accountId": NSNull(), "reason": ICloudError.account.localizedDescription]
    }
    return ["available": true, "accountId": account, "reason": "iCloud Drive is available."]
  }

  func reserve(account: String) throws -> String { try gate.begin(account: account) }

  func open(session: String) throws -> String {
    do {
      try gate.check(session)
      guard let container = container() else { throw ICloudError.unavailable }
      let root = container.appendingPathComponent("Documents", isDirectory: true)
      try coordinateWrite(root) { target in
        try self.gate.withActive(session) {
          try ICloudPolicy.safe(target, within: container)
          try self.files.createDirectory(at: target, withIntermediateDirectories: true)
        }
      }
      try gate.withActive(session) {
        rootsLock.lock(); roots = [session: root]; rootsLock.unlock()
      }
      discovery.start(session: session, root: root, valid: { (try? self.gate.check(session)) != nil })
      return session
    } catch {
      gate.cancel(session)
      throw error
    }
  }

  func close() {
    gate.close()
    rootsLock.lock(); roots.removeAll(); rootsLock.unlock()
    discovery.stop()
  }

  private func root(_ session: String) throws -> URL {
    try gate.check(session)
    rootsLock.lock(); let root = roots[session]; rootsLock.unlock()
    guard let root else { throw ICloudError.cancelled }
    return root
  }

  private var documents: URL {
    files.urls(for: .documentDirectory, in: .userDomainMask)[0].standardizedFileURL.resolvingSymlinksInPath()
  }

  func identify(uri: String, bytes: Int64) throws -> String {
    let source = try ICloudPolicy.localSource(uri, bytes: bytes, documents: documents)
    return try ICloudPolicy.stream(source, bytes: bytes)
  }

  func scan(session: String) throws -> [String: Any] {
    let root = try root(session)
    let snapshot = discovery.snapshot(session: session)
    var urls = Set(snapshot.items.keys)
    // Include newly published local files while their metadata query event is still pending.
    var errors = snapshot.errors
    // Day folders hold recording folders; older recording folders sit directly under the root.
    func add(_ folder: URL, nested: Bool) throws {
      try ICloudPolicy.safe(folder, within: root)
      let children = try files.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles])
      if children.count > 500 { errors += 1 }
      for child in children.prefix(500) {
        if urls.count >= 50_000 { errors += 1; return }
        if !nested, (try? child.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true {
          guard (try? ICloudPolicy.component(child.lastPathComponent)) != nil else { continue }
          do { try add(child, nested: true) } catch { errors += 1 }
        } else {
          urls.insert(child)
        }
      }
    }
    if let folders = try? files.contentsOfDirectory(at: root, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles]) {
      for folder in folders.prefix(10_000) where (try? ICloudPolicy.component(folder.lastPathComponent)) != nil {
        if urls.count >= 50_000 { errors += 1; break }
        do { try add(folder, nested: false) } catch { errors += 1 }
      }
      if folders.count > 10_000 { errors += 1 }
    }
    // Metadata and directory listings name the same file under different path aliases; one entry per path.
    var metadataByPath: [String: [String: Any]] = [:]
    for (url, metadata) in snapshot.items {
      if let relative = ICloudPolicy.relative(url, within: root) { metadataByPath[relative] = metadata }
    }
    var output: [String: [String: Any]] = [:]
    for url in urls.prefix(50_000) {
      try gate.check(session)
      guard let relative = ICloudPolicy.relative(url, within: root), output[relative] == nil,
        (try? ICloudPolicy.path(relative)) != nil else { continue }
      let file = root.appendingPathComponent(relative)
      do {
        try ICloudPolicy.safe(file, within: root)
        if var metadata = metadataByPath[relative] {
          // Metadata can arrive before the placeholder's filesystem resource values are available.
          metadata["path"] = relative
          output[relative] = (try? ICloudDiscovery.file(file, path: relative)) ?? metadata
        } else {
          output[relative] = try ICloudDiscovery.file(file, path: relative)
        }
      } catch { errors += 1 }
    }
    if urls.count > 50_000 { errors += 1 }
    try gate.check(session)
    return ["gathering": snapshot.gathering, "files": output.keys.sorted().compactMap { output[$0] }, "errors": errors]
  }

  func putText(session: String, path: String, text: String) throws {
    let root = try root(session)
    let destination = root.appendingPathComponent(try ICloudPolicy.path(path, audio: false))
    let data = Data(text.utf8)
    guard data.count <= ICloudPolicy.textLimit else { throw ICloudError.size }
    let staging = try ICloudPolicy.staging(near: root)
    defer { try? files.removeItem(at: staging) }
    let prepared = staging.appendingPathComponent("text")
    try data.write(to: prepared)
    try publish(session: session, root: root, prepared: prepared, destination: destination) { existing in
      guard try ICloudPolicy.readText(existing) == data else { throw ICloudError.conflict }
    }
  }

  func putAudio(session: String, folder: String, uri: String, bytes: Int64, sha256: String) throws {
    let root = try root(session)
    _ = try ICloudPolicy.folder(folder)
    // The copy below and any existing file are both checked against this checksum.
    guard ICloudPolicy.isDigest(sha256) else { throw ICloudError.integrity }
    let source = try ICloudPolicy.localSource(uri, bytes: bytes, documents: documents)
    let destination = root.appendingPathComponent(folder).appendingPathComponent("audio.mp3")
    let staging = try ICloudPolicy.staging(near: root)
    defer { try? files.removeItem(at: staging) }
    let prepared = staging.appendingPathComponent("audio.mp3")
    try copy(source, to: prepared, bytes: bytes, sha256: sha256, session: session)
    try publish(session: session, root: root, prepared: prepared, destination: destination) { existing in
      guard try ICloudPolicy.stream(existing, bytes: bytes, check: { try self.gate.checkpoint(session) }) == sha256 else {
        throw ICloudError.conflict
      }
    }
  }

  private func publish(session: String, root: URL, prepared: URL, destination: URL,
    same: (URL) throws -> Void) throws {
    let folder = destination.deletingLastPathComponent()
    try coordinateWrite(folder) { coordinatedFolder in
      try self.gate.withActive(session) {
        try ICloudPolicy.safe(coordinatedFolder, within: root)
        do {
          // The day folder is created along with the first recording of that day.
          try self.files.createDirectory(at: coordinatedFolder, withIntermediateDirectories: true)
        } catch CocoaError.fileWriteFileExists {
          // Audio, metadata and text share one recording folder; the first file created it.
          var isDirectory: ObjCBool = false
          guard self.files.fileExists(atPath: coordinatedFolder.path, isDirectory: &isDirectory),
            isDirectory.boolValue else { throw ICloudError.conflict }
        }
      }
    }
    var wrote = false
    try coordinateWrite(destination) { target in
      try self.gate.check(session)
      try ICloudPolicy.safe(target, within: root)
      if self.files.fileExists(atPath: target.path) || self.files.isUbiquitousItem(at: target) {
        guard try !ICloudDiscovery.conflicts(target) else { throw ICloudError.conflict }
        guard try ICloudDiscovery.ready(target) else {
          try self.gate.withActive(session) { try self.files.startDownloadingUbiquitousItem(at: target) }
          throw ICloudError.pending
        }
        try same(target)
        try self.gate.check(session)
        return
      }
      try self.gate.withActive(session) {
        try ICloudPolicy.safe(target, within: root)
        try ICloudPolicy.publish(prepared, to: target)
      }
      wrote = true
    }
    // An identical existing file is not news; announcing it would start another sync immediately.
    if wrote { change() }
  }

  func readText(session: String, path: String) throws -> String? {
    let root = try root(session)
    let source = root.appendingPathComponent(try ICloudPolicy.path(path, audio: false))
    return try readReady(session: session, root: root, source: source) { url in
      guard let text = String(data: try ICloudPolicy.readText(url), encoding: .utf8) else { throw ICloudError.integrity }
      return text
    }
  }

  func downloadAudio(session: String, path: String, bytes: Int64, sha256: String) throws -> String? {
    let root = try root(session)
    let source = root.appendingPathComponent(try ICloudPolicy.path(path, audio: true))
    // Folder names no longer carry the checksum; the streamed copy below is verified against it.
    guard ICloudPolicy.isDigest(sha256) else { throw ICloudError.integrity }
    let library = documents.appendingPathComponent("recordings")
    try ICloudPolicy.safe(library, within: documents)
    try files.createDirectory(at: library, withIntermediateDirectories: true)
    let destination = library.appendingPathComponent("icloud_\(sha256).mp3")
    if files.fileExists(atPath: destination.path) {
      try ICloudPolicy.safe(destination, within: library)
      guard try ICloudPolicy.stream(destination, bytes: bytes, check: { try self.gate.checkpoint(session) }) == sha256
      else { throw ICloudError.integrity }
      try gate.check(session)
      return destination.absoluteString
    }
    return try readReady(session: session, root: root, source: source) { url in
      let staging = try ICloudPolicy.staging(near: library)
      defer { try? self.files.removeItem(at: staging) }
      let prepared = staging.appendingPathComponent("audio.mp3")
      try self.copy(url, to: prepared, bytes: bytes, sha256: sha256, session: session)
      try self.gate.withActive(session) {
        try ICloudPolicy.safe(destination, within: library)
        try ICloudPolicy.publish(prepared, to: destination)
      }
      return destination.absoluteString
    }
  }

  /// Renames a recording folder, or merges it into `to` when that exists: missing files move across and
  /// byte-identical duplicates are removed. Anything that differs, or is not downloaded yet, stays where it is.
  func moveFolder(session: String, from: String, to: String, sha256: String) throws {
    let root = try root(session)
    guard from != to, ICloudPolicy.isDigest(sha256) else { throw ICloudError.path }
    let source = root.appendingPathComponent(try ICloudPolicy.folder(from), isDirectory: true)
    let target = root.appendingPathComponent(try ICloudPolicy.folder(to), isDirectory: true)
    var changed = false
    var failure: Error?
    var coordinationError: NSError?
    let coordinator = NSFileCoordinator()
    coordinator.coordinate(writingItemAt: source, options: .forMoving, writingItemAt: target, options: .forMerging,
      error: &coordinationError) { source, target in
      do {
        try self.gate.withActive(session) {
          try ICloudPolicy.safe(source, within: root)
          try ICloudPolicy.safe(target, within: root)
          var isDirectory: ObjCBool = false
          guard self.files.fileExists(atPath: source.path, isDirectory: &isDirectory), isDirectory.boolValue else { return }
          defer {
            // A day folder emptied by this move goes too; the root never does.
            let parent = source.deletingLastPathComponent()
            if parent.standardizedFileURL.path != root.standardizedFileURL.path,
              (try? self.files.contentsOfDirectory(atPath: parent.path))?.isEmpty == true {
              try? self.files.removeItem(at: parent)
            }
          }
          if !self.files.fileExists(atPath: target.path) {
            try self.files.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
            coordinator.item(at: source, willMoveTo: target)
            try self.files.moveItem(at: source, to: target)
            coordinator.item(at: source, didMoveTo: target)
            changed = true
            return
          }
          for child in try self.files.contentsOfDirectory(at: source, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles]) {
            let name = child.lastPathComponent
            // Only this archive's files are merged; anything else a person put there stays.
            guard (try? ICloudPolicy.path("\(to)/\(name)")) != nil else { continue }
            let destination = target.appendingPathComponent(name)
            if !self.files.fileExists(atPath: destination.path) && !self.files.isUbiquitousItem(at: destination) {
              try self.files.moveItem(at: child, to: destination)
              changed = true
            } else if try self.identical(child, destination, sha256: sha256, session: session) {
              try self.files.removeItem(at: child)
              changed = true
            }
          }
          if (try? self.files.contentsOfDirectory(atPath: source.path))?.isEmpty == true {
            try self.files.removeItem(at: source)
            changed = true
          }
        }
      } catch { failure = error }
    }
    if let failure { throw failure }
    if coordinationError != nil { throw ICloudError.file }
    if changed { change() }
  }

  /// Both copies are downloaded, conflict-free and equal: audio by checksum, text byte for byte.
  private func identical(_ a: URL, _ b: URL, sha256: String, session: String) throws -> Bool {
    for url in [a, b] {
      guard try ICloudDiscovery.ready(url), try !ICloudDiscovery.conflicts(url) else { return false }
    }
    if a.lastPathComponent == "audio.mp3" {
      for url in [a, b] {
        guard let size = (try? files.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.int64Value,
          try ICloudPolicy.stream(url, bytes: size, check: { try self.gate.checkpoint(session) }) == sha256 else { return false }
      }
      return true
    }
    return try ICloudPolicy.readText(a) == ICloudPolicy.readText(b)
  }

  private func copy(_ source: URL, to destination: URL, bytes: Int64, sha256: String, session: String) throws {
    guard files.createFile(atPath: destination.path, contents: nil) else { throw ICloudError.file }
    let output = try FileHandle(forWritingTo: destination)
    defer { try? output.close() }
    guard try ICloudPolicy.stream(source, bytes: bytes, output: output, check: { try self.gate.checkpoint(session) }) == sha256
    else { throw ICloudError.integrity }
  }

  private func readReady<T>(session: String, root: URL, source: URL, read: (URL) throws -> T) throws -> T? {
    try ICloudPolicy.safe(source, within: root)
    guard files.fileExists(atPath: source.path) || files.isUbiquitousItem(at: source) else {
      try gate.withActive(session) { try? files.startDownloadingUbiquitousItem(at: source) }
      return nil
    }
    guard try !ICloudDiscovery.conflicts(source) else { throw ICloudError.conflict }
    guard try ICloudDiscovery.ready(source) else {
      try gate.withActive(session) { try files.startDownloadingUbiquitousItem(at: source) }
      return nil
    }
    var result: Result<T, Error>?
    var coordinationError: NSError?
    NSFileCoordinator().coordinate(readingItemAt: source, options: [], error: &coordinationError) { url in
      result = Result {
        try self.gate.check(session)
        guard url.standardizedFileURL.path == source.standardizedFileURL.path else { throw ICloudError.path }
        try ICloudPolicy.safe(url, within: root)
        guard try !ICloudDiscovery.conflicts(url) else { throw ICloudError.conflict }
        guard try ICloudDiscovery.ready(url) else { throw ICloudError.pending }
        let value = try read(url)
        try self.gate.check(session)
        return value
      }
    }
    if coordinationError != nil { throw ICloudError.file }
    guard let result else { throw ICloudError.file }
    return try result.get()
  }

  private func coordinateWrite(_ url: URL, action: (URL) throws -> Void) throws {
    var failure: Error?
    var coordinationError: NSError?
    NSFileCoordinator().coordinate(writingItemAt: url, options: .forMerging, error: &coordinationError) { target in
      do {
        guard target.standardizedFileURL.path == url.standardizedFileURL.path else { throw ICloudError.path }
        try action(target)
      } catch { failure = error }
    }
    if let failure { throw failure }
    if coordinationError != nil { throw ICloudError.file }
  }
}
