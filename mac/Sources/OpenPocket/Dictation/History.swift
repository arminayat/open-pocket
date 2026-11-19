import Foundation
import SQLite3

struct DictationEntry: Identifiable {
    let id = UUID()
    let date: Date
    let seconds: Double
    let text: String?
}

/// Pocket dictations this app started, and (for OpenWhispr) the text it produced.
/// OpenWhispr's history is only read, never written.
enum History {
    private static let key = "dictations"

    static func record(start: Date, end: Date) {
        var all = UserDefaults.standard.array(forKey: key) as? [[Double]] ?? []
        all.append([start.timeIntervalSince1970, end.timeIntervalSince1970])
        UserDefaults.standard.set(Array(all.suffix(100)), forKey: key)
    }

    static func recent(limit: Int = 6, readOpenWhispr: Bool) -> [DictationEntry] {
        let sessions = (UserDefaults.standard.array(forKey: key) as? [[Double]] ?? []).suffix(limit).reversed()
        return sessions.compactMap { s in
            guard s.count == 2 else { return nil }
            let start = Date(timeIntervalSince1970: s[0])
            let end = Date(timeIntervalSince1970: s[1])
            return DictationEntry(date: start, seconds: end.timeIntervalSince(start),
                                  text: readOpenWhispr ? openWhisprText(after: end) : nil)
        }
    }

    private static let dbPath = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/open-whispr/transcriptions.db").path

    /// The first completed OpenWhispr dictation saved within two minutes after `end`.
    private static func openWhisprText(after end: Date) -> String? {
        var db: OpaquePointer?
        guard sqlite3_open_v2(dbPath, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else { return nil }
        defer { sqlite3_close(db) }
        let fmt = DateFormatter()
        fmt.timeZone = TimeZone(identifier: "UTC")
        fmt.locale = Locale(identifier: "en_US_POSIX")
        fmt.dateFormat = "yyyy-MM-dd HH:mm:ss"
        let sql = "SELECT text FROM transcriptions WHERE status = 'completed' AND created_at BETWEEN ? AND ? ORDER BY created_at LIMIT 1"
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return nil }
        defer { sqlite3_finalize(stmt) }
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        sqlite3_bind_text(stmt, 1, fmt.string(from: end.addingTimeInterval(-2)), -1, transient)
        sqlite3_bind_text(stmt, 2, fmt.string(from: end.addingTimeInterval(120)), -1, transient)
        guard sqlite3_step(stmt) == SQLITE_ROW, let c = sqlite3_column_text(stmt, 0) else { return nil }
        return String(cString: c)
    }
}
