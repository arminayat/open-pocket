import ExpoModulesCore

public final class PocketWifiModule: Module {
  private let hotspot = PocketHotspotConnection()
  private let transfer = PocketWifiTransfer()

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

    OnDestroy {
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
