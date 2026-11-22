/* global Hands, HAND_CONNECTIONS */

(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const status = $('#status');
  const statusDot = $('.status-dot');
  const hint = $('#gesture-hint');
  const cameraButton = $('#camera-button');
  const motionButton = $('#motion-button');
  const uploadButton = $('#upload-button');
  const fileInput = $('#video-file');
  const cameraVideo = $('#input-video');
  const scanCanvas = $('#scan-canvas');
  const scanContext = scanCanvas.getContext('2d');
  const scanHud = $('#scan-hud');
  const handCanvas = $('#hand-canvas');
  const handContext = handCanvas.getContext('2d');
  const screen = $('#ar-screen');
  const screenBar = $('#screen-bar');
  const resizeHandle = $('#resize-handle');
  const closeScreen = $('#close-screen');
  const uploadedVideo = $('#uploaded-video');
  const emptyVideo = $('#empty-video');
  const playBtn = $('#screen-play');
  const screenName = $('#screen-name');
  const anchorLabel = $('#anchor-label');
  const cursor = $('#hand-cursor');
  const scanButton = $('#scan-button');
  const vrButton = $('#vr-button');
  const vrMenu = $('#vr-menu');

  const debugMode = /[?&]debug\b/.test(location.search);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const minSize = { width: 220, height: 160 };
  const SMOOTHING = reduceMotion ? 1 : 0.24;
  const ORIENTATION_SMOOTH = reduceMotion ? 1 : 0.32;
  const FOCAL_FACTOR = 1.0;  // multiplicateur du focal (px) : 1.0 ≈ 55° FOV horizontal

  let objectUrl = null;
  let screenState = { x: 0, y: 0, width: 0, height: 0 };
  let targetState = { x: 0, y: 0, width: 0, height: 0 };
  let interaction = null;
  let twoHandResize = null;
  let motionEnabled = false;

  // Orientation : heading accumulé (non borné) + pitch (beta) lissés
  let rawHeading = null;
  let accumulatedHeading = 0;
  let smoothedHeadingAcc = 0;
  let rawBeta = null;
  let smoothedBeta = null;

  // Ancres monde
  let screenAnchor = null;  // { heading, pitch(beta), offsetX, offsetY }
  let menuAnchor = null;

  // VR
  let vrMode = false;
  let vrMenuTarget = { x: 0, y: 0 };
  let vrMenuState = { x: 0, y: 0 };
  let menuClickLatch = false;
  let playClickLatch = false;

  // Scan
  let scanActive = false;
  let scanAnimation = 0;
  let previousLuma = null;
  let depthVertices = [];
  let lastScanAt = 0;

  // Tracking
  let lastFrameAt = 0;
  let fps = 0;
  let smoothPoint = null;
  let lastHands = [];
  let handLostSince = 0;
  let pinchHeld = false;
  let handsInstance = null;
  let trackingLoop = null;

  const scanSource = document.createElement('canvas');
  const scanSourceContext = scanSource.getContext('2d', { willReadFrequently: true });
  const scanGrid = { width: 72, height: 54, step: 4 };
  scanSource.width = scanGrid.width;
  scanSource.height = scanGrid.height;

  /* ------------------------------------------------------------------ */
  /* Utilitaires                                                         */
  /* ------------------------------------------------------------------ */

  function setStatus(message, mode = 'ready') {
    status.textContent = message;
    statusDot.className = `status-dot ${mode}`;
  }
  function setHint(message) { hint.textContent = message; }
  function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function angleDelta(from, to) { return ((to - from + 540) % 360) - 180; }
  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0)); }

  /* ------------------------------------------------------------------ */
  /* Écran vidéo                                                         */
  /* ------------------------------------------------------------------ */

  function initialiseScreen() {
    const width = Math.min(520, innerWidth * (innerWidth < 600 ? 0.78 : 0.62));
    const height = width * 0.64;
    targetState = { x: (innerWidth - width) / 2, y: (innerHeight - height) / 2, width, height };
    screenState = { ...targetState };
    applyScreen(true);
    placeScreenAnchor();
  }

  function showScreen() {
    if (screen.hidden) {
      screen.hidden = false;
      initialiseScreen();
    }
  }

  function clampTarget(allowOffscreen) {
    if (allowOffscreen) return;
    const maxX = Math.max(0, innerWidth - targetState.width);
    const maxY = Math.max(0, innerHeight - targetState.height);
    targetState.x = clamp(targetState.x, 0, maxX);
    targetState.y = clamp(targetState.y, 0, maxY);
  }

  function applyScreen(snap = false) {
    const allowOffscreen = Boolean(screenAnchor) && !interaction && !twoHandResize;
    clampTarget(allowOffscreen);
    const t = snap ? 1 : SMOOTHING;
    screenState.x = lerp(screenState.x, targetState.x, t);
    screenState.y = lerp(screenState.y, targetState.y, t);
    screenState.width = lerp(screenState.width, targetState.width, t);
    screenState.height = lerp(screenState.height, targetState.height, t);
    screen.style.left = `${screenState.x.toFixed(2)}px`;
    screen.style.top = `${screenState.y.toFixed(2)}px`;
    screen.style.width = `${screenState.width.toFixed(2)}px`;
    screen.style.height = `${screenState.height.toFixed(2)}px`;
    updateSpatialPose();
  }

  // Parallaxe CSS : petite rotation de l'écran selon l'écart au cap ancré
  function updateSpatialPose() {
    if (!screenAnchor || smoothedBeta === null) {
      screen.style.setProperty('--yaw', '-3deg');
      screen.style.setProperty('--pitch', '1deg');
      screen.style.setProperty('--lift', '0px');
      return;
    }
    const headingDelta = smoothedHeadingAcc - screenAnchor.heading;
    const pitchDelta = smoothedBeta - screenAnchor.pitch;
    const yaw = clamp(-headingDelta * 0.10, -8, 8);
    const pitch = clamp(pitchDelta * 0.10, -6, 6);
    const lift = clamp(Math.abs(headingDelta) * 0.30, 0, 20);
    screen.style.setProperty('--yaw', `${yaw.toFixed(2)}deg`);
    screen.style.setProperty('--pitch', `${pitch.toFixed(2)}deg`);
    screen.style.setProperty('--lift', `${lift.toFixed(1)}px`);
  }

  function bounds() {
    return { left: screenState.x, top: screenState.y, right: screenState.x + screenState.width, bottom: screenState.y + screenState.height };
  }
  function pointInScreen(point) {
    const b = bounds();
    return point.x >= b.left && point.x <= b.right && point.y >= b.top && point.y <= b.bottom;
  }
  function pointOnResizeHandle(point) {
    const b = bounds();
    return point.x >= b.right - 58 && point.x <= b.right + 12 && point.y >= b.bottom - 58 && point.y <= b.bottom + 12;
  }

  /* ------------------------------------------------------------------ */
  /* Projection sphérique 3D — la clé du 360°                            */
  /* ------------------------------------------------------------------ */

  // Projection d'une ancre monde vers l'écran, selon l'orientation actuelle.
  // Renvoie la position pixel de l'ancre (centrée = innerWidth/2, innerHeight/2),
  // ou null si l'ancre est derrière la caméra (hors du champ).
  function projectAnchorToScreen(anchor) {
    if (smoothedBeta === null) return null;

    // Vecteur monde de l'ancre (sphère unité). pitch(beta) → élévation = beta - 90
    const anchorElevRad = (anchor.pitch - 90) * Math.PI / 180;
    const anchorHeadRad = anchor.heading * Math.PI / 180;
    const Ax = Math.sin(anchorHeadRad) * Math.cos(anchorElevRad);
    const Ay = Math.sin(anchorElevRad);
    const Az = Math.cos(anchorHeadRad) * Math.cos(anchorElevRad);

    // Base caméra courante
    const camElevRad = (smoothedBeta - 90) * Math.PI / 180;
    const camHeadRad = smoothedHeadingAcc * Math.PI / 180;
    const Fx = Math.sin(camHeadRad) * Math.cos(camElevRad);
    const Fy = Math.sin(camElevRad);
    const Fz = Math.cos(camHeadRad) * Math.cos(camElevRad);
    const Rx = Math.cos(camHeadRad);
    const Rz = -Math.sin(camHeadRad);
    // U = F × R
    const Ux = Fy * Rz;
    const Uy = Fz * Rx - Fx * Rz;
    const Uz = -Fy * Rx;

    const depth = Ax * Fx + Ay * Fy + Az * Fz;
    if (depth <= 0.05) return null;

    const right = Ax * Rx + Az * Rz;
    const up = Ax * Ux + Ay * Uy + Az * Uz;

    const focal = innerWidth * FOCAL_FACTOR;
    const offsetX = (right / depth) * focal;
    const offsetY = -(up / depth) * focal;

    return {
      x: innerWidth / 2 + offsetX,
      y: innerHeight / 2 + offsetY
    };
  }

  /* ------------------------------------------------------------------ */
  /* Ancrage écran                                                       */
  /* ------------------------------------------------------------------ */

  function placeScreenAnchor() {
    if (!motionEnabled || smoothedBeta === null || screen.hidden) return;
    const cx = targetState.x + targetState.width / 2;
    const cy = targetState.y + targetState.height / 2;
    screenAnchor = {
      heading: smoothedHeadingAcc,
      pitch: smoothedBeta,
      offsetX: cx - innerWidth / 2,
      offsetY: cy - innerHeight / 2
    };
    anchorLabel.textContent = 'ANCRAGE ORIENTATION';
  }

  /* ------------------------------------------------------------------ */
  /* Manipulation écran                                                  */
  /* ------------------------------------------------------------------ */

  function beginInteraction(point, mode, source) {
    if (screen.hidden) return false;
    screenAnchor = null;
    anchorLabel.textContent = 'MANIPULATION';
    if (mode === 'resize') {
      interaction = { mode, source, startX: point.x, startY: point.y, width: targetState.width, height: targetState.height };
      setHint('Pincement actif : éloignez votre main pour agrandir la fenêtre.');
    } else {
      interaction = { mode: 'move', source, offsetX: point.x - targetState.x, offsetY: point.y - targetState.y };
      setHint('Pincement actif : déplacez la main pour poser l’écran.');
    }
    screen.classList.add('grabbed');
    return true;
  }

  function updateInteraction(point, source) {
    if (!interaction || interaction.source !== source) return;
    if (interaction.mode === 'move') {
      targetState.x = point.x - interaction.offsetX;
      targetState.y = point.y - interaction.offsetY;
    } else {
      targetState.width = clamp(interaction.width + point.x - interaction.startX, minSize.width, innerWidth * 0.94);
      targetState.height = clamp(interaction.height + point.y - interaction.startY, minSize.height, innerHeight * 0.82);
    }
    applyScreen();
  }

  function endInteraction(source) {
    if (!interaction || interaction.source !== source) return;
    interaction = null;
    screen.classList.remove('grabbed');
    placeScreenAnchor();
    setHint('Écran posé.');
  }

  function resizeFromTwoHands(a, b) {
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (!twoHandResize) {
      if (screen.hidden || !pointInScreen(a)) return;
      screenAnchor = null;
      anchorLabel.textContent = 'REDIMENSIONNEMENT';
      twoHandResize = { distance: Math.max(dist, 1), width: targetState.width, height: targetState.height };
      screen.classList.add('grabbed');
      return;
    }
    const scale = clamp(dist / twoHandResize.distance, 0.5, 2.4);
    targetState.width = clamp(twoHandResize.width * scale, minSize.width, innerWidth * 0.94);
    targetState.height = clamp(twoHandResize.height * scale, minSize.height, innerHeight * 0.82);
    applyScreen();
  }

  function endTwoHandResize() {
    if (!twoHandResize) return;
    twoHandResize = null;
    screen.classList.remove('grabbed');
    placeScreenAnchor();
  }

  /* ------------------------------------------------------------------ */
  /* Vidéo importée                                                      */
  /* ------------------------------------------------------------------ */

  function openFilePicker() { fileInput.click(); }

  function loadVideo(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    uploadedVideo.src = objectUrl;
    uploadedVideo.load();
    uploadedVideo.play().catch(() => {});
    emptyVideo.hidden = true;
    playBtn.hidden = false;
    playBtn.classList.remove('playing');
    screenName.textContent = file.name;
    showScreen();
    setStatus('Vidéo ouverte dans l’écran spatial', 'active');
    setHint('Pincez la barre supérieure pour déplacer l’écran, ou le centre pour lancer la vidéo.');
    event.target.value = '';
  }

  function pointerPosition(event) { return { x: event.clientX, y: event.clientY }; }
  function startPointerMove(e) { e.preventDefault(); beginInteraction(pointerPosition(e), 'move', 'pointer'); screen.setPointerCapture(e.pointerId); }
  function startPointerResize(e) { e.preventDefault(); e.stopPropagation(); beginInteraction(pointerPosition(e), 'resize', 'pointer'); screen.setPointerCapture(e.pointerId); }
  function movePointer(e) { updateInteraction(pointerPosition(e), 'pointer'); }
  function endPointer() { endInteraction('pointer'); }

  /* ------------------------------------------------------------------ */
  /* Hit-tests VR                                                        */
  /* ------------------------------------------------------------------ */

  function pointOnVrMenu(point) {
    if (vrMenu.hidden) return null;
    const rect = vrMenu.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    if (point.x < rect.left - 8 || point.x > rect.right + 8 || point.y < rect.top - 8 || point.y > rect.bottom + 8) return null;
    for (const btn of vrMenu.querySelectorAll('button')) {
      const br = btn.getBoundingClientRect();
      if (point.x >= br.left && point.x <= br.right && point.y >= br.top && point.y <= br.bottom) return btn;
    }
    return null;
  }

  function pointOnPlayButton(point) {
    if (screen.hidden || playBtn.hidden) return null;
    const rect = playBtn.getBoundingClientRect();
    if (rect.width === 0) return null;
    const m = 18; // marge tactile
    if (point.x < rect.left - m || point.x > rect.right + m) return null;
    if (point.y < rect.top - m || point.y > rect.bottom + m) return null;
    return playBtn;
  }

  function handleVrMenuAction(action) {
    switch (action) {
      case 'reanchor':
        placeScreenAnchor();
        placeMenuAnchor();
        setStatus('Ancres replacées', 'active');
        break;
      case 'close-screen':
        if (!screen.hidden) { screen.hidden = true; uploadedVideo.pause(); }
        if (vrMode) toggleVRMode();
        setStatus('Écran fermé', 'ready');
        break;
      case 'exit':
        if (vrMode) toggleVRMode();
        break;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Menu VR                                                             */
  /* ------------------------------------------------------------------ */

  function applyVrMenuPosition(snap = false) {
    if (vrMenu.hidden) return;
    const t = snap ? 1 : SMOOTHING;
    vrMenuState.x = lerp(vrMenuState.x, vrMenuTarget.x, t);
    vrMenuState.y = lerp(vrMenuState.y, vrMenuTarget.y, t);
    vrMenu.style.left = `${vrMenuState.x.toFixed(1)}px`;
    vrMenu.style.top = `${vrMenuState.y.toFixed(1)}px`;
  }

  function placeMenuAnchor() {
    if (!motionEnabled || smoothedBeta === null || vrMenu.hidden) { menuAnchor = null; return; }
    const rect = vrMenu.getBoundingClientRect();
    if (rect.width === 0) return;
    const cx = vrMenuTarget.x + rect.width / 2;
    const cy = vrMenuTarget.y + rect.height / 2;
    menuAnchor = {
      heading: smoothedHeadingAcc,
      pitch: smoothedBeta,
      offsetX: cx - innerWidth / 2,
      offsetY: cy - innerHeight / 2,
      width: rect.width,
      height: rect.height
    };
  }

  function toggleVRMode() {
    vrMode = !vrMode;
    document.body.classList.toggle('vr-mode', vrMode);
    vrButton.classList.toggle('active', vrMode);

    if (vrMode) {
      vrMenuTarget = { x: Math.max(14, innerWidth - 210), y: Math.max(90, innerHeight * 0.15) };
      vrMenuState = { ...vrMenuTarget };
      vrMenu.hidden = false;
      applyVrMenuPosition(true);
      placeMenuAnchor();
      if (!screen.hidden) placeScreenAnchor();
      setStatus('Mode VR — pincez un bouton pour cliquer', 'active');
      setHint('Pincez l’index + pouce sur un bouton pour cliquer · Pincez la barre pour déplacer l’écran.');
    } else {
      vrMenu.hidden = true;
      menuAnchor = null;
      menuClickLatch = false;
      setStatus('Mode VR désactivé', 'ready');
      setHint('Écran posé.');
      if (!screen.hidden) placeScreenAnchor();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Mains                                                               */
  /* ------------------------------------------------------------------ */

  function fingerExtended(lm, tip, pip) { return distance(lm[tip], lm[0]) > distance(lm[pip], lm[0]) * 1.16; }

  function handData(lm, index) {
    const raw = { x: lm[8].x * innerWidth, y: lm[8].y * innerHeight };
    const pinchDist = distance(lm[4], lm[8]);
    if (pinchDist < 0.05) pinchHeld = true;
    else if (pinchDist > 0.07) pinchHeld = false;
    return {
      index,
      raw,
      point: raw,
      depth: clamp(0.5 - (lm[8].z || 0) * 2.5, 0, 1),
      pinch: pinchHeld,
      pinchDistance: pinchDist,
      indexOpen: fingerExtended(lm, 8, 6),
      landmarks: lm
    };
  }

  function smoothCursor(raw) {
    if (!smoothPoint || !smoothCursor.last) smoothPoint = { ...raw };
    else {
      const t = reduceMotion ? 1 : 0.42;
      smoothPoint = { x: lerp(smoothPoint.x, raw.x, t), y: lerp(smoothPoint.y, raw.y, t) };
    }
    smoothCursor.last = raw;
    return smoothPoint;
  }

  function showCursor(p, pinching, depth = 0.5) {
    cursor.style.left = `${p.x.toFixed(1)}px`;
    cursor.style.top = `${p.y.toFixed(1)}px`;
    cursor.style.setProperty('--depth', depth.toFixed(3));
    cursor.classList.add('visible');
    cursor.classList.toggle('pinching', pinching);
  }

  function drawHandSkeleton(lm) {
    const w = handCanvas.width, h = handCanvas.height;
    const scale = w / 1280;
    handContext.lineCap = 'round';
    handContext.lineWidth = 5.5 * scale;
    handContext.strokeStyle = 'rgba(20, 60, 110, .5)';
    HAND_CONNECTIONS.forEach(([a, b]) => {
      handContext.beginPath();
      handContext.moveTo(lm[a].x * w, lm[a].y * h);
      handContext.lineTo(lm[b].x * w, lm[b].y * h);
      handContext.stroke();
    });
    handContext.lineWidth = 2.4 * scale;
    handContext.strokeStyle = 'rgba(120, 232, 255, .85)';
    HAND_CONNECTIONS.forEach(([a, b]) => {
      handContext.beginPath();
      handContext.moveTo(lm[a].x * w, lm[a].y * h);
      handContext.lineTo(lm[b].x * w, lm[b].y * h);
      handContext.stroke();
    });
    lm.forEach((landmark, i) => {
      const d = clamp(0.5 - landmark.z * 2.5, 0, 1);
      const x = landmark.x * w;
      const y = landmark.y * h;
      const r = (2.4 + d * 3.8) * scale;
      handContext.beginPath();
      handContext.arc(x, y, r, 0, Math.PI * 2);
      handContext.fillStyle = `rgba(${Math.round(110 + d * 70)}, 245, 255, ${0.35 + d * 0.6})`;
      handContext.fill();
      if (i === 8 || i === 4) {
        handContext.beginPath();
        handContext.arc(x, y, r * 2.2, 0, Math.PI * 2);
        handContext.strokeStyle = `rgba(69, 221, 255, ${0.25 + d * 0.5})`;
        handContext.lineWidth = 1.5 * scale;
        handContext.stroke();
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Scan pièce                                                          */
  /* ------------------------------------------------------------------ */

  function analyseRelativeDepth() {
    if (cameraVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    const { width, height, step } = scanGrid;
    scanSourceContext.drawImage(cameraVideo, 0, 0, width, height);
    const px = scanSourceContext.getImageData(0, 0, width, height).data;
    const luma = new Float32Array(width * height);
    for (let i = 0, j = 0; i < luma.length; i++, j += 4) {
      luma[i] = px[j] * 0.2126 + px[j + 1] * 0.7152 + px[j + 2] * 0.0722;
    }
    const verts = [];
    for (let y = step; y < height - step; y += step) {
      for (let x = step; x < width - step; x += step) {
        const i = y * width + x;
        const hDiff = Math.abs(luma[i + step] - luma[i - step]);
        const vDiff = Math.abs(luma[i + width * step] - luma[i - width * step]);
        const structure = clamp((hDiff + vDiff) / 150, 0, 1);
        const temporal = previousLuma ? clamp(Math.abs(luma[i] - previousLuma[i]) / 46, 0, 1) : 0;
        const floorP = y / (height - 1);
        const near = clamp(0.12 + structure * 0.31 + temporal * 0.20 + floorP * 0.37, 0, 1);
        verts.push({ x: (x / width) * innerWidth, y: (y / height) * innerHeight, near, light: luma[i] / 255 });
      }
    }
    previousLuma = luma;
    depthVertices = verts;
    drawDepthField();
  }

  function drawDepthField() {
    const density = Math.min(devicePixelRatio, 2);
    scanContext.setTransform(density, 0, 0, density, 0, 0);
    scanContext.clearRect(0, 0, innerWidth, innerHeight);
    if (!depthVertices.length) return;
    const cols = Math.floor((scanGrid.width - scanGrid.step * 2 - 1) / scanGrid.step) + 1;
    let drift = 0;
    if (screenAnchor) drift = (smoothedHeadingAcc - screenAnchor.heading) * 1.8;
    scanContext.lineWidth = 0.65;
    for (let i = 0; i < depthVertices.length; i++) {
      const v = depthVertices[i];
      const px = v.x + (v.near - 0.5) * 28 + drift;
      const py = v.y - v.near * 18;
      const nbrs = [i + cols];
      if (i % cols !== cols - 1) nbrs.push(i + 1);
      nbrs.forEach(ni => {
        const n = depthVertices[ni];
        if (!n || Math.abs(n.near - v.near) > 0.24) return;
        scanContext.beginPath();
        scanContext.moveTo(px, py);
        scanContext.lineTo(n.x + (n.near - 0.5) * 28 + drift, n.y - n.near * 18);
        scanContext.strokeStyle = `rgba(75, 173, 255, ${0.025 + (v.near + n.near) * 0.075})`;
        scanContext.stroke();
      });
      scanContext.beginPath();
      scanContext.arc(px, py, 0.45 + v.near * 1.35, 0, Math.PI * 2);
      scanContext.fillStyle = `rgba(${Math.round(84 + v.light * 70)}, ${Math.round(135 + v.near * 110)}, 255, ${0.08 + v.near * 0.22})`;
      scanContext.fill();
    }
  }

  function runScanLoop(ts) {
    if (!scanActive) return;
    if (ts - lastScanAt > 165) { lastScanAt = ts; analyseRelativeDepth(); }
    scanAnimation = requestAnimationFrame(runScanLoop);
  }

  function toggleRoomScan() {
    scanActive = !scanActive;
    scanButton.classList.toggle('active', scanActive);
    scanButton.textContent = scanActive ? '◌ Stopper le scan' : '◌ Scanner la pièce';
    scanHud.hidden = !scanActive;
    if (scanActive) {
      previousLuma = null;
      lastScanAt = 0;
      setStatus('Scan 3D relatif actif', 'active');
      scanAnimation = requestAnimationFrame(runScanLoop);
    } else {
      cancelAnimationFrame(scanAnimation);
      scanAnimation = 0;
      depthVertices = [];
      scanContext.clearRect(0, 0, scanCanvas.width, scanCanvas.height);
      setStatus('Scan 3D relatif arrêté', 'ready');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Résultats MediaPipe                                                 */
  /* ------------------------------------------------------------------ */

  function onResults(results) {
    const now = performance.now();
    if (lastFrameAt) fps = lerp(fps || 30, 1000 / Math.max(1, now - lastFrameAt), 0.1);
    lastFrameAt = now;

    handContext.clearRect(0, 0, handCanvas.width, handCanvas.height);
    const list = results.multiHandLandmarks || [];

    if (!list.length) {
      if (!handLostSince) handLostSince = now;
      if (now - handLostSince > 120) {
        cursor.classList.remove('visible');
        smoothCursor.last = null;
        pinchHeld = false;
        menuClickLatch = false;
        playClickLatch = false;
        if (interaction) endInteraction('hand');
        endTwoHandResize();
        lastHands = [];
      }
      return;
    }
    handLostSince = 0;

    lastHands = list.map((lm, i) => handData(lm, i));
    lastHands.forEach(h => drawHandSkeleton(h.landmarks));

    const primary = lastHands[0];
    const point = smoothCursor(primary.raw);
    primary.point = point;
    showCursor(point, primary.pinch, primary.depth);

    const doublePinch = lastHands.length > 1 && lastHands[0].pinch && lastHands[1].pinch;
    if (doublePinch) {
      if (interaction) endInteraction('hand');
      resizeFromTwoHands(lastHands[0].point, lastHands[1].point);
      return;
    }
    endTwoHandResize();

    if (primary.pinch) {
      if (!interaction && !menuClickLatch && !playClickLatch) {
        const playHit = pointOnPlayButton(point);
        if (playHit) {
          playClickLatch = true;
          if (uploadedVideo.paused) uploadedVideo.play().catch(() => {});
          else uploadedVideo.pause();
        } else {
          const menuBtn = pointOnVrMenu(point);
          if (menuBtn) {
            menuClickLatch = true;
            handleVrMenuAction(menuBtn.dataset.vrAction);
          } else if (pointOnResizeHandle(point)) {
            beginInteraction(point, 'resize', 'hand');
          } else if (pointInScreen(point)) {
            beginInteraction(point, 'move', 'hand');
          }
        }
      }
      updateInteraction(point, 'hand');
    } else {
      menuClickLatch = false;
      playClickLatch = false;
      if (interaction) endInteraction('hand');
      if (vrMode) {
        const menuBtn = pointOnVrMenu(point);
        setStatus(menuBtn ? `Prêt : ${menuBtn.textContent.trim()}` : 'Mode VR — pincez pour cliquer', 'active');
      } else if (primary.indexOpen) {
        setStatus('Index détecté — pincez pour saisir', 'active');
      } else {
        setStatus(`Main détectée${fps ? ` · ${Math.round(fps)} i/s` : ''}`, 'active');
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Caméra arrière                                                      */
  /* ------------------------------------------------------------------ */

  function stopStream(s) { s?.getTracks().forEach(t => t.stop()); }
  const FRONT = /front|facetime|selfie|\buser\b|avant/i;
  const REAR = /back|rear|environment|arri[eè]re|ultra ?wide|telephoto|t[eé]l[eé]objectif|grand angle/i;

  function streamFacing(stream) {
    const t = stream.getVideoTracks()[0];
    if (!t) return 'user';
    const s = t.getSettings?.() || {};
    const l = t.label || '';
    if (s.facingMode === 'environment') return 'environment';
    if (s.facingMode === 'user') return 'user';
    if (REAR.test(l)) return 'environment';
    if (FRONT.test(l)) return 'user';
    return 'unknown';
  }
  const isFront = s => streamFacing(s) === 'user';

  async function rearDevices() {
    const ds = await navigator.mediaDevices.enumerateDevices();
    const ins = ds.filter(d => d.kind === 'videoinput');
    const named = ins.filter(d => REAR.test(d.label) && !FRONT.test(d.label));
    return named.length ? named : ins.filter(d => !FRONT.test(d.label));
  }
  const openDevice = (id, base) => navigator.mediaDevices.getUserMedia({ video: { ...base, deviceId: { exact: id } }, audio: false });

  async function requestNamedRear(base) {
    for (const d of await rearDevices()) {
      let s = null;
      try { s = await openDevice(d.deviceId, base); } catch { continue; }
      if (!isFront(s)) { cameraVideo.dataset.deviceId = d.deviceId || ''; return s; }
      stopStream(s);
    }
    throw new Error('rear-camera-unavailable');
  }

  async function requestRearCamera() {
    const base = { width: { ideal: 1280 }, height: { ideal: 720 } };
    if (cameraVideo.dataset.deviceId) {
      try {
        const s = await openDevice(cameraVideo.dataset.deviceId, base);
        if (!isFront(s)) return s;
        stopStream(s);
      } catch {}
      cameraVideo.dataset.deviceId = '';
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { ...base, facingMode: { exact: 'environment' } }, audio: false });
      if (!isFront(s)) return s;
      stopStream(s);
    } catch (e) {
      if (!['OverconstrainedError', 'NotFoundError', 'NotReadableError'].includes(e.name)) throw e;
    }
    return requestNamedRear(base);
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) { setStatus('Caméra indisponible', ''); return; }
    cameraButton.disabled = true;
    cameraButton.textContent = 'Connexion…';
    try {
      const warmup = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      stopStream(warmup);
    } catch (e) {
      if (e.name === 'NotAllowedError' || e.name === 'SecurityError') {
        cameraButton.disabled = false;
        cameraButton.textContent = 'Réessayer la caméra';
        setStatus('Autorisation caméra refusée', '');
        return;
      }
    }
    try {
      const stream = await requestRearCamera();
      cameraVideo.style.transform = 'none';
      cameraVideo.srcObject = stream;
      await cameraVideo.play();
      cameraButton.textContent = 'Caméra active';
      motionButton.disabled = false;
      scanButton.disabled = false;
      uploadButton.disabled = false;
      vrButton.disabled = false;
      setStatus('Caméra active — importez une vidéo', 'active');
      startHandTracking();
    } catch (e) {
      cameraButton.disabled = false;
      cameraButton.textContent = 'Réessayer la caméra';
      setStatus(e.message === 'rear-camera-unavailable' ? 'Caméra arrière introuvable' : 'Caméra indisponible', '');
    }
  }

  function startHandTracking() {
    if (handsInstance || typeof Hands === 'undefined') return;
    handsInstance = new Hands({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
    handsInstance.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.7, minTrackingConfidence: 0.5 });
    handsInstance.onResults(onResults);
    const loop = async () => {
      if (cameraVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        try { await handsInstance.send({ image: cameraVideo }); } catch {}
      }
      trackingLoop = requestAnimationFrame(loop);
    };
    trackingLoop = requestAnimationFrame(loop);
  }

  /* ------------------------------------------------------------------ */
  /* Orientation — 360° via heading accumulé                             */
  /* ------------------------------------------------------------------ */

  function onDeviceOrientation(event) {
    const heading = Number.isFinite(event.webkitCompassHeading) ? event.webkitCompassHeading : event.alpha;
    if (!Number.isFinite(heading) || !Number.isFinite(event.beta)) return;

    if (rawHeading === null) {
      accumulatedHeading = heading;
      smoothedHeadingAcc = heading;
    } else {
      accumulatedHeading += angleDelta(rawHeading, heading);
    }
    rawHeading = heading;

    rawBeta = event.beta;
    if (smoothedBeta === null) smoothedBeta = rawBeta;

    smoothedHeadingAcc = lerp(smoothedHeadingAcc, accumulatedHeading, ORIENTATION_SMOOTH);
    smoothedBeta = lerp(smoothedBeta, rawBeta, ORIENTATION_SMOOTH);

    updateOrientationAnchor();
  }

  function updateOrientationAnchor() {
    if (smoothedBeta === null) return;

    // Auto-placement des ancres manquantes
    if (motionEnabled) {
      if (!screenAnchor && !screen.hidden && !interaction && !twoHandResize) placeScreenAnchor();
    }
    if (vrMode && !menuAnchor && !vrMenu.hidden) placeMenuAnchor();

    // Écran
    if (screenAnchor && !interaction && !twoHandResize && !screen.hidden) {
      const proj = projectAnchorToScreen(screenAnchor);
      if (proj) {
        const cx = proj.x + screenAnchor.offsetX;
        const cy = proj.y + screenAnchor.offsetY;
        targetState.x = cx - targetState.width / 2;
        targetState.y = cy - targetState.height / 2;
      }
      // Si proj est null : ancre derrière la caméra → on laisse targetState tel quel,
      // l'écran sort naturellement du champ. Il reviendra au même endroit au retour.
    }

    // Menu VR
    if (vrMode && menuAnchor && !vrMenu.hidden) {
      const proj = projectAnchorToScreen(menuAnchor);
      if (proj) {
        vrMenuTarget.x = proj.x + menuAnchor.offsetX - menuAnchor.width / 2;
        vrMenuTarget.y = proj.y + menuAnchor.offsetY - menuAnchor.height / 2;
      }
    }
  }

  async function enableMotionAnchor() {
    if (!window.DeviceOrientationEvent) {
      setStatus('Capteurs indisponibles', '');
      return;
    }
    try {
      if (typeof window.DeviceOrientationEvent.requestPermission === 'function') {
        const p = await window.DeviceOrientationEvent.requestPermission();
        if (p !== 'granted') throw new Error('denied');
      }
      motionEnabled = true;
      motionButton.classList.add('active');
      motionButton.textContent = '⌖ Réancrer';
      setStatus('Ancrage 360° actif', 'active');
      setHint('Visez l’endroit choisi, puis touchez « Réancrer ». L’écran reste ancré sur 360°.');
      placeScreenAnchor();
      if (vrMode) placeMenuAnchor();
    } catch {
      setStatus('Mouvement non autorisé', '');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Boucle de rendu                                                     */
  /* ------------------------------------------------------------------ */

  function renderLoop() {
    if (!screen.hidden) applyScreen();
    if (vrMode && !vrMenu.hidden) applyVrMenuPosition();
    requestAnimationFrame(renderLoop);
  }

  function onResize() {
    const d = Math.min(devicePixelRatio, 2);
    scanCanvas.width = Math.max(1, innerWidth * d);
    scanCanvas.height = Math.max(1, innerHeight * d);
    handCanvas.width = Math.max(1, innerWidth * d);
    handCanvas.height = Math.max(1, innerHeight * d);
    if (!screen.hidden) {
      targetState.x = clamp(targetState.x, 0, Math.max(0, innerWidth - targetState.width));
      targetState.y = clamp(targetState.y, 0, Math.max(0, innerHeight - targetState.height));
      applyScreen(true);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Câblage                                                             */
  /* ------------------------------------------------------------------ */

  cameraButton.addEventListener('click', startCamera);
  motionButton.addEventListener('click', enableMotionAnchor);
  scanButton.addEventListener('click', toggleRoomScan);
  uploadButton.addEventListener('click', openFilePicker);
  vrButton.addEventListener('click', toggleVRMode);
  fileInput.addEventListener('change', loadVideo);

  closeScreen.addEventListener('click', () => {
    screen.hidden = true;
    uploadedVideo.pause();
    if (vrMode) toggleVRMode();
    setStatus('Écran fermé', 'ready');
  });

  // Fallback tactile sur le menu VR
  vrMenu.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => { if (vrMode) handleVrMenuAction(btn.dataset.vrAction); });
  });

  playBtn.addEventListener('click', () => {
    if (uploadedVideo.paused) uploadedVideo.play().catch(() => {});
    else uploadedVideo.pause();
  });
  uploadedVideo.addEventListener('play', () => playBtn.classList.add('playing'));
  uploadedVideo.addEventListener('pause', () => playBtn.classList.remove('playing'));

  screenBar.addEventListener('pointerdown', startPointerMove);
  resizeHandle.addEventListener('pointerdown', startPointerResize);
  screen.addEventListener('pointermove', movePointer);
  screen.addEventListener('pointerup', endPointer);
  screen.addEventListener('pointercancel', endPointer);

  addEventListener('resize', onResize);
  addEventListener('orientationchange', () => setTimeout(onResize, 250));
  addEventListener('deviceorientation', onDeviceOrientation, true);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(scanAnimation);
      cancelAnimationFrame(trackingLoop);
      trackingLoop = null;
    } else if (handsInstance && cameraVideo.srcObject && !trackingLoop) {
      const loop = async () => {
        if (cameraVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          try { await handsInstance.send({ image: cameraVideo }); } catch {}
        }
        trackingLoop = requestAnimationFrame(loop);
      };
      trackingLoop = requestAnimationFrame(loop);
      if (scanActive) scanAnimation = requestAnimationFrame(runScanLoop);
    }
  });

  onResize();
  requestAnimationFrame(renderLoop);
})();
