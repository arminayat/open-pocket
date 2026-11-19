// Pocket Mic: a loopback audio device for macOS (CoreAudio AudioServerPlugIn).
//
// It has one output stream and one input stream on the same clock. Audio an
// app plays into "Pocket Mic" comes back out of "Pocket Mic" as microphone
// input. The heypocket app plays the Pocket recorder's live audio into it,
// so dictation apps such as OpenWhispr can record the Pocket like a real mic.
//
// The two directions share a ring buffer indexed by sample time. Input only
// returns frames that were actually written recently; everything else reads as
// silence, so stale audio is never replayed after playback stops.
//
// Built on libASPL (MIT). SPDX-License-Identifier: MIT

#include <aspl/Driver.hpp>

#include <CoreAudio/AudioServerPlugIn.h>

#include <atomic>
#include <cstring>
#include <vector>

namespace {

constexpr UInt32 kSampleRate = 48000;
constexpr UInt32 kChannels = 2;
constexpr SInt64 kRingFrames = 1 << 16;  // ~1.4 s at 48 kHz

AudioStreamBasicDescription FloatFormat()
{
    AudioStreamBasicDescription f = {};
    f.mSampleRate = kSampleRate;
    f.mFormatID = kAudioFormatLinearPCM;
    f.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagsNativeEndian |
                     kAudioFormatFlagIsPacked;
    f.mBitsPerChannel = 32;
    f.mChannelsPerFrame = kChannels;
    f.mBytesPerFrame = sizeof(Float32) * kChannels;
    f.mFramesPerPacket = 1;
    f.mBytesPerPacket = f.mBytesPerFrame;
    return f;
}

class Loopback : public aspl::ControlRequestHandler, public aspl::IORequestHandler
{
public:
    Loopback()
        : ring_(kRingFrames * kChannels, 0.0f)
    {
    }

    OSStatus OnStartIO() override
    {
        writtenEnd_.store(0, std::memory_order_relaxed);
        writtenStart_.store(0, std::memory_order_relaxed);
        return kAudioHardwareNoError;
    }

    // Realtime thread: mixed output of all playing clients.
    void OnWriteMixedOutput(const std::shared_ptr<aspl::Stream>&,
        Float64,
        Float64 timestamp,
        const void* bytes,
        UInt32 bytesCount) override
    {
        const auto* in = static_cast<const Float32*>(bytes);
        const SInt64 frames = bytesCount / (sizeof(Float32) * kChannels);
        const SInt64 start = static_cast<SInt64>(timestamp);

        for (SInt64 i = 0; i < frames; i++) {
            const SInt64 slot = Wrap(start + i);
            std::memcpy(&ring_[slot * kChannels], &in[i * kChannels], sizeof(Float32) * kChannels);
        }

        // A gap means playback stopped and restarted: start a new valid range.
        const SInt64 end = writtenEnd_.load(std::memory_order_relaxed);
        if (start != end) {
            writtenStart_.store(start, std::memory_order_relaxed);
        }
        writtenEnd_.store(start + frames, std::memory_order_release);
    }

    // Realtime thread: what recording clients get.
    void OnReadClientInput(const std::shared_ptr<aspl::Client>&,
        const std::shared_ptr<aspl::Stream>&,
        Float64,
        Float64 timestamp,
        void* bytes,
        UInt32 bytesCount) override
    {
        auto* out = static_cast<Float32*>(bytes);
        const SInt64 frames = bytesCount / (sizeof(Float32) * kChannels);
        const SInt64 start = static_cast<SInt64>(timestamp);

        const SInt64 end = writtenEnd_.load(std::memory_order_acquire);
        SInt64 validFrom = writtenStart_.load(std::memory_order_relaxed);
        if (validFrom < end - kRingFrames) {
            validFrom = end - kRingFrames;
        }

        for (SInt64 i = 0; i < frames; i++) {
            const SInt64 t = start + i;
            if (t >= validFrom && t < end) {
                std::memcpy(&out[i * kChannels], &ring_[Wrap(t) * kChannels],
                    sizeof(Float32) * kChannels);
            } else {
                std::memset(&out[i * kChannels], 0, sizeof(Float32) * kChannels);
            }
        }
    }

private:
    static SInt64 Wrap(SInt64 t)
    {
        const SInt64 m = t % kRingFrames;
        return m < 0 ? m + kRingFrames : m;
    }

    std::vector<Float32> ring_;
    std::atomic<SInt64> writtenStart_ {0};
    std::atomic<SInt64> writtenEnd_ {0};
};

std::shared_ptr<aspl::Driver> CreateDriver()
{
    auto context = std::make_shared<aspl::Context>();

    aspl::DeviceParameters params;
    params.Name = "Pocket Mic";
    params.Manufacturer = "heypocket";
    params.DeviceUID = "heypocket.PocketMic";
    params.ModelUID = "heypocket.PocketMic.model";
    params.SampleRate = kSampleRate;
    params.ChannelCount = kChannels;
    params.EnableMixing = true;
    params.CanBeDefaultForSystemSounds = false;

    auto device = std::make_shared<aspl::Device>(context, params);

    for (auto dir : {aspl::Direction::Output, aspl::Direction::Input}) {
        aspl::StreamParameters sp;
        sp.Direction = dir;
        sp.Format = FloatFormat();
        device->AddStreamAsync(sp);
    }

    auto handler = std::make_shared<Loopback>();
    device->SetControlHandler(handler);
    device->SetIOHandler(handler);

    auto plugin = std::make_shared<aspl::Plugin>(context);
    plugin->AddDevice(device);

    return std::make_shared<aspl::Driver>(context, plugin);
}

} // namespace

extern "C" void* PocketMicEntryPoint(CFAllocatorRef, CFUUIDRef typeUUID)
{
    if (!CFEqual(typeUUID, kAudioServerPlugInTypeUUID)) {
        return nullptr;
    }
    static std::shared_ptr<aspl::Driver> driver = CreateDriver();
    return driver->GetReference();
}
