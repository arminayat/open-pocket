// swift-tools-version:5.10
import PackageDescription

let package = Package(
    name: "OpenPocket",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "OpenPocket",
            path: "Sources/OpenPocket",
            linkerSettings: [.linkedLibrary("sqlite3")]
        ),
    ]
)
