import CoreMotion
import Foundation
import simd

enum MotionStatus: Equatable {
    case unavailable
    case stopped
    case running
    case interrupted
    case failed(String)
}

@MainActor
final class MotionTracker: NSObject, ObservableObject {
    @Published private(set) var orientation = simd_quatf(angle: 0, axis: SIMD3<Float>(0, 1, 0))
    @Published private(set) var status: MotionStatus = .stopped

    private let manager = CMMotionManager()
    private var rawOrientation = simd_quatf(angle: 0, axis: SIMD3<Float>(0, 1, 0))
    private var calibrationOffset = simd_quatf(angle: 0, axis: SIMD3<Float>(0, 1, 0))
    private var watchdog: Timer?
    private var lastUpdate = Date()

    func start() {
        guard manager.isDeviceMotionAvailable else {
            status = .unavailable
            return
        }
        guard !manager.isDeviceMotionActive else { return }
        status = .running
        manager.deviceMotionUpdateInterval = 1.0 / 90.0
        manager.showsMovementRecorder = false
        manager.startDeviceMotionUpdates(using: .xArbitraryCorrectedZVertical, to: .main) { [weak self] motion, error in
            guard let self else { return }
            if let error {
                status = .failed(error.localizedDescription)
                return
            }
            guard let motion else {
                status = .interrupted
                return
            }
            let q = motion.attitude.quaternion
            rawOrientation = simd_quatf(vector: SIMD4<Float>(Float(q.x), Float(q.y), Float(q.z), Float(q.w)))
            orientation = rawOrientation * calibrationOffset
            lastUpdate = Date()
            status = .running
        }
        watchdog = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, manager.isDeviceMotionActive else { return }
                if Date().timeIntervalSince(lastUpdate) > 0.75 {
                    status = .interrupted
                }
            }
        }
    }

    func stop() {
        watchdog?.invalidate()
        watchdog = nil
        manager.stopDeviceMotionUpdates()
        status = .stopped
    }

    func calibrate() {
        calibrationOffset = simd_inverse(rawOrientation)
        orientation = rawOrientation * calibrationOffset
    }
}
