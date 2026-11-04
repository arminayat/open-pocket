import Foundation

@main
struct ICloudChecks {
  static func main() throws {
    let files = FileManager.default
    let root = files.temporaryDirectory.appendingPathComponent("openpocket-icloud-checks-\(UUID().uuidString)")
      .standardizedFileURL.resolvingSymlinksInPath()
    let documents = root.appendingPathComponent("Documents")
    let recordings = documents.appendingPathComponent("recordings")
    try files.createDirectory(at: recordings, withIntermediateDirectories: true)
    defer { try? files.removeItem(at: root) }
    var cases = 0
    func rejects(_ name: String, _ work: () throws -> Void) throws {
      do { try work(); fatalError("Accepted invalid synthetic iCloud input: \(name)") }
      catch { cases += 1 }
    }
    let digest = String(repeating: "a", count: 64)
    let folder = "2026-10-23_123456-" + digest
    let paths = ["audio.mp3", "recording.json", "transcript-\(digest).json", "transcript-\(digest).txt",
      "note-\(digest).json", "note-\(digest).md", "summary-\(digest).json", "summary-\(digest).md"]
    for name in paths { _ = try ICloudPolicy.path(folder + "/" + name); cases += 1 }
    // Readable folder names (date, time, title), including ones people rename by hand.
    for name in ["2026-10-23 12.34", "2026-10-23/12.34 – Budget review", "2026-10-23/12.34 (aaaaaa) – Ünïcödé 会议", "Salary talk"] {
      _ = try ICloudPolicy.path(name + "/recording.json"); cases += 1
    }
    for path in ["../audio.mp3", folder + "/../audio.mp3", "/" + folder + "/audio.mp3", folder + "//audio.mp3",
      folder + "/audio.mp3/", folder + "/.audio.mp3", folder + "/recording.txt", folder + "/secrets.json",
      folder + "/summary-\(digest).txt", folder + "/transcript-\(digest).md", folder + "/transcript-x.json",
      "../" + folder + "/recording.json", "a\\b-\(digest)/audio.mp3", "a:b/audio.mp3", ".hidden/audio.mp3",
      " padded/audio.mp3", "trailing /audio.mp3", "a\n-\(digest)/audio.mp3", String(repeating: "x", count: 201) + "/audio.mp3",
      folder + "/notes-\(digest).json", folder + "/note-\(digest).txt", "2026-10-23/a/b/audio.mp3", "2026-10-23//audio.mp3",
      "2026-10-23/.hidden/audio.mp3", "audio.mp3"] {
      try rejects("path") { _ = try ICloudPolicy.path(path) }
    }
    let container = URL(fileURLWithPath: "/var/mobile/Library/Mobile Documents/iCloud~x/Documents")
    precondition(ICloudPolicy.relative(URL(fileURLWithPath: "/private/var/mobile/Library/Mobile Documents/iCloud~x/Documents/\(folder)/audio.mp3"), within: container) == "\(folder)/audio.mp3")
    precondition(ICloudPolicy.relative(URL(fileURLWithPath: "/var/mobile/Library/Mobile Documents/iCloud~x/Documents/\(folder)/recording.json"), within: container) == "\(folder)/recording.json")
    precondition(ICloudPolicy.relative(URL(fileURLWithPath: "/private/var/mobile/Library/Mobile Documents/iCloud~x/Documents"), within: container) == nil)
    precondition(ICloudPolicy.relative(URL(fileURLWithPath: "/var/mobile/Library/Mobile Documents/iCloud~x/Documents-other/a"), within: container) == nil)
    cases += 4
    try rejects("text-only") { _ = try ICloudPolicy.path(folder + "/audio.mp3", audio: false) }
    try rejects("audio-only") { _ = try ICloudPolicy.path(folder + "/recording.json", audio: true) }
    precondition(ICloudPolicy.digest(Data("abc".utf8)) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    cases += 1

    let data = Data((0..<200_000).map { UInt8($0 % 256) })
    let audio = recordings.appendingPathComponent("synthetic.mp3")
    try data.write(to: audio)
    let source = try ICloudPolicy.localSource(audio.absoluteString, bytes: Int64(data.count), documents: documents)
    let hash = try ICloudPolicy.stream(source, bytes: Int64(data.count))
    precondition(hash == ICloudPolicy.digest(data))
    cases += 1
    let stage = try ICloudPolicy.staging(near: recordings)
    defer { try? files.removeItem(at: stage) }
    let copied = stage.appendingPathComponent("audio.mp3")
    precondition(files.createFile(atPath: copied.path, contents: nil))
    let output = try FileHandle(forWritingTo: copied)
    let copyHash = try ICloudPolicy.stream(source, bytes: Int64(data.count), output: output)
    try output.close()
    let copiedBytes = try Data(contentsOf: copied)
    precondition(copyHash == hash && copiedBytes == data)
    cases += 1
    let published = recordings.appendingPathComponent("published.mp3")
    try ICloudPolicy.publish(copied, to: published)
    precondition(!files.fileExists(atPath: copied.path))
    try Data("different bytes".utf8).write(to: copied)
    try rejects("immutable publication") { try ICloudPolicy.publish(copied, to: published) }
    let publishedBytes = try Data(contentsOf: published)
    let retainedBytes = try Data(contentsOf: copied)
    precondition(publishedBytes == data)
    precondition(retainedBytes == Data("different bytes".utf8))
    cases += 1

    let outside = documents.appendingPathComponent("outside.mp3")
    try data.write(to: outside)
    let alias = recordings.appendingPathComponent("alias.mp3")
    try files.createSymbolicLink(at: alias, withDestinationURL: outside)
    let linkedFolder = recordings.appendingPathComponent("linked")
    try files.createSymbolicLink(at: linkedFolder, withDestinationURL: documents)
    for uri in [outside.absoluteString, alias.absoluteString, audio.absoluteString + "?x=1",
      audio.absoluteString + "#fragment", "https://example.invalid/audio.mp3", linkedFolder.appendingPathComponent("outside.mp3").absoluteString] {
      try rejects("untrusted recording") { _ = try ICloudPolicy.localSource(uri, bytes: Int64(data.count), documents: documents) }
    }
    try rejects("symlink cloud leaf") { try ICloudPolicy.safe(alias, within: recordings) }
    try rejects("symlink cloud parent") { try ICloudPolicy.safe(linkedFolder.appendingPathComponent("new.json"), within: recordings) }
    try rejects("outside cloud root") { try ICloudPolicy.safe(outside, within: recordings) }
    try rejects("O_NOFOLLOW") { _ = try ICloudPolicy.stream(alias, bytes: Int64(data.count)) }
    for size in [Int64(0), -1, ICloudPolicy.audioLimit + 1] {
      try rejects("audio size") { _ = try ICloudPolicy.localSource(audio.absoluteString, bytes: size, documents: documents) }
    }
    try rejects("truncated audio") { _ = try ICloudPolicy.stream(audio, bytes: Int64(data.count + 1)) }
    try rejects("excess audio") { _ = try ICloudPolicy.stream(audio, bytes: Int64(data.count - 1)) }
    var checkpoints = 0
    try rejects("stream cancellation") {
      _ = try ICloudPolicy.stream(audio, bytes: Int64(data.count), check: {
        checkpoints += 1
        if checkpoints == 2 { throw ICloudError.cancelled }
      })
    }
    precondition(checkpoints == 2)
    let text = root.appendingPathComponent("text.json")
    try Data("{\"text\":\"こんにちは\"}".utf8).write(to: text)
    let readText = try ICloudPolicy.readText(text)
    let expectedText = try Data(contentsOf: text)
    precondition(readText == expectedText)
    cases += 1
    try Data([0xff, 0xfe]).write(to: text)
    try rejects("invalid UTF8") { _ = try ICloudPolicy.readText(text) }
    let large = try FileHandle(forWritingTo: text)
    try large.truncate(atOffset: UInt64(ICloudPolicy.textLimit + 1))
    try large.close()
    try rejects("text size") { _ = try ICloudPolicy.readText(text) }

    // Synthetic identity injection: no OS iCloud account or container is queried by these checks.
    let accountIdentity = ICloudAccountIdentity()
    let stable = accountIdentity.identifier(for: NSString(string: "synthetic-A"))
    precondition(stable != nil && stable == accountIdentity.identifier(for: NSString(string: "synthetic-A")))
    precondition(stable != accountIdentity.identifier(for: NSString(string: "synthetic-B")))
    precondition(accountIdentity.identifier(for: nil) == nil)
    cases += 3
    var account: String? = digest
    let gate = ICloudSessionGate(identity: { account })
    try rejects("invalid account consent") { _ = try gate.begin(account: "raw-account") }
    let session = try gate.begin(account: digest)
    try gate.check(session)
    var committed = false
    try gate.withActive(session) { committed = true }
    precondition(committed)
    cases += 1
    gate.close()
    try rejects("queued publication after close") { try gate.withActive(session) { () -> Void in fatalError("Revoked publication ran") } }
    let next = try gate.begin(account: digest)
    try rejects("stale session after reopen") { try gate.check(session) }
    gate.cancel(session) // A failed old open must not close a newer reserved session.
    try gate.check(next)
    cases += 1
    account = String(repeating: "b", count: 64)
    try rejects("identity switch before publication") { try gate.withActive(next) { () -> Void in fatalError("Wrong-account publication ran") } }
    account = digest
    try rejects("old session after account returns") { try gate.check(next) }
    let signedOut = try gate.begin(account: digest)
    account = nil
    try rejects("sign-out before publication") { try gate.withActive(signedOut) { () -> Void in fatalError("Signed-out publication ran") } }
    print("iCloud native policy checks passed (\(cases) cases; synthetic files and identities only)")
  }
}
