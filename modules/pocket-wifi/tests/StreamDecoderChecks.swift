import Foundation

@main
struct StreamDecoderChecks {
  static func main() throws {
    let payload = Data((0..<250).map { UInt8($0) })
    let wire = payload + PocketStreamDecoder.marker

    // All possible chunk sizes include splits inside the MP3 and end marker.
    for chunkSize in 1...wire.count {
      var decoder = PocketStreamDecoder()
      try decoder.setExpectedBytes(payload.count)
      var written = Data()
      for offset in stride(from: 0, to: wire.count, by: chunkSize) {
        written.append(try decoder.append(Data(wire[offset..<min(wire.count, offset + chunkSize)])))
      }
      try decoder.validateComplete()
      precondition(written == payload, "Fragmented transfer changed the stored MP3")
      precondition(decoder.payloadBytes == payload.count)
    }

    // The TCP stream may begin before the JS caller has supplied its BLE size.
    var lateSize = PocketStreamDecoder()
    let earlyPayload = try lateSize.append(wire)
    precondition(earlyPayload == payload)
    try lateSize.setExpectedBytes(payload.count)
    try lateSize.validateComplete()

    var invalidMarker = PocketStreamDecoder()
    try invalidMarker.setExpectedBytes(payload.count)
    var corrupted = wire
    corrupted[corrupted.count - 1] = 0
    _ = try invalidMarker.append(corrupted)
    expectError("E_TRANSFER_MARKER") { try invalidMarker.validateComplete() }

    var short = PocketStreamDecoder()
    try short.setExpectedBytes(payload.count)
    _ = try short.append(Data(wire.dropLast()))
    expectError("E_INCOMPLETE_TRANSFER") { try short.validateComplete() }

    var excess = PocketStreamDecoder()
    try excess.setExpectedBytes(payload.count)
    expectError("E_TRANSFER_SIZE") { _ = try excess.append(wire + Data([0])) }

    var lateExcess = PocketStreamDecoder()
    _ = try lateExcess.append(wire + Data([0]))
    expectError("E_TRANSFER_SIZE") { try lateExcess.setExpectedBytes(payload.count) }

    var zero = PocketStreamDecoder()
    expectError("E_INVALID_SIZE") { try zero.setExpectedBytes(0) }
    print("Pocket Wi-Fi decoder checks passed: 260 fragmentation cases, late size, invalid marker, short/excess transfer, invalid size.")
  }

  private static func expectError(_ code: String, run: () throws -> Void) {
    do { try run(); preconditionFailure("Expected \(code)") }
    catch let error as PocketWifiError { precondition(error.code == code) }
    catch { preconditionFailure("Unexpected error: \(error)") }
  }
}
