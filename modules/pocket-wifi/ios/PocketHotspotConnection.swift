import Foundation
import NetworkExtension

final class PocketHotspotConnection: @unchecked Sendable {
  typealias Completion = (Result<Void, PocketWifiError>) -> Void
  private let queue = DispatchQueue(label: "openpocket.wifi.hotspot")
  private var pending: Request?
  private var joinedSSID: String?

  private final class Request {
    let ssid: String
    let completion: Completion
    var timeout: DispatchWorkItem?

    init(ssid: String, completion: @escaping Completion) {
      self.ssid = ssid
      self.completion = completion
    }
  }

  func join(ssid: String, password: String, completion: @escaping Completion) {
    queue.async {
      guard self.pending == nil, self.joinedSSID == nil || self.joinedSSID == ssid else {
        completion(.failure(PocketWifiError("E_HOTSPOT_BUSY", "Leave the previous Pocket network before joining another.")))
        return
      }
      guard !ssid.isEmpty, ssid.utf8.count <= 32, (8...63).contains(password.utf8.count) else {
        completion(.failure(PocketWifiError("E_INVALID_HOTSPOT", "Pocket returned invalid Wi-Fi connection details.")))
        return
      }
      let request = Request(ssid: ssid, completion: completion)
      self.pending = request
      let timeout = DispatchWorkItem { [weak self, weak request] in
        guard let self, let request, self.pending === request else { return }
        self.finish(request, result: .failure(PocketWifiError("E_HOTSPOT_TIMEOUT", "Joining Pocket's Wi-Fi timed out. Retry and accept the iPhone network prompt.")))
        self.removeConfiguration(ssid)
      }
      request.timeout = timeout
      self.queue.asyncAfter(deadline: .now() + 90, execute: timeout)
      DispatchQueue.main.async {
        let configuration = NEHotspotConfiguration(ssid: ssid, passphrase: password, isWEP: false)
        configuration.hidden = true
        configuration.joinOnce = true
        NEHotspotConfigurationManager.shared.apply(configuration) { error in
          self.queue.async {
            guard self.pending === request else {
              // A cancelled apply can finish later; don't leave its network attached.
              if self.joinedSSID != ssid, self.pending?.ssid != ssid { self.removeConfiguration(ssid) }
              return
            }
            if let error = error as NSError?,
              !(error.domain == NEHotspotConfigurationErrorDomain && error.code == NEHotspotConfigurationError.alreadyAssociated.rawValue) {
              let message = error.code == NEHotspotConfigurationError.userDenied.rawValue
                ? "The iPhone network prompt was declined. Retry and allow joining Pocket's Wi-Fi."
                : "The iPhone could not join Pocket's Wi-Fi. Keep Open Pocket in the foreground and retry."
              self.finish(request, result: .failure(PocketWifiError("E_HOTSPOT_JOIN", message)))
              self.removeConfiguration(ssid)
            } else {
              self.joinedSSID = ssid
              self.finish(request, result: .success(()))
            }
          }
        }
      }
    }
  }

  func leave(ssid: String, completion: @escaping Completion) {
    queue.async {
      if let request = self.pending, request.ssid == ssid {
        self.finish(request, result: .failure(PocketWifiError("E_CANCELLED", "Joining Pocket's Wi-Fi was cancelled.")))
        self.removeConfiguration(ssid)
      }
      if self.joinedSSID == ssid {
        self.joinedSSID = nil
        self.removeConfiguration(ssid)
      }
      completion(.success(()))
    }
  }

  func dispose() {
    queue.async {
      if let request = self.pending {
        self.finish(request, result: .failure(PocketWifiError("E_CANCELLED", "The Wi-Fi connection was cancelled.")))
        self.removeConfiguration(request.ssid)
      }
      if let ssid = self.joinedSSID {
        self.joinedSSID = nil
        self.removeConfiguration(ssid)
      }
    }
  }

  private func finish(_ request: Request, result: Result<Void, PocketWifiError>) {
    guard pending === request else { return }
    pending = nil
    request.timeout?.cancel()
    request.timeout = nil
    request.completion(result)
  }

  private func removeConfiguration(_ ssid: String) {
    DispatchQueue.main.async {
      NEHotspotConfigurationManager.shared.removeConfiguration(forSSID: ssid)
    }
  }
}
