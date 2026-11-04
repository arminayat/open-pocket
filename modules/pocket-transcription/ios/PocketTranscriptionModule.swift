import ExpoModulesCore
import Foundation

public final class PocketTranscriptionModule: Module {
  private let lock = NSLock()
  private var operations: [String: TranscriptionUploadOperation] = [:]

  public func definition() -> ModuleDefinition {
    Name("PocketTranscription")

    Function("reserve") { () -> String in
      let id = UUID().uuidString
      self.lock.lock()
      self.operations[id] = TranscriptionUploadOperation()
      self.lock.unlock()
      return id
    }

    Function("cancel") { (id: String) in
      self.lock.lock(); let operation = self.operations[id]; self.lock.unlock()
      operation?.cancel()
    }

    AsyncFunction("upload") {
      (id: String, url: String, headers: [String: String], parameters: [String: String]?,
       mimeType: String, uri: String, promise: Promise) in
      self.lock.lock(); let operation = self.operations[id]; self.lock.unlock()
      guard let operation, operation.claim(),
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
        promise.reject(TranscriptionUploadError.request.rawValue, TranscriptionUploadError.request.localizedDescription)
        return
      }
      operation.start(url: url, headers: headers, parameters: parameters, mimeType: mimeType,
        uri: uri, documents: documents) { result in
        self.lock.lock(); self.operations.removeValue(forKey: id); self.lock.unlock()
        switch result {
        case .success(let response):
          promise.resolve(["status": response.status, "body": response.body] as [String: Any])
        case .failure(let error): promise.reject(error.rawValue, error.localizedDescription)
        }
      }
    }

    OnDestroy {
      self.lock.lock()
      let operations = Array(self.operations.values)
      self.operations.removeAll()
      self.lock.unlock()
      operations.forEach { $0.cancel() }
    }
  }
}
