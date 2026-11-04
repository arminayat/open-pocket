import Foundation

/// A single POST attempt. A reserved instance can be cancelled before preparation or URLSession starts.
final class TranscriptionUploadOperation: NSObject, URLSessionDataDelegate, @unchecked Sendable {
  typealias Completion = (Result<(status: Int, body: String), TranscriptionUploadError>) -> Void
  private static let responseLimit = 8_000_000
  private let lock = NSLock()
  private var cancellation: TranscriptionUploadError?
  private var claimed = false
  private var ended = false
  private var task: URLSessionUploadTask?
  private var session: URLSession?
  private var body: TranscriptionUploadBody?
  private var completion: Completion?
  private var timer: DispatchWorkItem?
  // URLSession invokes delegates serially, so only its delegate queue reads these buffers.
  private var responseData = Data()
  private var status: Int?

  func claim() -> Bool {
    lock.lock(); defer { lock.unlock() }
    guard !claimed else { return false }
    claimed = true
    return true
  }

  func cancel(_ error: TranscriptionUploadError = .cancelled) {
    lock.lock()
    if cancellation == nil { cancellation = error }
    let currentTask = task
    lock.unlock()
    currentTask?.cancel()
  }

  private func checkCancellation() throws {
    lock.lock(); let error = cancellation; lock.unlock()
    if let error { throw error }
  }

  func start(url: String, headers: [String: String], parameters: [String: String]?, mimeType: String,
    uri: String, documents: URL, completion: @escaping Completion) {
    self.completion = completion
    let timeout = DispatchWorkItem { [weak self] in self?.cancel(.timeout) }
    timer = timeout
    DispatchQueue.global().asyncAfter(deadline: .now() + 20 * 60, execute: timeout)
    DispatchQueue.global(qos: .utility).async {
      do {
        try self.checkCancellation()
        let target = try TranscriptionUploadTarget.validate(url, multipart: parameters != nil)
        let safeHeaders = try TranscriptionUploadTarget.headers(headers)
        let source = try TranscriptionUploadSource.validate(uri, documents: documents, maxBytes: target.maxBytes)
        let prepared = try TranscriptionUploadBody.prepare(source: source, parameters: parameters,
          mimeType: mimeType, checkCancellation: self.checkCancellation)
        // From here finish owns cleanup, including cancellation immediately after preparation.
        self.body = prepared
        try self.checkCancellation()
        var request = URLRequest(url: target.url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20 * 60)
        request.httpMethod = "POST"
        for (name, value) in safeHeaders { request.setValue(value, forHTTPHeaderField: name) }
        if parameters != nil || request.value(forHTTPHeaderField: "Content-Type") == nil {
          request.setValue(prepared.contentType, forHTTPHeaderField: "Content-Type")
        }
        request.setValue(String(prepared.bytes), forHTTPHeaderField: "Content-Length")
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 20 * 60
        configuration.timeoutIntervalForResource = 20 * 60
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        let delegates = OperationQueue()
        delegates.maxConcurrentOperationCount = 1
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: delegates)
        let task = session.uploadTask(with: request, fromFile: prepared.url)
        self.lock.lock()
        self.session = session
        self.task = task
        let cancellation = self.cancellation
        if cancellation == nil { task.resume() }
        self.lock.unlock()
        if let cancellation { self.finish(.failure(cancellation)) }
      } catch {
        self.finish(.failure(error as? TranscriptionUploadError ?? .file))
      }
    }
  }

  // This rejects even same-host redirects. Credentials and audio never follow Location.
  func urlSession(_ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void) {
    completionHandler(nil)
    finish(.failure(.request))
  }

  // Never replay a body following an authentication challenge or another resend request.
  func urlSession(_ session: URLSession, task: URLSessionTask,
    needNewBodyStream completionHandler: @escaping (InputStream?) -> Void) {
    completionHandler(nil)
    finish(.failure(.network))
  }

  func urlSession(_ session: URLSession, task: URLSessionTask,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
    if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust {
      completionHandler(.performDefaultHandling, nil)
    } else {
      completionHandler(.cancelAuthenticationChallenge, nil)
      // Preserve an HTTP rejection for the caller without retrying credentials or the POST body.
      if let response = challenge.failureResponse as? HTTPURLResponse, response.statusCode == 401 {
        finish(.success((401, "")))
      } else {
        finish(.failure(.network))
      }
    }
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
    guard let response = response as? HTTPURLResponse,
      response.expectedContentLength <= Int64(Self.responseLimit) else {
      completionHandler(.cancel)
      finish(.failure(.response))
      return
    }
    status = response.statusCode
    completionHandler(.allow)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    guard data.count <= Self.responseLimit - responseData.count else {
      finish(.failure(.response))
      return
    }
    responseData.append(data)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    do { try checkCancellation() }
    catch { finish(.failure(error as? TranscriptionUploadError ?? .cancelled)); return }
    if let error {
      finish(.failure((error as NSError).code == NSURLErrorTimedOut ? .timeout : .network))
    } else if let status, let text = String(data: responseData, encoding: .utf8) {
      finish(.success((status, text)))
    } else {
      finish(.failure(.response))
    }
  }

  private func finish(_ result: Result<(status: Int, body: String), TranscriptionUploadError>) {
    lock.lock()
    guard !ended else { lock.unlock(); return }
    ended = true
    let session = self.session
    self.session = nil
    self.task = nil
    let completion = self.completion
    self.completion = nil
    lock.unlock()
    timer?.cancel()
    timer = nil
    session?.invalidateAndCancel()
    body?.remove()
    body = nil
    completion?(result)
  }
}
