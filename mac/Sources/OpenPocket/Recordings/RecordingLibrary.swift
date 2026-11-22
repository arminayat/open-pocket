import Foundation

/// One file a scan found, by its path under `Documents/`.
struct ArchiveFile: Equatable {
    let path: String
    var downloaded: Bool
    var conflict: Bool
    /// Size and modification time, so unchanged documents aren't read again.
    var stamp: String = ""
}

/// What reading one small document gave.
enum ArchiveRead { case data(Data), pending, failed }

/// A recording as the Mac shows it: everything every folder holding the same audio checksum has.
struct LibraryRecording: Identifiable, Equatable {
    var id: String { manifest.sha256 }
    let manifest: RecordingArchive.Manifest
    var folderTitle: String?
    var summary: RecordingArchive.Artifact?
    var transcript: RecordingArchive.Artifact?
    var note: RecordingArchive.Artifact?
    /// `…/audio.mp3` under `Documents/`, from the first folder that has one.
    var audioPath: String?

    /// The AI summary's title, else the folder's, else the time.
    var title: String { summary?.title ?? folderTitle ?? manifest.time }

    /// `12m 5s`, like the iPhone.
    var duration: String {
        let s = Int(manifest.durationSeconds.rounded())
        return "\(s / 60)m \(s % 60)s"
    }

    var day: Date {
        let p = manifest.date.split(separator: "-").compactMap { Int($0) }
        return Calendar.current.date(from: DateComponents(year: p[0], month: p[1], day: p[2])) ?? .distantPast
    }
}

struct LibrarySnapshot: Equatable {
    /// Newest first.
    var recordings: [LibraryRecording] = []
    /// Documents iCloud hasn't downloaded to this Mac yet.
    var pending = 0
    /// Invalid or conflicting documents, skipped.
    var unreadable = 0

    /// Recordings grouped by the recorder's date, newest day first.
    var days: [(date: String, recordings: [LibraryRecording])] {
        var out: [(date: String, recordings: [LibraryRecording])] = []
        for r in recordings {
            if out.last?.date == r.manifest.date { out[out.count - 1].recordings.append(r) }
            else { out.append((r.manifest.date, [r])) }
        }
        return out
    }
}

enum LibraryBuilder {
    /// Reads every folder's `recording.json`, groups folders by audio checksum, and keeps each kind's newest
    /// text document across them, as the iPhone's sync does when it imports.
    static func build(files: [ArchiveFile], read: (ArchiveFile) -> ArchiveRead) -> LibrarySnapshot {
        var snapshot = LibrarySnapshot()
        var byPath: [String: ArchiveFile] = [:]
        var leaves: [String: [String]] = [:]
        for file in files {
            guard let part = RecordingArchive.archivePath(file.path), byPath[file.path] == nil else { continue }
            byPath[file.path] = file
            leaves[part.folder, default: []].append(part.leaf)
        }

        var manifests: [String: RecordingArchive.Manifest] = [:]
        var foldersBySha: [String: [String]] = [:]
        for (folder, names) in leaves where names.contains("recording.json") {
            let file = byPath["\(folder)/recording.json"]!
            if file.conflict { snapshot.unreadable += 1; continue }
            switch read(file) {
            case .pending: snapshot.pending += 1
            case .failed: snapshot.unreadable += 1
            case .data(let data):
                guard let manifest = try? RecordingArchive.parseManifest(data) else { snapshot.unreadable += 1; continue }
                manifests[folder] = manifest
                foldersBySha[manifest.sha256, default: []].append(folder)
            }
        }

        for folders in foldersBySha.values.map({ $0.sorted() }) {
            let manifest = manifests[folders[0]]!
            var recording = LibraryRecording(manifest: manifest)
            var latest: [RecordingArchive.Kind: RecordingArchive.Artifact] = [:]
            for folder in folders {
                for leaf in leaves[folder, default: []].sorted() where RecordingArchive.isTextDocument(leaf) {
                    let file = byPath["\(folder)/\(leaf)"]!
                    if file.conflict { snapshot.unreadable += 1; continue }
                    switch read(file) {
                    case .pending: snapshot.pending += 1
                    case .failed: snapshot.unreadable += 1
                    case .data(let data):
                        guard let artifact = try? RecordingArchive.parseArtifact(data, leaf: leaf) else {
                            snapshot.unreadable += 1
                            continue
                        }
                        if let current = latest[artifact.kind], !RecordingArchive.isNewer(artifact, than: current) { continue }
                        latest[artifact.kind] = artifact
                    }
                }
            }
            recording.summary = latest[.summary]
            recording.transcript = latest[.transcript]
            recording.note = latest[.note]
            recording.folderTitle = folders.lazy.compactMap { RecordingArchive.folderTitle($0, manifest: manifest) }.first
            recording.audioPath = folders.lazy.map { "\($0)/audio.mp3" }
                .first { byPath[$0] != nil && byPath[$0]?.conflict == false }
            snapshot.recordings.append(recording)
        }
        snapshot.recordings.sort { ($0.manifest.clock, $0.id) > ($1.manifest.clock, $1.id) }
        return snapshot
    }

    /// `OpenPocket --recordings-test <folder>`: reads a folder laid out like the iCloud container's
    /// `Documents/` and prints counts only, never names or text.
    static func offlineCheck(folder: URL) -> String {
        let archive = ArchiveFolder(root: folder)
        let files = archive.list()
        let s = build(files: files, read: archive.read)
        let count = { (has: (LibraryRecording) -> Bool) in s.recordings.filter(has).count }
        return [
            "files \(files.count)",
            "recordings \(s.recordings.count)",
            "days \(s.days.count)",
            "summaries \(count { $0.summary != nil })",
            "transcripts \(count { $0.transcript != nil })",
            "notes \(count { $0.note != nil })",
            "audio \(count { $0.audioPath != nil })",
            "folder titles \(count { $0.summary == nil && $0.folderTitle != nil })",
            "pending \(s.pending)",
            "unreadable \(s.unreadable)",
        ].joined(separator: ", ")
    }
}
