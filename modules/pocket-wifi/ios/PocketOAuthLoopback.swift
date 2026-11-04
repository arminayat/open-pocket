import Foundation
import Network

/// Pocket only registers HTTPS or loopback HTTP redirects. During sign-in this listens on
/// 127.0.0.1 and forwards `/callback?…` to the app scheme the auth session is watching.
final class PocketOAuthLoopback: @unchecked Sendable {
  static let appCallback = "openpocket://oauth/callback"
  private static let maxRequestBytes = 16_384
  private let queue = DispatchQueue(label: "openpocket.oauth.loopback")
  private var listener: NWListener?

  func start(completion: @escaping (Result<Int, PocketWifiError>) -> Void) {
    queue.async {
      self.stopOnQueue()
      let parameters = NWParameters.tcp
      parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
      let listener: NWListener
      do { listener = try NWListener(using: parameters) } catch {
        completion(.failure(PocketWifiError("E_OAUTH_LOOPBACK", "Sign-in could not prepare its return address.")))
        return
      }
      var settled = false
      listener.stateUpdateHandler = { [weak self, weak listener] state in
        guard let self, let listener, self.listener === listener, !settled else { return }
        switch state {
        case .ready:
          guard let port = listener.port?.rawValue else { return }
          settled = true
          completion(.success(Int(port)))
        case .failed, .cancelled:
          settled = true
          self.stopOnQueue()
          completion(.failure(PocketWifiError("E_OAUTH_LOOPBACK", "Sign-in could not open its return address.")))
        default: break
        }
      }
      listener.newConnectionHandler = { [weak self] connection in self?.serve(connection) }
      self.listener = listener
      listener.start(queue: self.queue)
    }
  }

  func stop(completion: @escaping () -> Void) {
    queue.async { self.stopOnQueue(); completion() }
  }

  private func stopOnQueue() {
    listener?.cancel()
    listener = nil
  }

  private func serve(_ connection: NWConnection) {
    connection.start(queue: queue)
    receive(connection, buffer: Data())
  }

  private func receive(_ connection: NWConnection, buffer: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: Self.maxRequestBytes) { [weak self] data, _, done, error in
      guard let self else { connection.cancel(); return }
      var request = buffer
      if let data { request.append(data) }
      if request.range(of: Data("\r\n\r\n".utf8)) != nil || done || error != nil
          || request.count >= Self.maxRequestBytes {
        self.respond(connection, request: request)
      } else {
        self.receive(connection, buffer: request)
      }
    }
  }

  private func respond(_ connection: NWConnection, request: Data) {
    let response: String
    if let location = Self.redirectLocation(for: request) {
      response = "HTTP/1.1 302 Found\r\nLocation: \(location)\r\nCache-Control: no-store\r\n"
        + "Content-Length: 0\r\nConnection: close\r\n\r\n"
    } else {
      response = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    }
    connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in connection.cancel() })
  }

  /// Only `GET /callback?<query>` is relayed; the query must be plain URL characters.
  static func redirectLocation(for request: Data) -> String? {
    guard let text = String(data: request.prefix(maxRequestBytes), encoding: .utf8),
          let line = text.components(separatedBy: "\r\n").first else { return nil }
    let parts = line.split(separator: " ", omittingEmptySubsequences: false)
    guard parts.count == 3, parts[0] == "GET", parts[2].hasPrefix("HTTP/1.") else { return nil }
    let target = parts[1]
    guard target.hasPrefix("/callback?") else { return nil }
    let query = target.dropFirst("/callback?".count)
    let allowed = CharacterSet(charactersIn:
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~%!$&'()*+,;=:@/?")
    guard !query.isEmpty, query.unicodeScalars.allSatisfy(allowed.contains) else { return nil }
    return "\(appCallback)?\(query)"
  }
}
