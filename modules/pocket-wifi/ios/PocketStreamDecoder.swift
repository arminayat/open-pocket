import Foundation

// Wire format from pocket-libre PROTOCOL.md (MIT), commit 42fad3b:
// the stored MP3, followed by the fixed ten-byte completion marker.
struct PocketStreamDecoder {
  static let marker = Data([0xba, 0x5a, 0x02, 0x8f, 0x04, 0xba, 0x5a, 0x02, 0x8f, 0x04])
  private(set) var totalBytes = 0
  private(set) var payloadBytes = 0
  private(set) var expectedBytes: Int?
  private var tail = Data()

  mutating func setExpectedBytes(_ count: Int) throws {
    guard count > 0, count <= Int.max - Self.marker.count else {
      throw PocketWifiError("E_INVALID_SIZE", "The recording size must be a positive integer.")
    }
    guard expectedBytes == nil else {
      throw PocketWifiError("E_TRANSFER_BUSY", "The transfer size has already been set.")
    }
    expectedBytes = count
    try validateCount()
  }

  mutating func append(_ chunk: Data) throws -> Data {
    guard chunk.count <= Int.max - totalBytes else {
      throw PocketWifiError("E_TRANSFER_SIZE", "The transfer size is invalid.")
    }
    totalBytes += chunk.count
    try validateCount()
    var buffered = tail
    buffered.append(chunk)
    let writable = max(0, buffered.count - Self.marker.count)
    let payload = Data(buffered.prefix(writable))
    tail = Data(buffered.suffix(Self.marker.count))
    payloadBytes += payload.count
    return payload
  }

  var hasExpectedLength: Bool {
    guard let expectedBytes else { return false }
    return totalBytes == expectedBytes + Self.marker.count
  }

  func validateComplete() throws {
    guard let expectedBytes, hasExpectedLength, payloadBytes == expectedBytes else {
      throw PocketWifiError("E_INCOMPLETE_TRANSFER", "Pocket closed the Wi-Fi transfer before all recording bytes arrived. Retry the download.")
    }
    guard tail == Self.marker else {
      throw PocketWifiError("E_TRANSFER_MARKER", "The recording completion marker did not match. Retry the download.")
    }
  }

  private func validateCount() throws {
    if let expectedBytes, totalBytes > expectedBytes + Self.marker.count {
      throw PocketWifiError("E_TRANSFER_SIZE", "Pocket sent more bytes than the recording size. Retry the download.")
    }
  }
}

struct PocketWifiError: LocalizedError {
  let code: String
  let message: String

  init(_ code: String, _ message: String) {
    self.code = code
    self.message = message
  }

  var errorDescription: String? { message }
}
