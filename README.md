# VISI0N SPATIAL

VISI0N SPATIAL is the native iPhone application in this repository. It uses SwiftUI, CoreMotion, AVFoundation, Apple Vision, ARKit, and a custom Metal stereoscopic renderer. The primary target is iPhone 16e with iOS 18 or later, locked to a landscape user interface.

The repository also preserves an independent browser-based prototype, documented below as the companion web app.

## Native app status

The native application now has an Xcode project, shared scheme, app icon, privacy manifest, unit tests, UI tests, and a GitHub Actions iOS workflow. Compilation and physical-device behavior must be verified with Xcode or the workflow; a local Windows session cannot produce a real iOS build or signed IPA.

## Native features

- Shared SwiftUI/Metal spatial window manager with open, close, focus, move, resize, roll, depth, pin, minimize, maximize, restore, and positioning modes.
- World-locked, head-locked, and individual-yaw window behavior.
- Real side-by-side stereo rendering from parallel left/right cameras with configurable IPD, FOV, viewing distance, and lens correction.
- Gaze-dwell selection, stereoscopic reticle/progress, window cycling, touch controls, and VR exit controls.
- CoreMotion orientation at a 90 Hz target, quaternion calibration, smoothing, sensitivity, and interruption handling.
- Rear-camera capture with explicit permission and no front-camera fallback.
- On-device Apple Vision hand landmarks with pinch selection, movement, and resizing; touch remains the fallback.
- Studio, midnight, aurora, and imported equirectangular environments.
- ARKit world tracking, raw feature points, plane estimates, world-map export/import, and point metadata. This is not LiDAR mesh reconstruction.
- Functional Browser, Photos, Video Player, Camera, Music, Scanner, Files, Settings, Environment Selector, and Window Manager modules.
- App-private media storage, atomic workspace persistence, file protection, adaptive resolution, thermal/memory-aware window budgets, and a privacy manifest.

## Build and test

Requires macOS with Xcode 16.4 and an iOS 18.4 or later simulator runtime.

```bash
xcodebuild -list -project VISI0NSpatial.xcodeproj
xcodebuild test \
  -project VISI0NSpatial.xcodeproj \
  -scheme VISI0NSpatial \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 16e' \
  CODE_SIGNING_ALLOWED=NO
```

The unit suite covers window lifecycle, persistence, spatial math, stereo cameras, zero-to-one Metal depth projection, lens correction, gaze dwell, hand gestures, adaptive quality, document storage, generated textures, and scan metadata. UI tests cover launch, launcher/browser flow, settings, calibration, and the VR countdown.

## iOS CI and signing

`.github/workflows/ios-build.yml` runs project validation, Swift/Metal compilation, unit tests, and UI tests on a macOS runner. Test results are uploaded as an artifact.

A signed archive/IPA job is disabled unless the repository variable `IOS_SIGNING_ENABLED` is set to `true` and the user has explicitly configured all of these GitHub Secrets:

- `APPLE_TEAM_ID`
- `IOS_CERTIFICATE_BASE64` — base64 of a distribution `.p12`
- `IOS_CERTIFICATE_PASSWORD`
- `IOS_PROVISIONING_PROFILE_BASE64`
- `IOS_PROVISIONING_PROFILE_NAME`
- `APP_STORE_CONNECT_API_KEY_ID`
- `APP_STORE_CONNECT_API_ISSUER_ID`
- `APP_STORE_CONNECT_API_KEY_P8`

No signing material belongs in the repository. The workflow does not claim an IPA exists until export succeeds and the artifact is available.

## Native controls

- Drag empty space to look around outside VR.
- Drag a window title bar to move it, its lower-right corner to resize, and use two fingers to pinch/rotate.
- Tap close/minimize controls, or long-press a window to open its full module outside VR.
- In VR, gaze at a window and dwell to focus it; swipe up/down to cycle windows.
- Tap the upper-right exit icon in either eye, or swipe down with three fingers, to leave VR.

## Native privacy and limitations

- Camera processing and imported files stay on the device. Nothing is transmitted by the native spatial renderer.
- Photo selection uses the system picker and does not require full photo-library access.
- VR windows currently use generated module previews/control surfaces. Full application content opens in handheld/spatial mode; long-press inside VR exits to that mode rather than pretending the full module is rendered stereoscopically.
- ARKit plane and feature-point data is an approximation. The app does not claim LiDAR, dense depth-mesh, or metric reconstruction on iPhone 16e.
- Browser rendering uses WKWebView outside the Metal window. External website behavior and network access depend on the selected site.
- Cardboard comfort, lens alignment, rear-camera permission behavior, hand tracking, thermal performance, and physical-device stereo quality require an actual iPhone test.
- No private key, certificate, provisioning profile, Apple credential, signed IPA, or successful remote build is included or implied.

---

# Companion web prototype: VISI0N OS BETA

VISI0N OS BETA is a browser-based spatial computing PWA built for iPhone Safari in landscape, including manual Google Cardboard use. It is a web application, not a native iOS app or IPA.

## Features

- Three.js spatial workspace with independent floating windows.
- World-locked, head-locked and camera-facing window modes.
- Drag, pinch-resize, rotate, depth scroll, minimize, maximize and restore controls.
- Real side-by-side stereo rendering from two eye cameras, with IPD, FOV, distance and lens-correction settings.
- Device-orientation controls with iOS permission handling, calibration and touch-look fallback.
- Rear-camera preview with explicit permission and no silent front-camera fallback.
- Optional MediaPipe hand landmarks and pinch detection when the model and WebAssembly are available.
- Browser-compatible RGB feature scanning with saved, clearly labeled estimated point clouds.
- Aurora, studio, cyber and deep-space environments.
- Local Browser, Photos, Video, Camera, Music, Scanner, Files, Settings, Environments and Window Manager modules.
- IndexedDB media/scan storage and localStorage settings/window persistence.
- Installable PWA manifest, offline app shell and Safari installation guide.

## Develop

Requires Node.js 20.19+ (Node 22 recommended).

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. For production verification:

```bash
npm run verify
```

The verification command runs ESLint, TypeScript checking, Vitest and the production build.

## GitHub Pages

The default Vite base path is `/VISI0N-OS-BETA/`, matching the repository name in the project brief. If the connected repository uses a different name, set `VITE_BASE_PATH` before building:

```bash
VITE_BASE_PATH=/actual-repository-name/ npm run build
```

The workflow in `.github/workflows/deploy.yml` installs dependencies, verifies the project, uploads `dist/` and deploys it with the supported GitHub Pages actions. Deployment is not successful until that workflow finishes and the published URL is checked.

## Install on iPhone

1. Open the GitHub Pages site in Safari.
2. Tap the Share button.
3. Choose **Add to Home Screen**.
4. Confirm the name and tap **Add**.
5. Launch VISI0N OS from the home screen in landscape.

Safari cannot install a PWA silently. Camera and motion permissions are requested only after a user gesture.

## Controls

- Drag a window title bar to move it.
- Drag the lower-right handle or use two fingers to resize.
- Drag the rotate title-bar control to tilt a window.
- Scroll over a window to change its depth.
- Drag empty space to look around when motion tracking is off.
- In VR, center a control and hold gaze for about one second to select it.

## Privacy and limitations

- Camera frames, imported media and scans stay in browser storage unless the user explicitly downloads them.
- Hand tracking requires a network connection the first time its WASM runtime and model are loaded; it is not faked when unavailable.
- The scanner measures image features and estimates depth/geometry. It does not provide LiDAR, ARKit or metric reconstruction.
- Many websites prohibit iframe embedding. The Browser app explains this and can open those sites in Safari.
- Offline support starts after the app shell has been loaded and cached.
- Physical iPhone, Cardboard lens alignment, rear-camera selection and motion permission behavior still require device testing.
