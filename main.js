/* global Hands, HAND_CONNECTIONS */

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
  const vrHud = $('#vr-hud');
  const orientationPill = $('#orientation-pill');

  const debugMode = /[?&]debug\b/.test(location.search);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const minSize = { width: 220, height: 160 };
  const SMOOTHING = reduceMotion ? 1 : 0.22;
  const ROT_SMOOTH = reduceMotion ? 1 : 0.25;
  const FOCAL_FACTOR = 0.85;      // px par unité
  const PERSPECTIVE = 1400;        // profondeur CSS (px)
  const ROT_STEP = 20;             // degrés par clic de rotation

  let objectUrl = null;
  let screenState = { x: 0, y: 0, width: 0, height: 0 };
  let targetState = { x: 0, y: 0, width: 0, height: 0 };
  let interaction = null;
  let twoHandResize = null;
  let motionEnabled = false;

  // Matrice 3×3 : CSS_3D → monde, courante. Recalculée à chaque deviceorientation.
  let currentCssToWorld = null;
  let currentScreenAngle = 0;

  // Ancres monde
  let screenAnchor = null;   // { vWorld: Vec3, baseMatrix: Mat3, screenAngleBase }
  let hudAnchor = null;      // { vWorld, baseMatrix, w, h }

  // VR
  let vrMode = false;
  let hudTarget = { x: 0, y: 0 };
  let hudState = { x: 0, y: 0 };
  let hudSize = { w: 400, h: 120 };
  let menuClickLatch = false;
  let playClickLatch = false;
  let hoveredBtn = null;

  // Rotation utilisateur de l'écran
  let screenUserYaw = 0, screenUserPitch = 0;

  // Scan
  let scanActive = false, scanAnimation = 0, previousLuma = null, depthVertices = [], lastScanAt = 0;

  // Main / tracking
  let lastFrameAt = 0, fps = 0, smoothPoint = null, lastHands = [], handLostSince = 0, pinchHeld = false;
  let handsInstance = null, trackingLoop = null;

  const scanSource = document.createElement('canvas');
  const scanSourceContext = scanSource.getContext('2d', { willReadFrequently: true });
  const scanGrid = { width: 72, height: 54, step: 4 };
  scanSource.width = scanGrid.width;
  scanSource.height = scanGrid.height;

  /* ------------------------------------------------------------------ */
  /* Utilitaires / maths                                                 */
  /* ------------------------------------------------------------------ */

  const setStatus = (m, mode = 'ready') => { status.textContent = m; statusDot.className = `status-dot ${mode}`; };
  const setHint = m => { hint.textContent = m; };
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const lerp = (a, b, t) => a + (b - a) * t;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));

  function getScreenAngle() {
    let angle = 0;
    if (screen.orientation && typeof screen.orientation.angle === 'number') angle = screen.orientation.angle;
    else if (typeof window.orientation === 'number') angle = window.orientation;
    return ((angle % 360) + 360) % 360;
  }

  function matMul(A, B) {
    const C = [[0,0,0],[0,0,0],[0,0,0]];
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        for (let k = 0; k < 3; k++)
          C[i][j] += A[i][k] * B[k][j];
    return C;
  }
  const matTranspose = M => [
    [M[0][0], M[1][0], M[2][0]],
    [M[0][1], M[1][1], M[2][1]],
    [M[0][2], M[1][2], M[2][2]]
  ];
  const matVec = (M, v) => [
    M[0][0]*v[0] + M[0][1]*v[1] + M[0][2]*v[2],
    M[1][0]*v[0] + M[1][1]*v[1] + M[1][2]*v[2],
    M[2][0]*v[0] + M[2][1]*v[1] + M[2][2]*v[2]
  ];

  // R = Rz(α) * Rx(β) * Ry(γ) — convention deviceorientation W3C
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

  // R_css_to_world = R_device_to_world * Rz(-screenAngle)
  function cssToWorld(alpha, beta, gamma, screenAngleDeg) {
    const Rdev = deviceToWorld(alpha, beta, gamma);
    const d2r = Math.PI / 180;
    const s = -screenAngleDeg * d2r;
    const c = Math.cos(s), sn = Math.sin(s);
    const Rz = [[c, -sn, 0], [sn, c, 0], [0, 0, 1]];
    return matMul(Rdev, Rz);
  }

  // Rotation locale de l'utilisateur (yaw puis pitch) — appliquée en espace "base"
  function userRotation(yawDeg, pitchDeg) {
    const d2r = Math.PI / 180;
    const y = yawDeg * d2r, p = pitchDeg * d2r;
    const cy = Math.cos(y), sy = Math.sin(y);
    const cp = Math.cos(p), sp = Math.sin(p);
    // Rz(yaw) * Ry(pitch)
    return [
      [cy*cp, -sy, cy*sp],
      [sy*cp,  cy, sy*sp],
      [-sp,    0,  cp]
    ];
  }

  /* ------------------------------------------------------------------ */
  /* Projection monde → écran (position)                                 */
  /* ------------------------------------------------------------------ */

  function projectWorldDirToScreen(vWorld) {
    if (!currentCssToWorld) return null;
    const vCssNow = matVec(matTranspose(currentCssToWorld), vWorld);
    if (vCssNow[2] >= -0.05) return null; // derrière la caméra
    const depth = -vCssNow[2];
    const focal = innerWidth * FOCAL_FACTOR;
    return {
      x: innerWidth / 2 + (vCssNow[0] / depth) * focal,
      y: innerHeight / 2 - (vCssNow[1] / depth) * focal
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
    const Ru = userRotation(screenUserYaw, screenUserPitch);
    // View matrix = R_now^T * R_base * R_user
    const view = matMul(matMul(matTranspose(currentCssToWorld), screenAnchor.baseMatrix), Ru);
    const [c0, c1, c2] = [0, 1, 2].map(j => [view[0][j], view[1][j], view[2][j]]);
    // Colonnes CSS : right → c0, down → -c1, normal → c2
    const m = (v, i) => v[i].toFixed(4);
    screen.style.transform = `perspective(${PERSPECTIVE}px) matrix3d(
      ${m(c0,0)}, ${m(c0,1)}, ${m(c0,2)}, 0,
      ${(-c1[0]).toFixed(4)}, ${(-c1[1]).toFixed(4)}, ${(-c1[2]).toFixed(4)}, 0,
      ${m(c2,0)}, ${m(c2,1)}, ${m(c2,2)}, 0,
      0, 0, 0, 1)`;
  }

  const bounds = () => ({ left: screenState.x, top: screenState.y, right: screenState.x + screenState.width, bottom: screenState.y + screenState.height });
  const pointInScreen = p => { const b = bounds(); return p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom; };
  const pointOnResizeHandle = p => { const b = bounds(); return p.x >= b.right - 58 && p.x <= b.right + 12 && p.y >= b.bottom - 58 && p.y <= b.bottom + 12; };

  function placeScreenAnchor() {
    if (!motionEnabled || !currentCssToWorld || screen.hidden) return;
    const cx = targetState.x + targetState.width / 2;
    const cy = targetState.y + targetState.height / 2;
    const dx = cx - innerWidth / 2;
    const dy = cy - innerHeight / 2;
    const focal = innerWidth * FOCAL_FACTOR;
    // Direction CSS_3D : +X = droite, +Y = haut, -Z = devant
    const vCss = [dx / focal, -dy / focal, -1];
    const vWorld = matVec(currentCssToWorld, vCss);
    screenAnchor = {
      vWorld,
      baseMatrix: currentCssToWorld,
      screenAngleBase: currentScreenAngle
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
    } else {
      interaction = { mode: 'move', source, offsetX: point.x - targetState.x, offsetY: point.y - targetState.y };
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

  function openFilePicker() { fileInput.click(); }
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
  const pointerPosition = e => ({ x: e.clientX, y: e.clientY });
  const startPointerMove = e => { e.preventDefault(); beginInteraction(pointerPosition(e), 'move', 'pointer'); screen.setPointerCapture(e.pointerId); };
  const startPointerResize = e => { e.preventDefault(); e.stopPropagation(); beginInteraction(pointerPosition(e), 'resize', 'pointer'); screen.setPointerCapture(e.pointerId); };
  const movePointer = e => updateInteraction(pointerPosition(e), 'pointer');
  const endPointer = () => endInteraction('pointer');

  /* ------------------------------------------------------------------ */
  /* Hit-tests HUD                                                       */
  /* ------------------------------------------------------------------ */

  function findVrButton(point) {
    if (vrHud.hidden) return null;
    const margin = 14;
    for (const btn of vrHud.querySelectorAll('.vr-btn')) {
      const r = btn.getBoundingClientRect();
      if (r.width === 0) continue;
      if (point.x >= r.left - margin && point.x <= r.right + margin &&
          point.y >= r.top - margin && point.y <= r.bottom + margin) return btn;
    }
    return null;
  }
  function pointOnPlayButton(point) {
    if (screen.hidden || playBtn.hidden) return null;
    const r = playBtn.getBoundingClientRect();
    if (r.width === 0) return null;
    const m = 22;
    if (point.x < r.left - m || point.x > r.right + m) return null;
    if (point.y < r.top - m || point.y > r.bottom + m) return null;
    return playBtn;
  }

  function flashVrButton(btn) {
    btn.classList.add('pressed');
    setTimeout(() => btn.classList.remove('pressed'), 200);
  }

  function handleVrAction(action) {
    switch (action) {
      case 'reanchor':
        placeScreenAnchor(); placeHudAnchor();
        setStatus('Ancres replacées', 'active');
        break;
      case 'scan': toggleRoomScan(); break;
      case 'play':
        if (uploadedVideo.src) {
          if (uploadedVideo.paused) uploadedVideo.play().catch(() => {});
          else uploadedVideo.pause();
        }
        break;
      case 'close-screen':
        if (!screen.hidden) { screen.hidden = true; uploadedVideo.pause(); }
        break;
      case 'exit':
        if (vrMode) toggleVRMode();
        break;
      case 'yaw-': screenUserYaw -= ROT_STEP; break;
      case 'yaw+': screenUserYaw += ROT_STEP; break;
      case 'pitch+': screenUserPitch = clamp(screenUserPitch + ROT_STEP, -75, 75); break;
      case 'pitch-': screenUserPitch = clamp(screenUserPitch - ROT_STEP, -75, 75); break;
      case 'reset-rot': screenUserYaw = 0; screenUserPitch = 0; break;
    }
  }

  /* ------------------------------------------------------------------ */
  /* HUD VR                                                              */
  /* ------------------------------------------------------------------ */

  function applyHudPosition(snap = false) {
    if (vrHud.hidden) return;
    const t = snap ? 1 : SMOOTHING;
    hudState.x = lerp(hudState.x, hudTarget.x, t);
    hudState.y = lerp(hudState.y, hudTarget.y, t);
    vrHud.style.left = `${hudState.x.toFixed(1)}px`;
    vrHud.style.top = `${hudState.y.toFixed(1)}px`;
  }

  function placeHudAnchor() {
    if (!motionEnabled || !currentCssToWorld || vrHud.hidden) { hudAnchor = null; return; }
    const r = vrHud.getBoundingClientRect();
    if (r.width === 0) return;
    hudSize = { w: r.width, h: r.height };
    const cx = hudTarget.x + r.width / 2;
    const cy = hudTarget.y + r.height / 2;
    const dx = cx - innerWidth / 2;
    const dy = cy - innerHeight / 2;
    const focal = innerWidth * FOCAL_FACTOR;
    const vCss = [dx / focal, -dy / focal, -1];
    hudAnchor = {
      vWorld: matVec(currentCssToWorld, vCss),
      baseMatrix: currentCssToWorld,
      w: r.width,
      h: r.height
    };
  }

  function toggleVRMode() {
    vrMode = !vrMode;
    document.body.classList.toggle('vr-mode', vrMode);
    vrButton.classList.toggle('active', vrMode);

    if (vrMode) {
      vrHud.hidden = false;
      requestAnimationFrame(() => {
        const r = vrHud.getBoundingClientRect();
        hudSize = { w: r.width, h: r.height };
        hudTarget = {
          x: (innerWidth - r.width) / 2,
          y: innerHeight - r.height - innerHeight * 0.12
        };
        hudState = { ...hudTarget };
        applyHudPosition(true);
        placeHudAnchor();
      });
      if (!screen.hidden) placeScreenAnchor();
      setStatus('Mode VR — pincez un bouton pour cliquer', 'active');
      setHint('Pointez un bouton avec l’index + pouce pour cliquer. Les 5 boutons du bas font pivoter l’écran.');
    } else {
      vrHud.hidden = true;
      hudAnchor = null;
      menuClickLatch = false;
      if (hoveredBtn) { hoveredBtn.classList.remove('hovered'); hoveredBtn = null; }
      setStatus('Mode VR désactivé', 'ready');
      setHint('Écran posé.');
      if (!screen.hidden) placeScreenAnchor();
    }
  }

  /* ------------------------------------------------------------------ */
  /* MAIN 3D beige articulée                                             */
  /* ------------------------------------------------------------------ */

  const SKIN = { base: '#eac5a3', light: '#f8e3ca', shade: '#c09064', edge: 'rgba(130, 90, 55, 0.45)', shadow: 'rgba(60, 40, 25, 0.55)' };
  const SKIN_GRAD = { hi: '#fbe9d4', mid: '#eac5a3', lo: '#c99b6e' };

  function fingerExtended(lm, tip, pip) { return distance(lm[tip], lm[0]) > distance(lm[pip], lm[0]) * 1.16; }

  function handData(lm, index) {
    const raw = { x: lm[8].x * innerWidth, y: lm[8].y * innerHeight };
    const pinchD = distance(lm[4], lm[8]);
    if (pinchD < 0.05) pinchHeld = true;
    else if (pinchD > 0.07) pinchHeld = false;
    return {
      index, raw, point: raw,
      depth: clamp(0.5 - (lm[8].z || 0) * 2.5, 0, 1),
      pinch: pinchHeld, pinchDistance: pinchD,
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

  /* --- Rendu main beige --- */

  const FINGER_CHAINS = [
    { idx: [17, 18, 19, 20], wm: 0.78 }, // auriculaire
    { idx: [13, 14, 15, 16], wm: 0.92 }, // annulaire
    { idx: [9,  10, 11, 12], wm: 1.05 }, // majeur
    { idx: [5,  6,  7,  8],  wm: 1.0  }, // index
    { idx: [1,  2,  3,  4],  wm: 1.15 }  // pouce
  ];
  const KNUCKLES = [5, 9, 13, 17];
  const TIPS = [4, 8, 12, 16, 20];

  function draw3DHand(lm) {
    const W = handCanvas.width, H = handCanvas.height;
    const pts = lm.map(p => ({ x: p.x * W, y: p.y * H, depth: clamp(0.5 - (p.z || 0) * 2.5, 0, 1) }));
    const avgDepth = pts.reduce((s, p) => s + p.depth, 0) / pts.length;
    const scale = (W / 400) * (0.9 + avgDepth * 0.4);

    // 1) Ombre douce offset
    handContext.save();
    handContext.translate(scale * 3, scale * 5);
    handContext.filter = 'blur(6px)';
    FINGER_CHAINS.forEach(c => strokeChain(pts, c.idx, c.wm * scale, SKIN.shadow));
    fillPalm(pts, SKIN.shadow);
    handContext.restore();
    handContext.filter = 'none';

    // 2) Doigts avec gradient
    FINGER_CHAINS.forEach(c => drawFinger3D(pts, c.idx, c.wm * scale));

    // 3) Paume avec gradient radial
    drawPalm3D(pts, scale);

    // 4) Articulations (knuckles)
    KNUCKLES.forEach(i => {
      const p = pts[i];
      const r = (3.5 + p.depth * 2.5) * scale * 0.4;
      const g = handContext.createRadialGradient(p.x - r*0.4, p.y - r*0.4, 0.5, p.x, p.y, r);
      g.addColorStop(0, SKIN_GRAD.hi);
      g.addColorStop(1, SKIN_GRAD.lo);
      handContext.beginPath();
      handContext.arc(p.x, p.y, r, 0, Math.PI * 2);
      handContext.fillStyle = g;
      handContext.fill();
    });

    // 5) Ongles légers aux bouts
    TIPS.forEach(i => {
      const p = pts[i];
      const r = (3 + p.depth * 2) * scale * 0.35;
      handContext.beginPath();
      handContext.ellipse(p.x, p.y - r * 0.3, r, r * 1.3, 0, 0, Math.PI * 2);
      handContext.fillStyle = 'rgba(255, 248, 240, 0.55)';
      handContext.fill();
      handContext.strokeStyle = 'rgba(180, 140, 110, 0.35)';
      handContext.lineWidth = Math.max(0.6, scale * 0.2);
      handContext.stroke();
    });
  }

  function strokeChain(pts, chain, wm, color) {
    handContext.lineCap = 'round';
    handContext.lineJoin = 'round';
    handContext.strokeStyle = color;
    for (let i = 0; i < chain.length - 1; i++) {
      const a = pts[chain[i]], b = pts[chain[i + 1]];
      const t = i / Math.max(1, chain.length - 2);
      const w = (8 - t * 3 + ((a.depth + b.depth) / 2) * 4) * wm;
      handContext.beginPath();
      handContext.moveTo(a.x, a.y);
      handContext.lineTo(b.x, b.y);
      handContext.lineWidth = w;
      handContext.stroke();
    }
  }

  function drawFinger3D(pts, chain, wm) {
    handContext.lineCap = 'round';
    handContext.lineJoin = 'round';
    // Base
    for (let i = 0; i < chain.length - 1; i++) {
      const a = pts[chain[i]], b = pts[chain[i + 1]];
      const t = i / Math.max(1, chain.length - 2);
      const w = (8 - t * 3 + ((a.depth + b.depth) / 2) * 4) * wm;
      // Cylindre : trait central foncé + trait haut clair
      handContext.beginPath();
      handContext.moveTo(a.x, a.y);
      handContext.lineTo(b.x, b.y);
      handContext.lineWidth = w;
      handContext.strokeStyle = SKIN.base;
      handContext.stroke();
      // Reflet
      handContext.beginPath();
      handContext.moveTo(a.x - w * 0.15, a.y - w * 0.25);
      handContext.lineTo(b.x - w * 0.15, b.y - w * 0.25);
      handContext.lineWidth = w * 0.35;
      handContext.strokeStyle = 'rgba(255, 245, 235, 0.55)';
      handContext.stroke();
      // Ombre bas
      handContext.beginPath();
      handContext.moveTo(a.x + w * 0.2, a.y + w * 0.15);
      handContext.lineTo(b.x + w * 0.2, b.y + w * 0.15);
      handContext.lineWidth = w * 0.3;
      handContext.strokeStyle = 'rgba(160, 110, 75, 0.35)';
      handContext.stroke();
    }
    // Bout
    const tip = pts[chain[chain.length - 1]];
    const r = (5.5 + tip.depth * 4) * wm;
    const g = handContext.createRadialGradient(tip.x - r*0.3, tip.y - r*0.3, 0.5, tip.x, tip.y, r);
    g.addColorStop(0, SKIN_GRAD.hi);
    g.addColorStop(1, SKIN_GRAD.mid);
    handContext.beginPath();
    handContext.arc(tip.x, tip.y, r, 0, Math.PI * 2);
    handContext.fillStyle = g;
    handContext.fill();
  }

  function palmPath(pts) {
    const p0 = pts[0], p1 = pts[1], p2 = pts[2], p5 = pts[5], p9 = pts[9], p13 = pts[13], p17 = pts[17];
    const cx = (p0.x + p9.x) / 2, cy = (p0.y + p9.y) / 2;
    handContext.beginPath();
    handContext.moveTo(p0.x, p0.y);
    handContext.lineTo(p1.x, p1.y);
    handContext.lineTo(p2.x, p2.y);
    const web1X = ((p2.x + p5.x) / 2) * 0.65 + cx * 0.35;
    const web1Y = ((p2.y + p5.y) / 2) * 0.65 + cy * 0.35;
    handContext.quadraticCurveTo(web1X, web1Y, p5.x, p5.y);
    handContext.lineTo(p9.x, p9.y);
    handContext.lineTo(p13.x, p13.y);
    handContext.lineTo(p17.x, p17.y);
    const edge1X = ((p17.x + p0.x) / 2) * 0.55 + cx * 0.45;
    const edge1Y = ((p17.y + p0.y) / 2) * 0.55 + cy * 0.45;
    handContext.quadraticCurveTo(edge1X, edge1Y, p0.x, p0.y);
    handContext.closePath();
  }

  function fillPalm(pts, color) {
    palmPath(pts);
    handContext.fillStyle = color;
    handContext.fill();
  }

  function drawPalm3D(pts, scale) {
    const p0 = pts[0], p5 = pts[5], p9 = pts[9], p13 = pts[13], p17 = pts[17];
    const cx = (p0.x + p9.x) / 2, cy = (p0.y + p9.y) / 2;
    const r = Math.max(1, Math.abs(p5.y - p0.y) * 0.55);
    const g = handContext.createRadialGradient(cx - r*0.3, cy - r*0.3, r*0.15, cx, cy, r * 1.3);
    g.addColorStop(0, SKIN_GRAD.hi);
    g.addColorStop(0.55, SKIN_GRAD.mid);
    g.addColorStop(1, SKIN_GRAD.lo);
    palmPath(pts);
    handContext.fillStyle = g;
    handContext.fill();
    handContext.strokeStyle = SKIN.edge;
    handContext.lineWidth = Math.max(1, scale * 0.35);
    handContext.stroke();
  }

  /* ------------------------------------------------------------------ */
  /* Scan pièce (inchangé)                                               */
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

    // Hover sur bouton VR
    if (vrMode && !vrHud.hidden) {
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
      if (!interaction && !menuClickLatch && !playClickLatch) {
        const vrBtn = findVrButton(point);
        if (vrBtn) {
          menuClickLatch = true;
          flashVrButton(vrBtn);
          handleVrAction(vrBtn.dataset.vrAction);
        } else {
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
  /* Caméra                                                              */
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
    const base = { width: { ideal: 1280 }, height: { ideal: 720 } };
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
        cameraButton.disabled = false;
        cameraButton.textContent = 'Réessayer la caméra';
        setStatus('Autorisation caméra refusée', '');
        return;
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
  /* Orientation — matrice complète, marche en portrait ET paysage      */
  /* ------------------------------------------------------------------ */

  let lastUpdateKey = '';

  function onDeviceOrientation(event) {
    const a = Number.isFinite(event.webkitCompassHeading) ? event.webkitCompassHeading : event.alpha;
    if (!Number.isFinite(a) || !Number.isFinite(event.beta)) return;

    const screenAngle = getScreenAngle();
    const M = cssToWorld(a, event.beta, event.gamma || 0, screenAngle);
    currentCssToWorld = M;
    currentScreenAngle = screenAngle;

    // Mise à jour de l'indicateur de mode
    const isLandscape = screenAngle === 90 || screenAngle === 270;
    orientationPill.textContent = isLandscape ? 'PAYSAGE' : 'PORTRAIT';

    updateAnchors();
  }

  function updateAnchors() {
    if (!currentCssToWorld) return;

    // Auto-ancre si manquante
    if (motionEnabled && !screenAnchor && !screen.hidden && !interaction && !twoHandResize) placeScreenAnchor();
    if (vrMode && !hudAnchor && !vrHud.hidden) placeHudAnchor();

    // Écran
    if (screenAnchor && !screen.hidden) {
      if (!interaction && !twoHandResize) {
        const proj = projectWorldDirToScreen(screenAnchor.vWorld);
        if (proj) {
          targetState.x = proj.x - targetState.width / 2;
          targetState.y = proj.y - targetState.height / 2;
          screen.classList.remove('offscreen');
        } else {
          screen.classList.add('offscreen');
        }
      }
    }

    // HUD
    if (vrMode && hudAnchor && !vrHud.hidden) {
      const proj = projectWorldDirToScreen(hudAnchor.vWorld);
      if (proj) {
        hudTarget.x = proj.x - hudAnchor.w / 2;
        hudTarget.y = proj.y - hudAnchor.h / 2;
        vrHud.style.opacity = '1';
      } else {
        vrHud.style.opacity = '0.15';
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
      setHint('Tournez librement : portrait et paysage fonctionnent. Touchez « Ancrer » pour fixer un nouveau repère.');
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
    if (vrMode && !vrHud.hidden) applyHudPosition();
    requestAnimationFrame(renderLoop);
  }

  function onResize() {
    const d = Math.min(devicePixelRatio, 2);
    scanCanvas.width = Math.max(1, innerWidth * d);
    scanCanvas.height = Math.max(1, innerHeight * d);
    handCanvas.width = Math.max(1, innerWidth * d);
    handCanvas.height = Math.max(1, innerHeight * d);
    if (!screen.hidden) applyScreen(true);
    if (vrMode && !vrHud.hidden) {
      requestAnimationFrame(() => {
        const r = vrHud.getBoundingClientRect();
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
    if (vrMode) toggleVRMode();
    setStatus('Écran fermé', 'ready');
  });

  vrHud.querySelectorAll('.vr-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (vrMode) { flashVrButton(btn); handleVrAction(btn.dataset.vrAction); }
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
