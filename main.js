/* global Hands */

(() => {
  'use strict';

  const $ = s => document.querySelector(s);
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
  const gameCanvas = $('#game-canvas');
  const gameContext = gameCanvas.getContext('2d');
  const gameHud = $('#game-hud');
  const gameScoreEl = $('#game-score');
  const gameMissedEl = $('#game-missed');
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
  const vrTaskbar = $('#vr-taskbar');
  const orientationPill = $('#orientation-pill');

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const minSize = { width: 220, height: 160 };
  const SMOOTHING = reduceMotion ? 1 : 0.32;   // plus réactif (0.24 → 0.32)
  const ROT_SMOOTH = reduceMotion ? 1 : 0.25;
  const FOCAL_FACTOR = 0.85;
  const PERSPECTIVE = 1400;
  const ROT_STEP = 20;

  // Pinch (ratio par rapport à la taille de la main) — robuste à la distance
  const PINCH_ENTER = 0.28;
  const PINCH_EXIT = 0.48;

  let objectUrl = null;
  let screenState = { x: 0, y: 0, width: 0, height: 0 };
  let targetState = { x: 0, y: 0, width: 0, height: 0 };
  let interaction = null;
  let twoHandResize = null;
  let motionEnabled = false;

  let currentCssToWorld = null;
  let currentScreenAngle = 0;
  let screenAnchor = null;
  let hudAnchor = null;

  let vrMode = false;
  let hudTarget = { x: 0, y: 0 };
  let hudState = { x: 0, y: 0 };
  let hudSize = { w: 400, h: 60 };
  let menuClickLatch = false;
  let playClickLatch = false;
  let hoveredBtn = null;
  let screenUserYaw = 0;

  // Game
  let gameActive = false;
  let gameScore = 0;
  let gameMissed = 0;
  let gameSpheres = [];
  let gameLastSpawn = 0;
  let gameSpawnInterval = 1400;

  let scanActive = false, scanAnimation = 0, previousLuma = null, depthVertices = [], lastScanAt = 0;

  let lastFrameAt = 0, fps = 0, smoothPoint = null, lastHands = [], handLostSince = 0;
  let pinchHeld = false, pinchJustEntered = false, pinchJustExited = false;
  let handsInstance = null, trackingLoop = null, usingRVFC = false;

  const scanSource = document.createElement('canvas');
  const scanSourceContext = scanSource.getContext('2d', { willReadFrequently: true });
  const scanGrid = { width: 72, height: 54, step: 4 };
  scanSource.width = scanGrid.width;
  scanSource.height = scanGrid.height;

  /* ------------------------------------------------------------------ */
  /* Utils / maths                                                       */
  /* ------------------------------------------------------------------ */

  const setStatus = (m, mode = 'ready') => { status.textContent = m; statusDot.className = `status-dot ${mode}`; };
  const setHint = m => { hint.textContent = m; };
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const lerp = (a, b, t) => a + (b - a) * t;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));

  function getScreenAngle() {
    let a = 0;
    if (screen.orientation && typeof screen.orientation.angle === 'number') a = screen.orientation.angle;
    else if (typeof window.orientation === 'number') a = window.orientation;
    return ((a % 360) + 360) % 360;
  }

  function matMul(A, B) {
    const C = [[0,0,0],[0,0,0],[0,0,0]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[i][j] += A[i][k] * B[k][j];
    return C;
  }
  const matT = M => [[M[0][0],M[1][0],M[2][0]],[M[0][1],M[1][1],M[2][1]],[M[0][2],M[1][2],M[2][2]]];
  const matVec = (M, v) => [
    M[0][0]*v[0] + M[0][1]*v[1] + M[0][2]*v[2],
    M[1][0]*v[0] + M[1][1]*v[1] + M[1][2]*v[2],
    M[2][0]*v[0] + M[2][1]*v[1] + M[2][2]*v[2]
  ];

  function deviceToWorld(alpha, beta, gamma) {
    const d2r = Math.PI / 180;
    const a = alpha * d2r, b = beta * d2r, g = gamma * d2r;
    const cA = Math.cos(a), sA = Math.sin(a);
    const cB = Math.cos(b), sB = Math.sin(b);
    const cG = Math.cos(g), sG = Math.sin(g);
    return [
      [cA*cG - sA*sB*sG,  -sA*cB,  cA*sG + sA*sB*cG],
      [sA*cG + cA*sB*sG,   cA*cB,  sA*sG - cA*sB*cG],
      [-cB*sG,             sB,     cB*cG]
    ];
  }

  function cssToWorld(alpha, beta, gamma, screenAngleDeg) {
    const Rdev = deviceToWorld(alpha, beta, gamma);
    const d2r = Math.PI / 180;
    const s = -screenAngleDeg * d2r;
    const c = Math.cos(s), sn = Math.sin(s);
    const Rz = [[c, -sn, 0], [sn, c, 0], [0, 0, 1]];
    return matMul(Rdev, Rz);
  }

  function userRotation(yawDeg, pitchDeg) {
    const d2r = Math.PI / 180;
    const y = yawDeg * d2r, p = pitchDeg * d2r;
    const cy = Math.cos(y), sy = Math.sin(y);
    const cp = Math.cos(p), sp = Math.sin(p);
    return [[cy*cp, -sy, cy*sp], [sy*cp, cy, sy*sp], [-sp, 0, cp]];
  }

  function projectWorldDirToScreen(vWorld) {
    if (!currentCssToWorld) return null;
    const vCss = matVec(matT(currentCssToWorld), vWorld);
    if (vCss[2] >= -0.05) return null;
    const depth = -vCss[2];
    const focal = innerWidth * FOCAL_FACTOR;
    return {
      x: innerWidth / 2 + (vCss[0] / depth) * focal,
      y: innerHeight / 2 - (vCss[1] / depth) * focal
    };
  }

  /* ------------------------------------------------------------------ */
  /* Écran vidéo                                                         */
  /* ------------------------------------------------------------------ */

  function initialiseScreen() {
    const base = Math.min(520, innerWidth * (innerWidth < 600 ? 0.78 : 0.62));
    const h = base * 0.64;
    targetState = { x: (innerWidth - base) / 2, y: (innerHeight - h) / 2, width: base, height: h };
    screenState = { ...targetState };
    applyScreen(true);
    placeScreenAnchor();
  }

  function showScreen() {
    if (screen.hidden) { screen.hidden = false; initialiseScreen(); }
  }

  function applyScreen(snap = false) {
    const t = snap ? 1 : SMOOTHING;
    screenState.x = lerp(screenState.x, targetState.x, t);
    screenState.y = lerp(screenState.y, targetState.y, t);
    screenState.width = lerp(screenState.width, targetState.width, t);
    screenState.height = lerp(screenState.height, targetState.height, t);
    screen.style.left = `${screenState.x.toFixed(2)}px`;
    screen.style.top = `${screenState.y.toFixed(2)}px`;
    screen.style.width = `${screenState.width.toFixed(2)}px`;
    screen.style.height = `${screenState.height.toFixed(2)}px`;
    updateScreenRotation();
  }

  function updateScreenRotation() {
    if (!currentCssToWorld || !screenAnchor) {
      screen.style.transform = `perspective(${PERSPECTIVE}px)`;
      return;
    }
    const Ru = userRotation(screenUserYaw, 0);
    const view = matMul(matMul(matT(currentCssToWorld), screenAnchor.baseMatrix), Ru);
    const c0 = [view[0][0], view[1][0], view[2][0]];
    const c1 = [view[0][1], view[1][1], view[2][1]];
    const c2 = [view[0][2], view[1][2], view[2][2]];
    screen.style.transform = `perspective(${PERSPECTIVE}px) matrix3d(
      ${c0[0].toFixed(4)}, ${c0[1].toFixed(4)}, ${c0[2].toFixed(4)}, 0,
      ${(-c1[0]).toFixed(4)}, ${(-c1[1]).toFixed(4)}, ${(-c1[2]).toFixed(4)}, 0,
      ${c2[0].toFixed(4)}, ${c2[1].toFixed(4)}, ${c2[2].toFixed(4)}, 0,
      0, 0, 0, 1)`;
  }

  const bounds = () => ({ left: screenState.x, top: screenState.y, right: screenState.x + screenState.width, bottom: screenState.y + screenState.height });
  const pointInScreen = p => { const b = bounds(); return p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom; };
  const pointOnResizeHandle = p => { const b = bounds(); return p.x >= b.right - 58 && p.x <= b.right + 12 && p.y >= b.bottom - 58 && p.y <= b.bottom + 12; };

  function placeScreenAnchor() {
    if (!motionEnabled || !currentCssToWorld || screen.hidden) return;
    const cx = targetState.x + targetState.width / 2;
    const cy = targetState.y + targetState.height / 2;
    const focal = innerWidth * FOCAL_FACTOR;
    const vCss = [(cx - innerWidth / 2) / focal, -(cy - innerHeight / 2) / focal, -1];
    screenAnchor = { vWorld: matVec(currentCssToWorld, vCss), baseMatrix: currentCssToWorld };
    anchorLabel.textContent = 'ANCRAGE ORIENTATION';
  }

  /* ------------------------------------------------------------------ */
  /* Manipulation                                                        */
  /* ------------------------------------------------------------------ */

  function beginInteraction(point, mode, source) {
    if (screen.hidden) return false;
    screenAnchor = null;
    anchorLabel.textContent = 'MANIPULATION';
    if (mode === 'resize') interaction = { mode, source, startX: point.x, startY: point.y, width: targetState.width, height: targetState.height };
    else interaction = { mode: 'move', source, offsetX: point.x - targetState.x, offsetY: point.y - targetState.y };
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
  }
  function resizeFromTwoHands(a, b) {
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (!twoHandResize) {
      if (screen.hidden || !pointInScreen(a)) return;
      screenAnchor = null;
      twoHandResize = { distance: Math.max(d, 1), width: targetState.width, height: targetState.height };
      screen.classList.add('grabbed');
      return;
    }
    const scale = clamp(d / twoHandResize.distance, 0.5, 2.4);
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
  /* Vidéo                                                               */
  /* ------------------------------------------------------------------ */

  const openFilePicker = () => fileInput.click();
  function loadVideo(event) {
    const f = event.target.files && event.target.files[0];
    if (!f) return;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(f);
    uploadedVideo.src = objectUrl;
    uploadedVideo.load();
    uploadedVideo.play().catch(() => {});
    emptyVideo.hidden = true;
    playBtn.hidden = false;
    playBtn.classList.remove('playing');
    screenName.textContent = f.name;
    showScreen();
    setStatus('Vidéo ouverte', 'active');
    event.target.value = '';
  }
  const pointerPos = e => ({ x: e.clientX, y: e.clientY });
  const startPointerMove = e => { e.preventDefault(); beginInteraction(pointerPos(e), 'move', 'pointer'); screen.setPointerCapture(e.pointerId); };
  const startPointerResize = e => { e.preventDefault(); e.stopPropagation(); beginInteraction(pointerPos(e), 'resize', 'pointer'); screen.setPointerCapture(e.pointerId); };
  const movePointer = e => updateInteraction(pointerPos(e), 'pointer');
  const endPointer = () => endInteraction('pointer');

  /* ------------------------------------------------------------------ */
  /* Hit-tests                                                           */
  /* ------------------------------------------------------------------ */

  function findVrButton(point) {
    if (vrTaskbar.hidden) return null;
    const m = 16;
    for (const btn of vrTaskbar.querySelectorAll('.vr-btn')) {
      const r = btn.getBoundingClientRect();
      if (r.width === 0) continue;
      if (point.x >= r.left - m && point.x <= r.right + m && point.y >= r.top - m && point.y <= r.bottom + m) return btn;
    }
    return null;
  }
  function pointOnPlayButton(point) {
    if (screen.hidden || playBtn.hidden) return null;
    const r = playBtn.getBoundingClientRect();
    if (r.width === 0) return null;
    const m = 22;
    if (point.x < r.left - m || point.x > r.right + m || point.y < r.top - m || point.y > r.bottom + m) return null;
    return playBtn;
  }
  const flashBtn = btn => { btn.classList.add('pressed'); setTimeout(() => btn.classList.remove('pressed'), 200); };

  function handleVrAction(action) {
    switch (action) {
      case 'reanchor': placeScreenAnchor(); placeHudAnchor(); setStatus('Ancres replacées', 'active'); break;
      case 'game': toggleGame(); break;
      case 'play': if (uploadedVideo.src) { if (uploadedVideo.paused) uploadedVideo.play().catch(() => {}); else uploadedVideo.pause(); } break;
      case 'close-screen': if (!screen.hidden) { screen.hidden = true; uploadedVideo.pause(); } break;
      case 'exit': if (vrMode) toggleVRMode(); break;
      case 'yaw-': screenUserYaw -= ROT_STEP; break;
      case 'yaw+': screenUserYaw += ROT_STEP; break;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Taskbar                                                             */
  /* ------------------------------------------------------------------ */

  function applyHudPosition(snap = false) {
    if (vrTaskbar.hidden) return;
    const t = snap ? 1 : SMOOTHING;
    hudState.x = lerp(hudState.x, hudTarget.x, t);
    hudState.y = lerp(hudState.y, hudTarget.y, t);
    vrTaskbar.style.left = `${hudState.x.toFixed(1)}px`;
    vrTaskbar.style.top = `${hudState.y.toFixed(1)}px`;
  }

  function placeHudAnchor() {
    if (!motionEnabled || !currentCssToWorld || vrTaskbar.hidden) { hudAnchor = null; return; }
    const r = vrTaskbar.getBoundingClientRect();
    if (r.width === 0) return;
    hudSize = { w: r.width, h: r.height };
    const cx = hudTarget.x + r.width / 2;
    const cy = hudTarget.y + r.height / 2;
    const focal = innerWidth * FOCAL_FACTOR;
    const vCss = [(cx - innerWidth / 2) / focal, -(cy - innerHeight / 2) / focal, -1];
    hudAnchor = { vWorld: matVec(currentCssToWorld, vCss), w: r.width, h: r.height };
  }

  function toggleVRMode() {
    vrMode = !vrMode;
    document.body.classList.toggle('vr-mode', vrMode);
    vrButton.classList.toggle('active', vrMode);
    if (vrMode) {
      vrTaskbar.hidden = false;
      requestAnimationFrame(() => {
        const r = vrTaskbar.getBoundingClientRect();
        hudSize = { w: r.width, h: r.height };
        hudTarget = { x: (innerWidth - r.width) / 2, y: innerHeight - r.height - innerHeight * 0.14 };
        hudState = { ...hudTarget };
        applyHudPosition(true);
        placeHudAnchor();
      });
      if (!screen.hidden) placeScreenAnchor();
      setStatus('Mode VR — pincez un bouton pour cliquer', 'active');
      setHint('Pointez un bouton avec l’index + pouce pour cliquer · Pincez la barre pour déplacer l’écran.');
    } else {
      vrTaskbar.hidden = true;
      hudAnchor = null;
      menuClickLatch = false;
      if (hoveredBtn) { hoveredBtn.classList.remove('hovered'); hoveredBtn = null; }
      setStatus('Mode VR désactivé', 'ready');
      if (!screen.hidden) placeScreenAnchor();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Jeu des sphères                                                     */
  /* ------------------------------------------------------------------ */

  function toggleGame() {
    if (gameActive) { gameActive = false; gameSpheres = []; gameHud.hidden = true; gameContext.clearRect(0, 0, gameCanvas.width, gameCanvas.height); setStatus('Jeu arrêté', 'ready'); }
    else { gameActive = true; gameScore = 0; gameMissed = 0; gameSpheres = []; gameLastSpawn = 0; gameSpawnInterval = 1400; gameHud.hidden = false; gameScoreEl.textContent = '0'; gameMissedEl.textContent = '0'; setStatus('Jeu actif — touchez les sphères !', 'active'); }
  }

  function spawnSphere() {
    return {
      x: innerWidth * 0.2 + Math.random() * innerWidth * 0.6,
      y: innerHeight * 0.2 + Math.random() * innerHeight * 0.5,
      z: 1.0,
      speed: 0.0006 + Math.random() * 0.0005,
      hue: 180 + Math.random() * 130,
      popped: false,
      popProgress: 0,
      missed: false
    };
  }

  function updateGame(now) {
    if (!gameActive) return;
    if (now - gameLastSpawn > gameSpawnInterval) {
      gameSpheres.push(spawnSphere());
      gameLastSpawn = now;
      gameSpawnInterval = Math.max(650, gameSpawnInterval - 12);
    }
    const hand = lastHands[0];
    const handPts = hand && hand.landmarks ? [hand.landmarks[8], hand.landmarks[9], hand.landmarks[0]].map(lm => ({ x: lm.x * innerWidth, y: lm.y * innerHeight })) : [];

    for (let i = gameSpheres.length - 1; i >= 0; i--) {
      const s = gameSpheres[i];
      if (s.popped) {
        s.popProgress += 0.09;
        if (s.popProgress >= 1) gameSpheres.splice(i, 1);
        continue;
      }
      s.z -= s.speed * 16.67;
      const r = Math.min(18 + (1 - s.z) * 95, 130);
      if (s.z <= 0.05) {
        s.popped = true; s.missed = true;
        gameMissed++; gameMissedEl.textContent = gameMissed;
        continue;
      }
      for (const hp of handPts) {
        if (Math.hypot(hp.x - s.x, hp.y - s.y) < r * 0.85) {
          s.popped = true; gameScore++; gameScoreEl.textContent = gameScore;
          break;
        }
      }
    }
  }

  function renderGame() {
    const dpr = Math.min(devicePixelRatio, 2);
    gameContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    gameContext.clearRect(0, 0, innerWidth, innerHeight);
    if (!gameActive) return;
    for (const s of gameSpheres) {
      const r = Math.min(18 + (1 - s.z) * 95, 130) * (s.popped ? (1 - s.popProgress) * 1.6 : 1);
      if (r <= 0.5) continue;
      const alpha = s.popped ? 1 - s.popProgress : 1;
      gameContext.save();
      gameContext.globalAlpha = alpha;
      const grad = gameContext.createRadialGradient(s.x - r*0.3, s.y - r*0.3, 1, s.x, s.y, r);
      if (s.missed) {
        grad.addColorStop(0, 'rgba(255,120,120,.95)');
        grad.addColorStop(0.7, 'rgba(255,40,40,.6)');
        grad.addColorStop(1, 'rgba(255,0,0,0)');
      } else {
        grad.addColorStop(0, `hsla(${s.hue},100%,92%,.95)`);
        grad.addColorStop(0.55, `hsla(${s.hue},100%,60%,.7)`);
        grad.addColorStop(1, `hsla(${s.hue},100%,40%,0)`);
      }
      gameContext.beginPath();
      gameContext.arc(s.x, s.y, r, 0, Math.PI * 2);
      gameContext.fillStyle = grad;
      gameContext.fill();
      gameContext.beginPath();
      gameContext.arc(s.x, s.y, r * 0.9, 0, Math.PI * 2);
      gameContext.strokeStyle = s.missed ? `rgba(255,80,80,${0.6 * alpha})` : `hsla(${s.hue},100%,80%,${0.7 * alpha})`;
      gameContext.lineWidth = 2;
      gameContext.stroke();
      gameContext.beginPath();
      gameContext.arc(s.x - r * 0.3, s.y - r * 0.3, r * 0.16, 0, Math.PI * 2);
      gameContext.fillStyle = `rgba(255,255,255,${0.75 * alpha})`;
      gameContext.fill();
      gameContext.restore();
    }
  }

  /* ------------------------------------------------------------------ */
  /* MAIN 3D beige — mesh ~110 faces                                     */
  /* ------------------------------------------------------------------ */

  function handData(lm, index) {
    const raw = { x: lm[8].x * innerWidth, y: lm[8].y * innerHeight };
    const pinchD = distance(lm[4], lm[8]);
    const span = Math.max(distance(lm[0], lm[9]), 0.001);
    const ratio = pinchD / span;

    pinchJustEntered = false;
    pinchJustExited = false;
    if (!pinchHeld && ratio < PINCH_ENTER) { pinchHeld = true; pinchJustEntered = true; }
    else if (pinchHeld && ratio > PINCH_EXIT) { pinchHeld = false; pinchJustExited = true; }

    // Échelle normalisée : 1 = main "typique" ; adapte les épaisseurs de trait
    const handScale = span / 0.12;

    return {
      index, raw, point: raw,
      depth: clamp(0.5 - (lm[8].z || 0) * 2.5, 0, 1),
      pinch: pinchHeld, pinchRatio: ratio, handScale,
      indexOpen: distance(lm[8], lm[0]) > distance(lm[6], lm[0]) * 1.16,
      landmarks: lm
    };
  }

  function smoothCursor(raw) {
    if (!smoothPoint || !smoothCursor.last) smoothPoint = { ...raw };
    else {
      // Adaptation dynamique : rapide = pas de lissage, lent = lissage
      const speed = Math.hypot(raw.x - smoothCursor.last.x, raw.y - smoothCursor.last.y);
      const t = reduceMotion ? 1 : clamp(0.55 + speed / 130, 0.55, 1);
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

  /* --- Mesh 3D articulée ~110 faces --- */

  const FINGER_CHAINS = [
    { idx: [17, 18, 19, 20], wm: 0.78 }, // auriculaire
    { idx: [13, 14, 15, 16], wm: 0.92 }, // annulaire
    { idx: [9, 10, 11, 12],  wm: 1.05 }, // majeur
    { idx: [5, 6, 7, 8],     wm: 1.00 }, // index
    { idx: [1, 2, 3, 4],     wm: 1.15 }  // pouce
  ];
  const SUBDIV = 3; // subdiviser chaque segment en 3 → ~18 faces/doigt

  function draw3DHand(lm) {
    const W = handCanvas.width, H = handCanvas.height;
    const pts = lm.map(p => ({
      x: p.x * W, y: p.y * H,
      depth: clamp(0.5 - (p.z || 0) * 2.5, 0, 1)
    }));
    const scaleFactor = Math.hypot(pts[5].x - pts[17].x, pts[5].y - pts[17].y) / (W * 0.15);

    const faces = [];
    FINGER_CHAINS.forEach(c => buildFingerFaces(pts, c.idx, c.wm * scaleFactor, faces));
    buildPalmFaces(pts, faces);

    // Ombre globale derrière
    handContext.save();
    handContext.translate(scaleFactor * 4, scaleFactor * 6);
    handContext.filter = 'blur(8px)';
    handContext.fillStyle = 'rgba(50, 30, 15, 0.45)';
    drawFacesSolid(faces, true);
    handContext.restore();
    handContext.filter = 'none';

    // Faces beiges avec ombrage par face
    drawFacesShaded(faces, scaleFactor);
  }

  function buildFingerFaces(pts, chain, wm, faces) {
    const nodes = [];
    const jointWidths = chain.map((idx, i) => {
      const t = i / (chain.length - 1);
      const p = pts[idx];
      return Math.max(1.5, (7 - t * 3 + p.depth * 4) * wm * 0.5);
    });

    for (let i = 0; i < chain.length - 1; i++) {
      const a = pts[chain[i]], b = pts[chain[i + 1]];
      const wa = jointWidths[i], wb = jointWidths[i + 1];
      for (let s = 0; s < SUBDIV; s++) {
        const t = s / SUBDIV;
        nodes.push({
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          depth: a.depth + (b.depth - a.depth) * t,
          w: wa + (wb - wa) * t
        });
      }
    }
    const lastIdx = chain[chain.length - 1];
    nodes.push({ x: pts[lastIdx].x, y: pts[lastIdx].y, depth: pts[lastIdx].depth, w: jointWidths[jointWidths.length - 1] });

    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i], b = nodes[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const px = -dy / len, py = dx / len;
      const aL = { x: a.x + px * a.w, y: a.y + py * a.w, depth: a.depth };
      const aR = { x: a.x - px * a.w, y: a.y - py * a.w, depth: a.depth };
      const bL = { x: b.x + px * b.w, y: b.y + py * b.w, depth: b.depth };
      const bR = { x: b.x - px * b.w, y: b.y - py * b.w, depth: b.depth };
      faces.push({ v: [aL, aR, bL], depth: (aL.depth + aR.depth + bL.depth) / 3 });
      faces.push({ v: [aR, bL, bR], depth: (aR.depth + bL.depth + bR.depth) / 3 });
    }

    // Bout arrondi
    const last = nodes[nodes.length - 1];
    const prev = nodes[nodes.length - 2];
    const dx = last.x - prev.x, dy = last.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const dirX = dx / len, dirY = dy / len;
    const px = -dirY, py = dirX;
    const far = { x: last.x + dirX * last.w * 1.3, y: last.y + dirY * last.w * 1.3, depth: last.depth };
    const left = { x: last.x + px * last.w, y: last.y + py * last.w, depth: last.depth };
    const right = { x: last.x - px * last.w, y: last.y - py * last.w, depth: last.depth };
    faces.push({ v: [left, far, last], depth: last.depth });
    faces.push({ v: [far, right, last], depth: last.depth });
    faces.push({ v: [left, right, far], depth: last.depth });
  }

  function buildPalmFaces(pts, faces) {
    const p0 = pts[0], p1 = pts[1], p5 = pts[5], p9 = pts[9], p13 = pts[13], p17 = pts[17];
    const cx = (p0.x + p5.x + p9.x + p13.x + p17.x) / 5;
    const cy = (p0.y + p5.y + p9.y + p13.y + p17.y) / 5;
    const cd = (p0.depth + p5.depth + p9.depth + p13.depth + p17.depth) / 5;
    const center = { x: cx, y: cy, depth: cd };

    const perimeter = [p0, p1, p5, p9, p13, p17];
    for (let i = 0; i < perimeter.length; i++) {
      const a = perimeter[i];
      const b = perimeter[(i + 1) % perimeter.length];
      faces.push({ v: [center, a, b], depth: (cd + a.depth + b.depth) / 3 });
      faces.push({ v: [center, b, a], depth: (cd + a.depth + b.depth) / 3 });
    }
  }

  function drawFacesSolid(faces) {
    handContext.beginPath();
    for (const f of faces) {
      const [a, b, c] = f.v;
      handContext.moveTo(a.x, a.y);
      handContext.lineTo(b.x, b.y);
      handContext.lineTo(c.x, c.y);
      handContext.closePath();
    }
    handContext.fill();
  }

  function drawFacesShaded(faces, scaleFactor) {
    const lw = Math.max(0.4, 0.6 * scaleFactor);
    // Base skin
    const R0 = 210, G0 = 170, B0 = 135;
    const edgeColor = 'rgba(120, 75, 45, 0.32)';

    for (const f of faces) {
      const [a, b, c] = f.v;
      const t = f.depth;
      // Lumière simulée : plus clair en haut-gauche
      const avgX = (a.x + b.x + c.x) / 3;
      const avgY = (a.y + b.y + c.y) / 3;
      const H = handCanvas.height;
      const shade = 0.78 + (1 - avgX / handCanvas.width) * 0.14 + (1 - avgY / H) * 0.14;

      const r = Math.round((R0 - 30 + t * 55) * shade);
      const g = Math.round((G0 - 25 + t * 45) * shade);
      const bl = Math.round((B0 - 20 + t * 40) * shade);

      handContext.beginPath();
      handContext.moveTo(a.x, a.y);
      handContext.lineTo(b.x, b.y);
      handContext.lineTo(c.x, c.y);
      handContext.closePath();
      handContext.fillStyle = `rgb(${r}, ${g}, ${bl})`;
      handContext.fill();
      handContext.strokeStyle = edgeColor;
      handContext.lineWidth = lw;
      handContext.stroke();
    }

    // Reflet global
    const p0 = [faces[0].v[0].x, faces[0].v[0].y];
    handContext.fillStyle = 'rgba(255, 250, 240, 0.12)';
    handContext.beginPath();
    handContext.ellipse(p0[0] + 20, p0[1] - 20, 40 * scaleFactor, 30 * scaleFactor, -0.4, 0, Math.PI * 2);
    handContext.fill();
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
    for (let i = 0, j = 0; i < luma.length; i++, j += 4) luma[i] = px[j] * 0.2126 + px[j+1] * 0.7152 + px[j+2] * 0.0722;
    const verts = [];
    for (let y = step; y < height - step; y += step) {
      for (let x = step; x < width - step; x += step) {
        const i = y * width + x;
        const hd = Math.abs(luma[i+step] - luma[i-step]);
        const vd = Math.abs(luma[i+width*step] - luma[i-width*step]);
        const structure = clamp((hd + vd) / 150, 0, 1);
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
    const d = Math.min(devicePixelRatio, 2);
    scanContext.setTransform(d, 0, 0, d, 0, 0);
    scanContext.clearRect(0, 0, innerWidth, innerHeight);
    if (!depthVertices.length) return;
    const cols = Math.floor((scanGrid.width - scanGrid.step * 2 - 1) / scanGrid.step) + 1;
    scanContext.lineWidth = 0.65;
    for (let i = 0; i < depthVertices.length; i++) {
      const v = depthVertices[i];
      const px = v.x + (v.near - 0.5) * 28;
      const py = v.y - v.near * 18;
      const nbrs = [i + cols];
      if (i % cols !== cols - 1) nbrs.push(i + 1);
      nbrs.forEach(ni => {
        const n = depthVertices[ni];
        if (!n || Math.abs(n.near - v.near) > 0.24) return;
        scanContext.beginPath();
        scanContext.moveTo(px, py);
        scanContext.lineTo(n.x + (n.near - 0.5) * 28, n.y - n.near * 18);
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
    if (scanActive) { previousLuma = null; lastScanAt = 0; scanAnimation = requestAnimationFrame(runScanLoop); }
    else { cancelAnimationFrame(scanAnimation); scanAnimation = 0; depthVertices = []; scanContext.clearRect(0, 0, scanCanvas.width, scanCanvas.height); }
  }

  /* ------------------------------------------------------------------ */
  /* MediaPipe results                                                   */
  /* ------------------------------------------------------------------ */

  function onResults(results) {
    const now = performance.now();
    if (lastFrameAt) fps = lerp(fps || 30, 1000 / Math.max(1, now - lastFrameAt), 0.15);
    lastFrameAt = now;

    handContext.clearRect(0, 0, handCanvas.width, handCanvas.height);
    const list = results.multiHandLandmarks || [];

    if (!list.length) {
      if (!handLostSince) handLostSince = now;
      if (now - handLostSince > 100) {   // était 120ms
        cursor.classList.remove('visible');
        smoothCursor.last = null;
        pinchHeld = false;
        menuClickLatch = false;
        playClickLatch = false;
        if (hoveredBtn) { hoveredBtn.classList.remove('hovered'); hoveredBtn = null; }
        if (interaction) endInteraction('hand');
        endTwoHandResize();
        lastHands = [];
      }
      return;
    }
    handLostSince = 0;

    lastHands = list.map((lm, i) => handData(lm, i));
    lastHands.forEach(h => draw3DHand(h.landmarks));

    const primary = lastHands[0];
    const point = smoothCursor(primary.raw);
    primary.point = point;
    showCursor(point, primary.pinch, primary.depth);

    if (vrMode && !vrTaskbar.hidden) {
      const btn = findVrButton(point);
      if (btn !== hoveredBtn) {
        if (hoveredBtn) hoveredBtn.classList.remove('hovered');
        if (btn) btn.classList.add('hovered');
        hoveredBtn = btn;
      }
    }

    const doublePinch = lastHands.length > 1 && lastHands[0].pinch && lastHands[1].pinch;
    if (doublePinch) {
      if (interaction) endInteraction('hand');
      resizeFromTwoHands(lastHands[0].point, lastHands[1].point);
      return;
    }
    endTwoHandResize();

    if (primary.pinch) {
      if (pinchJustEntered && !interaction && !menuClickLatch && !playClickLatch) {
        const vrBtn = findVrButton(point);
        if (vrBtn) { menuClickLatch = true; flashBtn(vrBtn); handleVrAction(vrBtn.dataset.vrAction); }
        else {
          const playHit = pointOnPlayButton(point);
          if (playHit) {
            playClickLatch = true;
            if (uploadedVideo.paused) uploadedVideo.play().catch(() => {});
            else uploadedVideo.pause();
          } else if (pointOnResizeHandle(point)) beginInteraction(point, 'resize', 'hand');
          else if (pointInScreen(point)) beginInteraction(point, 'move', 'hand');
        }
      }
      updateInteraction(point, 'hand');
    } else {
      menuClickLatch = false;
      playClickLatch = false;
      if (interaction) endInteraction('hand');
      if (vrMode) setStatus(hoveredBtn ? `Prêt : ${hoveredBtn.title || ''}` : 'Mode VR — pointez un bouton', 'active');
      else if (primary.indexOpen) setStatus('Index détecté — pincez pour saisir', 'active');
      else setStatus(`Main détectée${fps ? ` · ${Math.round(fps)} i/s` : ''}`, 'active');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Caméra arrière                                                      */
  /* ------------------------------------------------------------------ */

  function stopStream(s) { s?.getTracks().forEach(t => t.stop()); }
  const FRONT = /front|facetime|selfie|\buser\b|avant/i;
  const REAR = /back|rear|environment|arri[eè]re|ultra ?wide|telephoto|grand angle/i;
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
    // Résolution plus basse = moins de latence / meilleur fps
    const base = { width: { ideal: 640 }, height: { ideal: 480 } };
    if (cameraVideo.dataset.deviceId) {
      try { const s = await openDevice(cameraVideo.dataset.deviceId, base); if (!isFront(s)) return s; stopStream(s); } catch {}
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
        cameraButton.disabled = false; cameraButton.textContent = 'Réessayer la caméra';
        setStatus('Autorisation caméra refusée', ''); return;
      }
    }
    try {
      const stream = await requestRearCamera();
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
      setStatus('Caméra indisponible', '');
    }
  }

  /* --- Tracking basse latence via requestVideoFrameCallback --- */

  function startHandTracking() {
    if (handsInstance || typeof Hands === 'undefined') return;
    handsInstance = new Hands({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
    // modelComplexity 0 = modèle léger = ~2× plus rapide, latence minimale
    handsInstance.setOptions({
      maxNumHands: 2,
      modelComplexity: 0,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.5
    });
    handsInstance.onResults(onResults);

    usingRVFC = typeof cameraVideo.requestVideoFrameCallback === 'function';

    const loop = async () => {
      if (cameraVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        try { await handsInstance.send({ image: cameraVideo }); } catch {}
      }
      schedule();
    };
    const schedule = () => {
      if (usingRVFC) {
        cameraVideo.requestVideoFrameCallback(loop);
        trackingLoop = null;
      } else {
        trackingLoop = requestAnimationFrame(loop);
      }
    };
    schedule();
  }

  /* ------------------------------------------------------------------ */
  /* Orientation                                                         */
  /* ------------------------------------------------------------------ */

  function onDeviceOrientation(event) {
    const a = Number.isFinite(event.webkitCompassHeading) ? event.webkitCompassHeading : event.alpha;
    if (!Number.isFinite(a) || !Number.isFinite(event.beta)) return;
    const screenAngle = getScreenAngle();
    currentCssToWorld = cssToWorld(a, event.beta, event.gamma || 0, screenAngle);
    currentScreenAngle = screenAngle;
    const isLandscape = screenAngle === 90 || screenAngle === 270;
    orientationPill.textContent = isLandscape ? 'PAYSAGE' : 'PORTRAIT';
    updateAnchors();
  }

  function updateAnchors() {
    if (!currentCssToWorld) return;
    if (motionEnabled && !screenAnchor && !screen.hidden && !interaction && !twoHandResize) placeScreenAnchor();
    if (vrMode && !hudAnchor && !vrTaskbar.hidden) placeHudAnchor();

    if (screenAnchor && !screen.hidden && !interaction && !twoHandResize) {
      const proj = projectWorldDirToScreen(screenAnchor.vWorld);
      if (proj) {
        targetState.x = proj.x - targetState.width / 2;
        targetState.y = proj.y - targetState.height / 2;
        screen.classList.remove('offscreen');
      } else {
        screen.classList.add('offscreen');
      }
    }
    if (vrMode && hudAnchor && !vrTaskbar.hidden) {
      const proj = projectWorldDirToScreen(hudAnchor.vWorld);
      if (proj) {
        hudTarget.x = proj.x - hudAnchor.w / 2;
        hudTarget.y = proj.y - hudAnchor.h / 2;
        vrTaskbar.style.opacity = '1';
      } else {
        vrTaskbar.style.opacity = '0.15';
      }
    }
  }

  async function enableMotionAnchor() {
    if (!window.DeviceOrientationEvent) { setStatus('Capteurs indisponibles', ''); return; }
    try {
      if (typeof window.DeviceOrientationEvent.requestPermission === 'function') {
        const p = await window.DeviceOrientationEvent.requestPermission();
        if (p !== 'granted') throw new Error('denied');
      }
      motionEnabled = true;
      motionButton.classList.add('active');
      motionButton.textContent = '⌖ Réancrer';
      setStatus('Ancrage 360° actif', 'active');
      setHint('Tournez librement : portrait et paysage fonctionnent. Touchez « Réancrer » pour repositionner.');
      placeScreenAnchor();
      if (vrMode) placeHudAnchor();
    } catch {
      setStatus('Mouvement non autorisé', '');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Boucle de rendu                                                     */
  /* ------------------------------------------------------------------ */

  function renderLoop() {
    if (!screen.hidden) applyScreen();
    if (vrMode && !vrTaskbar.hidden) applyHudPosition();
    if (gameActive) { updateGame(performance.now()); renderGame(); }
    requestAnimationFrame(renderLoop);
  }

  function onResize() {
    const d = Math.min(devicePixelRatio, 2);
    scanCanvas.width = Math.max(1, innerWidth * d); scanCanvas.height = Math.max(1, innerHeight * d);
    handCanvas.width = Math.max(1, innerWidth * d); handCanvas.height = Math.max(1, innerHeight * d);
    gameCanvas.width = Math.max(1, innerWidth * d); gameCanvas.height = Math.max(1, innerHeight * d);
    if (!screen.hidden) applyScreen(true);
    if (vrMode && !vrTaskbar.hidden) {
      requestAnimationFrame(() => {
        const r = vrTaskbar.getBoundingClientRect();
        hudSize = { w: r.width, h: r.height };
        applyHudPosition(true);
        placeHudAnchor();
      });
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
    setStatus('Écran fermé', 'ready');
  });

  vrTaskbar.querySelectorAll('.vr-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (vrMode) { flashBtn(btn); handleVrAction(btn.dataset.vrAction); }
    });
  });

  playBtn.addEventListener('click', () => {
    if (uploadedVideo.paused) uploadedVideo.play().catch(() => {});
    else uploadedVideo.pause();
  });
  uploadedVideo.addEventListener('play', () => playBtn.classList.add('playing'));
  uploadedVideo.addEventListener('pause', () => playBtn.classList.remove('playing'));

  orientationPill.addEventListener('click', () => {
    placeScreenAnchor();
    if (vrMode) placeHudAnchor();
    setStatus('Repère recentré', 'active');
  });

  screenBar.addEventListener('pointerdown', startPointerMove);
  resizeHandle.addEventListener('pointerdown', startPointerResize);
  screen.addEventListener('pointermove', movePointer);
  screen.addEventListener('pointerup', endPointer);
  screen.addEventListener('pointercancel', endPointer);

  addEventListener('resize', onResize);
  addEventListener('orientationchange', () => {
    setTimeout(() => {
      onResize();
      if (motionEnabled) {
        placeScreenAnchor();
        if (vrMode) placeHudAnchor();
      }
    }, 350);
  });
  addEventListener('deviceorientation', onDeviceOrientation, true);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(scanAnimation);
      if (trackingLoop) cancelAnimationFrame(trackingLoop);
      trackingLoop = null;
    } else if (handsInstance && cameraVideo.srcObject && !trackingLoop) {
      if (usingRVFC) {
        const loop = async () => {
          if (cameraVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            try { await handsInstance.send({ image: cameraVideo }); } catch {}
          }
          cameraVideo.requestVideoFrameCallback(loop);
        };
        cameraVideo.requestVideoFrameCallback(loop);
      } else {
        const loop = async () => {
          if (cameraVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            try { await handsInstance.send({ image: cameraVideo }); } catch {}
          }
          trackingLoop = requestAnimationFrame(loop);
        };
        trackingLoop = requestAnimationFrame(loop);
      }
      if (scanActive) scanAnimation = requestAnimationFrame(runScanLoop);
    }
  });

  onResize();
  requestAnimationFrame(renderLoop);
})();
