import Foundation
import Darwin

enum TranscriptionUploadError: String, LocalizedError {
  case request = "E_TRANSCRIPTION_REQUEST"
  case file = "E_TRANSCRIPTION_FILE"
  case size = "E_TRANSCRIPTION_SIZE"
  case cancelled = "E_TRANSCRIPTION_CANCELLED"
  case timeout = "E_TRANSCRIPTION_TIMEOUT"
  case response = "E_TRANSCRIPTION_RESPONSE"
  case network = "E_TRANSCRIPTION_NETWORK"

  var errorDescription: String? {
    switch self {
    case .request: return "The transcription upload request is not supported."
    case .file: return "The recording could not be read from app storage."
    case .size: return "The recording exceeds this provider's upload limit."
    case .cancelled: return "The transcription upload was cancelled."
    case .timeout: return "The transcription upload timed out."
    case .response: return "The transcription response is incomplete or too large."
    case .network: return "The transcription upload could not complete."
    }
  }
}

struct TranscriptionUploadTarget {
  let url: URL
  let maxBytes: Int64
  let multipart: Bool

  static func validate(_ value: String, multipart: Bool) throws -> Self {
    guard value.utf8.count <= 4096, let parts = URLComponents(string: value),
      parts.scheme == "https", parts.user == nil, parts.password == nil,
      parts.fragment == nil, parts.port == nil || parts.port == 443,
      let host = parts.host, let url = parts.url else { throw TranscriptionUploadError.request }
    let path = parts.percentEncodedPath
    let small = host == "api.openai.com" && path == "/v1/audio/transcriptions"
      || host == "api.groq.com" && path == "/openai/v1/audio/transcriptions"
    let largeMultipart = host == "api.elevenlabs.io" && path == "/v1/speech-to-text"
    let raw = host == "api.deepgram.com" && path == "/v1/listen"
      || host == "api.assemblyai.com" && path == "/v2/upload"
    guard (multipart && (small || largeMultipart)) || (!multipart && raw) else {
      throw TranscriptionUploadError.request
    }
    return Self(url: url, maxBytes: small ? 25_000_000 : 500_000_000, multipart: multipart)
  }

  static func headers(_ values: [String: String]) throws -> [String: String] {
    let allowed: Set<String> = ["authorization", "xi-api-key", "accept", "content-type"]
    var names = Set<String>()
    for (name, value) in values {
      guard allowed.contains(name.lowercased()), names.insert(name.lowercased()).inserted,
        !value.isEmpty, value.utf8.count <= 8192,
        value.utf8.allSatisfy({ $0 >= 32 && $0 <= 126 }) else { throw TranscriptionUploadError.request }
    }
    return values
  }
}

struct TranscriptionUploadSource {
  let url: URL
  let bytes: Int64

  static func validate(_ uri: String, documents: URL, maxBytes: Int64) throws -> Self {
    guard let url = URL(string: uri), url.isFileURL, url.pathExtension == "mp3",
      url.host == nil || url.host == "" || url.host == "localhost",
      url.user == nil, url.password == nil, url.port == nil, url.query == nil, url.fragment == nil
    else { throw TranscriptionUploadError.file }
    let root = documents.standardizedFileURL.resolvingSymlinksInPath().appendingPathComponent("recordings")
    let normalized = url.standardizedFileURL
    let resolved = normalized.resolvingSymlinksInPath()
    guard root.resolvingSymlinksInPath().path == root.path,
      normalized.deletingLastPathComponent().resolvingSymlinksInPath().path == root.path,
      resolved.deletingLastPathComponent().path == root.path,
      (try url.resourceValues(forKeys: [.isSymbolicLinkKey])).isSymbolicLink == false
    else { throw TranscriptionUploadError.file }
    let attributes = try FileManager.default.attributesOfItem(atPath: resolved.path)
    guard attributes[.type] as? FileAttributeType == .typeRegular,
      let count = attributes[.size] as? NSNumber, count.int64Value > 0
    else { throw TranscriptionUploadError.file }
    guard count.int64Value <= maxBytes else { throw TranscriptionUploadError.size }
    return Self(url: resolved, bytes: count.int64Value)
  }
}

struct TranscriptionUploadBody {
  let url: URL
  let contentType: String
  let bytes: Int64

  func remove() { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }

  /// Copies bounded chunks to disk, so URLSession never reads a mutable library path or a JS audio buffer.
  static func prepare(source: TranscriptionUploadSource, parameters: [String: String]?, mimeType: String,
    temporaryDirectory: URL = FileManager.default.temporaryDirectory,
    checkCancellation: () throws -> Void) throws -> Self {
    guard mimeType == "audio/mpeg" else { throw TranscriptionUploadError.request }
    if let parameters {
      guard parameters.count <= 20, parameters.allSatisfy({ key, value in
        !key.isEmpty && key.utf8.count <= 80 && key != "file"
          && key.utf8.allSatisfy({ (65...90).contains($0) || (97...122).contains($0)
            || (48...57).contains($0) || $0 == 95 || $0 == 45 })
          && value.utf8.count <= 4096 && !value.utf8.contains(13) && !value.utf8.contains(10)
      }) else { throw TranscriptionUploadError.request }
    }
    try checkCancellation()
    let folder = temporaryDirectory.appendingPathComponent("openpocket-transcription-\(UUID().uuidString)")
    let destination = folder.appendingPathComponent("body")
    do {
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
      guard FileManager.default.createFile(atPath: destination.path, contents: nil) else {
        throw TranscriptionUploadError.file
      }
      let output = try FileHandle(forWritingTo: destination)
      defer { try? output.close() }
      let descriptor = open(source.url.path, O_RDONLY | O_NOFOLLOW)
      guard descriptor >= 0 else { throw TranscriptionUploadError.file }
      let input = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
      defer { try? input.close() }
      var information = stat()
      guard fstat(descriptor, &information) == 0,
        information.st_mode & S_IFMT == S_IFREG, information.st_size == source.bytes
      else { throw TranscriptionUploadError.file }
      let boundary = "OpenPocket-\(UUID().uuidString)"
      var total: Int64 = 0
      func write(_ data: Data) throws {
        try checkCancellation()
        try output.write(contentsOf: data)
        total += Int64(data.count)
      }
      if let parameters {
        for name in parameters.keys.sorted() {
          try write(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(parameters[name]!)\r\n".utf8))
        }
        try write(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"recording.mp3\"\r\nContent-Type: audio/mpeg\r\n\r\n".utf8))
      }
      var copied: Int64 = 0
      while true {
        try checkCancellation()
        guard let chunk = try input.read(upToCount: 65_536), !chunk.isEmpty else { break }
        copied += Int64(chunk.count)
        guard copied <= source.bytes else { throw TranscriptionUploadError.file }
        try write(chunk)
      }
      guard copied == source.bytes else { throw TranscriptionUploadError.file }
      if parameters != nil { try write(Data("\r\n--\(boundary)--\r\n".utf8)) }
      try output.synchronize()
      try checkCancellation()
      return Self(url: destination,
        contentType: parameters == nil ? mimeType : "multipart/form-data; boundary=\(boundary)", bytes: total)
    } catch {
      try? FileManager.default.removeItem(at: folder)
      throw error as? TranscriptionUploadError ?? TranscriptionUploadError.file
    }
  }
}
