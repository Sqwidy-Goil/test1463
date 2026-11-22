/* global Hands, Camera, drawConnectors, drawLandmarks, HAND_CONNECTIONS */

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
  const ORIENTATION_GAIN = 11;   // px par degré en cap
  const PITCH_GAIN = 9;          // px par degré en tangage

  let objectUrl = null;
  let screenState = { x: 0, y: 0, width: 0, height: 0 };
  let targetState = { x: 0, y: 0, width: 0, height: 0 };
  let interaction = null;
  let twoHandResize = null;
  let motionEnabled = false;
  let latestOrientation = null;
  let smoothedOrientation = null;

  // Ancres séparées : écran et menu chacun dans l'espace monde
  let screenAnchor = null;   // { heading, pitch, x, y }
  let menuAnchor = null;     // { heading, pitch, x, y }

  let rawHeading = null;
  let accumulatedHeading = 0;

  let vrMode = false;
  let vrMenuTarget = { x: 0, y: 0 };
  let vrMenuState = { x: 0, y: 0 };
  let menuClickLatch = false;

  let scanActive = false;
  let scanAnimation = 0;
  let previousLuma = null;
  let depthVertices = [];
  let lastScanAt = 0;
  let lastFrameAt = 0;
  let fps = 0;
  let smoothPoint = null;
  let lastHands = [];
  let handLostSince = 0;
  let pinchHeld = false;

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
  function clamp(value, low, high) { return Math.min(Math.max(value, low), high); }
  function lerp(from, to, amount) { return from + (to - from) * amount; }
  function angleDelta(from, to) { return ((to - from + 540) % 360) - 180; }

  function lowPass(previous, next, amount) {
    if (!previous) return { ...next };
    return {
      heading: previous.heading + angleDelta(previous.heading, next.heading) * amount,
      pitch: lerp(previous.pitch, next.pitch, amount),
      roll: lerp(previous.roll ?? 0, next.roll ?? 0, amount)
    };
  }

  /* ------------------------------------------------------------------ */
  /* Fenêtre spatiale                                                    */
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
    if (allowOffscreen) return; // ancre monde : pas de borne
    const maxX = Math.max(0, innerWidth - targetState.width);
    const maxY = Math.max(0, innerHeight - targetState.height);
    targetState.x = clamp(targetState.x, 0, maxX);
    targetState.y = clamp(targetState.y, 0, maxY);
  }

  function applyScreen(snap = false) {
    const allowOffscreen = Boolean(screenAnchor) && !interaction && !twoHandResize;
    clampTarget(allowOffscreen);
    const amount = snap ? 1 : SMOOTHING;
    screenState.x = lerp(screenState.x, targetState.x, amount);
    screenState.y = lerp(screenState.y, targetState.y, amount);
    screenState.width = lerp(screenState.width, targetState.width, amount);
    screenState.height = lerp(screenState.height, targetState.height, amount);
    screen.style.left = `${screenState.x.toFixed(2)}px`;
    screen.style.top = `${screenState.y.toFixed(2)}px`;
    screen.style.width = `${screenState.width.toFixed(2)}px`;
    screen.style.height = `${screenState.height.toFixed(2)}px`;
    updateSpatialPose();
  }

  function updateSpatialPose() {
    const orientation = smoothedOrientation || latestOrientation;
    if (!orientation || !screenAnchor) {
      screen.style.setProperty('--yaw', '-3deg');
      screen.style.setProperty('--pitch', '1deg');
      screen.style.setProperty('--lift', '0px');
      return;
    }
    const anchorHeadingNorm = ((screenAnchor.heading % 360) + 360) % 360;
    const yawOffset = angleDelta(orientation.heading, anchorHeadingNorm);
    const pitchOffset = orientation.pitch - screenAnchor.pitch;
    const yaw = clamp(-yawOffset * 0.16, -11, 11) - 2;
    const pitch = clamp(pitchOffset * 0.14, -8, 8) + 1;
    const lift = clamp(Math.abs(yawOffset) * 0.5, 0, 26);
    screen.style.setProperty('--yaw', `${yaw.toFixed(2)}deg`);
    screen.style.setProperty('--pitch', `${pitch.toFixed(2)}deg`);
    screen.style.setProperty('--lift', `${lift.toFixed(1)}px`);
  }

  function bounds() {
    return { left: screenState.x, top: screenState.y, right: screenState.x + screenState.width, bottom: screenState.y + screenState.height };
  }
  function pointInScreen(point) {
    const box = bounds();
    return point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;
  }
  function pointOnResizeHandle(point) {
    const box = bounds();
    return point.x >= box.right - 58 && point.x <= box.right + 12 && point.y >= box.bottom - 58 && point.y <= box.bottom + 12;
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
    setHint(vrMode
      ? 'Écran posé. Pincez la barre pour le déplacer.'
      : 'Écran posé. Pincez la barre pour le déplacer, ou le coin pour le redimensionner.');
  }

  function resizeFromTwoHands(first, second) {
    const distance = Math.hypot(first.x - second.x, first.y - second.y);
    if (!twoHandResize) {
      if (screen.hidden || !pointInScreen(first)) return;
      screenAnchor = null;
      anchorLabel.textContent = 'REDIMENSIONNEMENT';
      twoHandResize = { distance: Math.max(distance, 1), width: targetState.width, height: targetState.height };
      screen.classList.add('grabbed');
      setHint('Deux pincements actifs : écartez ou rapprochez les mains pour redimensionner.');
      return;
    }
    const scale = clamp(distance / twoHandResize.distance, 0.5, 2.4);
    targetState.width = clamp(twoHandResize.width * scale, minSize.width, innerWidth * 0.94);
    targetState.height = clamp(twoHandResize.height * scale, minSize.height, innerHeight * 0.82);
    applyScreen();
  }

  function endTwoHandResize() {
    if (!twoHandResize) return;
    twoHandResize = null;
    screen.classList.remove('grabbed');
    placeScreenAnchor();
    setHint('Écran redimensionné.');
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
    screenName.textContent = file.name;
    showScreen();
    setStatus('Vidéo ouverte dans l’écran spatial', 'active');
    setHint('Pincez la barre supérieure pour déplacer l’écran, ou le coin inférieur droit pour le redimensionner.');
    event.target.value = '';
  }

  function pointerPosition(event) { return { x: event.clientX, y: event.clientY }; }
  function startPointerMove(event) { event.preventDefault(); beginInteraction(pointerPosition(event), 'move', 'pointer'); screen.setPointerCapture(event.pointerId); }
  function startPointerResize(event) { event.preventDefault(); event.stopPropagation(); beginInteraction(pointerPosition(event), 'resize', 'pointer'); screen.setPointerCapture(event.pointerId); }
  function movePointer(event) { updateInteraction(pointerPosition(event), 'pointer'); }
  function endPointer() { endInteraction('pointer'); }

  /* ------------------------------------------------------------------ */
  /* Mains                                                               */
  /* ------------------------------------------------------------------ */

  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0)); }
  function fingerExtended(landmarks, tip, pip) { return distance(landmarks[tip], landmarks[0]) > distance(landmarks[pip], landmarks[0]) * 1.16; }

  function handData(landmarks, index) {
    const raw = { x: landmarks[8].x * innerWidth, y: landmarks[8].y * innerHeight };
    const pinchDistance = distance(landmarks[4], landmarks[8]);
    if (pinchDistance < 0.05) pinchHeld = true;
    else if (pinchDistance > 0.07) pinchHeld = false;
    return {
      index,
      raw,
      point: raw,
      depth: clamp(0.5 - (landmarks[8].z || 0) * 2.5, 0, 1),
      pinch: pinchHeld,
      pinchDistance,
      indexOpen: fingerExtended(landmarks, 8, 6),
      landmarks
    };
  }

  function smoothCursor(raw) {
    if (!smoothPoint || !smoothCursor.last) { smoothPoint = { ...raw }; }
    else {
      const amount = reduceMotion ? 1 : 0.42;
      smoothPoint = { x: lerp(smoothPoint.x, raw.x, amount), y: lerp(smoothPoint.y, raw.y, amount) };
    }
    smoothCursor.last = raw;
    return smoothPoint;
  }

  function showCursor(point, pinching, depth = 0.5) {
    cursor.style.left = `${point.x.toFixed(1)}px`;
    cursor.style.top = `${point.y.toFixed(1)}px`;
    cursor.style.setProperty('--depth', depth.toFixed(3));
    cursor.classList.add('visible');
    cursor.classList.toggle('pinching', pinching);
  }

  function drawHandSkeleton(landmarks) {
    const width = handCanvas.width;
    const height = handCanvas.height;
    const scale = width / 1280;
    handContext.lineCap = 'round';
    handContext.lineWidth = 5.5 * scale;
    handContext.strokeStyle = 'rgba(20, 60, 110, .45)';
    HAND_CONNECTIONS.forEach(([a, b]) => {
      handContext.beginPath();
      handContext.moveTo(landmarks[a].x * width, landmarks[a].y * height);
      handContext.lineTo(landmarks[b].x * width, landmarks[b].y * height);
      handContext.stroke();
    });
    handContext.lineWidth = 2.2 * scale;
    handContext.strokeStyle = 'rgba(120, 232, 255, .8)';
    HAND_CONNECTIONS.forEach(([a, b]) => {
      handContext.beginPath();
      handContext.moveTo(landmarks[a].x * width, landmarks[a].y * height);
      handContext.lineTo(landmarks[b].x * width, landmarks[b].y * height);
      handContext.stroke();
    });
    landmarks.forEach((landmark, index) => {
      const depth = clamp(0.5 - landmark.z * 2.5, 0, 1);
      const x = landmark.x * width;
      const y = landmark.y * height;
      const radius = (2.2 + depth * 3.6) * scale;
      handContext.beginPath();
      handContext.arc(x, y, radius, 0, Math.PI * 2);
      handContext.fillStyle = `rgba(${Math.round(110 + depth * 70)}, 245, 255, ${0.3 + depth * 0.6})`;
      handContext.fill();
      if (index === 8 || index === 4) {
        handContext.beginPath();
        handContext.arc(x, y, radius * 2.2, 0, Math.PI * 2);
        handContext.strokeStyle = `rgba(69, 221, 255, ${0.2 + depth * 0.45})`;
        handContext.lineWidth = 1.4 * scale;
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
    const pixels = scanSourceContext.getImageData(0, 0, width, height).data;
    const luma = new Float32Array(width * height);
    for (let index = 0, pixel = 0; index < luma.length; index += 1, pixel += 4) {
      luma[index] = pixels[pixel] * 0.2126 + pixels[pixel + 1] * 0.7152 + pixels[pixel + 2] * 0.0722;
    }
    const vertices = [];
    for (let y = step; y < height - step; y += step) {
      for (let x = step; x < width - step; x += step) {
        const index = y * width + x;
        const horizontal = Math.abs(luma[index + step] - luma[index - step]);
        const vertical = Math.abs(luma[index + width * step] - luma[index - width * step]);
        const structure = clamp((horizontal + vertical) / 150, 0, 1);
        const temporal = previousLuma ? clamp(Math.abs(luma[index] - previousLuma[index]) / 46, 0, 1) : 0;
        const floorPerspective = y / (height - 1);
        const near = clamp(0.12 + structure * 0.31 + temporal * 0.20 + floorPerspective * 0.37, 0, 1);
        vertices.push({ x: (x / width) * innerWidth, y: (y / height) * innerHeight, near, light: luma[index] / 255 });
      }
    }
    previousLuma = luma;
    depthVertices = vertices;
    drawDepthField();
  }

  function drawDepthField() {
    const density = Math.min(devicePixelRatio, 2);
    scanContext.setTransform(density, 0, 0, density, 0, 0);
    scanContext.clearRect(0, 0, innerWidth, innerHeight);
    if (!depthVertices.length) return;
    const columns = Math.floor((scanGrid.width - scanGrid.step * 2 - 1) / scanGrid.step) + 1;
    const orientation = smoothedOrientation || latestOrientation;
    let headingDrift = 0;
    if (screenAnchor && orientation) {
      const anchorHeadingNorm = ((screenAnchor.heading % 360) + 360) % 360;
      headingDrift = angleDelta(orientation.heading, anchorHeadingNorm) * 1.8;
    }
    scanContext.lineWidth = 0.65;
    for (let index = 0; index < depthVertices.length; index += 1) {
      const vertex = depthVertices[index];
      const projectedX = vertex.x + (vertex.near - 0.5) * 28 + headingDrift;
      const projectedY = vertex.y - vertex.near * 18;
      const neighbours = [index + columns];
      if (index % columns !== columns - 1) neighbours.push(index + 1);
      neighbours.forEach(neighbourIndex => {
        const neighbour = depthVertices[neighbourIndex];
        if (!neighbour || Math.abs(neighbour.near - vertex.near) > 0.24) return;
        scanContext.beginPath();
        scanContext.moveTo(projectedX, projectedY);
        scanContext.lineTo(neighbour.x + (neighbour.near - 0.5) * 28 + headingDrift, neighbour.y - neighbour.near * 18);
        scanContext.strokeStyle = `rgba(75, 173, 255, ${0.025 + (vertex.near + neighbour.near) * 0.075})`;
        scanContext.stroke();
      });
      scanContext.beginPath();
      scanContext.arc(projectedX, projectedY, 0.45 + vertex.near * 1.35, 0, Math.PI * 2);
      scanContext.fillStyle = `rgba(${Math.round(84 + vertex.light * 70)}, ${Math.round(135 + vertex.near * 110)}, 255, ${0.08 + vertex.near * 0.22})`;
      scanContext.fill();
    }
  }

  function runScanLoop(timestamp) {
    if (!scanActive) return;
    if (timestamp - lastScanAt > 165) {
      lastScanAt = timestamp;
      analyseRelativeDepth();
    }
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
      setHint('Déplacez lentement la caméra : le nuage montre les structures et la profondeur relative.');
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
  /* Menu VR : position, hit-test, actions                               */
  /* ------------------------------------------------------------------ */

  function applyVrMenuPosition(snap = false) {
    if (vrMenu.hidden) return;
    const amount = snap ? 1 : SMOOTHING;
    vrMenuState.x = lerp(vrMenuState.x, vrMenuTarget.x, amount);
    vrMenuState.y = lerp(vrMenuState.y, vrMenuTarget.y, amount);
    vrMenu.style.left = `${vrMenuState.x.toFixed(1)}px`;
    vrMenu.style.top = `${vrMenuState.y.toFixed(1)}px`;
  }

  function placeMenuAnchor() {
    if (!motionEnabled || !latestOrientation || vrMenu.hidden) { menuAnchor = null; return; }
    menuAnchor = {
      heading: accumulatedHeading,
      pitch: smoothedOrientation ? smoothedOrientation.pitch : latestOrientation.pitch,
      x: vrMenuTarget.x,
      y: vrMenuTarget.y
    };
  }

  function pointOnVrMenu(point) {
    if (vrMenu.hidden) return null;
    const rect = vrMenu.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    if (point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom) return null;
    for (const btn of vrMenu.querySelectorAll('button')) {
      const br = btn.getBoundingClientRect();
      if (point.x >= br.left && point.x <= br.right && point.y >= br.top && point.y <= br.bottom) return btn;
    }
    return null;
  }

  function handleVrMenuAction(action) {
    switch (action) {
      case 'reanchor':
        placeScreenAnchor();
        placeMenuAnchor();
        setStatus('Ancres replacées', 'active');
        setHint('Écran et menu sont réancrés au cap actuel.');
        break;
      case 'close-screen':
        if (!screen.hidden) {
          screen.hidden = true;
          uploadedVideo.pause();
        }
        if (vrMode) toggleVRMode();
        setStatus('Écran fermé', 'ready');
        break;
      case 'exit':
        if (vrMode) toggleVRMode();
        break;
    }
  }

  function toggleVRMode() {
    vrMode = !vrMode;
    document.body.classList.toggle('vr-mode', vrMode);
    vrButton.classList.toggle('active', vrMode);

    if (vrMode) {
      vrMenuTarget = {
        x: Math.max(14, innerWidth - 200),
        y: Math.max(90, innerHeight * 0.16)
      };
      vrMenuState = { ...vrMenuTarget };
      vrMenu.hidden = false;
      applyVrMenuPosition(true);
      placeMenuAnchor();
      if (!screen.hidden) placeScreenAnchor();
      setStatus('Mode VR — visez et pincez pour cliquer', 'active');
      setHint('Pincez index + pouce sur un bouton du menu pour cliquer · Pincez la barre de l’écran pour le déplacer.');
    } else {
      vrMenu.hidden = true;
      menuAnchor = null;
      menuClickLatch = false;
      setStatus('Mode VR désactivé', 'ready');
      setHint('Écran posé. Pincez la barre pour le déplacer, ou le coin pour le redimensionner.');
      if (!screen.hidden) placeScreenAnchor();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Résultats MediaPipe                                                 */
  /* ------------------------------------------------------------------ */

  function onResults(results) {
    const now = performance.now();
    if (lastFrameAt) fps = lerp(fps || 30, 1000 / Math.max(1, now - lastFrameAt), 0.1);
    lastFrameAt = now;

    const width = handCanvas.width;
    const height = handCanvas.height;
    handContext.clearRect(0, 0, width, height);
    const landmarksList = results.multiHandLandmarks || [];

    if (!landmarksList.length) {
      if (!handLostSince) handLostSince = now;
      if (now - handLostSince > 120) {
        cursor.classList.remove('visible');
        smoothCursor.last = null;
        pinchHeld = false;
        menuClickLatch = false;
        if (interaction) endInteraction('hand');
        endTwoHandResize();
        lastHands = [];
        setStatus(`Caméra active — main non détectée${fps ? ` · ${Math.round(fps)} i/s` : ''}`, 'ready');
      }
      return;
    }
    handLostSince = 0;

    lastHands = landmarksList.map((landmarks, index) => handData(landmarks, index));
    handContext.setTransform(1, 0, 0, 1, 0, 0);
    lastHands.forEach(hand => drawHandSkeleton(hand.landmarks));

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
      if (!interaction && !menuClickLatch) {
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
      updateInteraction(point, 'hand');
    } else {
      menuClickLatch = false;
      if (interaction) endInteraction('hand');
      if (vrMode) {
        const menuBtn = pointOnVrMenu(point);
        setStatus(menuBtn ? `Prêt : ${menuBtn.textContent.trim()}` : 'Mode VR — pincez pour cliquer', 'active');
      } else if (primary.indexOpen) {
        setStatus('Index détecté — pincez l’écran pour le saisir', 'active');
      } else {
        setStatus(`Main détectée${fps ? ` · ${Math.round(fps)} i/s` : ''}`, 'active');
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Caméra arrière                                                      */
  /* ------------------------------------------------------------------ */

  function stopStream(stream) { stream?.getTracks().forEach(track => track.stop()); }

  const FRONT_PATTERN = /front|facetime|selfie|\buser\b|avant/i;
  const REAR_PATTERN = /back|rear|environment|arri[eè]re|ultra ?wide|telephoto|t[eé]l[eé]objectif|grand angle/i;

  function streamFacing(stream) {
    const track = stream.getVideoTracks()[0];
    if (!track) return 'user';
    const settings = track.getSettings?.() || {};
    const label = track.label || '';
    if (settings.facingMode === 'environment') return 'environment';
    if (settings.facingMode === 'user') return 'user';
    if (REAR_PATTERN.test(label)) return 'environment';
    if (FRONT_PATTERN.test(label)) return 'user';
    return 'unknown';
  }
  function streamIsFrontCamera(stream) { return streamFacing(stream) === 'user'; }

  async function rearDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter(device => device.kind === 'videoinput');
    const named = inputs.filter(device => REAR_PATTERN.test(device.label) && !FRONT_PATTERN.test(device.label));
    if (named.length) return named;
    return inputs.filter(device => !FRONT_PATTERN.test(device.label));
  }
  function openDevice(deviceId, base) {
    return navigator.mediaDevices.getUserMedia({ video: { ...base, deviceId: { exact: deviceId } }, audio: false });
  }
  async function requestNamedRearCamera(base) {
    const candidates = await rearDevices();
    for (const device of candidates) {
      let stream = null;
      try { stream = await openDevice(device.deviceId, base); } catch (error) { continue; }
      if (!streamIsFrontCamera(stream)) {
        cameraVideo.dataset.deviceId = device.deviceId || '';
        return stream;
      }
      stopStream(stream);
    }
    throw new Error('rear-camera-unavailable');
  }
  async function requestRearCamera() {
    const base = { width: { ideal: 1280 }, height: { ideal: 720 } };
    if (cameraVideo.dataset.deviceId) {
      try {
        const stream = await openDevice(cameraVideo.dataset.deviceId, base);
        if (!streamIsFrontCamera(stream)) return stream;
        stopStream(stream);
      } catch (error) {}
      cameraVideo.dataset.deviceId = '';
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { ...base, facingMode: { exact: 'environment' } }, audio: false });
      if (!streamIsFrontCamera(stream)) return stream;
      stopStream(stream);
    } catch (error) {
      if (!['OverconstrainedError', 'NotFoundError', 'NotReadableError'].includes(error.name)) throw error;
    }
    return requestNamedRearCamera(base);
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) { setStatus('Caméra indisponible dans ce navigateur', ''); return; }
    cameraButton.disabled = true;
    cameraButton.textContent = 'Connexion…';
    try {
      const warmup = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      stopStream(warmup);
    } catch (error) {
      if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
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
      const facing = streamFacing(stream);
      const openedTrack = stream.getVideoTracks()[0];
      console.info('[mvmobile] caméra ouverte :', facing, '|', openedTrack?.label);
      cameraButton.textContent = 'Caméra active';
      motionButton.disabled = false;
      scanButton.disabled = false;
      uploadButton.disabled = false;
      vrButton.disabled = false;
      setStatus(facing === 'environment' ? 'Caméra arrière active — importez une vidéo' : 'Caméra active — importez une vidéo', 'active');
      setHint('Ajoutez une vidéo. La main et son curseur passent devant l’écran virtuel.');
      startHandTracking();
    } catch (error) {
      cameraButton.disabled = false;
      cameraButton.textContent = 'Réessayer la caméra';
      setStatus(error.message === 'rear-camera-unavailable' ? 'Caméra arrière introuvable' : 'Caméra indisponible', '');
      setHint('La caméra arrière nécessite HTTPS (ou localhost) et votre autorisation.');
    }
  }

  let handsInstance = null;
  let trackingLoop = null;

  function startHandTracking() {
    if (handsInstance || typeof Hands === 'undefined') return;
    handsInstance = new Hands({ locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
    handsInstance.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.7, minTrackingConfidence: 0.5 });
    handsInstance.onResults(onResults);
    const loop = async () => {
      if (cameraVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        try { await handsInstance.send({ image: cameraVideo }); } catch (error) {}
      }
      trackingLoop = requestAnimationFrame(loop);
    };
    trackingLoop = requestAnimationFrame(loop);
  }

  /* ------------------------------------------------------------------ */
  /* Orientation : ancrage monde, heading accumulé                       */
  /* ------------------------------------------------------------------ */

  function placeScreenAnchor() {
    if (!motionEnabled || !latestOrientation || screen.hidden) return;
    screenAnchor = {
      heading: accumulatedHeading,
      pitch: smoothedOrientation ? smoothedOrientation.pitch : latestOrientation.pitch,
      x: targetState.x,
      y: targetState.y
    };
    anchorLabel.textContent = 'ANCRAGE ORIENTATION';
  }

  function updateOrientationAnchor() {
    if (!smoothedOrientation) return;
    if (screenAnchor && !interaction && !twoHandResize && !screen.hidden) {
      const horizontal = accumulatedHeading - screenAnchor.heading;
      // pitch : inclinaison téléphone vers le haut -> beta augmente
      // -> scène descend dans le cadre -> targetState.y augmente
      const vertical = smoothedOrientation.pitch - screenAnchor.pitch;
      targetState.x = screenAnchor.x + horizontal * ORIENTATION_GAIN;
      targetState.y = screenAnchor.y + vertical * PITCH_GAIN;
    }
    if (vrMode && menuAnchor && !vrMenu.hidden) {
      const horizontal = accumulatedHeading - menuAnchor.heading;
      const vertical = smoothedOrientation.pitch - menuAnchor.pitch;
      vrMenuTarget.x = menuAnchor.x + horizontal * ORIENTATION_GAIN;
      vrMenuTarget.y = menuAnchor.y + vertical * PITCH_GAIN;
    }
  }

  async function enableMotionAnchor() {
    if (!window.DeviceOrientationEvent) {
      setStatus('Capteurs de mouvement indisponibles', '');
      return;
    }
    try {
      if (typeof window.DeviceOrientationEvent.requestPermission === 'function') {
        const permission = await window.DeviceOrientationEvent.requestPermission();
        if (permission !== 'granted') throw new Error('motion-permission-denied');
      }
      motionEnabled = true;
      motionButton.classList.add('active');
      motionButton.textContent = '⌖ Réancrer';
      setStatus('Ancrage d’orientation actif', 'active');
      setHint('Visez l’endroit choisi, puis touchez « Réancrer ». L’écran suivra votre rotation et reviendra au même cap.');
      placeScreenAnchor();
      if (vrMode) placeMenuAnchor();
    } catch (error) {
      setStatus('Mouvement non autorisé', '');
      setHint('Sur iPhone, acceptez l’accès aux mouvements pour activer l’ancrage d’orientation.');
    }
  }

  function onDeviceOrientation(event) {
    const heading = Number.isFinite(event.webkitCompassHeading) ? event.webkitCompassHeading : event.alpha;
    if (!Number.isFinite(heading) || !Number.isFinite(event.beta)) return;

    // Heading accumulé : supporte les rotations > 180° sans saut
    if (rawHeading === null) accumulatedHeading = heading;
    else accumulatedHeading += angleDelta(rawHeading, heading);
    rawHeading = heading;

    latestOrientation = {
      heading: (heading + 360) % 360,
      pitch: event.beta,
      roll: event.gamma || 0
    };
    smoothedOrientation = lowPass(smoothedOrientation, latestOrientation, reduceMotion ? 1 : 0.3);
    updateOrientationAnchor();
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
    const density = Math.min(devicePixelRatio, 2);
    scanCanvas.width = Math.max(1, innerWidth * density);
    scanCanvas.height = Math.max(1, innerHeight * density);
    handCanvas.width = Math.max(1, innerWidth * density);
    handCanvas.height = Math.max(1, innerHeight * density);
    if (!screen.hidden) {
      targetState.x = clamp(targetState.x, 0, Math.max(0, innerWidth - targetState.width));
      targetState.y = clamp(targetState.y, 0, Math.max(0, innerHeight - targetState.height));
      applyScreen(true);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Câblage                                                             */
  /* ------------------------------------------------------------------ */

  if (debugMode) {
    setStatus('Mode diagnostic : activez la caméra', 'ready');
    setHint('Mode debug actif.');
  }

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
    setStatus('Écran vidéo fermé', 'ready');
  });

  // Fallback tactile sur le menu VR (utile si le tracking main échoue)
  vrMenu.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!vrMode) return;
      handleVrMenuAction(btn.dataset.vrAction);
    });
  });

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
          try { await handsInstance.send({ image: cameraVideo }); } catch (error) {}
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
