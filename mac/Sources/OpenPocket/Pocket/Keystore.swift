import Foundation
import Security

/// The Pocket session key. Same Keychain item as the `pocket` CLI (service "heypocket").
/// Moves to a team-shared, iCloud-synced item once the app is signed by the iPhone app's team.
enum Keystore {
    static let service = "heypocket"
    static let account = "session-key"

    private static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    static func load() -> String? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data,
              let key = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
              isValid(key) else { return nil }
        return key
    }

    @discardableResult
    static func save(_ raw: String) -> Bool {
        let key = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isValid(key) else { return false }
        SecItemDelete(query as CFDictionary)
        var q = query
        q[kSecValueData as String] = Data(key.utf8)
        q[kSecAttrLabel as String] = "HeyPocket session key"
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }

    static func isValid(_ key: String) -> Bool {
        (8...64).contains(key.count) && key.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber) }
    }

    static func masked(_ key: String) -> String {
        guard key.count > 4 else { return "••••" }
        return key.prefix(2) + String(repeating: "•", count: key.count - 4) + key.suffix(2)
    }
}
