import CoreAudio
import Foundation

/// CoreAudio device lookup and the system default input.
enum AudioDevices {
    static let pocketMicName = "Pocket Mic"

    private static func address(_ selector: AudioObjectPropertySelector,
                                _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
    }

    static func allIDs() -> [AudioDeviceID] {
        var addr = address(kAudioHardwarePropertyDevices)
        var size: UInt32 = 0
        let system = AudioObjectID(kAudioObjectSystemObject)
        guard AudioObjectGetPropertyDataSize(system, &addr, 0, nil, &size) == noErr else { return [] }
        var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
        guard AudioObjectGetPropertyData(system, &addr, 0, nil, &size, &ids) == noErr else { return [] }
        return ids
    }

    private static func string(_ id: AudioDeviceID, _ selector: AudioObjectPropertySelector) -> String? {
        var addr = address(selector)
        var ref: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        let status = withUnsafeMutablePointer(to: &ref) {
            AudioObjectGetPropertyData(id, &addr, 0, nil, &size, $0)
        }
        guard status == noErr, let ref else { return nil }
        return ref.takeRetainedValue() as String
    }

    static func name(_ id: AudioDeviceID) -> String? { string(id, kAudioObjectPropertyName) }
    static func uid(_ id: AudioDeviceID) -> String? { string(id, kAudioDevicePropertyDeviceUID) }

    static func channelCount(_ id: AudioDeviceID, input: Bool) -> Int {
        var addr = address(kAudioDevicePropertyStreamConfiguration,
                           input ? kAudioObjectPropertyScopeInput : kAudioObjectPropertyScopeOutput)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(id, &addr, 0, nil, &size) == noErr, size > 0 else { return 0 }
        let raw = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: MemoryLayout<AudioBufferList>.alignment)
        defer { raw.deallocate() }
        let list = raw.bindMemory(to: AudioBufferList.self, capacity: 1)
        guard AudioObjectGetPropertyData(id, &addr, 0, nil, &size, list) == noErr else { return 0 }
        return UnsafeMutableAudioBufferListPointer(list).reduce(0) { $0 + Int($1.mNumberChannels) }
    }

    static func find(name: String, input: Bool) -> AudioDeviceID? {
        allIDs().first { self.name($0) == name && channelCount($0, input: input) > 0 }
    }

    static func device(uid: String) -> AudioDeviceID? {
        allIDs().first { self.uid($0) == uid }
    }

    static var pocketMic: AudioDeviceID? { find(name: pocketMicName, input: true) }

    static var defaultInput: AudioDeviceID? {
        var addr = address(kAudioHardwarePropertyDefaultInputDevice)
        var id = AudioDeviceID(0)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &id) == noErr,
              id != 0 else { return nil }
        return id
    }

    @discardableResult
    static func setDefaultInput(_ id: AudioDeviceID) -> Bool {
        var addr = address(kAudioHardwarePropertyDefaultInputDevice)
        var value = id
        let size = UInt32(MemoryLayout<AudioDeviceID>.size)
        return AudioObjectSetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, size, &value) == noErr
    }
}

/// Switches the default input to Pocket Mic and back. The device to return to is
/// saved first, so a crash mid-dictation is undone on the next launch.
enum InputSwitch {
    private static let key = "restoreInputUID"

    static func engage(_ mic: AudioDeviceID) {
        if let current = AudioDevices.defaultInput, current != mic, let uid = AudioDevices.uid(current) {
            UserDefaults.standard.set(uid, forKey: key)
        }
        AudioDevices.setDefaultInput(mic)
    }

    /// Name of the input that comes back after dictation.
    static var restoreName: String {
        if let uid = UserDefaults.standard.string(forKey: key), let id = AudioDevices.device(uid: uid),
           let name = AudioDevices.name(id) { return name }
        return AudioDevices.defaultInput.flatMap { AudioDevices.name($0) } ?? "your usual mic"
    }

    static func release() {
        defer { UserDefaults.standard.removeObject(forKey: key) }
        guard let uid = UserDefaults.standard.string(forKey: key),
              let id = AudioDevices.device(uid: uid) else { return }
        AudioDevices.setDefaultInput(id)
    }

    /// Call at launch: undo a switch left behind by a crash.
    static func recover() {
        if UserDefaults.standard.string(forKey: key) != nil {
            log.info("restoring default input left switched by a previous run")
            release()
        }
    }
}
