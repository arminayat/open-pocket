// Renders the 1024 px app icon: an Instrument Serif "P" drawn as a dashed outline on white.
// Usage: npm run icon (xcrun swift scripts/app-icon.swift <font.ttf> <output.png>), then rebuild the native app.
import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

let size = 1024.0
// Like the Pocket icon, the letter is oversized: it starts 22% from the top and its foot
// serif runs off the bottom edge.
let letterHeight = size * 0.92
let letterTop = size * 0.22
let lineWidth = 18.0
let dash: [CGFloat] = [28, 26]

let args = CommandLine.arguments
guard args.count == 3,
      let descriptors = CTFontManagerCreateFontDescriptorsFromURL(URL(fileURLWithPath: args[1]) as CFURL) as? [CTFontDescriptor],
      let descriptor = descriptors.first else {
  fatalError("usage: app-icon.swift <font.ttf> <output.png>")
}

// Scale the glyph so its outline, not the font's em box, fills the target height.
let probe = CTFontCreateWithFontDescriptor(descriptor, 1000, nil)
var glyph = CGGlyph()
var character: UniChar = 0x50 // "P"
guard CTFontGetGlyphsForCharacters(probe, &character, &glyph, 1),
      let probePath = CTFontCreatePathForGlyph(probe, glyph, nil) else { fatalError("Font has no P glyph") }
let font = CTFontCreateWithFontDescriptor(descriptor, 1000 * letterHeight / probePath.boundingBoxOfPath.height, nil)
guard let glyphPath = CTFontCreatePathForGlyph(font, glyph, nil) else { fatalError("Font has no P glyph") }
let bounds = glyphPath.boundingBoxOfPath
// Bitmap y grows upwards, so the letter's top edge sits at size - letterTop.
var place = CGAffineTransform(translationX: (size - bounds.width) / 2 - bounds.minX, y: size - letterTop - bounds.maxY)
guard let letter = glyphPath.copy(using: &place) else { fatalError("Could not place the glyph") }

// App Store icons must be opaque, so the bitmap has no alpha channel.
guard let context = CGContext(data: nil, width: Int(size), height: Int(size), bitsPerComponent: 8, bytesPerRow: 0,
                              space: CGColorSpace(name: CGColorSpace.sRGB)!,
                              bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { fatalError("No bitmap context") }
context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
context.fill(CGRect(x: 0, y: 0, width: size, height: size))
context.addPath(letter)
context.setStrokeColor(CGColor(red: 0.07, green: 0.07, blue: 0.07, alpha: 1))
context.setLineWidth(lineWidth)
context.setLineCap(.round)
context.setLineJoin(.round)
context.setLineDash(phase: 0, lengths: dash)
context.strokePath()

guard let image = context.makeImage(),
      let output = CGImageDestinationCreateWithURL(URL(fileURLWithPath: args[2]) as CFURL, UTType.png.identifier as CFString, 1, nil) else {
  fatalError("Could not write \(args[2])")
}
CGImageDestinationAddImage(output, image, nil)
guard CGImageDestinationFinalize(output) else { fatalError("Could not write \(args[2])") }
