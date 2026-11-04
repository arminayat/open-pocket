import Foundation

@main
struct TranscriptionUploadChecks {
  static func main() throws {
    let files = FileManager.default
    let root = files.temporaryDirectory.appendingPathComponent("openpocket-upload-checks-\(UUID().uuidString)")
    let documents = root.appendingPathComponent("Documents")
    let recordings = documents.appendingPathComponent("recordings")
    let temporary = root.appendingPathComponent("temp")
    try files.createDirectory(at: recordings, withIntermediateDirectories: true)
    try files.createDirectory(at: temporary, withIntermediateDirectories: true)
    defer { try? files.removeItem(at: root) }
    var cases = 0
    func rejects(_ name: String, _ work: () throws -> Void) throws {
      do { try work(); fatalError("Accepted invalid synthetic upload: \(name)") }
      catch { cases += 1 }
    }
    func noTemporaryBodies() throws {
      let entries = try files.contentsOfDirectory(atPath: temporary.path)
      precondition(entries.isEmpty)
    }

    for (url, multipart, expected) in [
      ("https://api.openai.com/v1/audio/transcriptions", true, 25_000_000),
      ("https://api.groq.com/openai/v1/audio/transcriptions", true, 25_000_000),
      ("https://api.elevenlabs.io/v1/speech-to-text", true, 500_000_000),
      ("https://api.deepgram.com/v1/listen?model=nova-3&mip_opt_out=true", false, 500_000_000),
      ("https://api.assemblyai.com/v2/upload", false, 500_000_000),
    ] {
      let target = try TranscriptionUploadTarget.validate(url, multipart: multipart)
      precondition(target.maxBytes == expected)
      cases += 1
    }
    for url in [
      "http://api.openai.com/v1/audio/transcriptions", "https://evil.example/v1/audio/transcriptions",
      "https://api.openai.com.evil.example/v1/audio/transcriptions", "https://api.openai.com:444/v1/audio/transcriptions",
      "https://key@api.openai.com/v1/audio/transcriptions", "https://api.openai.com/v1/audio/transcriptions#secret",
      "https://api.openai.com/v1/audio/transcriptions/", "https://api.openai.com/v1/%61udio/transcriptions",
      "https://api.assemblyai.com/v2/transcript", "file:///v1/audio/transcriptions",
    ] {
      try rejects("untrusted URL") { _ = try TranscriptionUploadTarget.validate(url, multipart: true) }
    }
    try rejects("wrong body mode") {
      _ = try TranscriptionUploadTarget.validate("https://api.openai.com/v1/audio/transcriptions", multipart: false)
    }
    for headers in [
      ["Host": "evil.example"], ["Authorization": "Bearer synthetic\r\nInjected: yes"],
      ["authorization": "a", "Authorization": "b"], ["Authorization": ""],
    ] {
      try rejects("unsafe header") { _ = try TranscriptionUploadTarget.headers(headers) }
    }
    _ = try TranscriptionUploadTarget.headers(["Authorization": "synthetic", "Content-Type": "application/octet-stream"])
    cases += 1

    let audio = recordings.appendingPathComponent("synthetic.mp3")
    let binary = Data((0..<200_000).map { UInt8($0 % 256) })
    try binary.write(to: audio)
    let source = try TranscriptionUploadSource.validate(audio.absoluteString, documents: documents, maxBytes: 25_000_000)
    precondition(source.bytes == binary.count)
    cases += 1
    let raw = try TranscriptionUploadBody.prepare(source: source, parameters: nil, mimeType: "audio/mpeg",
      temporaryDirectory: temporary, checkCancellation: {})
    let rawBytes = try Data(contentsOf: raw.url)
    precondition(rawBytes == binary)
    precondition(raw.bytes == binary.count && raw.contentType == "audio/mpeg")
    raw.remove()
    try noTemporaryBodies()
    cases += 1

    let multipart = try TranscriptionUploadBody.prepare(source: source,
      parameters: ["model": "synthetic-model", "language": "日本語"], mimeType: "audio/mpeg",
      temporaryDirectory: temporary, checkCancellation: {})
    let boundary = String(multipart.contentType.split(separator: "=").last!)
    let prefix = "--\(boundary)\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\n日本語\r\n"
      + "--\(boundary)\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\nsynthetic-model\r\n"
      + "--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"recording.mp3\"\r\nContent-Type: audio/mpeg\r\n\r\n"
    let expected = Data(prefix.utf8) + binary + Data("\r\n--\(boundary)--\r\n".utf8)
    let multipartBytes = try Data(contentsOf: multipart.url)
    precondition(multipartBytes == expected)
    precondition(multipart.bytes == expected.count)
    multipart.remove()
    try noTemporaryBodies()
    cases += 1

    for parameters in [["file": "other"], ["bad\"name": "value"], ["model": "bad\r\nvalue"]] {
      try rejects("invalid multipart parameters") {
        _ = try TranscriptionUploadBody.prepare(source: source, parameters: parameters, mimeType: "audio/mpeg",
          temporaryDirectory: temporary, checkCancellation: {})
      }
      try noTemporaryBodies()
    }
    try rejects("cancel before preparation") {
      _ = try TranscriptionUploadBody.prepare(source: source, parameters: nil, mimeType: "audio/mpeg",
        temporaryDirectory: temporary, checkCancellation: { throw TranscriptionUploadError.cancelled })
    }
    var checks = 0
    try rejects("cancel during preparation") {
      _ = try TranscriptionUploadBody.prepare(source: source, parameters: ["model": "synthetic"], mimeType: "audio/mpeg",
        temporaryDirectory: temporary, checkCancellation: {
          checks += 1
          if checks == 7 { throw TranscriptionUploadError.cancelled }
        })
    }
    try noTemporaryBodies()

    let outside = documents.appendingPathComponent("outside.mp3")
    try binary.write(to: outside)
    let nested = recordings.appendingPathComponent("nested")
    try files.createDirectory(at: nested, withIntermediateDirectories: false)
    try binary.write(to: nested.appendingPathComponent("nested.mp3"))
    let alias = recordings.appendingPathComponent("alias.mp3")
    try files.createSymbolicLink(at: alias, withDestinationURL: outside)
    for uri in [outside.absoluteString, nested.appendingPathComponent("nested.mp3").absoluteString,
      alias.absoluteString, audio.absoluteString + "?query=1", audio.absoluteString + "#fragment",
      "https://example.invalid/audio.mp3", recordings.appendingPathComponent("missing.mp3").absoluteString] {
      try rejects("invalid recording path") {
        _ = try TranscriptionUploadSource.validate(uri, documents: documents, maxBytes: 25_000_000)
      }
    }
    let huge = recordings.appendingPathComponent("huge.mp3")
    files.createFile(atPath: huge.path, contents: nil)
    let sparse = try FileHandle(forWritingTo: huge)
    try sparse.truncate(atOffset: 25_000_001)
    try rejects("small provider size cap") {
      _ = try TranscriptionUploadSource.validate(huge.absoluteString, documents: documents, maxBytes: 25_000_000)
    }
    try sparse.truncate(atOffset: 500_000_001)
    try sparse.close()
    try rejects("large provider size cap") {
      _ = try TranscriptionUploadSource.validate(huge.absoluteString, documents: documents, maxBytes: 500_000_000)
    }
    try files.removeItem(at: audio)
    try rejects("source removed during preparation") {
      _ = try TranscriptionUploadBody.prepare(source: source, parameters: nil, mimeType: "audio/mpeg",
        temporaryDirectory: temporary, checkCancellation: {})
    }
    try noTemporaryBodies()

    // These exercise native cancellation and redirect delegates without opening a network connection.
    let operation = TranscriptionUploadOperation()
    precondition(operation.claim())
    precondition(!operation.claim())
    operation.cancel()
    let cancelled = DispatchSemaphore(value: 0)
    operation.start(url: "https://api.openai.com/v1/audio/transcriptions", headers: [:], parameters: [:],
      mimeType: "audio/mpeg", uri: source.url.absoluteString, documents: documents) { result in
      guard case .failure(.cancelled) = result else { fatalError("Prestart cancellation did not win") }
      cancelled.signal()
    }
    precondition(cancelled.wait(timeout: .now() + 5) == .success)
    cases += 1
    let redirectOperation = TranscriptionUploadOperation()
    let target = URL(string: "https://api.openai.com/v1/audio/transcriptions")!
    let session = URLSession(configuration: .ephemeral)
    let task = session.dataTask(with: target) // deliberately never resumed
    var redirectDenied = false
    redirectOperation.urlSession(session, task: task,
      willPerformHTTPRedirection: HTTPURLResponse(url: target, statusCode: 307, httpVersion: nil, headerFields: nil)!,
      newRequest: URLRequest(url: URL(string: "https://evil.example/upload")!)) { redirectDenied = $0 == nil }
    precondition(redirectDenied)
    let responseOperation = TranscriptionUploadOperation()
    var oversizedDenied = false
    responseOperation.urlSession(session, dataTask: task,
      didReceive: HTTPURLResponse(url: target, statusCode: 200, httpVersion: nil,
        headerFields: ["Content-Length": "8000001"])!) { oversizedDenied = $0 == .cancel }
    precondition(oversizedDenied)
    let resendOperation = TranscriptionUploadOperation()
    var resendDenied = false
    resendOperation.urlSession(session, task: task, needNewBodyStream: { resendDenied = $0 == nil })
    precondition(resendDenied)
    session.invalidateAndCancel()
    cases += 3
    print("Transcription native upload checks passed (\(cases) cases)")
  }
}
