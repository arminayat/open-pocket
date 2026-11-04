import ExpoModulesCore
import Foundation

public final class PocketICloudModule: Module {
  private let queue = DispatchQueue(label: "OpenPocket.iCloud", qos: .utility)
  private lazy var documents = ICloudDocuments { [weak self] in self?.sendEvent("change", [:]) }

  public func definition() -> ModuleDefinition {
    Name("PocketICloud")
    Events("change")
    OnCreate { _ = self.documents }
    Function("close") { self.documents.close() }
    Function("reserve") { (account: String) -> String in
      do { return try self.documents.reserve(account: account) }
      catch { throw ICloudError.account }
    }
    AsyncFunction("status") { (promise: Promise) in
      self.perform(promise) { self.documents.status() }
    }
    AsyncFunction("open") { (session: String, promise: Promise) in
      self.perform(promise) { try self.documents.open(session: session) }
    }
    AsyncFunction("identify") { (uri: String, bytes: Int64, promise: Promise) in
      self.perform(promise) { try self.documents.identify(uri: uri, bytes: bytes) }
    }
    AsyncFunction("scan") { (session: String, promise: Promise) in
      self.perform(promise) { try self.documents.scan(session: session) }
    }
    AsyncFunction("putAudio") {
      (session: String, folder: String, uri: String, bytes: Int64, sha256: String, promise: Promise) in
      self.perform(promise) { try self.documents.putAudio(session: session, folder: folder,
        uri: uri, bytes: bytes, sha256: sha256); return NSNull() }
    }
    AsyncFunction("putText") { (session: String, path: String, text: String, promise: Promise) in
      self.perform(promise) { try self.documents.putText(session: session, path: path, text: text); return NSNull() }
    }
    AsyncFunction("readText") { (session: String, path: String, promise: Promise) in
      self.perform(promise) { try self.documents.readText(session: session, path: path) as Any? ?? NSNull() }
    }
    AsyncFunction("downloadAudio") { (session: String, path: String, bytes: Int64, sha256: String, promise: Promise) in
      self.perform(promise) { try self.documents.downloadAudio(session: session, path: path,
        bytes: bytes, sha256: sha256) as Any? ?? NSNull() }
    }
    AsyncFunction("moveFolder") { (session: String, from: String, to: String, sha256: String, promise: Promise) in
      self.perform(promise) { try self.documents.moveFolder(session: session, from: from, to: to, sha256: sha256); return NSNull() }
    }
    OnDestroy { self.documents.close() }
  }

  private func perform(_ promise: Promise, work: @escaping () throws -> Any) {
    queue.async {
      do { promise.resolve(try work()) }
      catch {
        if let known = error as? ICloudError {
          promise.reject(known.rawValue, known.localizedDescription)
        } else {
          // Domain and code identify unexpected system failures without exposing paths or file names.
          let system = error as NSError
          promise.reject(ICloudError.file.rawValue, "\(ICloudError.file.localizedDescription) (\(system.domain) \(system.code))")
        }
      }
    }
  }
}
