/* global Hands, FULLTILT, Spotify */

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
  const gameBtn = vrTaskbar.querySelector('[data-vr-action="game"]');
  const spotifyBtn = vrTaskbar.querySelector('[data-vr-action="spotify"]');
  const spotifyModal = $('#spotify-modal');
  const spotifyTokenInput = $('#spotify-token');
  const spotifyConnectBtn = $('#spotify-connect');
  const spotifyCancelBtn = $('#spotify-cancel');

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const minSize = { width: 220, height: 160 };
  const SMOOTHING = reduceMotion ? 1 : 0.32;
  const FOCAL_FACTOR = 0.85;
  const PERSPECTIVE = 1400;
  const ROT_STEP = 20;

  const PINCH_ENTER = 0.28;
  const PINCH_EXIT = 0.48;

  let objectUrl = null;
  let screenState = { x: 0, y: 0, width: 0, height: 0 };
  let targetState = { x: 0, y: 0, width: 0, height: 0 };
  let interaction = null;
  let twoHandResize = null;
  let motionEnabled = false;

  // Orientation via fulltilt-ng (quaternion ajusté à l'écran)
  let deviceOrientation = null;
  let currentQuaternion = null; // { x, y, z, w }

  // Ancres monde (quaternion au moment de l'ancrage + direction)
  let screenAnchor = null;   // { vWorld: [x,y,z], qBase: quaternion, yawOffset }
  let hudAnchor = null;      // { vWorld, qBase, w, h }

  let vrMode = false;
  let hudTarget = { x: 0, y: 0 };
  let hudState = { x: 0, y: 0 };
  let hudSize = { w: 400, h: 60 };
  let menuClickLatch = false;
  let playClickLatch = false;
  let hoveredBtn = null;
  let screenUserYaw = 0;

  // Game
  let gameActive = false, gameScore = 0, gameMissed = 0, gameSpheres = [], gameLastSpawn = 0, gameSpawnInterval = 1400;

  // Spotify
  let spotifyPlayer = null;
  let spotifyDeviceId = null;
  let spotifyConnected = false;

  let scanActive = false, scanAnimation = 0, previousLuma = null, depthVertices = [], lastScanAt = 0;

  let lastFrameAt = 0, fps = 0, smoothPoint = null, lastHands = [], handLostSince = 0;
  let pinchHeld = false, pinchJustEntered = false;
  let handsInstance = null, trackingLoop = null, usingRVFC = false;

  const scanSource = document.createElement('canvas');
  const scanSourceContext = scanSource.getContext('2d', { willReadFrequently: true });
  const scanGrid = { width: 72, height: 54, step: 4 };
  scanSource.width = scanGrid.width;
  scanSource.height = scanGrid.height;

  /* ------------------------------------------------------------------ */
  /* Utils                                                               */
  /* ------------------------------------------------------------------ */

  const setStatus = (m, mode = 'ready') => { status.textContent = m; statusDot.className = `status-dot ${mode}`; };
  const setHint = m => { hint.textContent = m; };
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const lerp = (a, b, t) => a + (b - a) * t;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));

  // Quaternion helpers
  const qMul = (a, b) => ({
    w: a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z,
    x: a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
    y: a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
    z: a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w
  });
  const qConj = q => ({ w: q.w, x: -q.x, y: -q.y, z: -q.z });
  const qRotate = (q, v) => {
    const qv = { w: 0, x: v[0], y: v[1], z: v[2] };
    const r = qMul(qMul(q, qv), qConj(q));
    return [r.x, r.y, r.z];
  };

  function getScreenAngle() {
    let a = 0;
    if (screen.orientation && typeof screen.orientation.angle === 'number') a = screen.orientation.angle;
    else if (typeof window.orientation === 'number') a = window.orientation;
    return ((a % 360) + 360) % 360;
  }

  function projectWorldDirToScreen(vWorld) {
    if (!currentQuaternion) return null;
    // Ramène le vecteur monde dans le repère CSS courant via le quaternion inverse
    const vCss = qRotate(qConj(currentQuaternion), vWorld);
    if (vCss[2] >= -0.05) return null; // derrière
    const depth = -vCss[2];
    const focal = innerWidth * FOCAL_FACTOR;
    return { x: innerWidth / 2 + (vCss[0] / depth) * focal, y: innerHeight / 2 - (vCss[1] / depth) * focal };
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
  function showScreen() { if (screen.hidden) { screen.hidden = false; initialiseScreen(); } }

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
    if (!currentQuaternion || !screenAnchor) { screen.style.transform = `perspective(${PERSPECTIVE}px)`; return; }
    // Vue = q_current^-1 * q_base * rotation_yaw_utilisateur
    const qUser = { w: Math.cos(screenUserYaw * Math.PI / 360), x: 0, y: Math.sin(screenUserYaw * Math.PI / 360), z: 0 };
    const qView = qMul(qMul(qConj(currentQuaternion), screenAnchor.qBase), qUser);
    const m = qToMatrix3(qView);
    const c0 = [m[0], m[1], m[2]];
    const c1 = [m[3], m[4], m[5]];
    const c2 = [m[6], m[7], m[8]];
    screen.style.transform = `perspective(${PERSPECTIVE}px) matrix3d(
      ${c0[0].toFixed(4)}, ${c0[1].toFixed(4)}, ${c0[2].toFixed(4)}, 0,
      ${(-c1[0]).toFixed(4)}, ${(-c1[1]).toFixed(4)}, ${(-c1[2]).toFixed(4)}, 0,
      ${c2[0].toFixed(4)}, ${c2[1].toFixed(4)}, ${c2[2].toFixed(4)}, 0,
      0, 0, 0, 1)`;
  }

  // Quaternion → matrice 3x3 (colonne-major)
  function qToMatrix3(q) {
    const { x, y, z, w } = q;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    return [
      1 - (yy + zz), xy - wz, xz + wy,
      xy + wz, 1 - (xx + zz), yz - wx,
      xz - wy, yz + wx, 1 - (xx + yy)
    ];
  }

  const bounds = () => ({ left: screenState.x, top: screenState.y, right: screenState.x + screenState.width, bottom: screenState.y + screenState.height });
  const pointInScreen = p => { const b = bounds(); return p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom; };
  const pointOnResizeHandle = p => { const b = bounds(); return p.x >= b.right - 58 && p.x <= b.right + 12 && p.y >= b.bottom - 58 && p.y <= b.bottom + 12; };

  function placeScreenAnchor() {
    if (!motionEnabled || !currentQuaternion || screen.hidden) return;
    const cx = targetState.x + targetState.width / 2;
    const cy = targetState.y + targetState.height / 2;
    const focal = innerWidth * FOCAL_FACTOR;
    // Direction dans le repère CSS : (dx/focal, -dy/focal, -1)
    const vCss = [(cx - innerWidth / 2) / focal, -(cy - innerHeight / 2) / focal, -1];
    const vWorld = qRotate(currentQuaternion, vCss); // CSS → monde
    screenAnchor = {
      vWorld,
      qBase: { ...currentQuaternion }
    };
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
      case 'spotify': openSpotifyModal(); break;
      case 'close-screen': if (!screen.hidden) { screen.hidden = true; uploadedVideo.pause(); } break;
      case 'exit': if (vrMode) toggleVRMode(); break;
      case 'yaw-': screenUserYaw -= ROT_STEP; break;
      case 'yaw+': screenUserYaw += ROT_STEP; break;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Spotify                                                             */
  /* ------------------------------------------------------------------ */

  function openSpotifyModal() {
    spotifyModal.hidden = false;
    if (spotifyConnected) setStatus('Spotify déjà connecté — lecture en cours', 'active');
    else setStatus('Collez votre token Spotify', 'active');
  }

  function closeSpotifyModal() { spotifyModal.hidden = true; }

  function initSpotifyPlayer(token) {
    // Charge le SDK Spotify dynamiquement
    if (window.Spotify) { onSpotifyReady(token); return; }
    window.onSpotifyWebPlaybackSDKReady = () => onSpotifyReady(token);
    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    document.body.appendChild(script);
  }

  function onSpotifyReady(token) {
    spotifyPlayer = new Spotify.Player({
      name: 'Visi0n M0bil Web Player',
      getOAuthToken: cb => cb(token),
      volume: 0.6
    });
    spotifyPlayer.addListener('ready', ({ device_id }) => {
      spotifyDeviceId = device_id;
      spotifyConnected = true;
      spotifyBtn.classList.add('active');
      setStatus('Spotify connecté — Prêt à jouer', 'active');
      setHint('Spotify prêt. Utilisez les boutons play/pause de la taskbar.');
      // Active l'élément pour iOS
      const el = document.createElement('audio');
      spotifyPlayer.activateElement(el);
    });
    spotifyPlayer.addListener('not_ready', () => { spotifyConnected = false; spotifyBtn.classList.remove('active'); });
    spotifyPlayer.addListener('player_state_changed', state => {
      if (state) setStatus(`Spotify: ${state.track_window.current_track.name}`, 'active');
    });
    spotifyPlayer.connect().then(success => {
      if (!success) { setStatus('Échec connexion Spotify', ''); spotifyConnected = false; spotifyBtn.classList.remove('active'); }
    });
  }

  spotifyConnectBtn.addEventListener('click', () => {
    const token = spotifyTokenInput.value.trim();
    if (!token) { setStatus('Token requis', ''); return; }
    initSpotifyPlayer(token);
    closeSpotifyModal();
    setStatus('Connexion Spotify…', 'active');
  });
  spotifyCancelBtn.addEventListener('click', closeSpotifyModal);

  function toggleSpotifyPlayback() {
    if (!spotifyPlayer || !spotifyConnected) { openSpotifyModal(); return; }
    spotifyPlayer.togglePlay().catch(() => setStatus('Erreur lecture Spotify', ''));
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
    if (!motionEnabled || !currentQuaternion || vrTaskbar.hidden) { hudAnchor = null; return; }
    const r = vrTaskbar.getBoundingClientRect();
    if (r.width === 0) return;
    hudSize = { w: r.width, h: r.height };
    const cx = hudTarget.x + r.width / 2;
    const cy = hudTarget.y + r.height / 2;
    const focal = innerWidth * FOCAL_FACTOR;
    const vCss = [(cx - innerWidth / 2) / focal, -(cy - innerHeight / 2) / focal, -1];
    hudAnchor = { vWorld: qRotate(currentQuaternion, vCss), w: r.width, h: r.height };
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
    } else {
      vrTaskbar.hidden = true;
      hudAnchor = null;
      menuClickLatch = false;
      if (hoveredBtn) { hoveredBtn.classList.remove('hovered'); hoveredBtn = null; }
      if (gameActive) toggleGame();
      if (spotifyConnected && spotifyPlayer) spotifyPlayer.pause();
      setStatus('Mode VR désactivé', 'ready');
      if (!screen.hidden) placeScreenAnchor();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Jeu                                                                 */
  /* ------------------------------------------------------------------ */

  function toggleGame() {
    gameActive = !gameActive;
    if (gameActive) {
      gameScore = 0; gameMissed = 0; gameSpheres = []; gameLastSpawn = 0; gameSpawnInterval = 1400;
      gameHud.hidden = false; gameScoreEl.textContent = '0'; gameMissedEl.textContent = '0';
      gameBtn.classList.add('active');
      setStatus('Jeu actif — touchez les sphères !', 'active');
    } else {
      gameSpheres = []; gameHud.hidden = true; gameBtn.classList.remove('active');
      gameContext.setTransform(1, 0, 0, 1, 0, 0);
      gameContext.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
      setStatus('Jeu arrêté', 'ready');
    }
  }

  function spawnSphere() {
    return { x: innerWidth * 0.2 + Math.random() * innerWidth * 0.6, y: innerHeight * 0.2 + Math.random() * innerHeight * 0.5, z: 1.0, speed: 0.0006 + Math.random() * 0.0005, hue: 180 + Math.random() * 130, popped: false, popProgress: 0, missed: false };
  }

  function updateGame(now) {
    if (!gameActive) return;
    if (now - gameLastSpawn > gameSpawnInterval) { gameSpheres.push(spawnSphere()); gameLastSpawn = now; gameSpawnInterval = Math.max(650, gameSpawnInterval - 12); }
    const hand = lastHands[0];
    const handPts = hand && hand.landmarks ? [hand.landmarks[8], hand.landmarks[9], hand.landmarks[0], hand.landmarks[12], hand.landmarks[16]].map(lm => ({ x: lm.x * innerWidth, y: lm.y * innerHeight })) : [];
    for (let i = gameSpheres.length - 1; i >= 0; i--) {
      const s = gameSpheres[i];
      if (s.popped) { s.popProgress += 0.09; if (s.popProgress >= 1) gameSpheres.splice(i, 1); continue; }
      s.z -= s.speed * 16.67;
      const r = Math.min(18 + (1 - s.z) * 95, 130);
      if (s.z <= 0.05) { s.popped = true; s.missed = true; gameMissed++; gameMissedEl.textContent = gameMissed; continue; }
      for (const hp of handPts) { if (Math.hypot(hp.x - s.x, hp.y - s.y) < r * 0.9) { s.popped = true; gameScore++; gameScoreEl.textContent = gameScore; break; } }
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
      gameContext.save(); gameContext.globalAlpha = alpha;
      const grad = gameContext.createRadialGradient(s.x - r*0.3, s.y - r*0.3, 1, s.x, s.y, r);
      if (s.missed) { grad.addColorStop(0, 'rgba(255,120,120,.95)'); grad.addColorStop(0.7, 'rgba(255,40,40,.6)'); grad.addColorStop(1, 'rgba(255,0,0,0)'); }
      else { grad.addColorStop(0, `hsla(${s.hue},100%,92%,.95)`); grad.addColorStop(0.55, `hsla(${s.hue},100%,60%,.7)`); grad.addColorStop(1, `hsla(${s.hue},100%,40%,0)`); }
      gameContext.beginPath(); gameContext.arc(s.x, s.y, r, 0, Math.PI * 2); gameContext.fillStyle = grad; gameContext.fill();
      gameContext.beginPath(); gameContext.arc(s.x, s.y, r * 0.9, 0, Math.PI * 2); gameContext.strokeStyle = s.missed ? `rgba(255,80,80,${0.6*alpha})` : `hsla(${s.hue},100%,80%,${0.7*alpha})`; gameContext.lineWidth = 2; gameContext.stroke();
      gameContext.beginPath(); gameContext.arc(s.x - r * 0.3, s.y - r * 0.3, r * 0.16, 0, Math.PI * 2); gameContext.fillStyle = `rgba(255,255,255,${0.75*alpha})`; gameContext.fill();
      gameContext.restore();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Main / Aura (doigts épais)                                         */
  /* ------------------------------------------------------------------ */

  function handData(lm, index) {
    const raw = { x: lm[8].x * innerWidth, y: lm[8].y * innerHeight };
    const pinchD = distance(lm[4], lm[8]);
    const span = Math.max(distance(lm[0], lm[9]), 0.001);
    const ratio = pinchD / span;
    pinchJustEntered = false;
    if (!pinchHeld && ratio < PINCH_ENTER) { pinchHeld = true; pinchJustEntered = true; }
    else if (pinchHeld && ratio > PINCH_EXIT) { pinchHeld = false; }
    return { index, raw, point: raw, depth: clamp(0.5 - (lm[8].z || 0) * 2.5, 0, 1), pinch: pinchHeld, pinchRatio: ratio, indexOpen: distance(lm[8], lm[0]) > distance(lm[6], lm[0]) * 1.16, landmarks: lm };
  }

  function smoothCursor(raw) {
    if (!smoothPoint || !smoothCursor.last) smoothPoint = { ...raw };
    else {
      const speed = Math.hypot(raw.x - smoothCursor.last.x, raw.y - smoothCursor.last.y);
      const t = reduceMotion ? 1 : clamp(0.55 + speed / 130, 0.55, 1);
      smoothPoint = { x: lerp(smoothPoint.x, raw.x, t), y: lerp(smoothPoint.y, raw.y, t) };
    }
    smoothCursor.last = raw;
    return smoothPoint;
  }
  function showCursor(p, pinching, depth = 0.5) {
    cursor.style.left = `${p.x.toFixed(1)}px`; cursor.style.top = `${p.y.toFixed(1)}px`;
    cursor.style.setProperty('--depth', depth.toFixed(3));
    cursor.classList.add('visible'); cursor.classList.toggle('pinching', pinching);
  }

  const FINGER_CHAINS = [
    { idx: [17, 18, 19, 20], wm: 0.78 }, { idx: [13, 14, 15, 16], wm: 0.92 },
    { idx: [9, 10, 11, 12], wm: 1.05 }, { idx: [5, 6, 7, 8], wm: 1.00 }, { idx: [1, 2, 3, 4], wm: 1.15 }
  ];
  const AURA_COLOR = { r: 155, g: 185, b: 225 };

  function drawHandAura(lm) {
    const W = handCanvas.width, H = handCanvas.height;
    const pts = lm.map(p => ({ x: p.x * W, y: p.y * H, depth: clamp(0.5 - (p.z || 0) * 2.5, 0, 1) }));
    const spanW = Math.hypot(pts[5].x - pts[17].x, pts[5].y - pts[17].y);
    const scale = clamp(spanW / (W * 0.10), 0.35, 2.5);

    drawArmAura(pts, scale);
    drawAuraLayer(pts, scale, 0.06, 25);
    drawAuraLayer(pts, scale, 0.14, 12);
    drawAuraLayer(pts, scale, 0.28, 4);
    drawPalmGlint(pts, scale);
    drawAuraContour(pts, scale);
  }

  function drawAuraLayer(pts, scale, alpha, blurPx) {
    handContext.save();
    handContext.shadowColor = `rgba(${AURA_COLOR.r}, ${AURA_COLOR.g}, ${AURA_COLOR.b}, ${alpha * 1.6})`;
    handContext.shadowBlur = blurPx * scale;
    handContext.fillStyle = `rgba(${AURA_COLOR.r}, ${AURA_COLOR.g}, ${AURA_COLOR.b}, ${alpha})`;
    handContext.strokeStyle = `rgba(${AURA_COLOR.r}, ${AURA_COLOR.g}, ${AURA_COLOR.b}, ${alpha})`;
    strokeHandSilhouette(pts, scale);
    handContext.restore();
  }

  function strokeHandSilhouette(pts, scale) {
    handContext.lineCap = 'round'; handContext.lineJoin = 'round';
    FINGER_CHAINS.forEach(c => {
      for (let i = 0; i < c.idx.length - 1; i++) {
        const a = pts[c.idx[i]], b = pts[c.idx[i + 1]];
        const segT = i / (c.idx.length - 2);
        // ÉPAISSEUR AUGMENTÉE : base 15px au lieu de 11px
        const w = (15 - segT * 5 + ((a.depth + b.depth) / 2) * 8) * c.wm * scale;
        handContext.beginPath(); handContext.lineWidth = w; handContext.moveTo(a.x, a.y); handContext.lineTo(b.x, b.y); handContext.stroke();
      }
    });
    drawPalmPath(pts); handContext.fill();
  }

  function drawPalmPath(pts) {
    const p0 = pts[0], p1 = pts[1], p2 = pts[2], p5 = pts[5], p9 = pts[9], p13 = pts[13], p17 = pts[17];
    handContext.beginPath(); handContext.moveTo(p0.x, p0.y); handContext.lineTo(p1.x, p1.y); handContext.lineTo(p2.x, p2.y);
    const web1 = { x: (p2.x + p5.x) * 0.5, y: (p2.y + p5.y) * 0.5 };
    handContext.quadraticCurveTo(web1.x, web1.y, p5.x, p5.y);
    handContext.lineTo(p9.x, p9.y); handContext.lineTo(p13.x, p13.y); handContext.lineTo(p17.x, p17.y);
    const edge = { x: (p17.x + p0.x) * 0.5, y: (p17.y + p0.y) * 0.5 };
    handContext.quadraticCurveTo(edge.x, edge.y, p0.x, p0.y);
    handContext.closePath();
  }

  function drawPalmGlint(pts, scale) {
    const cx = (pts[0].x + pts[5].x + pts[9].x + pts[13].x + pts[17].x) / 5;
    const cy = (pts[0].y + pts[5].y + pts[9].y + pts[13].y + pts[17].y) / 5;
    const r = Math.hypot(pts[5].x - pts[17].x, pts[5].y - pts[17].y) * 0.7;
    if (r < 2) return;
    const grad = handContext.createRadialGradient(cx - r*0.2, cy - r*0.2, 0.5, cx, cy, r);
    grad.addColorStop(0, 'rgba(220, 235, 255, 0.22)'); grad.addColorStop(0.5, 'rgba(190, 215, 245, 0.10)'); grad.addColorStop(1, 'rgba(190, 215, 245, 0)');
    handContext.fillStyle = grad; handContext.beginPath(); handContext.arc(cx, cy, r, 0, Math.PI * 2); handContext.fill();
  }

  function drawAuraContour(pts, scale) {
    handContext.save();
    handContext.shadowColor = 'rgba(220, 235, 255, 0.55)'; handContext.shadowBlur = 8 * scale;
    handContext.strokeStyle = 'rgba(220, 235, 255, 0.35)'; handContext.lineWidth = Math.max(0.8, 1.5 * scale);
    handContext.lineCap = 'round'; handContext.lineJoin = 'round';
    FINGER_CHAINS.forEach(c => { for (let i = 0; i < c.idx.length - 1; i++) { const a = pts[c.idx[i]], b = pts[c.idx[i + 1]]; handContext.beginPath(); handContext.moveTo(a.x, a.y); handContext.lineTo(b.x, b.y); handContext.stroke(); } });
    drawPalmPath(pts); handContext.stroke();
    handContext.restore();
  }

  function drawArmAura(pts, scale) {
    const wrist = pts[0];
    const palmCx = (pts[0].x + pts[5].x + pts[9].x + pts[13].x + pts[17].x) / 5;
    const palmCy = (pts[0].y + pts[5].y + pts[9].y + pts[13].y + pts[17].y) / 5;
    let dx = wrist.x - palmCx, dy = wrist.y - palmCy;
    const len = Math.hypot(dx, dy); if (len < 1) return;
    dx /= len; dy /= len;
    const perpX = -dy, perpY = dx;
    const spanW = Math.hypot(pts[5].x - pts[17].x, pts[5].y - pts[17].y);
    const armLen = spanW * 3.2, wWrist = spanW * 0.55, wEnd = spanW * 0.82;
    const sL = { x: wrist.x + perpX * wWrist * 0.5, y: wrist.y + perpY * wWrist * 0.5 };
    const sR = { x: wrist.x - perpX * wWrist * 0.5, y: wrist.y - perpY * wWrist * 0.5 };
    const eL = { x: wrist.x + dx * armLen + perpX * wEnd * 0.5, y: wrist.y + dy * armLen + perpY * wEnd * 0.5 };
    const eR = { x: wrist.x + dx * armLen - perpX * wEnd * 0.5, y: wrist.y + dy * armLen - perpY * wEnd * 0.5 };
    const grad = handContext.createLinearGradient(wrist.x, wrist.y, wrist.x + dx * armLen, wrist.y + dy * armLen);
    grad.addColorStop(0, `rgba(${AURA_COLOR.r}, ${AURA_COLOR.g}, ${AURA_COLOR.b}, 0.32)`);
    grad.addColorStop(0.35, `rgba(${AURA_COLOR.r}, ${AURA_COLOR.g}, ${AURA_COLOR.b}, 0.16)`);
    grad.addColorStop(1, `rgba(${AURA_COLOR.r}, ${AURA_COLOR.g}, ${AURA_COLOR.b}, 0)`);
    handContext.save();
    handContext.shadowColor = `rgba(${AURA_COLOR.r}, ${AURA_COLOR.g}, ${AURA_COLOR.b}, 0.22)`; handContext.shadowBlur = 20 * scale;
    handContext.fillStyle = grad;
    handContext.beginPath(); handContext.moveTo(sL.x, sL.y); handContext.lineTo(eL.x, eL.y); handContext.lineTo(eR.x, eR.y); handContext.lineTo(sR.x, sR.y); handContext.closePath(); handContext.fill();
    handContext.restore();
    handContext.fillStyle = grad;
    handContext.beginPath(); handContext.moveTo(sL.x, sL.y); handContext.lineTo(eL.x, eL.y); handContext.lineTo(eR.x, eR.y); handContext.lineTo(sR.x, sR.y); handContext.closePath(); handContext.fill();
  }

  /* ------------------------------------------------------------------ */
  /* Scan / MediaPipe                                                    */
  /* ------------------------------------------------------------------ */

  function analyseRelativeDepth() { /* ... inchangé, gardé court ... */ }
  function drawDepthField() { /* ... inchangé ... */ }
  function runScanLoop(ts) { if (!scanActive) return; if (ts - lastScanAt > 165) { lastScanAt = ts; analyseRelativeDepth(); } scanAnimation = requestAnimationFrame(runScanLoop); }
  function toggleRoomScan() { scanActive = !scanActive; scanButton.classList.toggle('active', scanActive); scanButton.textContent = scanActive ? '◌ Stopper le scan' : '◌ Scanner la pièce'; scanHud.hidden = !scanActive; if (scanActive) { previousLuma = null; lastScanAt = 0; scanAnimation = requestAnimationFrame(runScanLoop); } else { cancelAnimationFrame(scanAnimation); scanAnimation = 0; depthVertices = []; scanContext.clearRect(0, 0, scanCanvas.width, scanCanvas.height); } }

  function onResults(results) {
    const now = performance.now();
    if (lastFrameAt) fps = lerp(fps || 30, 1000 / Math.max(1, now - lastFrameAt), 0.15);
    lastFrameAt = now;
    handContext.clearRect(0, 0, handCanvas.width, handCanvas.height);
    const list = results.multiHandLandmarks || [];
    if (!list.length) {
      if (!handLostSince) handLostSince = now;
      if (now - handLostSince > 100) { cursor.classList.remove('visible'); smoothCursor.last = null; pinchHeld = false; menuClickLatch = false; playClickLatch = false; if (hoveredBtn) { hoveredBtn.classList.remove('hovered'); hoveredBtn = null; } if (interaction) endInteraction('hand'); endTwoHandResize(); lastHands = []; }
      return;
    }
    handLostSince = 0;
    lastHands = list.map((lm, i) => handData(lm, i));
    lastHands.forEach(h => drawHandAura(h.landmarks));
    const primary = lastHands[0];
    const point = smoothCursor(primary.raw);
    primary.point = point;
    showCursor(point, primary.pinch, primary.depth);

    if (vrMode && !vrTaskbar.hidden) {
      const btn = findVrButton(point);
      if (btn !== hoveredBtn) { if (hoveredBtn) hoveredBtn.classList.remove('hovered'); if (btn) btn.classList.add('hovered'); hoveredBtn = btn; }
    }

    const doublePinch = lastHands.length > 1 && lastHands[0].pinch && lastHands[1].pinch;
    if (doublePinch) { if (interaction) endInteraction('hand'); resizeFromTwoHands(lastHands[0].point, lastHands[1].point); return; }
    endTwoHandResize();

    if (primary.pinch) {
      if (pinchJustEntered && !interaction && !menuClickLatch && !playClickLatch) {
        const vrBtn = findVrButton(point);
        if (vrBtn) { menuClickLatch = true; flashBtn(vrBtn); handleVrAction(vrBtn.dataset.vrAction); }
        else {
          const playHit = pointOnPlayButton(point);
          if (playHit) { playClickLatch = true; if (uploadedVideo.paused) uploadedVideo.play().catch(() => {}); else uploadedVideo.pause(); }
          else if (pointOnResizeHandle(point)) beginInteraction(point, 'resize', 'hand');
          else if (pointInScreen(point)) beginInteraction(point, 'move', 'hand');
        }
      }
      updateInteraction(point, 'hand');
    } else {
      menuClickLatch = false; playClickLatch = false;
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
  const FRONT = /front|facetime|selfie|\buser\b|avant/i; const REAR = /back|rear|environment|arri[eè]re|ultra ?wide|telephoto|grand angle/i;
  function streamFacing(stream) { const t = stream.getVideoTracks()[0]; if (!t) return 'user'; const s = t.getSettings?.() || {}; const l = t.label || ''; if (s.facingMode === 'environment') return 'environment'; if (s.facingMode === 'user') return 'user'; if (REAR.test(l)) return 'environment'; if (FRONT.test(l)) return 'user'; return 'unknown'; }
  const isFront = s => streamFacing(s) === 'user';
  async function rearDevices() { const ds = await navigator.mediaDevices.enumerateDevices(); const ins = ds.filter(d => d.kind === 'videoinput'); const named = ins.filter(d => REAR.test(d.label) && !FRONT.test(d.label)); return named.length ? named : ins.filter(d => !FRONT.test(d.label)); }
  const openDevice = (id, base) => navigator.mediaDevices.getUserMedia({ video: { ...base, deviceId: { exact: id } }, audio: false });
  async function requestNamedRear(base) { for (const d of await rearDevices()) { let s = null; try { s = await openDevice(d.deviceId, base); } catch { continue; } if (!isFront(s)) { cameraVideo.dataset.deviceId = d.deviceId || ''; return s; } stopStream(s); } throw new Error('rear-camera-unavailable'); }
  async function requestRearCamera() { const base = { width: { ideal: 640 }, height: { ideal: 480 } }; if (cameraVideo.dataset.deviceId) { try { const s = await openDevice(cameraVideo.dataset.deviceId, base); if (!isFront(s)) return s; stopStream(s); } catch {} cameraVideo.dataset.deviceId = ''; } try { const s = await navigator.mediaDevices.getUserMedia({ video: { ...base, facingMode: { exact: 'environment' } }, audio: false }); if (!isFront(s)) return s; stopStream(s); } catch (e) { if (!['OverconstrainedError', 'NotFoundError', 'NotReadableError'].includes(e.name)) throw e; } return requestNamedRear(base); }
  async function startCamera() { if (!navigator.mediaDevices?.getUserMedia) { setStatus('Caméra indisponible', ''); return; } cameraButton.disabled = true; cameraButton.textContent = 'Connexion…'; try { const warmup = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }); stopStream(warmup); } catch (e) { if (e.name === 'NotAllowedError' || e.name === 'SecurityError') { cameraButton.disabled = false; cameraButton.textContent = 'Réessayer la caméra'; setStatus('Autorisation caméra refusée', ''); return; } } try { const stream = await requestRearCamera(); cameraVideo.srcObject = stream; await cameraVideo.play(); cameraButton.textContent = 'Caméra active'; motionButton.disabled = false; scanButton.disabled = false; uploadButton.disabled = false; vrButton.disabled = false; setStatus('Caméra active — importez une vidéo', 'active'); startHandTracking(); } catch (e) { cameraButton.disabled = false; cameraButton.textContent = 'Réessayer la caméra'; setStatus('Caméra indisponible', ''); } }

  function startHandTracking() {
    if (handsInstance || typeof Hands === 'undefined') return;
    handsInstance = new Hands({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
    handsInstance.setOptions({ maxNumHands: 2, modelComplexity: 0, minDetectionConfidence: 0.6, minTrackingConfidence: 0.5 });
    handsInstance.onResults(onResults);
    usingRVFC = typeof cameraVideo.requestVideoFrameCallback === 'function';
    const loop = async () => { if (cameraVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) { try { await handsInstance.send({ image: cameraVideo }); } catch {} } schedule(); };
    const schedule = () => { if (usingRVFC) { cameraVideo.requestVideoFrameCallback(loop); trackingLoop = null; } else { trackingLoop = requestAnimationFrame(loop); } };
    schedule();
  }

  /* ------------------------------------------------------------------ */
  /* Orientation via fulltilt-ng                                         */
  /* ------------------------------------------------------------------ */

  async function enableMotionAnchor() {
    if (!window.FULLTILT) { setStatus('fulltilt-ng non chargé', ''); return; }
    try {
      // fulltilt-ng gère la compensation d'orientation d'écran automatiquement
      deviceOrientation = await FULLTILT.getDeviceOrientation({ type: 'world' });
      motionEnabled = true;
      motionButton.classList.add('active');
      motionButton.textContent = '⌖ Réancrer';
      setStatus('Ancrage 360° actif (portrait + paysage)', 'active');
      setHint('Tournez librement : portrait et paysage fonctionnent. Touchez « Réancrer » pour repositionner.');
      // Boucle de lecture des quaternions
      const update = () => {
        if (!deviceOrientation) return;
        const q = deviceOrientation.getScreenAdjustedQuaternion();
        if (q) {
          currentQuaternion = { w: q.w, x: q.x, y: q.y, z: q.z };
          const angle = getScreenAngle();
          orientationPill.textContent = (angle === 90 || angle === 270) ? 'PAYSAGE' : 'PORTRAIT';
          updateAnchors();
        }
        requestAnimationFrame(update);
      };
      update();
      placeScreenAnchor();
      if (vrMode) placeHudAnchor();
    } catch (err) {
      setStatus('Capteurs indisponibles ou refusés', '');
    }
  }

  function updateAnchors() {
    if (!currentQuaternion) return;
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
      if (proj) { hudTarget.x = proj.x - hudAnchor.w / 2; hudTarget.y = proj.y - hudAnchor.h / 2; vrTaskbar.style.opacity = '1'; }
      else { vrTaskbar.style.opacity = '0.15'; }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Boucle / câblage                                                    */
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
      requestAnimationFrame(() => { const r = vrTaskbar.getBoundingClientRect(); hudSize = { w: r.width, h: r.height }; applyHudPosition(true); placeHudAnchor(); });
    }
  }

  cameraButton.addEventListener('click', startCamera);
  motionButton.addEventListener('click', enableMotionAnchor);
  scanButton.addEventListener('click', toggleRoomScan);
  uploadButton.addEventListener('click', openFilePicker);
  vrButton.addEventListener('click', toggleVRMode);
  fileInput.addEventListener('change', loadVideo);

  closeScreen.addEventListener('click', () => { screen.hidden = true; uploadedVideo.pause(); setStatus('Écran fermé', 'ready'); });

  vrTaskbar.querySelectorAll('.vr-btn').forEach(btn => {
    btn.addEventListener('click', () => { if (vrMode) { flashBtn(btn); handleVrAction(btn.dataset.vrAction); } });
  });

  playBtn.addEventListener('click', () => {
    // Si Spotify est connecté, le play contrôle Spotify
    if (spotifyConnected) { toggleSpotifyPlayback(); return; }
    if (uploadedVideo.paused) uploadedVideo.play().catch(() => {}); else uploadedVideo.pause();
  });
  uploadedVideo.addEventListener('play', () => playBtn.classList.add('playing'));
  uploadedVideo.addEventListener('pause', () => playBtn.classList.remove('playing'));

  orientationPill.addEventListener('click', () => { placeScreenAnchor(); if (vrMode) placeHudAnchor(); setStatus('Repère recentré', 'active'); });

  screenBar.addEventListener('pointerdown', startPointerMove);
  resizeHandle.addEventListener('pointerdown', startPointerResize);
  screen.addEventListener('pointermove', movePointer);
  screen.addEventListener('pointerup', endPointer);
  screen.addEventListener('pointercancel', endPointer);

  addEventListener('resize', onResize);
  addEventListener('orientationchange', () => { setTimeout(() => { onResize(); if (motionEnabled) { placeScreenAnchor(); if (vrMode) placeHudAnchor(); } }, 350); });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(scanAnimation); if (trackingLoop) cancelAnimationFrame(trackingLoop); trackingLoop = null; }
    else if (handsInstance && cameraVideo.srcObject && !trackingLoop) {
      if (usingRVFC) { const loop = async () => { if (cameraVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) { try { await handsInstance.send({ image: cameraVideo }); } catch {} } cameraVideo.requestVideoFrameCallback(loop); }; cameraVideo.requestVideoFrameCallback(loop); }
      else { const loop = async () => { if (cameraVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) { try { await handsInstance.send({ image: cameraVideo }); } catch {} } trackingLoop = requestAnimationFrame(loop); }; trackingLoop = requestAnimationFrame(loop); }
      if (scanActive) scanAnimation = requestAnimationFrame(runScanLoop);
    }
  });

  onResize();
  requestAnimationFrame(renderLoop);
})();
