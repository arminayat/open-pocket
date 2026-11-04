import ExpoModulesCore
import Foundation

public final class PocketWifiModule: Module {
  private let hotspot = PocketHotspotConnection()
  private let transfer = PocketWifiTransfer()
  private let oauthLoopback = PocketOAuthLoopback()

  public func definition() -> ModuleDefinition {
    Name("PocketWifi")
    Events("transferProgress")

    OnCreate {
      self.transfer.onProgress = { [weak self] bytes in
        self?.sendEvent("transferProgress", ["bytesWritten": bytes])
      }
    }

    AsyncFunction("join") { (ssid: String, password: String, promise: Promise) in
      self.hotspot.join(ssid: ssid, password: password) { result in
        self.settle(promise, result: result)
      }
    }

    AsyncFunction("openTransfer") { (destinationUri: String, promise: Promise) in
      self.transfer.open(destinationUri: destinationUri) { result in
        self.settle(promise, result: result)
      }
    }

    AsyncFunction("completeTransfer") { (expectedBytes: Double, promise: Promise) in
      self.transfer.complete(expectedBytes: expectedBytes) { result in
        switch result {
        case .success(let value):
          promise.resolve(["bytesWritten": value.bytesWritten, "uri": value.uri] as [String: Any])
        case .failure(let error):
          promise.reject(error.code, error.message)
        }
      }
    }

    AsyncFunction("cancel") { (promise: Promise) in
      self.transfer.cancel { result in self.settle(promise, result: result) }
    }

    AsyncFunction("leave") { (ssid: String, promise: Promise) in
      self.hotspot.leave(ssid: ssid) { result in self.settle(promise, result: result) }
    }

    AsyncFunction("startOAuthLoopback") { (promise: Promise) in
      self.oauthLoopback.start { result in
        switch result {
        case .success(let port): promise.resolve(port)
        case .failure(let error): promise.reject(error.code, error.message)
        }
      }
    }

    AsyncFunction("stopOAuthLoopback") { (promise: Promise) in
      self.oauthLoopback.stop { promise.resolve() }
    }

    AsyncFunction("verifyChatGPTIdentity") {
      (idToken: String, jwksJson: String, clientId: String, nonce: String, promise: Promise) in
      do {
        let identity = try ChatGPTIdentity.verify(
          idToken: idToken, jwksJson: jwksJson, clientId: clientId, nonce: nonce
        )
        promise.resolve([
          "subject": identity.subject,
          "email": identity.email.map { $0 as Any } ?? NSNull(),
        ] as [String: Any])
      } catch {
        promise.reject("E_CHATGPT_IDENTITY", "ChatGPT could not verify this sign-in. Please try again.")
      }
    }

    OnDestroy {
      self.oauthLoopback.stop {}
      self.transfer.dispose()
      self.hotspot.dispose()
    }
  }

  private func settle(_ promise: Promise, result: Result<Void, PocketWifiError>) {
    switch result {
    case .success: promise.resolve()
    case .failure(let error): promise.reject(error.code, error.message)
    }
  }
}
