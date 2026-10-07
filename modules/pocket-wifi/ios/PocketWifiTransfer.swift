import Foundation
import Network

final class PocketWifiTransfer: @unchecked Sendable {
  typealias OpenCompletion = (Result<Void, PocketWifiError>) -> Void
  typealias TransferCompletion = (Result<(bytesWritten: Int, uri: String), PocketWifiError>) -> Void
  private let queue = DispatchQueue(label: "openpocket.wifi.transfer")
  private var session: Session?
  private var lastError: PocketWifiError?
  var onProgress: ((Int) -> Void)?

  private final class Session {
    let destination: URL
    let connection: NWConnection
    var file: FileHandle?
    var decoder = PocketStreamDecoder()
    var openCompletion: OpenCompletion?
    var transferCompletion: TransferCompletion?
    var timeout: DispatchWorkItem?
    var ended = false
    var ready = false
    var lastProgress = Date.distantPast

    init(destination: URL, connection: NWConnection, file: FileHandle, completion: @escaping OpenCompletion) {
      self.destination = destination
      self.connection = connection
      self.file = file
      self.openCompletion = completion
    }
  }

  func open(destinationUri: String, completion: @escaping OpenCompletion) {
    queue.async {
      guard self.session == nil else {
        completion(.failure(PocketWifiError("E_TRANSFER_BUSY", "A Wi-Fi transfer is already in progress.")))
        return
      }
      var destination: URL?
      do {
        let url = try self.validateDestination(destinationUri)
        destination = url
        if !FileManager.default.fileExists(atPath: url.path) {
          guard FileManager.default.createFile(atPath: url.path, contents: nil) else {
            throw PocketWifiError("E_TRANSFER_FILE", "The temporary recording file could not be created.")
          }
        }
        let file = try FileHandle(forWritingTo: url)
        do { try file.truncate(atOffset: 0) } catch { try? file.close(); throw error }
        let parameters = NWParameters.tcp
        parameters.requiredInterfaceType = .wifi
        parameters.prohibitedInterfaceTypes = [.cellular]
        let connection = NWConnection(host: "192.168.200.1", port: 8475, using: parameters)
        let session = Session(destination: url, connection: connection, file: file, completion: completion)
        self.session = session
        self.lastError = nil
        connection.stateUpdateHandler = { [weak self, weak session] state in
          guard let self, let session, self.session === session else { return }
          self.handleState(state, session: session)
        }
        self.armTimeout(session, seconds: 20, error: PocketWifiError("E_WIFI_CONNECT", "Pocket's Wi-Fi socket did not open. Confirm the recorder's hotspot is ready and retry."))
        connection.start(queue: self.queue)
      } catch {
        if let destination { try? FileManager.default.removeItem(at: destination) }
        completion(.failure(self.asError(error)))
      }
    }
  }

  func complete(expectedBytes: Double, completion: @escaping TransferCompletion) {
    queue.async {
      guard let session = self.session else {
        completion(.failure(self.lastError ?? PocketWifiError("E_NO_TRANSFER", "Open a Pocket Wi-Fi transfer before completing it.")))
        return
      }
      guard session.ready, session.transferCompletion == nil else {
        completion(.failure(PocketWifiError("E_TRANSFER_BUSY", "The Wi-Fi transfer is not ready or is already awaiting completion.")))
        return
      }
      guard expectedBytes.isFinite, expectedBytes.rounded(.towardZero) == expectedBytes,
        expectedBytes > 0, expectedBytes <= 9_007_199_254_740_991 else {
        completion(.failure(PocketWifiError("E_INVALID_SIZE", "The recording size must be a positive integer.")))
        return
      }
      session.transferCompletion = completion
      do {
        try session.decoder.setExpectedBytes(Int(expectedBytes))
        self.tryFinish(session)
      } catch { self.fail(session, error: self.asError(error)) }
    }
  }

  func cancel(completion: @escaping OpenCompletion) {
    queue.async {
      if let session = self.session {
        self.fail(session, error: PocketWifiError("E_CANCELLED", "The recording download was cancelled."))
      }
      completion(.success(()))
    }
  }

  func dispose() {
    queue.async {
      if let session = self.session {
        self.fail(session, error: PocketWifiError("E_CANCELLED", "The recording download was cancelled."))
      }
      self.onProgress = nil
    }
  }

  private func handleState(_ state: NWConnection.State, session: Session) {
    switch state {
    case .ready:
      guard !session.ready else { return }
      session.ready = true
      self.armIdleTimeout(session)
      let completion = session.openCompletion
      session.openCompletion = nil
      completion?(.success(()))
      self.receive(session)
    case .failed:
      self.fail(session, error: PocketWifiError("E_WIFI_SOCKET", "Pocket's Wi-Fi connection failed. Allow Local Network access in iPhone settings, then retry the download."))
    case .cancelled:
      self.fail(session, error: PocketWifiError("E_CANCELLED", "Pocket's Wi-Fi connection was closed."))
    default:
      break
    }
  }

  private func receive(_ session: Session) {
    session.connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self, weak session] data, _, ended, error in
      guard let self, let session, self.session === session else { return }
      do {
        if let data, !data.isEmpty {
          let payload = try session.decoder.append(data)
          try session.file?.write(contentsOf: payload)
          self.armIdleTimeout(session)
          if Date().timeIntervalSince(session.lastProgress) >= 0.15 {
            session.lastProgress = Date()
            self.onProgress?(session.decoder.payloadBytes)
          }
        }
        session.ended = ended
        if error != nil, !session.decoder.hasExpectedLength {
          self.fail(session, error: PocketWifiError("E_WIFI_INTERRUPTED", "Pocket's Wi-Fi transfer was interrupted. Keep the phone nearby and retry."))
          return
        }
        self.tryFinish(session)
        if self.session === session, !ended, error == nil { self.receive(session) }
      } catch { self.fail(session, error: self.asError(error)) }
    }
  }

  private func tryFinish(_ session: Session) {
    guard session.decoder.expectedBytes != nil else { return }
    guard session.decoder.hasExpectedLength || session.ended else { return }
    do {
      try session.decoder.validateComplete()
      try session.file?.synchronize()
      try session.file?.close()
      session.file = nil
      let completion = session.transferCompletion
      session.transferCompletion = nil
      self.onProgress?(session.decoder.payloadBytes)
      self.cleanup(session, removeFile: false)
      completion?(.success((session.decoder.payloadBytes, session.destination.absoluteString)))
    } catch { self.fail(session, error: self.asError(error)) }
  }

  private func fail(_ session: Session, error: PocketWifiError) {
    guard self.session === session else { return }
    lastError = error
    let open = session.openCompletion
    let complete = session.transferCompletion
    session.openCompletion = nil
    session.transferCompletion = nil
    cleanup(session, removeFile: true)
    open?(.failure(error))
    complete?(.failure(error))
  }

  private func cleanup(_ session: Session, removeFile: Bool) {
    self.session = nil
    session.timeout?.cancel()
    session.timeout = nil
    session.connection.stateUpdateHandler = nil
    session.connection.cancel()
    try? session.file?.close()
    session.file = nil
    if removeFile { try? FileManager.default.removeItem(at: session.destination) }
  }

  private func armIdleTimeout(_ session: Session) {
    armTimeout(session, seconds: 30, error: PocketWifiError("E_WIFI_TIMEOUT", "No recording bytes arrived for 30 seconds. Retry the Wi-Fi download."))
  }

  private func armTimeout(_ session: Session, seconds: Double, error: PocketWifiError) {
    session.timeout?.cancel()
    let timeout = DispatchWorkItem { [weak self, weak session] in
      guard let self, let session, self.session === session else { return }
      self.fail(session, error: error)
    }
    session.timeout = timeout
    queue.asyncAfter(deadline: .now() + seconds, execute: timeout)
  }

  private func validateDestination(_ uri: String) throws -> URL {
    guard let url = URL(string: uri), url.isFileURL, url.pathExtension == "part",
      url.query == nil, url.fragment == nil, url.host == nil || url.host == "" || url.host == "localhost" else {
      throw PocketWifiError("E_TRANSFER_FILE", "Wi-Fi downloads require a temporary .part file in app storage.")
    }
    let destination = url.standardizedFileURL.resolvingSymlinksInPath()
    let roots = [
      FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first,
      FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first,
      FileManager.default.temporaryDirectory,
    ].compactMap { $0?.standardizedFileURL.resolvingSymlinksInPath() }
    guard roots.contains(where: { destination.path.hasPrefix($0.path + "/") }) else {
      throw PocketWifiError("E_TRANSFER_FILE", "The temporary recording must be inside app documents, cache, or temporary storage.")
    }
    guard FileManager.default.fileExists(atPath: destination.deletingLastPathComponent().path) else {
      throw PocketWifiError("E_TRANSFER_FILE", "Create the app recording folder before starting the download.")
    }
    return destination
  }

  private func asError(_ error: Error) -> PocketWifiError {
    error as? PocketWifiError ?? PocketWifiError("E_TRANSFER_FILE", "The temporary recording file could not be written. Check available iPhone storage and retry.")
  }
}
