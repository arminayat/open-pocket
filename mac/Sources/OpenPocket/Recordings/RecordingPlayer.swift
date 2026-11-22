import AVFoundation
import Foundation

/// Plays the selected recording's `audio.mp3` from the iCloud folder. Audio downloads only when asked
/// (press play) and plays only once its size and SHA-256 match the recording. Main thread.
final class RecordingPlayer: NSObject, ObservableObject, AVAudioPlayerDelegate {
    enum State: Equatable {
        /// No `audio.mp3` in iCloud yet.
        case missing
        /// Only a placeholder on this Mac; play downloads it.
        case inCloud
        case downloading(percent: Int?)
        case checking
        case ready
        case playing
        case failed(String)
    }

    @Published private(set) var state: State = .missing
    @Published private(set) var position: TimeInterval = 0
    @Published private(set) var duration: TimeInterval = 0

    private var recording: LibraryRecording?
    private var folder: ArchiveFolder?
    private weak var watcher: ICloudWatcher?
    private var audio: AVAudioPlayer?
    private var timer: Timer?
    /// Recordings whose audio matched this session.
    private var verified = Set<String>()
    private let queue = DispatchQueue(label: "recordings.audio", qos: .userInitiated)

    /// Follows the selection. The same recording again (after a rescan) keeps playing, even when the iPhone
    /// renamed its folder meanwhile: the open file stays valid.
    func select(_ next: LibraryRecording?, in folder: ArchiveFolder?, watcher: ICloudWatcher?) {
        let same = next?.id == recording?.id && folder === self.folder
        recording = next
        self.folder = folder
        self.watcher = watcher
        guard !same else {
            if audio == nil && (state == .missing || state == .inCloud || state == .ready) { refresh() }
            return
        }
        stop()
        position = 0
        duration = next?.manifest.durationSeconds ?? 0
        refresh()
    }

    /// Play or pause; downloads first when the audio is still only in iCloud.
    func toggle() {
        switch state {
        case .playing: pause()
        case .ready: play()
        case .inCloud, .failed: download()
        case .missing, .downloading, .checking: break
        }
    }

    func seek(to fraction: Double) {
        guard duration > 0 else { return }
        position = max(0, min(1, fraction)) * duration
        audio?.currentTime = position
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        stopTimer()
        position = 0
        state = .ready
    }

    private func refresh() {
        guard let path = recording?.audioPath, let folder else { state = .missing; return }
        state = folder.isDownloaded(path) ? .ready : .inCloud
    }

    private func download() {
        guard let path = recording?.audioPath, let folder else { return }
        if folder.isDownloaded(path) { play(); return }
        folder.startDownloading(path)
        state = .downloading(percent: nil)
        stopTimer()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            // The latest path, in case a rescan found the folder under a new name.
            guard let self, case .downloading = self.state, let path = self.recording?.audioPath else { return }
            if folder.isDownloaded(path) {
                self.stopTimer()
                self.play()
            } else {
                self.state = .downloading(percent: self.watcher?.percent(of: folder.url(path)).map { Int($0) })
            }
        }
    }

    private func play() {
        if let audio {
            audio.currentTime = position
            audio.play()
            state = .playing
            startTimer()
            return
        }
        guard let recording, let path = recording.audioPath, let folder else { return }
        state = .checking
        let checked = verified.contains(recording.id)
        queue.async {
            // Open inside a coordinated read; the player keeps the file open afterwards.
            let result: Result<AVAudioPlayer, PlayError> = folder.coordinatedRead(path) { url in
                guard checked || ArchiveFolder.digest(url, bytes: recording.manifest.bytes) == recording.manifest.sha256 else {
                    return .failure(.mismatch)
                }
                return (try? AVAudioPlayer(contentsOf: url)).map { .success($0) } ?? .failure(.unplayable)
            } ?? .failure(.unreadable)
            DispatchQueue.main.async {
                guard self.recording?.id == recording.id, self.state == .checking else { return }
                switch result {
                case .success(let player):
                    self.verified.insert(recording.id)
                    player.delegate = self
                    player.prepareToPlay()
                    self.audio = player
                    if player.duration > 0 { self.duration = player.duration }
                    self.play()
                case .failure(let error):
                    self.state = .failed(error.message)
                }
            }
        }
    }

    private func pause() {
        audio?.pause()
        position = audio?.currentTime ?? position
        stopTimer()
        state = .ready
    }

    private func stop() {
        audio?.stop()
        audio = nil
        stopTimer()
    }

    private func startTimer() {
        stopTimer()
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            guard let self, let audio = self.audio else { return }
            self.position = audio.currentTime
        }
    }

    private func stopTimer() {
        timer?.invalidate()
        timer = nil
    }

    enum PlayError: Error {
        case mismatch, unplayable, unreadable
        var message: String {
            switch self {
            case .mismatch: return "This audio doesn't match the recording. Open Pocket on your iPhone may still be uploading it."
            case .unplayable: return "This audio file can't be played."
            case .unreadable: return "The audio couldn't be read from iCloud. Try again."
            }
        }
    }

    /// Sample state for `--snapshot` renders.
    func applyPreview(duration: TimeInterval) {
        stop()
        self.duration = duration
        position = duration * 0.3
        state = .ready
    }
}
