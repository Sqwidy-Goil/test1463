# VISI0N SPATIAL — Native iOS Development Notes

## Architecture

- `App/` contains the SwiftUI entry point, `Info.plist`, and the `@MainActor` application coordinator.
- `Interface/` contains the Liquid Glass design system, launcher, reusable controls, and handheld HUD.
- `Spatial/Scene/` defines persisted window transforms and spatial math.
- `Spatial/Windows/WindowManager.swift` owns the shared scene state, lifecycle actions, z-order, depth, positioning, and debounced atomic persistence.
- `VR/StereoscopicRenderer/` creates separate offscreen color/depth targets for each eye, renders the same scene through distinct camera matrices, then composites both views with lens correction and gaze UI.
- `VR/EyeCameras/StereoCameraRig.swift` implements parallel stereo cameras, Metal zero-to-one projection, lens correction, and gaze-dwell state.
- `Core/Motion/`, `Core/Camera/`, `Core/Permissions/`, `Core/Persistence/`, and `Core/Performance/` provide platform services.
- `Tracking/HandTracking/` contains a testable gesture state machine and Apple Vision hand-pose processing.
- `Scanning/ARSession/ScannerService.swift` owns ARKit world tracking, plane/feature sampling, and world-map/metadata export and import.
- `Modules/` contains the router and all ten native module views.
- `tests/VISI0NSpatialTests/` covers deterministic logic; `tests/VISI0NSpatialUITests/` exercises the app shell.

## Rendering invariants

1. One `SpatialWindow` array is the source of truth for rendering, hit testing, persistence, and UI controls.
2. Stereo mode renders left and right eye targets separately; it never duplicates a single image.
3. Eye targets use half the drawable width per eye in stereo mode and full width in monoscopic mode.
4. Camera matrices, ray construction, model placement, and hit testing share the same view-distance transform.
5. Window textures are regenerated when status, lifecycle, pin state, or dimensions change.
6. The postprocess pass composites both eye textures, applies configurable radial correction, and draws separate per-eye reticles/exit controls.
7. Shader uniforms are sent with `setVertexBytes`/`setFragmentBytes`; there is no unused uniform ring buffer.

## Build and test

Open `VISI0NSpatial.xcodeproj` in Xcode 16.4. The shared `VISI0NSpatial` scheme contains the app, unit tests, and UI tests.

```bash
node scripts/validate-native-project.cjs
xcodebuild test \
  -project VISI0NSpatial.xcodeproj \
  -scheme VISI0NSpatial \
  -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 16e' \
  -configuration Debug \
  CODE_SIGNING_ALLOWED=NO
```

The project validator parses the OpenStep project, checks references and source membership, verifies synchronized source trees, and checks asset metadata. It is not a substitute for `xcodebuild`.

## Persistence and privacy

- Workspace snapshots use versioned JSON, atomic writes, and `completeUntilFirstUserAuthentication` file protection.
- Optical, motion, camera, hand, and environment preferences use versioned `UserDefaults` data.
- Imported files live in `Documents/VISI0N-SPATIAL` and are only exported through explicit user actions.
- Photo import uses `PHPickerViewController`; camera access is requested only after a camera feature is enabled.
- `Config/PrivacyInfo.xcprivacy` declares no tracking and no collected data.
- Signing secrets are optional CI inputs and are never written into project files.

## Native limitations and QA gates

- Full SwiftUI modules are not rendered inside the Metal stereo surfaces; VR uses truthful module previews/control surfaces and hands full content off to handheld mode.
- iPhone 16e has no assumed LiDAR. The scanner exports ARKit feature points, estimated planes, and world maps, not a fabricated depth mesh.
- Camera, motion, hand tracking, and stereo comfort require a physical iPhone 16e.
- A successful simulator build does not validate Cardboard lens fit, thermal throttling, camera orientation, real gyro latency, or device signing.
- UI tests launch with `-ui-test-reset` to isolate persisted workspace state in Debug builds.

## CI

`ios-build.yml` runs simulator tests and uploads `.xcresult`. The signed archive/IPA job runs only with `IOS_SIGNING_ENABLED=true` and explicitly configured secrets documented in `README.md`. No workflow step should report an IPA without a successful export.

---

# VISI0N OS BETA — Companion Web Development Notes

## Architecture

- `src/main.ts` composes the shell, permissions, launcher, dialogs, settings and persistence.
- `src/spatial/scene.ts` owns the shared Three.js scene, environments, window interactions, adaptive quality and gaze selection.
- `src/spatial/window.ts` renders each application to a canvas texture on a real 3D plane.
- `src/spatial/stereo.ts` renders the shared scene through two eye cameras and composites lens-corrected left/right views.
- `src/core/` contains rear-camera, motion and local-storage services.
- `src/applications/` contains the built-in spatial applications and their registry.
- `src/services/scanner.ts` implements feature detection, patch tracking and estimated point generation.
- `src/tracking/handTracking.ts` lazily loads MediaPipe Tasks Vision and exposes real landmarks/pinch state.
- `public/` contains the manifest, service worker, offline page and app icon.

## Development phases

### Completed in the local implementation

1. **Foundation** — TypeScript/Vite architecture, landscape shell, Liquid Glass styling, responsive controls.
2. **Spatial engine** — shared 3D scene, textured windows, transforms, anchoring modes and persistence.
3. **Cardboard VR** — dual eye cameras, stereo compositing, IPD/FOV/distance/distortion controls and gaze dwell.
4. **Motion and interaction** — iOS permission flow, calibration, smoothing, touch-look and multitouch resize.
5. **Camera and tracking** — environment-facing camera preference, explicit front-camera rejection, optional MediaPipe hand tracking.
6. **Environments** — four procedural spaces with shared window state.
7. **Scanning** — grayscale feature detection, patch tracking, estimated point clouds, IndexedDB save/reload.
8. **Applications** — Browser, Photos, Video, Camera, Music, Scanner, Files, Settings, Environments and Windows.
9. **PWA/offline** — manifest, service worker, offline fallback and installation instructions.
10. **Verification/deployment** — automated tests, lint/typecheck/build workflow and a prepared Pages deployment workflow.

### Local browser verification — 2026-11-25

- `npm run verify` passes ESLint, TypeScript, 13 Vitest tests and the production build.
- Headless Chrome at 874×430 launches all ten apps, persists settings and renders distinct left/right Cardboard views without console errors.
- Window drag, depth scrolling, maximize/restore, anchoring modes, pinch resize, rotate, resize grip, minimize/restore, close and empty-state recovery pass.
- Environment changes persist; browser address entry and sandboxed iframe projection align with the spatial window.
- Camera permission denial reports an error without an unhandled rejection.
- Manifest PNG icons load, the service worker controls the page and an offline reload restores the cached shell and saved windows.
- Physical iPhone 16e Safari/Cardboard QA and the remote GitHub Actions Pages run remain outstanding.

## Known limitations

- No native ARKit, LiDAR or metric depth access is assumed.
- Hand tracking model/WASM assets are fetched from MediaPipe/CDN hosts on first use and may be blocked offline or by network policy.
- Browser iframe support depends on each site's headers.
- iOS Safari may report an unknown camera facing mode; the app reports this instead of claiming a rear camera.
- CSS orientation locking is not assumed; portrait users receive a rotate instruction.
- Service-worker caching cannot include private IndexedDB blobs as HTTP assets; those records remain available locally through IndexedDB.

## Device QA checklist

- [ ] iPhone 16e landscape layout and safe-area insets.
- [ ] Add to Home Screen launch and standalone behavior.
- [ ] Rear-camera permission and actual environment-facing selection.
- [ ] Motion permission, calibration and 360-degree response.
- [ ] Window drag/resize/rotate/depth and state restoration.
- [ ] Left/right perspective difference and Cardboard lens alignment.
- [ ] Offline reload after the app shell has been cached.
- [ ] Local media import/playback/deletion and scan save/reload.
- [ ] Hand tracking model load, landmarks and pinch threshold.

## Future improvements

- Add user-imported panoramic equirectangular environments.
- Improve scan geometry with bundle adjustment when feasible on device.
- Add adaptive hand-tracking cadence based on measured frame cost.
- Promote the local CDP permission-denied, browser-overlay and offline checks into a maintained browser-test suite.
