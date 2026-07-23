import AVFoundation
import AppKit
import CoreMedia
import Foundation
import ScreenCaptureKit

final class WriterOutput: NSObject, SCStreamOutput, @unchecked Sendable {
    private let writer: AVAssetWriter
    private let input: AVAssetWriterInput
    private var started = false
    private let queue = DispatchQueue(label: "behold.capture.writer")

    init(url: URL, width: Int, height: Int) throws {
        writer = try AVAssetWriter(outputURL: url, fileType: .mov)
        input = AVAssetWriterInput(
            mediaType: .video,
            outputSettings: [
                AVVideoCodecKey: AVVideoCodecType.h264,
                AVVideoWidthKey: width,
                AVVideoHeightKey: height,
                AVVideoCompressionPropertiesKey: [
                    AVVideoAverageBitRateKey: 24_000_000,
                    AVVideoExpectedSourceFrameRateKey: 60,
                    AVVideoMaxKeyFrameIntervalKey: 120,
                ],
            ]
        )
        input.expectsMediaDataInRealTime = true
        guard writer.canAdd(input) else { throw CaptureError.cannotAddWriterInput }
        writer.add(input)
    }

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of outputType: SCStreamOutputType
    ) {
        guard outputType == .screen, sampleBuffer.isValid else { return }
        queue.async { [self] in
            if !started {
                guard writer.startWriting() else { return }
                writer.startSession(atSourceTime: sampleBuffer.presentationTimeStamp)
                started = true
            }
            if input.isReadyForMoreMediaData {
                input.append(sampleBuffer)
            }
        }
    }

    func finish() async throws {
        await withCheckedContinuation { continuation in
            queue.async { [self] in
                input.markAsFinished()
                writer.finishWriting { continuation.resume() }
            }
        }
        if writer.status != .completed {
            throw writer.error ?? CaptureError.writerFailed
        }
    }
}

enum CaptureError: Error, CustomStringConvertible {
    case usage
    case windowNotFound(String)
    case cannotAddWriterInput
    case writerFailed

    var description: String {
        switch self {
        case .usage:
            return "usage: capture-window <window-id-or-owner/title-substring> <seconds> <output.mov>"
        case let .windowNotFound(selector):
            return "window not found: \(selector)"
        case .cannotAddWriterInput:
            return "AVAssetWriter refused the video input"
        case .writerFailed:
            return "AVAssetWriter failed without an error"
        }
    }
}

@main
struct CaptureWindow {
    static func main() async throws {
        _ = NSApplication.shared
        let arguments = CommandLine.arguments
        guard arguments.count == 4,
              let seconds = Double(arguments[2]),
              seconds > 0
        else { throw CaptureError.usage }

        let selector = arguments[1]
        let outputURL = URL(fileURLWithPath: arguments[3]).standardizedFileURL
        try FileManager.default.createDirectory(
            at: outputURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try? FileManager.default.removeItem(at: outputURL)

        let content = try await SCShareableContent.excludingDesktopWindows(
            false,
            onScreenWindowsOnly: false
        )
        let window: SCWindow?
        if let rawWindowID = UInt32(selector) {
            window = content.windows.first(where: { $0.windowID == CGWindowID(rawWindowID) })
        } else {
            let needle = selector.lowercased()
            window = content.windows
                .filter { candidate in
                    let owner = candidate.owningApplication?.applicationName.lowercased() ?? ""
                    let title = candidate.title?.lowercased() ?? ""
                    return owner.contains(needle) || title.contains(needle)
                }
                .max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height })
        }
        guard let window else { throw CaptureError.windowNotFound(selector) }

        let width = max(2, Int(window.frame.width.rounded(.down)))
        let height = max(2, Int(window.frame.height.rounded(.down)))
        let configuration = SCStreamConfiguration()
        configuration.width = width
        configuration.height = height
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 60)
        configuration.queueDepth = 8
        configuration.pixelFormat = kCVPixelFormatType_32BGRA
        configuration.showsCursor = false
        configuration.capturesAudio = false

        let output = try WriterOutput(url: outputURL, width: width, height: height)
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let stream = SCStream(filter: filter, configuration: configuration, delegate: nil)
        let sampleQueue = DispatchQueue(label: "behold.capture.samples", qos: .userInitiated)
        try stream.addStreamOutput(output, type: .screen, sampleHandlerQueue: sampleQueue)

        try await stream.startCapture()
        try await Task.sleep(for: .seconds(seconds))
        try await stream.stopCapture()
        try await output.finish()

        let owner = window.owningApplication?.applicationName ?? "unknown"
        let title = window.title ?? "untitled"
        print(
            "captured window \(window.windowID) \(owner) / \(title) " +
                "(\(width)x\(height)) for \(seconds)s -> \(outputURL.path)"
        )
    }
}
