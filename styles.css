:root {
  color-scheme: dark;
  --cyan: #45ddff; --blue: #4496ff; --ink: #eef6ff;
  --glass-bg: linear-gradient(135deg, rgba(255,255,255,.14), rgba(255,255,255,.04));
  --glass-border: 1px solid rgba(255,255,255,.24);
  --glass-shadow: 0 8px 32px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,255,255,.28);
}
* { box-sizing: border-box; }
html, body, main { width: 100%; height: 100%; }
body { margin: 0; overflow: hidden; background: #0b1020; color: var(--ink); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; -webkit-tap-highlight-color: transparent; }
button { font-family: inherit; }

.room-camera { position: fixed; inset: 0; width: 100%; height: 100%; object-fit: cover; background: radial-gradient(circle at 50% 38%, #2c4162, #090d1b 70%); }
.vignette { position: fixed; z-index: 1; inset: 0; pointer-events: none; background: radial-gradient(ellipse at center, transparent 42%, rgba(1,4,14,.34) 100%); }
#scan-canvas { position: fixed; z-index: 2; inset: 0; width: 100%; height: 100%; pointer-events: none; mix-blend-mode: screen; }
#game-canvas { position: fixed; z-index: 45; inset: 0; width: 100%; height: 100%; pointer-events: none; }
#hand-canvas { position: fixed; z-index: 50; inset: 0; width: 100%; height: 100%; pointer-events: none; mix-blend-mode: normal; }

.controls { position: fixed; z-index: 70; top: max(18px, env(safe-area-inset-top)); left: max(18px, env(safe-area-inset-left)); max-width: min(340px, calc(100vw - 36px)); padding: 14px 17px; border-radius: 18px; background: var(--glass-bg); backdrop-filter: blur(20px) saturate(160%); border: var(--glass-border); box-shadow: var(--glass-shadow); pointer-events: none; }
.eyebrow { color: var(--cyan); font-size: 10px; font-weight: 800; letter-spacing: .15em; }
h1 { margin: 4px 0 9px; font-size: 22px; line-height: 1; letter-spacing: -.03em; } h1 span { color: var(--cyan); }
.status-row { display: flex; align-items: center; gap: 8px; color: #c4d5eb; font-size: 12px; font-weight: 600; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; background: #f1ae45; box-shadow: 0 0 12px currentColor; }
.status-dot.ready { background: #55edaf; } .status-dot.active { background: var(--cyan); }

.orientation-pill { position: fixed; z-index: 70; top: max(20px, env(safe-area-inset-top)); right: max(20px, env(safe-area-inset-right)); padding: 8px 14px; border-radius: 999px; background: var(--glass-bg); backdrop-filter: blur(20px) saturate(160%); border: var(--glass-border); box-shadow: var(--glass-shadow); color: var(--cyan); font-size: 10px; font-weight: 800; letter-spacing: .12em; cursor: pointer; }

.scan-hud { position: fixed; z-index: 70; top: max(70px, calc(env(safe-area-inset-top) + 50px)); right: max(20px, env(safe-area-inset-right)); display: flex; align-items: center; gap: 7px; padding: 8px 10px; border-radius: 999px; background: rgba(4,34,31,.72); backdrop-filter: blur(16px); border: 1px solid rgba(101,255,196,.42); color: #85ffce; font-size: 9px; font-weight: 800; letter-spacing: .09em; }
.scan-dot { width: 6px; height: 6px; border-radius: 50%; background: #6affaa; box-shadow: 0 0 12px #6affaa; animation: scan-pulse 1.2s ease-in-out infinite; }
@keyframes scan-pulse { 50% { opacity: .25; transform: scale(.65); } }

.game-hud { position: fixed; z-index: 68; top: max(80px, calc(env(safe-area-inset-top) + 60px)); left: 50%; transform: translateX(-50%); display: flex; gap: 20px; padding: 10px 22px; border-radius: 16px; background: var(--glass-bg); backdrop-filter: blur(22px) saturate(180%); border: var(--glass-border); box-shadow: var(--glass-shadow); opacity: 1; transition: opacity .25s ease, transform .25s ease; }
.game-hud[hidden] { display: none !important; }
.game-stat { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.game-label { color: #a8bcd2; font-size: 9px; font-weight: 800; letter-spacing: .14em; }
.game-hud b { color: var(--cyan); font-size: 22px; font-weight: 800; line-height: 1; }

.ar-screen { position: fixed; z-index: 5; left: 0; top: 0; width: min(320px, 62vmin); height: calc(min(320px, 62vmin) * 0.64); min-width: 180px; min-height: 120px; max-width: 90vw; max-height: 76vh; overflow: hidden; border-radius: 20px; background: linear-gradient(135deg, rgba(30, 45, 75, 0.45), rgba(15, 22, 42, 0.60)); backdrop-filter: blur(24px) saturate(180%) brightness(1.05); -webkit-backdrop-filter: blur(24px) saturate(180%) brightness(1.05); border: 1px solid rgba(255, 255, 255, 0.32); box-shadow: 0 26px 48px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(120, 200, 255, 0.18) inset, inset 0 1px 0 rgba(255, 255, 255, 0.35), inset 0 -1px 0 rgba(0, 0, 0, 0.22), 0 0 30px rgba(100, 180, 255, 0.22); transform-origin: center; transition: box-shadow .18s ease, border-color .14s ease, opacity .18s ease; will-change: transform, left, top, width, height; touch-action: none; user-select: none; -webkit-user-select: none; }
.ar-screen.offscreen { opacity: 0; pointer-events: none; }
.ar-screen::after { position: absolute; z-index: 5; right: 8%; bottom: -6%; left: 8%; height: 10%; content: ""; background: radial-gradient(ellipse at center, rgba(0,0,0,.45), transparent 72%); filter: blur(6px); pointer-events: none; }
.ar-screen::before { position: absolute; z-index: 4; top: 0; left: 0; right: 0; height: 42%; content: ""; background: linear-gradient(160deg, rgba(255,255,255,0.18), rgba(255,255,255,0.02) 55%, transparent 100%); pointer-events: none; }
.ar-screen.grabbed { border-color: #f6fbff; box-shadow: 0 28px 55px rgba(0,0,0,.55), 0 0 0 3px rgba(69,221,255,.6), 0 0 30px rgba(69,221,255,.42); }

.screen-bar { position: relative; z-index: 2; display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 8px 0 12px; background: linear-gradient(90deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04)); backdrop-filter: blur(14px) saturate(160%); -webkit-backdrop-filter: blur(14px) saturate(160%); border-bottom: 1px solid rgba(255,255,255,0.16); cursor: grab; }
.screen-bar:active { cursor: grabbing; }
.grab-dots { color: var(--cyan); font-size: 18px; line-height: 1; transform: rotate(90deg); text-shadow: 0 0 12px rgba(69,221,255,.5); }
.screen-name { overflow: hidden; flex: 1; color: #f2faff; font-size: 11px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; text-shadow: 0 1px 2px rgba(0,0,0,.4); }
.icon-button { width: 24px; height: 24px; border: 1px solid rgba(255,255,255,.22); border-radius: 7px; background: rgba(255,255,255,.15); backdrop-filter: blur(8px); color: white; font-size: 18px; line-height: 18px; cursor: pointer; transition: background .15s; }

.screen-content { position: absolute; inset: 34px 0 0; background: #060810; overflow: hidden; border-radius: 0 0 20px 20px; }
.screen-content video { display: block; width: 100%; height: 100%; background: #05070d; object-fit: contain; }
.empty-video { position: absolute; inset: 0; display: grid; width: 100%; height: 100%; place-items: center; padding: 20px; color: #9dacbf; font-size: 12px; text-align: center; }

.screen-play { position: absolute; z-index: 6; left: 50%; top: 50%; transform: translate(-50%,-50%); width: 54px; height: 54px; border: 1px solid rgba(255,255,255,.4); border-radius: 50%; background: linear-gradient(135deg, rgba(69,221,255,.32), rgba(68,150,255,.18)); backdrop-filter: blur(16px) saturate(180%); color: #f4fbff; font-size: 22px; cursor: pointer; box-shadow: 0 8px 24px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.4), 0 0 24px rgba(69,221,255,.35); transition: opacity .25s ease, transform .15s ease; }
.screen-play[hidden] { display: none; }
.screen-play.playing { opacity: 0; pointer-events: none; }

.resize-handle { position: absolute; z-index: 3; right: 0; bottom: 0; display: grid; width: 34px; height: 34px; place-items: center; border-radius: 12px 0 20px 0; background: linear-gradient(135deg, rgba(69,221,255,.9), rgba(68,150,255,.7)); color: #081323; font-size: 17px; font-weight: 900; cursor: nwse-resize; box-shadow: inset 0 1px 0 rgba(255,255,255,.4), 0 4px 12px rgba(0,0,0,.3); }
.screen-depth { position: absolute; z-index: 3; bottom: 7px; left: 10px; padding: 3px 6px; border-radius: 5px; background: rgba(2,8,19,.6); backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,.1); color: #82def5; font-size: 7px; font-weight: 800; letter-spacing: .1em; }

/* Clavier */
.keyboard-panel { position: fixed; z-index: 90; left: 50%; bottom: 120px; transform: translateX(-50%); width: min(92vw, 560px); padding: 12px; border-radius: 18px; background: var(--glass-bg); backdrop-filter: blur(24px) saturate(180%); border: var(--glass-border); box-shadow: var(--glass-shadow); }
.keyboard-panel[hidden] { display: none; }
.kb-display { min-height: 40px; padding: 8px 12px; margin-bottom: 8px; border-radius: 10px; background: rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.15); color: #e8f4ff; font-size: 14px; font-family: monospace; outline: none; word-break: break-all; }
.kb-keys { display: grid; grid-template-columns: repeat(10, 1fr); gap: 4px; }
.kb-key { aspect-ratio: 1; border-radius: 8px; border: 1px solid rgba(255,255,255,.22); background: linear-gradient(135deg, rgba(69,221,255,.15), rgba(68,150,255,.06)); color: #f4fbff; font-size: 13px; font-weight: 700; cursor: pointer; transition: transform .12s, background .12s; }
.kb-key.hovered { background: rgba(69,221,255,.55); transform: scale(1.1); }
.kb-key.pressed { background: rgba(69,221,255,.9); color: #061424; }
.kb-key.wide { grid-column: span 2; }
.kb-close { position: absolute; top: 8px; right: 8px; width: 24px; height: 24px; border-radius: 7px; border: none; background: rgba(255,255,255,.15); color: white; cursor: pointer; }

/* Photos */
.photos-app { position: fixed; z-index: 85; inset: 10% 5%; border-radius: 22px; overflow: hidden; background: rgba(6,12,29,.85); backdrop-filter: blur(24px) saturate(180%); border: var(--glass-border); box-shadow: var(--glass-shadow); display: flex; flex-direction: column; }
.photos-app[hidden] { display: none; }
.photos-header { display: flex; gap: 8px; padding: 10px; border-bottom: 1px solid rgba(255,255,255,.12); }
.photos-header button { flex: 1; min-height: 34px; border-radius: 10px; border: 1px solid rgba(255,255,255,.2); background: rgba(255,255,255,.08); color: white; font-size: 12px; font-weight: 700; cursor: pointer; }
.photos-header button.active { background: rgba(69,221,255,.35); }
.photos-gallery { flex: 1; overflow-y: auto; padding: 10px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.photos-gallery img, .photos-gallery video { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; }
.photos-shutter { position: absolute; right: 16px; bottom: 16px; width: 54px; height: 54px; border-radius: 50%; border: 4px solid rgba(255,255,255,.9); background: radial-gradient(circle, #fff 55%, rgba(255,255,255,.4)); cursor: pointer; box-shadow: 0 4px 20px rgba(0,0,0,.5), 0 0 0 4px rgba(69,221,255,.5); }

/* Modal AR */
.ar-modal { position: fixed; z-index: 95; inset: 0; display: grid; place-items: center; background: rgba(0,0,0,.7); backdrop-filter: blur(10px); }
.ar-modal[hidden] { display: none; }
.ar-modal-card { width: min(92vw, 440px); padding: 20px; border-radius: 20px; background: var(--glass-bg); backdrop-filter: blur(24px) saturate(180%); border: var(--glass-border); box-shadow: var(--glass-shadow); }
.ar-modal-card h2 { margin: 0 0 6px; font-size: 18px; }
.ar-modal-card p { margin: 0 0 14px; color: #b0c0d5; font-size: 12px; }
.ar-modal-actions { display: flex; justify-content: flex-end; margin-top: 12px; }
.ar-modal-actions button { padding: 10px 20px; border-radius: 10px; border: none; background: rgba(255,255,255,.15); color: white; font-size: 13px; font-weight: 700; cursor: pointer; }

/* Spotify */
.spotify-modal { position: fixed; z-index: 100; inset: 0; display: grid; place-items: center; background: rgba(0,0,0,.65); backdrop-filter: blur(8px); }
.spotify-modal[hidden] { display: none; }
.spotify-card { width: min(90vw, 400px); padding: 24px; border-radius: 20px; background: var(--glass-bg); backdrop-filter: blur(28px) saturate(180%); border: var(--glass-border); box-shadow: var(--glass-shadow); }
.spotify-card h2 { margin: 0 0 8px; font-size: 20px; }
.spotify-card p { margin: 0 0 16px; color: #b0c0d5; font-size: 13px; line-height: 1.4; }
.spotify-card input { width: 100%; padding: 12px 14px; margin-bottom: 8px; border-radius: 10px; border: 1px solid rgba(255,255,255,.2); background: rgba(0,0,0,.3); color: white; font-size: 13px; }
.spotify-hint { font-size: 11px !important; color: #7a8ba3 !important; }
.spotify-hint a { color: var(--cyan); }
.spotify-actions { display: flex; gap: 10px; margin-top: 16px; }
.spotify-actions button { flex: 1; min-height: 44px; border-radius: 12px; border: none; font-size: 14px; font-weight: 700; cursor: pointer; }
.spotify-actions button:first-child { background: #1DB954; color: #000; }
.spotify-actions button:last-child { background: rgba(255,255,255,.12); color: white; }

.vr-taskbar { position: fixed; z-index: 8; display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 999px; background: var(--glass-bg); backdrop-filter: blur(28px) saturate(180%); border: var(--glass-border); box-shadow: var(--glass-shadow), 0 0 0 1px rgba(69,221,255,.08); will-change: left, top; }
.vr-taskbar[hidden] { display: none; }
.vr-btn { width: 44px; height: 44px; padding: 0; border-radius: 50%; border: 1px solid rgba(255,255,255,.32); background: linear-gradient(135deg, rgba(69,221,255,.18), rgba(68,150,255,.08)); color: #f4fbff; font-size: 18px; font-weight: 700; cursor: pointer; display: grid; place-items: center; transition: transform .22s cubic-bezier(.34,1.56,.64,1), background .15s, box-shadow .22s, border-color .15s; will-change: transform; }
.vr-btn.hovered { transform: translateY(-10px) scale(1.1); background: linear-gradient(135deg, rgba(69,221,255,.55), rgba(68,150,255,.35)); border-color: rgba(69,221,255,.9); box-shadow: 0 14px 24px rgba(0,0,0,.5), 0 0 24px rgba(69,221,255,.7); }
.vr-btn.pressed { transform: translateY(-4px) scale(.94); background: rgba(69,221,255,.95); color: #061424; }
.vr-btn.active { background: linear-gradient(135deg, rgba(220,130,255,.45), rgba(130,40,150,.35)); border-color: rgba(220,130,255,.85); box-shadow: 0 0 18px rgba(220,130,255,.6); }

.hand-cursor { --depth: .5; position: fixed; z-index: 60; width: 14px; height: 14px; margin: -7px 0 0 -7px; border: 1.5px solid rgba(180, 210, 245, .9); border-radius: 50%; box-shadow: 0 0 calc(8px + var(--depth) * 14px) rgba(160, 200, 240, .85); opacity: 0; pointer-events: none; transform: scale(calc(.72 + var(--depth) * .6)); transition: opacity .12s ease, background .08s ease, transform .08s ease; }
.hand-cursor.visible { opacity: 1; }
.hand-cursor.pinching { background: rgba(180, 210, 245, .85); transform: scale(calc(.5 + var(--depth) * .4)); }

.hint { position: fixed; z-index: 70; left: 50%; bottom: max(86px, calc(env(safe-area-inset-bottom) + 65px)); width: min(630px, calc(100vw - 32px)); margin: 0; transform: translateX(-50%); padding: 10px 15px; border-radius: 999px; background: var(--glass-bg); backdrop-filter: blur(20px) saturate(160%); border: var(--glass-border); box-shadow: var(--glass-shadow); color: #d2dceb; font-size: 12px; text-align: center; }
.action-bar { position: fixed; z-index: 70; right: max(18px, env(safe-area-inset-right)); bottom: max(18px, env(safe-area-inset-bottom)); display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.action-bar button { min-height: 44px; padding: 0 14px; border-radius: 14px; background: var(--glass-bg); backdrop-filter: blur(20px) saturate(160%); border: var(--glass-border); box-shadow: var(--glass-shadow); color: white; font-size: 13px; font-weight: 700; cursor: pointer; transition: transform .15s; }
.action-bar button:active { transform: scale(.95); }
.action-bar button:disabled { opacity: .45; cursor: default; }
.vr-button { border-color: rgba(220,130,255,.65); }
.vr-button.active { background: linear-gradient(135deg, rgba(220,130,255,.5), rgba(130,40,150,.3)); box-shadow: 0 0 22px rgba(220,130,255,.5), var(--glass-shadow); }

body.vr-mode .action-bar,
body.vr-mode .hint,
body.vr-mode .scan-hud,
body.vr-mode .orientation-pill { opacity: 0; pointer-events: none; visibility: hidden; }
body.vr-mode .controls { opacity: .35; }

@media (max-width: 600px) {
  .controls { padding: 13px 14px; } h1 { font-size: 19px; }
  .hint { bottom: max(135px, calc(env(safe-area-inset-bottom) + 110px)); font-size: 11px; }
  .action-bar { right: 14px; bottom: max(14px, env(safe-area-inset-bottom)); left: 14px; gap: 4px; }
  .action-bar button { flex: 1; min-height: 42px; padding: 0 3px; font-size: 9px; }
  .vr-btn { width: 38px; height: 38px; font-size: 15px; }
  .vr-taskbar { gap: 4px; padding: 5px 8px; }
  .game-hud { padding: 8px 16px; }
  .game-hud b { font-size: 18px; }
  .keyboard-panel { bottom: 100px; }
  .kb-key { font-size: 12px; }
}
