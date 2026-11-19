import AVFoundation
import AudioToolbox
import CoreAudio

/// Streaming MP3 decoder: feed raw bytes, get PCM buffers.
final class MP3Decoder {
    var onPCM: ((AVAudioPCMBuffer) -> Void)?

    private var stream: AudioFileStreamID?
    private var inFormat: AVAudioFormat?
    private var pcmFormat: AVAudioFormat?
    private var converter: AVAudioConverter?
    private var maxPacketSize = 1441   // largest possible MP3 frame

    init() {
        let me = Unmanaged.passUnretained(self).toOpaque()
        AudioFileStreamOpen(me, { ctx, stream, property, _ in
            Unmanaged<MP3Decoder>.fromOpaque(ctx).takeUnretainedValue().property(stream, property)
        }, { ctx, bytes, packets, data, descriptions in
            Unmanaged<MP3Decoder>.fromOpaque(ctx).takeUnretainedValue()
                .packets(bytes: bytes, count: packets, data: data, descriptions: descriptions)
        }, kAudioFileMP3Type, &stream)
    }

    deinit {
        if let stream { AudioFileStreamClose(stream) }
    }

    func feed(_ data: Data) {
        guard let stream else { return }
        data.withUnsafeBytes { raw in
            _ = AudioFileStreamParseBytes(stream, UInt32(raw.count), raw.baseAddress, [])
        }
    }

    private func property(_ stream: AudioFileStreamID, _ property: AudioFileStreamPropertyID) {
        guard property == kAudioFileStreamProperty_ReadyToProducePackets else { return }
        var asbd = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        guard AudioFileStreamGetProperty(stream, kAudioFileStreamProperty_DataFormat, &size, &asbd) == noErr else { return }
        var upper: UInt32 = 0
        size = UInt32(MemoryLayout<UInt32>.size)
        if AudioFileStreamGetProperty(stream, kAudioFileStreamProperty_PacketSizeUpperBound, &size, &upper) == noErr, upper > 0 {
            maxPacketSize = max(maxPacketSize, Int(upper))
        }
        guard let input = AVAudioFormat(streamDescription: &asbd),
              let output = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: asbd.mSampleRate,
                                         channels: max(1, asbd.mChannelsPerFrame), interleaved: false) else { return }
        inFormat = input
        pcmFormat = output
        converter = AVAudioConverter(from: input, to: output)
        log.info("stream format \(asbd.mSampleRate, privacy: .public) Hz, \(asbd.mChannelsPerFrame, privacy: .public) ch")
    }

    private func packets(bytes: UInt32, count: UInt32, data: UnsafeRawPointer,
                         descriptions: UnsafeMutablePointer<AudioStreamPacketDescription>?) {
        guard count > 0, let inFormat, let pcmFormat, let converter, let descriptions else { return }
        let compressed = AVAudioCompressedBuffer(format: inFormat, packetCapacity: count, maximumPacketSize: maxPacketSize)
        compressed.data.copyMemory(from: data, byteCount: Int(bytes))
        compressed.packetDescriptions?.update(from: descriptions, count: Int(count))
        compressed.packetCount = count
        compressed.byteLength = bytes

        guard let out = AVAudioPCMBuffer(pcmFormat: pcmFormat, frameCapacity: count * 1152) else { return }
        var given = false
        var error: NSError?
        let status = converter.convert(to: out, error: &error) { _, inputStatus in
            if given { inputStatus.pointee = .noDataNow; return nil }
            given = true
            inputStatus.pointee = .haveData
            return compressed
        }
        if status == .error {
            log.error("decode failed: \(error?.localizedDescription ?? "", privacy: .public)")
        } else if out.frameLength > 0 {
            onPCM?(out)
        }
    }
}

/// Plays PCM into one specific output device (Pocket Mic), never the speakers.
final class PocketMicPlayer {
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let lowCut = AVAudioUnitEQ(numberOfBands: 1)
    private var pending = 0
    private(set) var isRunning = false

    init() {
        engine.attach(player)
        engine.attach(lowCut)
        let band = lowCut.bands[0]
        band.filterType = .highPass
        band.frequency = 140
        band.bypass = false
        lowCut.globalGain = -4   // the high-pass filter's resonance boosts near its cutoff; keep headroom
    }

    func start(device: AudioDeviceID, format: AVAudioFormat, reduceBoom: Bool) throws {
        guard let unit = engine.outputNode.audioUnit else {
            throw NSError(domain: "OpenPocket", code: 1, userInfo: [NSLocalizedDescriptionKey: "No audio output unit"])
        }
        var dev = device
        let status = AudioUnitSetProperty(unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0,
                                          &dev, UInt32(MemoryLayout<AudioDeviceID>.size))
        guard status == noErr else {
            throw NSError(domain: "OpenPocket", code: Int(status),
                          userInfo: [NSLocalizedDescriptionKey: "Could not route audio to Pocket Mic (\(status))"])
        }
        lowCut.bands[0].bypass = !reduceBoom
        engine.connect(player, to: lowCut, format: format)
        engine.connect(lowCut, to: engine.mainMixerNode, format: format)
        engine.prepare()
        try engine.start()
        player.play()
        isRunning = true
    }

    func schedule(_ buffer: AVAudioPCMBuffer) {
        guard isRunning else { return }
        pending += 1
        player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            DispatchQueue.main.async { self?.pending -= 1 }
        }
    }

    /// Wait until everything scheduled has actually been played.
    func drain(timeout: Double) async {
        let deadline = Date().addingTimeInterval(timeout)
        while pending > 0 && Date() < deadline { await sleep(ms: 40) }
    }

    func stop() {
        guard isRunning else { return }
        player.stop()
        engine.stop()
        isRunning = false
    }

    static func rms(_ buffer: AVAudioPCMBuffer) -> Float {
        guard let ch = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return 0 }
        var sum: Float = 0
        for i in 0..<Int(buffer.frameLength) { sum += ch[i] * ch[i] }
        return (sum / Float(buffer.frameLength)).squareRoot()
    }
}
