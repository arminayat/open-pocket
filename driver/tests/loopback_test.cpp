// Unit test for the ring buffer in PocketMic.cpp (no CoreAudio daemon needed).
#include "../PocketMic.cpp"
#include <cassert>
#include <cstdio>

static std::vector<Float32> ramp(SInt64 start, SInt64 n) {
    std::vector<Float32> v(n * kChannels);
    for (SInt64 i = 0; i < n; i++)
        for (UInt32 c = 0; c < kChannels; c++) v[i * kChannels + c] = Float32(start + i) + 0.5f * c;
    return v;
}
static std::vector<Float32> read(Loopback& lb, SInt64 t, SInt64 n) {
    std::vector<Float32> v(n * kChannels, -1.0f);
    lb.OnReadClientInput(nullptr, nullptr, 0, Float64(t), v.data(), UInt32(v.size() * sizeof(Float32)));
    return v;
}
static void write(Loopback& lb, SInt64 t, SInt64 n) {
    auto v = ramp(t, n);
    lb.OnWriteMixedOutput(nullptr, 0, Float64(t), v.data(), UInt32(v.size() * sizeof(Float32)));
}
static bool same(const std::vector<Float32>& a, SInt64 t) { return a == ramp(t, a.size() / kChannels); }
static bool silent(const std::vector<Float32>& a) { for (auto x : a) if (x != 0.0f) return false; return true; }

int main() {
    Loopback lb;
    lb.OnStartIO();
    assert(silent(read(lb, 0, 512)));                      // nothing written yet
    write(lb, 1000, 512); write(lb, 1512, 512);             // continuous playback
    assert(same(read(lb, 1000, 1024), 1000));               // loops back exactly
    auto part = read(lb, 1900, 512);                        // straddles end of written data
    assert(same({part.begin(), part.begin() + 124 * kChannels}, 1900));
    assert(silent({part.begin() + 124 * kChannels, part.end()}));
    assert(silent(read(lb, 3000, 512)));                    // after playback stopped: silence
    write(lb, 200000, 512);                                 // playback restarts later
    assert(silent(read(lb, 1000 + kRingFrames * 3, 512)));  // old slots are not replayed
    assert(silent(read(lb, 1000, 512)));                    // pre-gap audio is gone
    assert(same(read(lb, 200000, 512), 200000));
    for (SInt64 t = 200512; t < 200512 + 3 * kRingFrames; t += 512) write(lb, t, 512);  // wrap around
    SInt64 end = 200512 + 3 * kRingFrames;
    assert(same(read(lb, end - 1024, 1024), end - 1024));
    assert(silent(read(lb, end - kRingFrames - 1024, 512))); // overwritten: silence, not garbage
    std::puts("loopback ok");
}
