import Foundation
import CoreFoundation
import Security

struct VerifiedChatGPTIdentity {
  let subject: String
  let email: String?
}

enum ChatGPTIdentityError: LocalizedError {
  case invalid

  var errorDescription: String? {
    "ChatGPT could not verify this sign-in. Please try again."
  }
}

/// Verifies an ID token using keys fetched from the fixed, trusted OpenAI JWKS endpoint.
/// Token-provided URLs and keys are never used.
enum ChatGPTIdentity {
  static func verify(
    idToken: String, jwksJson: String, clientId: String, nonce: String,
    now: Date = Date()
  ) throws -> VerifiedChatGPTIdentity {
    guard !clientId.isEmpty, clientId.utf8.count <= 1024,
      !nonce.isEmpty, nonce.utf8.count <= 1024,
      idToken.utf8.count <= 65_536, jwksJson.utf8.count <= 262_144
    else { throw ChatGPTIdentityError.invalid }

    let parts = idToken.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count == 3 else { throw ChatGPTIdentityError.invalid }
    let header = try object(decode(parts[0], limit: 8192))
    let payload = try decode(parts[1], limit: 32_768)
    let signature = try decode(parts[2], limit: 1024)
    guard header["alg"] as? String == "RS256",
      let kid = header["kid"] as? String, !kid.isEmpty, kid.utf8.count <= 256,
      header["crit"] == nil, header["b64"] == nil
    else { throw ChatGPTIdentityError.invalid }

    let key = try publicKey(jwksJson: jwksJson, kid: kid)
    let message = Data("\(parts[0]).\(parts[1])".utf8)
    guard SecKeyIsAlgorithmSupported(key, .verify, .rsaSignatureMessagePKCS1v15SHA256),
      SecKeyVerifySignature(
        key, .rsaSignatureMessagePKCS1v15SHA256, message as CFData, signature as CFData, nil
      )
    else { throw ChatGPTIdentityError.invalid }

    // Claims become trusted only after verifying the signature.
    let claims = try object(payload)
    let currentTime = now.timeIntervalSince1970
    let issuedAt = try numericDate(claims["iat"])
    let expiresAt = try numericDate(claims["exp"])
    guard claims["iss"] as? String == "https://auth.openai.com",
      let subject = claims["sub"] as? String, !subject.isEmpty, subject.utf8.count <= 1024,
      let tokenNonce = claims["nonce"] as? String, constantTimeEqual(tokenNonce, nonce),
      expiresAt > currentTime - 5, issuedAt <= currentTime + 5, issuedAt < expiresAt
    else { throw ChatGPTIdentityError.invalid }
    if let notBefore = claims["nbf"] {
      let time = try numericDate(notBefore)
      guard time <= currentTime + 5, time < expiresAt else { throw ChatGPTIdentityError.invalid }
    }

    let audiences: [String]
    if let audience = claims["aud"] as? String {
      audiences = [audience]
    } else if let values = claims["aud"] as? [String] {
      audiences = values
    } else {
      throw ChatGPTIdentityError.invalid
    }
    guard !audiences.isEmpty, audiences.count <= 16,
      audiences.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 1024 }),
      Set(audiences).count == audiences.count, audiences.contains(clientId)
    else { throw ChatGPTIdentityError.invalid }
    if audiences.count > 1 || claims["azp"] != nil {
      guard claims["azp"] as? String == clientId else { throw ChatGPTIdentityError.invalid }
    }

    let email: String?
    if claims["email"] == nil || claims["email"] is NSNull {
      email = nil
    } else {
      guard let value = claims["email"] as? String,
        !value.isEmpty, value.utf8.count <= 320
      else { throw ChatGPTIdentityError.invalid }
      email = value
    }
    return VerifiedChatGPTIdentity(subject: subject, email: email)
  }

  private static func publicKey(jwksJson: String, kid: String) throws -> SecKey {
    let jwks = try object(Data(jwksJson.utf8))
    guard let keys = jwks["keys"] as? [[String: Any]], keys.count <= 64 else {
      throw ChatGPTIdentityError.invalid
    }
    let matches = keys.filter { $0["kid"] as? String == kid }
    guard matches.count == 1, let jwk = matches.first,
      jwk["kty"] as? String == "RSA",
      jwk["use"] == nil || jwk["use"] as? String == "sig",
      jwk["alg"] == nil || jwk["alg"] as? String == "RS256",
      jwk["key_ops"] == nil || jwk["key_ops"] as? [String] == ["verify"],
      jwk["d"] == nil,
      let modulusString = jwk["n"] as? String, let exponentString = jwk["e"] as? String
    else { throw ChatGPTIdentityError.invalid }
    let modulus = try decode(Substring(modulusString), limit: 1024)
    let exponent = try decode(Substring(exponentString), limit: 8)
    guard let first = modulus.first, first != 0, exponent.first != 0 else {
      throw ChatGPTIdentityError.invalid
    }
    let bits = modulus.count * 8 - first.leadingZeroBitCount
    let exponentValue = exponent.reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
    guard bits >= 2048, bits <= 8192, exponentValue >= 3, exponentValue % 2 == 1 else {
      throw ChatGPTIdentityError.invalid
    }
    let encodedKey = der(tag: 0x30, value: derInteger(modulus) + derInteger(exponent))
    let attributes: [CFString: Any] = [
      kSecAttrKeyType: kSecAttrKeyTypeRSA,
      kSecAttrKeyClass: kSecAttrKeyClassPublic,
      kSecAttrKeySizeInBits: bits,
    ]
    guard let key = SecKeyCreateWithData(encodedKey as CFData, attributes as CFDictionary, nil) else {
      throw ChatGPTIdentityError.invalid
    }
    return key
  }

  private static func object(_ data: Data) throws -> [String: Any] {
    guard let result = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw ChatGPTIdentityError.invalid
    }
    return result
  }

  private static func decode(_ segment: Substring, limit: Int) throws -> Data {
    guard !segment.isEmpty, segment.utf8.count <= (limit * 4 + 2) / 3,
      segment.utf8.allSatisfy({ byte in
        (65...90).contains(byte) || (97...122).contains(byte) || (48...57).contains(byte)
          || byte == 45 || byte == 95
      })
    else { throw ChatGPTIdentityError.invalid }
    var base64 = segment.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
    guard let decoded = Data(base64Encoded: base64), decoded.count <= limit,
      decoded.base64EncodedString().replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") == segment
    else { throw ChatGPTIdentityError.invalid }
    return decoded
  }

  private static func numericDate(_ value: Any?) throws -> Double {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
      number.doubleValue.isFinite, number.doubleValue >= 0
    else { throw ChatGPTIdentityError.invalid }
    return number.doubleValue
  }

  private static func constantTimeEqual(_ value: String, _ expected: String) -> Bool {
    let valueBytes = Array(value.utf8)
    let expectedBytes = Array(expected.utf8)
    guard valueBytes.count == expectedBytes.count else { return false }
    var difference: UInt8 = 0
    for index in expectedBytes.indices { difference |= valueBytes[index] ^ expectedBytes[index] }
    return difference == 0
  }

  private static func derInteger(_ value: Data) -> Data {
    der(tag: 0x02, value: value.first! & 0x80 == 0 ? value : Data([0]) + value)
  }

  private static func der(tag: UInt8, value: Data) -> Data {
    if value.count < 128 { return Data([tag, UInt8(value.count)]) + value }
    var length = value.count
    var bytes: [UInt8] = []
    while length > 0 {
      bytes.insert(UInt8(length & 0xff), at: 0)
      length >>= 8
    }
    return Data([tag, 0x80 | UInt8(bytes.count)] + bytes) + value
  }
}
