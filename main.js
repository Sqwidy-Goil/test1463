/* global Hands, FULLTILT, Spotify */

(() => {
  'use strict';

  // --- DOM Elements ---
  const $ = s => document.querySelector(s);
  const cameraBtn = $('#camera-button');
  const motionBtn = $('#motion-button');
  const scanBtn = $('#scan-button');
  const uploadBtn = $('#upload-button');
  const vrBtn = $('#vr-button');
  const fileInput = $('#video-file');
  const cameraVideo = $('#input-video');
  
  const arScreen = $('#ar-screen');
  const screenBar = $('#screen-bar');
  const resizeHandle = $('#resize-handle');
  const closeScreenBtn = $('#close-screen');
  const uploadedVideo = $('#uploaded-video');
  const emptyVideo = $('#empty-video');
  const playBtn = $('#screen-play');
  
  const vrTaskbar = $('#vr-taskbar');
  const cursor = $('#hand-cursor');
  const statusText = $('#status-text');
  const statusDot = $('#status-dot');
  const orientationPill = $('#orientation-pill');
  
  const gameHud = $('#game-hud');
  const gameScoreEl = $('#game-score');
  const gameMissedEl = $('#game-missed');
  
  const handCanvas = $('#hand-canvas');
  const handCtx = handCanvas.getContext('2d');
  const gameCanvas = $('#game-canvas');
  const gameCtx = gameCanvas.getContext('2d');
  const scanCanvas = $('#scan-canvas');
  const scanCtx = scanCanvas.getContext('2d');

  // --- State ---
  let objectUrl = null;
  let screenState = { x: 0, y: 0, w: 0, h: 0 };
  let targetState = { x: 0, y: 0, w: 0, h: 0 };
  let interaction = null;
  let twoHandResize = null;
  
  let motionEnabled = false;
  let deviceOrientation = null;
  let currentQuaternion = null;
  let screenAnchor = null;
  let hudAnchor = null;
  let screenUserYaw = 0;
  
  let vrMode = false;
  let hudTarget = { x: 0, y: 0 };
  let hudState = { x: 0, y: 0 };
  let hudSize = { w: 400, h: 60 };
  
  let gameActive = false;
  let gameSpheres = [];
  let gameScore = 0;
  let gameMissed = 0;
  let gameLastSpawn = 0;
  
  let spotifyPlayer = null;
  let spotifyConnected = false;
  let photosMode = 'photo';
  let photoStore = [];
  let mediaRecorder = null;
  let mediaChunks = [];

  // --- Constants ---
  const SMOOTHING = 0.25;
  const FOCAL_FACTOR = 0.85;
  const PINCH_ENTER = 0.28;
  const PINCH_EXIT = 0.48;
  const ROT_STEP = 20;

  // --- Utility Functions ---
  const setStatus = (msg, type = '') => {
    statusText.textContent = msg;
    statusDot.className = `dot ${type}`;
  };
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));

  function getScreenAngle() {
    if (screen.orientation && screen.orientation.angle !== undefined) return screen.orientation.angle;
    return window.orientation || 0;
  }

  // Quaternion Math
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

  function projectWorldDirToScreen(vWorld) {
    if (!currentQuaternion) return null;
    const vCss = qRotate(qConj(currentQuaternion), vWorld);
    if (vCss[2] >= -0.05) return null; // Derrière la caméra
    const depth = -vCss[2];
    const focal = innerWidth * FOCAL_FACTOR;
    return { x: innerWidth / 2 + (vCss[0] / depth) * focal, y: innerHeight / 2 - (vCss[1] / depth) * focal };
  }

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

  // --- Spatial Screen Logic ---
  function initScreen() {
    const base = Math.min(320, innerWidth * 0.45);
    const h = base * 0.62;
    targetState = { x: (innerWidth - base) / 2, y: (innerHeight - h) / 2, w: base, h: h };
    screenState = { ...targetState };
    applyScreen(true);
    placeScreenAnchor();
  }

  function applyScreen(snap = false) {
    const t = snap ? 1 : SMOOTHING;
    screenState.x = lerp(screenState.x, targetState.x, t);
    screenState.y = lerp(screenState.y, targetState.y, t);
    screenState.w = lerp(screenState.w, targetState.w, t);
    screenState.h = lerp(screenState.h, targetState.h, t);
    
    arScreen.style.left = `${screenState.x}px`;
    arScreen.style.top = `${screenState.y}px`;
    arScreen.style.width = `${screenState.w}px`;
    arScreen.style.height = `${screenState.h}px`;
    
    updateScreenRotation();
  }

  function updateScreenRotation() {
    if (!currentQuaternion || !screenAnchor) {
      arScreen.style.transform = `perspective(1400px)`;
      return;
    }
    const qUser = { w: Math.cos(screenUserYaw * Math.PI / 360), x: 0, y: Math.sin(screenUserYaw * Math.PI / 360), z: 0 };
    const qView = qMul(qMul(qConj(currentQuaternion), screenAnchor.qBase), qUser);
    const m = qToMatrix3(qView);
    
    arScreen.style.transform = `perspective(1400px) matrix3d(
      ${m[0]}, ${m[1]}, ${m[2]}, 0,
      ${-m[3]}, ${-m[4]}, ${-m[5]}, 0,
      ${m[6]}, ${m[7]}, ${m[8]}, 0,
      0, 0, 0, 1)`;
  }

  function placeScreenAnchor() {
    if (!motionEnabled || !currentQuaternion || arScreen.hidden) return;
    const cx = targetState.x + targetState.w / 2;
    const cy = targetState.y + targetState.h / 2;
    const focal = innerWidth * FOCAL_FACTOR;
    const vCss = [(cx - innerWidth / 2) / focal, -(cy - innerHeight / 2) / focal, -1];
    screenAnchor = { vWorld: qRotate(currentQuaternion, vCss), qBase: { ...currentQuaternion } };
  }

  function placeHudAnchor() {
    if (!motionEnabled || !currentQuaternion || vrTaskbar.hidden) return;
    const r = vrTaskbar.getBoundingClientRect();
    const cx = hudTarget.x + r.width / 2;
    const cy = hudTarget.y + r.height / 2;
    const focal = innerWidth * FOCAL_FACTOR;
    const vCss = [(cx - innerWidth / 2) / focal, -(cy - innerHeight / 2) / focal, -1];
    hudAnchor = { vWorld: qRotate(currentQuaternion, vCss), w: r.width, h: r.height };
  }

  function updateAnchors() {
    if (!currentQuaternion) return;
    
    // Screen
    if (screenAnchor && !interaction && !twoHandResize && !arScreen.hidden) {
      const proj = projectWorldDirToScreen(screenAnchor.vWorld);
      if (proj) {
        targetState.x = proj.x - targetState.w / 2;
        targetState.y = proj.y - targetState.h / 2;
        arScreen.classList.remove('offscreen');
      } else {
        arScreen.classList.add('offscreen');
      }
    }
    
    // HUD
    if (vrMode && hudAnchor && !vrTaskbar.hidden) {
      const proj = projectWorldDirToScreen(hudAnchor.vWorld);
      if (proj) {
        hudTarget.x = proj.x - hudAnchor.w / 2;
        hudTarget.y = proj.y - hudAnchor.h / 2;
        vrTaskbar.style.opacity = '1';
      } else {
        vrTaskbar.style.opacity = '0.2';
      }
    }
  }

  // --- Interactions ---
  function beginInteraction(p, mode, source) {
    if (arScreen.hidden) return;
    screenAnchor = null;
    if (mode === 'resize') interaction = { mode, source, startX: p.x, startY: p.y, w: targetState.w, h: targetState.h };
    else interaction = { mode: 'move', source, offX: p.x - targetState.x, offY: p.y - targetState.y };
  }

  function updateInteraction(p, source) {
    if (!interaction || interaction.source !== source) return;
    if (interaction.mode === 'move') {
      targetState.x = p.x - interaction.offX;
      targetState.y = p.y - interaction.offY;
    } else {
      targetState.w = clamp(interaction.w + p.x - interaction.startX, 180, innerWidth * 0.9);
      targetState.h = clamp(interaction.h + p.y - interaction.startY, 120, innerHeight * 0.8);
    }
    applyScreen();
  }

  function endInteraction(source) {
    if (!interaction || interaction.source !== source) return;
    interaction = null;
    placeScreenAnchor();
  }

  // Pointer fallback
  const pointerPos = e => ({ x: e.clientX, y: e.clientY });
  screenBar.addEventListener('pointerdown', e => { e.preventDefault(); beginInteraction(pointerPos(e), 'move', 'pointer'); arScreen.setPointerCapture(e.pointerId); });
  resizeHandle.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); beginInteraction(pointerPos(e), 'resize', 'pointer'); arScreen.setPointerCapture(e.pointerId); });
  arScreen.addEventListener('pointermove', e => updateInteraction(pointerPos(e), 'pointer'));
  arScreen.addEventListener('pointerup', () => endInteraction('pointer'));

  // --- Hand Tracking ---
  function onResults(results) {
    handCtx.clearRect(0, 0, handCanvas.width, handCanvas.height);
    const list = results.multiHandLandmarks || [];
    
    if (!list.length) {
      cursor.classList.remove('visible');
      return;
    }

    list.forEach(lm => drawAura(lm));
    
    const primary = list[0];
    const tip = { x: primary[8].x * innerWidth, y: primary[8].y * innerHeight };
    const thumb = primary[4];
    const index = primary[8];
    const span = dist(primary[0], primary[9]);
    const ratio = dist(thumb, index) / span;
    
    const isPinching = ratio < PINCH_ENTER;
    
    cursor.style.left = `${tip.x}px`;
    cursor.style.top = `${tip.y}px`;
    cursor.classList.add('visible');
    cursor.classList.toggle('pinching', isPinching);

    // Handle UI Clicks
    if (isPinching && !interaction) {
      // Check dock buttons
      const btn = Array.from(vrTaskbar.querySelectorAll('.dock-btn')).find(b => {
        const r = b.getBoundingClientRect();
        return tip.x >= r.left && tip.x <= r.right && tip.y >= r.top && tip.y <= r.bottom;
      });
      if (btn) { handleVrAction(btn.dataset.vrAction); return; }
      
      // Check screen
      if (tip.x > screenState.x && tip.x < screenState.x + screenState.w &&
          tip.y > screenState.y && tip.y < screenState.y + screenState.h) {
        beginInteraction(tip, 'move', 'hand');
      }
    } else if (!isPinching && interaction) {
      endInteraction('hand');
    }
    
    if (interaction) updateInteraction(tip, 'hand');
  }

  function drawAura(lm) {
    const W = handCanvas.width, H = handCanvas.height;
    const pts = lm.map(p => ({ x: p.x * W, y: p.y * H, z: p.z }));
    const scale = Math.hypot(pts[5].x - pts[17].x, pts[5].y - pts[17].y) / (W * 0.15);
    
    handCtx.save();
    handCtx.shadowColor = 'rgba(100, 200, 255, 0.6)';
    handCtx.shadowBlur = 15 * scale;
    handCtx.fillStyle = 'rgba(100, 200, 255, 0.2)';
    handCtx.strokeStyle = 'rgba(100, 200, 255, 0.4)';
    handCtx.lineWidth = 4 * scale;
    handCtx.lineCap = 'round';
    handCtx.lineJoin = 'round';

    // Simple palm path
    handCtx.beginPath();
    handCtx.moveTo(pts[0].x, pts[0].y);
    [1, 2, 5, 9, 13, 17].forEach(i => handCtx.lineTo(pts[i].x, pts[i].y));
    handCtx.closePath();
    handCtx.fill();
    handCtx.stroke();

    // Fingers
    [[1,2,3,4], [5,6,7,8], [9,10,11,12], [13,14,15,16], [17,18,19,20]].forEach(chain => {
      handCtx.beginPath();
      handCtx.moveTo(pts[chain[0]].x, pts[chain[0]].y);
      for(let i=1; i<chain.length; i++) handCtx.lineTo(pts[chain[i]].x, pts[chain[i]].y);
      handCtx.stroke();
    });
    handCtx.restore();
  }

  // --- Gyroscope ---
  async function enableMotion() {
    if (!window.FULLTILT) return setStatus('Erreur capteurs', '');
    
    try {
      // IOS 13+ Permission check BEFORE any await
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const p = await DeviceOrientationEvent.requestPermission();
        if (p !== 'granted') return setStatus('Gyro refusé', '');
      }
      
      deviceOrientation = await FULLTILT.getDeviceOrientation({ type: 'world' });
      motionEnabled = true;
      motionBtn.classList.add('accent');
      setStatus('Gyro Actif', 'active');
      
      const loop = () => {
        if (!deviceOrientation) return;
        const q = deviceOrientation.getScreenAdjustedQuaternion();
        if (q) {
          currentQuaternion = { w: q.w, x: q.x, y: q.y, z: q.z };
          orientationPill.textContent = [90, 270].includes(getScreenAngle()) ? 'Paysage' : 'Portrait';
          updateAnchors();
        }
        requestAnimationFrame(loop);
      };
      loop();
      placeScreenAnchor();
    } catch (e) {
      setStatus('Erreur Gyro', '');
    }
  }

  // --- AR Integration (IKEA-style) ---
  function openArModal() {
    $('#ar-modal').hidden = false;
    setStatus('Prêt pour l\'AR', 'active');
  }

  // --- Init & Event Listeners ---
  async function startCamera() {
    cameraBtn.disabled = true;
    cameraBtn.textContent = 'Connexion...';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      cameraVideo.srcObject = stream;
      await cameraVideo.play();
      
      cameraBtn.textContent = 'Caméra OK';
      motionBtn.disabled = false;
      scanBtn.disabled = false;
      uploadBtn.disabled = false;
      vrBtn.disabled = false;
      setStatus('Caméra Prête', 'ready');
      
      startHandTracking();
    } catch (e) {
      cameraBtn.textContent = 'Erreur Caméra';
      setStatus('Caméra refusée', '');
    }
  }

  function startHandTracking() {
    const hands = new Hands({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
    hands.setOptions({ maxNumHands: 2, modelComplexity: 0, minDetectionConfidence: 0.5, minTrackingConfidence: 0.4 });
    hands.onResults(onResults);
    
    // Fast inference canvas
    const infCanvas = document.createElement('canvas');
    infCanvas.width = 320; infCanvas.height = 240;
    const infCtx = infCanvas.getContext('2d');
    
    const loop = async () => {
      if (cameraVideo.readyState >= 2) {
        infCtx.drawImage(cameraVideo, 0, 0, 320, 240);
        await hands.send({ image: infCanvas });
      }
      requestAnimationFrame(loop);
    };
    loop();
  }

  function toggleVR() {
    vrMode = !vrMode;
    document.body.classList.toggle('vr-mode', vrMode);
    vrBtn.classList.toggle('accent', vrMode);
    vrTaskbar.hidden = !vrMode;
    
    if (vrMode) {
      const r = vrTaskbar.getBoundingClientRect();
      hudTarget = { x: (innerWidth - r.width) / 2, y: innerHeight - r.height - 40 };
      hudState = { ...hudTarget };
      vrTaskbar.style.left = `${hudState.x}px`;
      vrTaskbar.style.top = `${hudState.y}px`;
      placeHudAnchor();
    }
  }

  function handleVrAction(action) {
    switch (action) {
      case 'reanchor': placeScreenAnchor(); placeHudAnchor(); break;
      case 'game': toggleGame(); break;
      case 'play': if (uploadedVideo.src) uploadedVideo.paused ? uploadedVideo.play() : uploadedVideo.pause(); break;
      case 'keyboard': $('#keyboard-panel').hidden = !$('#keyboard-panel').hidden; break;
      case 'photos': $('#photos-app').hidden = !$('#photos-app').hidden; break;
      case 'ar': openArModal(); break;
      case 'spotify': $('#spotify-modal').hidden = false; break;
      case 'yaw-': screenUserYaw -= ROT_STEP; break;
      case 'yaw+': screenUserYaw += ROT_STEP; break;
      case 'close-screen': arScreen.hidden = true; break;
      case 'exit': toggleVR(); break;
    }
  }

  // Bind events
  cameraBtn.addEventListener('click', startCamera);
  motionBtn.addEventListener('click', enableMotion);
  vrBtn.addEventListener('click', toggleVR);
  $('#ar-modal-close').addEventListener('click', () => $('#ar-modal').hidden = true);
  
  // Load Video
  uploadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(f);
    uploadedVideo.src = objectUrl;
    uploadedVideo.play();
    emptyVideo.hidden = true;
    $('#screen-name').textContent = f.name;
    arScreen.hidden = false;
    initScreen();
  });

  // Render loop
  function render() {
    if (!arScreen.hidden) applyScreen();
    if (vrMode && !vrTaskbar.hidden) {
      hudState.x = lerp(hudState.x, hudTarget.x, SMOOTHING);
      hudState.y = lerp(hudState.y, hudTarget.y, SMOOTHING);
      vrTaskbar.style.left = `${hudState.x}px`;
      vrTaskbar.style.top = `${hudState.y}px`;
    }
    requestAnimationFrame(render);
  }
  
  // Resize canvases
  window.addEventListener('resize', () => {
    [handCanvas, gameCanvas, scanCanvas].forEach(c => {
      c.width = innerWidth * devicePixelRatio;
      c.height = innerHeight * devicePixelRatio;
    });
  });
  
  // Start
  window.dispatchEvent(new Event('resize'));
  render();
})();
