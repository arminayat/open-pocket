import Foundation
import Security

@main
struct ChatGPTIdentityChecks {
  static func main() throws {
    let key = try makeKey()
    let otherKey = try makeKey()
    let publicJWK = try jwk(key)
    let jwks = try json(["keys": [publicJWK]])
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    let claims: [String: Any] = [
      "iss": "https://auth.openai.com", "sub": "synthetic-subject", "aud": "issued-client",
      "nonce": "synthetic-nonce", "iat": now.timeIntervalSince1970 - 30,
      "exp": now.timeIntervalSince1970 + 600, "email": "test@example.invalid",
    ]
    let header: [String: Any] = ["alg": "RS256", "kid": "ephemeral-key", "typ": "JWT"]
    var checkCount = 0

    func verify(_ token: String, keys: String? = nil) throws -> VerifiedChatGPTIdentity {
      try ChatGPTIdentity.verify(
        idToken: token, jwksJson: keys ?? jwks,
        clientId: "issued-client", nonce: "synthetic-nonce", now: now
      )
    }
    func reject(_ name: String, token: String, keys: String? = nil) throws {
      do {
        _ = try verify(token, keys: keys)
        fatalError("Accepted invalid synthetic token: \(name)")
      } catch is ChatGPTIdentityError {
        checkCount += 1
      }
    }
    func token(_ updates: [String: Any] = [:], removing: String? = nil) throws -> String {
      var values = claims.merging(updates) { _, new in new }
      if let removing { values.removeValue(forKey: removing) }
      return try sign(header: header, claims: values, key: key)
    }

    let validToken = try token()
    let valid = try verify(validToken)
    precondition(valid.subject == "synthetic-subject" && valid.email == "test@example.invalid")
    checkCount += 1
    let noEmail = try verify(token(removing: "email"))
    precondition(noEmail.email == nil)
    checkCount += 1
    let nullEmail = try verify(token(["email": NSNull()]))
    precondition(nullEmail.email == nil)
    checkCount += 1
    _ = try verify(token(["aud": ["issued-client", "another-client"], "azp": "issued-client"]))
    _ = try verify(token(["aud": ["issued-client"]]))
    _ = try verify(token(["iat": now.timeIntervalSince1970 + 4, "nbf": now.timeIntervalSince1970 + 4]))
    _ = try verify(token(["exp": now.timeIntervalSince1970 - 4]))
    checkCount += 4

    for (name, update) in [
      ("wrong issuer", ["iss": "https://untrusted.example"]),
      ("issuer trailing slash", ["iss": "https://auth.openai.com/"]),
      ("wrong nonce", ["nonce": "wrong-nonce"]),
      ("wrong same-length nonce", ["nonce": "synthetic-noncf"]),
      ("wrong audience", ["aud": "other-client"]),
      ("array wrong audience", ["aud": ["other-client"]]),
      ("mixed audience types", ["aud": ["issued-client", 1]]),
      ("duplicate audience", ["aud": ["issued-client", "issued-client"]]),
      ("empty audience", ["aud": []]),
      ("multiple audiences missing azp", ["aud": ["issued-client", "another-client"]]),
      ("wrong azp", ["azp": "another-client"]),
      ("numeric azp", ["azp": 123]),
      ("expired", ["exp": now.timeIntervalSince1970 - 6]),
      ("future iat", ["iat": now.timeIntervalSince1970 + 6]),
      ("future nbf", ["nbf": now.timeIntervalSince1970 + 6]),
      ("string expiry", ["exp": "1800000600"]),
      ("boolean expiry", ["exp": true]),
      ("boolean iat", ["iat": true]),
      ("string nbf", ["nbf": "1800000000"]),
      ("boolean nbf", ["nbf": false]),
      ("null nbf", ["nbf": NSNull()]),
      ("negative iat", ["iat": -1]),
      ("empty subject", ["sub": ""]),
      ("number subject", ["sub": 123]),
      ("bad email", ["email": ["test@example.invalid"]]),
    ] as [(String, [String: Any])] {
      try reject(name, token: token(update))
    }
    for field in ["iss", "sub", "aud", "nonce", "iat", "exp"] {
      try reject("missing \(field)", token: token(removing: field))
    }
    for update: [String: Any] in [
      ["alg": "none"], ["alg": "HS256"], ["alg": "RS512"], ["kid": "wrong-key"],
      ["kid": 123], ["crit": ["unknown"]], ["b64": false],
    ] {
      try reject("invalid header", token: sign(
        header: header.merging(update) { _, new in new }, claims: claims, key: key
      ))
    }
    try reject("wrong signature", token: sign(header: header, claims: claims, key: otherKey))
    let pieces = validToken.split(separator: ".").map(String.init)
    try reject("tampered payload", token: pieces[0] + "." + base64url(Data(try json(["sub": "other"]).utf8)) + "." + pieces[2])
    try reject("signature padding", token: validToken + "=")
    for malformed in ["", "a.b", "a.b.c.d", ".b.c", "a..c", "a.b.", "***.b.c", String(repeating: "x", count: 65_537)] {
      try reject("malformed JWT", token: malformed)
    }
    for update: [String: Any] in [
      ["kty": "EC"], ["use": "enc"], ["alg": "HS256"], ["key_ops": ["sign"]],
      ["key_ops": ["verify", "sign"]], ["key_ops": "verify"], ["n": "AA"], ["e": "Ag"],
      ["n": "invalid="], ["d": "private-material"],
    ] {
      let badJWK = publicJWK.merging(update) { _, new in new }
      try reject("invalid JWK", token: validToken, keys: json(["keys": [badJWK]]))
    }
    try reject("duplicate kid", token: validToken, keys: json(["keys": [publicJWK, publicJWK]]))
    try reject("empty keyset", token: validToken, keys: "{\"keys\":[]}")
    try reject("malformed keyset", token: validToken, keys: "not JSON")
    try reject("oversized keyset", token: validToken, keys: String(repeating: " ", count: 262_145))
    print("ChatGPT native identity checks passed (\(checkCount) cases)")
  }

  private static func makeKey() throws -> SecKey {
    let attributes: [CFString: Any] = [kSecAttrKeyType: kSecAttrKeyTypeRSA, kSecAttrKeySizeInBits: 2048]
    guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, nil) else {
      throw CheckError.failed
    }
    return key
  }

  private static func jwk(_ privateKey: SecKey) throws -> [String: Any] {
    guard let publicKey = SecKeyCopyPublicKey(privateKey),
      let der = SecKeyCopyExternalRepresentation(publicKey, nil) as Data?
    else { throw CheckError.failed }
    var cursor = 0
    let sequence = try readDER(der, cursor: &cursor, tag: 0x30)
    cursor = 0
    let modulus = try readDER(sequence, cursor: &cursor, tag: 0x02)
    let exponent = try readDER(sequence, cursor: &cursor, tag: 0x02)
    return [
      "kty": "RSA", "kid": "ephemeral-key", "alg": "RS256", "use": "sig", "key_ops": ["verify"],
      "n": base64url(Data(modulus.drop(while: { $0 == 0 }))),
      "e": base64url(Data(exponent.drop(while: { $0 == 0 }))),
    ]
  }

  private static func readDER(_ data: Data, cursor: inout Int, tag: UInt8) throws -> Data {
    guard cursor + 2 <= data.count, data[cursor] == tag else { throw CheckError.failed }
    cursor += 1
    var length = Int(data[cursor])
    cursor += 1
    if length & 0x80 != 0 {
      let byteCount = length & 0x7f
      guard byteCount > 0, byteCount <= 4, cursor + byteCount <= data.count else { throw CheckError.failed }
      length = 0
      for _ in 0..<byteCount {
        length = (length << 8) | Int(data[cursor])
        cursor += 1
      }
    }
    guard cursor + length <= data.count else { throw CheckError.failed }
    let value = data.subdata(in: cursor..<(cursor + length))
    cursor += length
    return value
  }

  private static func sign(header: [String: Any], claims: [String: Any], key: SecKey) throws -> String {
    let message = try base64url(Data(json(header).utf8)) + "." + base64url(Data(json(claims).utf8))
    guard let signature = SecKeyCreateSignature(
      key, .rsaSignatureMessagePKCS1v15SHA256, Data(message.utf8) as CFData, nil
    ) as Data? else { throw CheckError.failed }
    return message + "." + base64url(signature)
  }

  private static func json(_ value: Any) throws -> String {
    String(decoding: try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), as: UTF8.self)
  }

  private static func base64url(_ data: Data) -> String {
    data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
  }

  private enum CheckError: Error { case failed }
}
