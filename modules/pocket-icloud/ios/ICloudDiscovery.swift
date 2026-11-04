import Foundation

/// NSMetadataQuery is run-loop driven. All query access is confined to the main queue.
final class ICloudDiscovery {
  private var query: NSMetadataQuery?
  private var session: String?
  private var observers: [NSObjectProtocol] = []
  private var didGather = false
  private var failed = false
  /// Last emitted file state. Upload progress and access updates must not restart sync in a loop.
  private var signature: String?
  private let change: () -> Void

  init(change: @escaping () -> Void) { self.change = change }

  func start(session: String, root: URL, valid: @escaping () -> Bool) {
    DispatchQueue.main.async {
      guard valid() else { return }
      self.stopOnMain()
      let query = NSMetadataQuery()
      query.searchScopes = [NSMetadataQueryUbiquitousDocumentsScope]
      // The container path can be reported with or without iOS's `/private` prefix.
      let base = root.standardizedFileURL.path
      let alias = base.hasPrefix("/private/var/") ? String(base.dropFirst(8)) : "/private" + base
      query.predicate = NSPredicate(format: "%K BEGINSWITH %@ OR %K BEGINSWITH %@",
        NSMetadataItemPathKey, base + "/", NSMetadataItemPathKey, alias + "/")
      query.notificationBatchingInterval = 1
      self.query = query
      self.session = session
      for notification in [Notification.Name.NSMetadataQueryDidFinishGathering, .NSMetadataQueryDidUpdate] {
        self.observers.append(NotificationCenter.default.addObserver(forName: notification,
          object: query, queue: .main) { [weak self] event in
          guard let self, let query = self.query else { return }
          let gathered = event.name == .NSMetadataQueryDidFinishGathering
          if gathered { self.didGather = true }
          query.disableUpdates()
          let next = self.describe(query).map { "\($0.url.path)|\($0.state)" }.sorted().joined(separator: "\n")
          query.enableUpdates()
          guard gathered || next != self.signature else { return }
          self.signature = next
          self.change()
        })
      }
      if !query.start() { self.failed = true; self.change() }
    }
  }

  func stop() { DispatchQueue.main.async { self.stopOnMain() } }

  private func stopOnMain() {
    observers.forEach(NotificationCenter.default.removeObserver)
    observers = []
    query?.stop()
    query = nil
    session = nil
    didGather = false
    failed = false
    signature = nil
  }

  /// Sync-relevant state per result: readiness, upload completion, conflicts and transfer errors.
  private func describe(_ query: NSMetadataQuery) -> [(url: URL, item: [String: Any], failed: Bool, state: String)] {
    (0..<min(query.resultCount, 50_000)).compactMap { index in
      guard let item = query.result(at: index) as? NSMetadataItem,
        let url = item.value(forAttribute: NSMetadataItemURLKey) as? URL else { return nil }
      let status = item.value(forAttribute: NSMetadataUbiquitousItemDownloadingStatusKey) as? String
      let downloaded = status == NSMetadataUbiquitousItemDownloadingStatusCurrent
        || status == NSMetadataUbiquitousItemDownloadingStatusDownloaded
      let uploaded = item.value(forAttribute: NSMetadataUbiquitousItemIsUploadedKey) as? Bool == true
      let conflict = item.value(forAttribute: NSMetadataUbiquitousItemHasUnresolvedConflictsKey) as? Bool == true
      let failed = item.value(forAttribute: NSMetadataUbiquitousItemDownloadingErrorKey) != nil
        || item.value(forAttribute: NSMetadataUbiquitousItemUploadingErrorKey) != nil
      return (url, ["downloaded": downloaded, "uploaded": uploaded, "conflict": conflict], failed,
        "\(downloaded)\(uploaded)\(conflict)\(failed)")
    }
  }

  func snapshot(session: String) -> (gathering: Bool, items: [URL: [String: Any]], errors: Int) {
    DispatchQueue.main.sync {
      guard self.session == session, let query else { return (true, [:], 0) }
      if failed { failed = !query.start() }
      query.disableUpdates()
      defer { query.enableUpdates() }
      var items: [URL: [String: Any]] = [:]
      var errors = query.resultCount > 50_000 || failed ? 1 : 0
      for result in describe(query) {
        items[result.url] = result.item
        if result.failed { errors += 1 }
      }
      return (!didGather, items, errors)
    }
  }

  static func ready(_ url: URL) throws -> Bool {
    let values = try url.resourceValues(forKeys: [.isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey,
      .ubiquitousItemDownloadingErrorKey])
    if values.ubiquitousItemDownloadingError != nil { throw ICloudError.file }
    if values.isUbiquitousItem != true { return FileManager.default.fileExists(atPath: url.path) }
    return values.ubiquitousItemDownloadingStatus == .current || values.ubiquitousItemDownloadingStatus == .downloaded
  }

  static func conflicts(_ url: URL) throws -> Bool {
    let values = try url.resourceValues(forKeys: [.ubiquitousItemHasUnresolvedConflictsKey])
    return values.ubiquitousItemHasUnresolvedConflicts == true
      || !(NSFileVersion.unresolvedConflictVersionsOfItem(at: url) ?? []).isEmpty
  }

  static func file(_ url: URL, path: String) throws -> [String: Any] {
    let values = try url.resourceValues(forKeys: [.ubiquitousItemIsUploadedKey,
      .ubiquitousItemUploadingErrorKey])
    if values.ubiquitousItemUploadingError != nil { throw ICloudError.file }
    return ["path": path, "downloaded": try ready(url), "uploaded": values.ubiquitousItemIsUploaded == true,
      "conflict": try conflicts(url)]
  }
}
