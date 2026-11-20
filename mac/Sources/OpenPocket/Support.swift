import Foundation
import SwiftUI
import os

let log = Logger(subsystem: "com.nestorcodecrafters.openpocket.mac", category: "app")

/// How this build is distributed. TestFlight builds (`APP_STORE`, set by testflight.sh) run in
/// the App Sandbox, so they can't install Pocket Mic themselves or run shell commands.
enum Distribution {
    #if APP_STORE
    static let appStore = true
    #else
    static let appStore = false
    #endif
}

func sleep(ms: Int) async {
    try? await Task.sleep(nanoseconds: UInt64(ms) * 1_000_000)
}

/// Stand-in for @State: in Command Line Tools SDKs @State is a macro whose
/// plugin only ships with Xcode. Hold one of these in @StateObject instead.
final class Box<T>: ObservableObject {
    @Published var value: T
    init(_ value: T) { self.value = value }
}
