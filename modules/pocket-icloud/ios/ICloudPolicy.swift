import Foundation
import CryptoKit
import Darwin

enum ICloudError: String, LocalizedError {
  case unavailable = "E_ICLOUD_UNAVAILABLE"
  case account = "E_ICLOUD_ACCOUNT"
  case cancelled = "E_ICLOUD_CANCELLED"
  case path = "E_ICLOUD_PATH"
  case file = "E_ICLOUD_FILE"
  case size = "E_ICLOUD_SIZE"
  case conflict = "E_ICLOUD_CONFLICT"
  case integrity = "E_ICLOUD_INTEGRITY"
  case pending = "E_ICLOUD_PENDING"

  var errorDescription: String? {
    switch self {
    case .unavailable: return "iCloud Drive is unavailable. Check iCloud Drive and this app's signing configuration."
    case .account: return "The iCloud account changed. Enable sync again for the current account."
    case .cancelled: return "iCloud sync stopped."
    case .path: return "An iCloud recording file has an unsupported location."
    case .file: return "An iCloud recording file could not be read or saved. Check free storage and try again."
    case .size: return "The file exceeds the iCloud sync limit. Audio must be at most 2 GB; text at most 8 MB."
    case .conflict: return "An iCloud file has conflicting versions. Both versions have been preserved."
    case .integrity: return "An iCloud recording file failed its size or content check."
    case .pending: return "An iCloud file is still downloading. Try syncing again when it is available."
    }
  }
}

enum ICloudPolicy {
  static let audioLimit: Int64 = 2_000_000_000
  static let textLimit: Int64 = 8_000_000

  static func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
  static func isDigest(_ value: String) -> Bool {
    value.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
  }

  /// Folder names are readable labels (date, time, title) that people may also rename; a recording's identity is
  /// the checksum in its `recording.json`. Same rule as the app: no separators, colons, control characters or leading dot.
  /// A recording folder: `YYYY-MM-DD/<name>`, or one top-level name (older layouts and folders people made).
  static func folder(_ value: String) throws -> String {
    let parts = value.split(separator: "/", omittingEmptySubsequences: false)
    guard (1...2).contains(parts.count) else { throw ICloudError.path }
    for part in parts { _ = try component(String(part)) }
    return value
  }

  static func component(_ value: String) throws -> String {
    guard (1...200).contains(value.utf8.count), !value.hasPrefix("."), value != "..",
      value.trimmingCharacters(in: .whitespaces) == value,
      !value.unicodeScalars.contains(where: { "/\\:".unicodeScalars.contains($0) || CharacterSet.controlCharacters.contains($0) })
    else { throw ICloudError.path }
    return value
  }

  static func path(_ value: String, audio: Bool? = nil) throws -> String {
    let parts = value.split(separator: "/", omittingEmptySubsequences: false)
    guard (2...3).contains(parts.count) else { throw ICloudError.path }
    _ = try folder(parts.dropLast().joined(separator: "/"))
    let name = String(parts[parts.count - 1])
    if name == "audio.mp3" {
      guard audio != false else { throw ICloudError.path }
    } else {
      guard audio != true else { throw ICloudError.path }
      if name != "recording.json" {
        let ext = (name as NSString).pathExtension
        let base = (name as NSString).deletingPathExtension
        guard let prefix = ["transcript-", "note-", "summary-"].first(where: { base.hasPrefix($0) }),
          isDigest(String(base.dropFirst(prefix.count))),
          ext == "json" || (prefix == "transcript-" ? ext == "txt" : ext == "md") else { throw ICloudError.path }
      }
    }
    return value
  }

  /// iOS reports the container as `/private/var/…` from listings and metadata but `/var/…` once symlinks are
  /// resolved. Compare without that alias; returns nil for anything outside `root`.
  static func relative(_ url: URL, within root: URL) -> String? {
    func canonical(_ path: String) -> String { path.hasPrefix("/private/var/") ? String(path.dropFirst(8)) : path }
    let base = canonical(root.standardizedFileURL.path) + "/"
    let path = canonical(url.standardizedFileURL.path)
    guard path.hasPrefix(base), path.count > base.count else { return nil }
    return String(path.dropFirst(base.count))
  }

  /// Reject each existing component, including parents; standardized paths alone do not reject symlinks.
  static func safe(_ url: URL, within root: URL) throws {
    let base = root.standardizedFileURL
    let target = url.standardizedFileURL
    guard target.path == base.path || target.path.hasPrefix(base.path + "/"),
      base.resolvingSymlinksInPath().path == base.path else { throw ICloudError.path }
    var current = target
    while current.path.count >= base.path.count {
      if let attributes = try? FileManager.default.attributesOfItem(atPath: current.path),
        attributes[.type] as? FileAttributeType == .typeSymbolicLink { throw ICloudError.path }
      if current.path == base.path { break }
      current.deleteLastPathComponent()
    }
  }

  static func localSource(_ uri: String, bytes: Int64, documents: URL) throws -> URL {
    guard bytes > 0, bytes <= audioLimit else { throw ICloudError.size }
    guard let url = URL(string: uri), url.isFileURL, url.pathExtension == "mp3",
      url.host == nil || url.host == "" || url.host == "localhost",
      url.user == nil, url.password == nil, url.port == nil, url.query == nil, url.fragment == nil
    else { throw ICloudError.path }
    let recordings = documents.standardizedFileURL.resolvingSymlinksInPath().appendingPathComponent("recordings")
    let normalized = url.standardizedFileURL
    guard normalized.deletingLastPathComponent().resolvingSymlinksInPath().path == recordings.path,
      (try normalized.resourceValues(forKeys: [.isSymbolicLinkKey])).isSymbolicLink == false
    else { throw ICloudError.path }
    let resolved = normalized.resolvingSymlinksInPath()
    try safe(resolved, within: recordings)
    return resolved
  }

  /// Reads only regular files with O_NOFOLLOW; bounded chunks never copy the audio into JS or one Data buffer.
  @discardableResult
  static func stream(_ source: URL, bytes: Int64, output: FileHandle? = nil,
    check: () throws -> Void = {}) throws -> String {
    guard bytes > 0, bytes <= audioLimit else { throw ICloudError.size }
    let descriptor = Darwin.open(source.path, O_RDONLY | O_NOFOLLOW)
    guard descriptor >= 0 else { throw ICloudError.file }
    let input = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
    defer { try? input.close() }
    var information = stat()
    guard fstat(descriptor, &information) == 0, information.st_mode & S_IFMT == S_IFREG,
      information.st_size == bytes else { throw ICloudError.integrity }
    var hash = SHA256()
    var count: Int64 = 0
    while true {
      try check()
      guard let chunk = try input.read(upToCount: 65_536), !chunk.isEmpty else { break }
      count += Int64(chunk.count)
      guard count <= bytes else { throw ICloudError.integrity }
      hash.update(data: chunk)
      try output?.write(contentsOf: chunk)
    }
    guard count == bytes else { throw ICloudError.integrity }
    try output?.synchronize()
    try check()
    return hash.finalize().map { String(format: "%02x", $0) }.joined()
  }

  static func readText(_ url: URL) throws -> Data {
    let descriptor = Darwin.open(url.path, O_RDONLY | O_NOFOLLOW)
    guard descriptor >= 0 else { throw ICloudError.file }
    let input = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
    defer { try? input.close() }
    var information = stat()
    guard fstat(descriptor, &information) == 0, information.st_mode & S_IFMT == S_IFREG,
      information.st_size <= textLimit else { throw ICloudError.size }
    let data = try input.read(upToCount: Int(textLimit) + 1) ?? Data()
    guard data.count <= textLimit, data.count == information.st_size,
      String(data: data, encoding: .utf8) != nil else { throw ICloudError.integrity }
    return data
  }

  /// The staging directory is OS-managed replacement storage on the destination volume, outside Documents.
  static func staging(near destination: URL) throws -> URL {
    try FileManager.default.url(for: .itemReplacementDirectory, in: .userDomainMask,
      appropriateFor: destination, create: true)
  }

  static func publish(_ source: URL, to destination: URL) throws {
    // RENAME_EXCL is atomic and cannot replace an existing file, including a concurrent writer's file.
    guard renamex_np(source.path, destination.path, UInt32(RENAME_EXCL)) == 0 else {
      throw errno == EEXIST ? ICloudError.conflict : ICloudError.file
    }
  }
}

/// Synchronous revocation shares the same lock as final publication; lengthy copies stay outside it.
final class ICloudSessionGate {
  private let lock = NSLock()
  private var active: (id: String, account: String)?
  private let identity: () -> String?
  init(identity: @escaping () -> String?) { self.identity = identity }

  func begin(account: String) throws -> String {
    lock.lock(); defer { lock.unlock() }
    guard ICloudPolicy.isDigest(account), identity() == account else { throw ICloudError.account }
    let id = UUID().uuidString
    active = (id, account)
    return id
  }

  func close() { lock.lock(); active = nil; lock.unlock() }

  func cancel(_ id: String) {
    lock.lock(); defer { lock.unlock() }
    if active?.id == id { active = nil }
  }

  func checkpoint(_ id: String) throws {
    lock.lock(); defer { lock.unlock() }
    guard active?.id == id else { throw ICloudError.cancelled }
  }

  func withActive<T>(_ id: String, _ work: () throws -> T) throws -> T {
    lock.lock(); defer { lock.unlock() }
    guard let active, active.id == id else { throw ICloudError.cancelled }
    guard identity() == active.account else { self.active = nil; throw ICloudError.account }
    return try work()
  }

  func check(_ id: String) throws { try withActive(id) {} }
}

/// Apple defines token identity through isEqual, not archive-byte equality. Cache equal live tokens.
final class ICloudAccountIdentity {
  typealias Token = NSCoding & NSCopying & NSObjectProtocol
  private let lock = NSLock()
  private var token: Token?
  private var digest: String?

  func identifier(for current: Token?) -> String? {
    lock.lock(); defer { lock.unlock() }
    guard let current else { token = nil; digest = nil; return nil }
    if let token, token.isEqual(current) { return digest }
    guard let data = try? NSKeyedArchiver.archivedData(withRootObject: current, requiringSecureCoding: false) else {
      token = nil; digest = nil; return nil
    }
    token = current
    digest = ICloudPolicy.digest(data)
    return digest
  }
}
