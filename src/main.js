// RigReady: Mud Pump Lockout. Main game: rendering, controls, procedure logic.
import * as THREE from 'three';
import PROC from './procedure.json';
import { buildWorld, canvasTex } from './world.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { initAudio, sfx, setMuted, isMuted } from './audio.js';
import { saveAttempt } from './storage.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const lowEnd = isTouch && ((navigator.hardwareConcurrency || 4) <= 4 || (navigator.deviceMemory || 4) <= 3);
document.body.classList.toggle('touch', isTouch);

// ---------- renderer / scene ----------
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch || window.devicePixelRatio < 2, powerPreference: 'high-performance', preserveDrawingBuffer: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.5 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = !lowEnd;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.05, 420);
{ const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.55; pm.dispose(); }
camera.rotation.order = 'YXZ';
const world = buildWorld(scene, { shadows: !lowEnd, shadowSize: isTouch ? 1024 : 2048, breakers: PROC.breakers, tools: PROC.tools });
const P = world.parts;
for (const k of ['beacon', 'moveMarker']) { const o = k === 'beacon' ? P.beacon.group : P.moveMarker; o.traverse((c) => { c.userData.noPick = true; }); }

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.fov = w < h ? 74 : 62; camera.updateProjectionMatrix();
  checkRotate();
}
window.addEventListener('resize', resize);

// ---------- player + controls ----------
const EYE = 1.65, SPEED = 3.4, RADIUS = 0.32;
const SPAWN = { x: 0, z: 11.2, yaw: 0.12, pitch: -0.1 };
const player = { ...SPAWN };
let mode = 'title';
let autoWalk = null, faceTween = null, shakeT = 0, bobT = 0;
const keys = {};
const joy = { x: 0, y: 0, active: false, id: null };

window.addEventListener('keydown', (e) => { if (e.target.tagName === 'INPUT') return; keys[e.code] = true; if (mode === 'play' && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault(); });
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

let look = null;
canvas.addEventListener('pointerdown', (e) => {
  if (mode !== 'play' || look) return;
  look = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false };
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
});
canvas.addEventListener('pointermove', (e) => {
  if (!look || e.pointerId !== look.id) { if (!isTouch && mode === 'play') hover(e.clientX, e.clientY); return; }
  const dx = e.clientX - look.x, dy = e.clientY - look.y; look.x = e.clientX; look.y = e.clientY;
  if (Math.hypot(e.clientX - look.sx, e.clientY - look.sy) > 9) look.moved = true;
  if (look.moved) { const k = isTouch ? 0.0065 : 0.0042; player.yaw -= dx * k; player.pitch = clamp(player.pitch - dy * k, -1.25, 0.95); faceTween = null; }
});
function endLook(e) {
  if (!look || e.pointerId !== look.id) return;
  const quick = performance.now() - look.t < 450;
  if (!look.moved && quick && mode === 'play') tap(e.clientX, e.clientY);
  look = null;
}
canvas.addEventListener('pointerup', endLook);
canvas.addEventListener('pointercancel', (e) => { if (look && e.pointerId === look.id) look = null; });

const joyEl = $('joy'), knob = $('joyKnob');
joyEl.addEventListener('pointerdown', (e) => { joy.active = true; joy.id = e.pointerId; joyEl.setPointerCapture(e.pointerId); moveJoy(e); e.preventDefault(); });
joyEl.addEventListener('pointermove', (e) => { if (joy.active && e.pointerId === joy.id) moveJoy(e); });
const joyEnd = (e) => { if (e.pointerId !== joy.id) return; joy.active = false; joy.x = joy.y = 0; knob.style.transform = 'translate(-50%,-50%)'; };
joyEl.addEventListener('pointerup', joyEnd); joyEl.addEventListener('pointercancel', joyEnd);
function moveJoy(e) {
  const r = joyEl.getBoundingClientRect(); const R = r.width / 2;
  let dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R); const d = Math.hypot(dx, dy);
  if (d > R * 0.8) { dx *= R * 0.8 / d; dy *= R * 0.8 / d; }
  joy.x = dx / (R * 0.8); joy.y = dy / (R * 0.8);
  knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
}

const raycaster = new THREE.Raycaster(); const ndc = new THREE.Vector2();
function visibleChain(o) { while (o) { if (!o.visible) return false; o = o.parent; } return true; }
function pick(cx, cy) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(scene.children, true);
  for (const h of hits) {
    if (h.object.isSprite || h.object.isInstancedMesh && false) continue;
    if (h.object.userData.noPick || !visibleChain(h.object)) continue;
    if (h.object === P.floor) return { floor: h.point };
    let o = h.object; while (o && !o.userData.iid) o = o.parent;
    if (o) return { iid: o.userData.iid, point: h.point, dist: h.distance };
    if (h.distance < 60) return { blocked: true, point: h.point };
  }
  return null;
}
let hoverT = 0;
function hover(cx, cy) {
  const now = performance.now(); if (now - hoverT < 70) return; hoverT = now;
  const p = pick(cx, cy); const tip = $('tip');
  if (p && p.iid) { const e = world.byId[p.iid]; canvas.style.cursor = 'pointer'; tip.textContent = e.name; tip.style.left = cx + 'px'; tip.style.top = cy + 'px'; tip.hidden = false; }
  else { canvas.style.cursor = p && p.floor ? 'crosshair' : 'grab'; tip.hidden = true; }
}

function tap(cx, cy) {
  if (G && G.busy) return;
  const p = pick(cx, cy);
  if (!p) return;
  if (p.floor) { walkTo(p.floor.x, p.floor.z); P.moveMarker.position.set(p.floor.x, 0.03, p.floor.z); P.moveMarker.visible = true; return; }
  if (!p.iid) return;
  const e = world.byId[p.iid];
  const st = world.stations[e.station];
  const wp = new THREE.Box3().setFromObject(e.obj).getCenter(new THREE.Vector3());
  const dist = Math.hypot(wp.x - player.x, wp.z - player.z);
  if (dist > 3.6 && st) { sfx.click(); walkTo(st.stand[0], st.stand[1], st.look); return; }
  interact(p.iid);
}

function walkTo(x, z, lookAt = null, then = null) { autoWalk = { x, z, lookAt, then, stuck: 0 }; faceTween = null; }
function faceTowards(v, dur = 0.55) {
  const dx = v.x - player.x, dz = v.z - player.z, dy = v.y - EYE;
  let toYaw = Math.atan2(-dx, -dz); const toPitch = Math.atan2(dy, Math.hypot(dx, dz));
  let d = toYaw - player.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
  faceTween = { fy: player.yaw, ty: player.yaw + d, fp: player.pitch, tp: toPitch, t: 0, dur };
}
function goToStation(id) { const st = world.stations[id]; player.x = st.stand[0]; player.z = st.stand[1]; autoWalk = null; faceTween = null; const dx = st.look.x - player.x, dz = st.look.z - player.z; player.yaw = Math.atan2(-dx, -dz); player.pitch = Math.atan2(st.look.y - EYE, Math.hypot(dx, dz)); }

function collide() {
  for (const o of world.obstacles) {
    const minX = o.minX - RADIUS, maxX = o.maxX + RADIUS, minZ = o.minZ - RADIUS, maxZ = o.maxZ + RADIUS;
    if (player.x > minX && player.x < maxX && player.z > minZ && player.z < maxZ) {
      const dl = player.x - minX, dr = maxX - player.x, dn = player.z - minZ, ds = maxZ - player.z;
      const m = Math.min(dl, dr, dn, ds);
      if (m === dl) player.x = minX; else if (m === dr) player.x = maxX; else if (m === dn) player.z = minZ; else player.z = maxZ;
    }
  }
  player.x = clamp(player.x, -19.5, 19.5); player.z = clamp(player.z, -13.5, 13.5);
}

function updatePlayer(dt) {
  let f = 0, s = 0, turn = 0;
  if (mode === 'play' && !(G && G.busy)) {
    if (keys.KeyW || keys.ArrowUp) f += 1; if (keys.KeyS || keys.ArrowDown) f -= 1;
    if (keys.KeyA) s -= 1; if (keys.KeyD) s += 1;
    if (keys.ArrowLeft || keys.KeyQ) turn += 1; if (keys.ArrowRight || keys.KeyE) turn -= 1;
    if (joy.active) { f -= joy.y; s += joy.x; }
  }
  if (turn) { player.yaw += turn * dt * 1.9; faceTween = null; }
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw), rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
  let vx = 0, vz = 0;
  if (Math.abs(f) > 0.08 || Math.abs(s) > 0.08) {
    if (autoWalk) { autoWalk = null; P.moveMarker.visible = false; }
    faceTween = null;
    const len = Math.max(1, Math.hypot(f, s)); vx = (fx * f + rx * s) / len * SPEED; vz = (fz * f + rz * s) / len * SPEED;
  } else if (autoWalk && mode === 'play') {
    const dx = autoWalk.x - player.x, dz = autoWalk.z - player.z, d = Math.hypot(dx, dz);
    if (d < 0.08) arrive();
    else {
      const sp = Math.min(SPEED, d / dt); vx = dx / d * sp; vz = dz / d * sp;
      let ty = Math.atan2(-dx, -dz), dd = Math.atan2(Math.sin(ty - player.yaw), Math.cos(ty - player.yaw));
      if (d > 0.6) player.yaw += dd * Math.min(1, dt * 5);
    }
  }
  const ox = player.x, oz = player.z;
  player.x += vx * dt; player.z += vz * dt; collide();
  const moved = Math.hypot(player.x - ox, player.z - oz);
  if (autoWalk && (vx || vz)) { if (moved < SPEED * dt * 0.15) { autoWalk.stuck += dt; if (autoWalk.stuck > 0.45) arrive(); } else autoWalk.stuck = 0; }
  if (moved > 0.001) bobT += moved * 2.6;
  if (faceTween) {
    faceTween.t += dt; const k = clamp(faceTween.t / faceTween.dur, 0, 1); const e = k * k * (3 - 2 * k);
    player.yaw = faceTween.fy + (faceTween.ty - faceTween.fy) * e; player.pitch = faceTween.fp + (faceTween.tp - faceTween.fp) * e;
    if (k >= 1) faceTween = null;
  }
}
function arrive() {
  const a = autoWalk; autoWalk = null; P.moveMarker.visible = false;
  if (a.lookAt) faceTowards(a.lookAt);
  if (a.then) a.then();
}

let titleT = 0;
function updateCamera(dt) {
  if (mode === 'title') {
    titleT += dt * 0.06;
    camera.position.set(2 + Math.sin(titleT) * 18, 11, -1 + Math.cos(titleT) * 13);
    camera.lookAt(2, 0.5, -2.5);
    return;
  }
  const bob = Math.sin(bobT) * 0.025;
  camera.position.set(player.x, EYE + bob, player.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
  if (shakeT > 0) { shakeT -= dt; const a = Math.min(1, shakeT) * 0.09; camera.position.x += (Math.random() - 0.5) * a; camera.position.y += (Math.random() - 0.5) * a; camera.rotation.z = (Math.random() - 0.5) * a * 0.6; }
}

// ---------- tweens ----------
const tweens = [];
function tween(dur, fn, done) { tweens.push({ t: 0, dur, fn, done }); }
function updateTweens(dt) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i]; tw.t += dt; const k = clamp(tw.t / tw.dur, 0, 1); tw.fn(k);
    if (k >= 1) { tweens.splice(i, 1); tw.done && tw.done(); }
  }
}
const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
const anim = (dur, fn) => new Promise((r) => tween(dur, fn, r));
const wait = (s) => anim(s, () => {});
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------- attempt state ----------
const STEP = Object.fromEntries(PROC.steps.map((s) => [s.id, s]));
let G = null;
function freshState() {
  return {
    done: [], ppe: [], tools: [], breakers: Object.fromEntries(PROC.breakers.map((b) => [b.id, 'on'])), locked: false,
    suction: 'open', discharge: 'open', bleed: 'closed', pressure: 3000, cover: 'on', oldLiner: 'in', newLiner: 'stand',
    toolsOut: false, trayCleared: false, permit: 'none', distractor: 'none', pump1: 'off',
  };
}
const isDone = (id) => G.state.done.includes(id);
const elapsed = () => (performance.now() - G.start) / 1000;
const cap = (s) => s[0].toUpperCase() + s.slice(1);

// ---------- textures that show state ----------
function drawPermit(status) {
  const t = P.permitTex, c = t.userData.canvas, g = t.userData.ctx, w = c.width, h = c.height;
  g.fillStyle = '#b98d5a'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(80,50,20,${Math.random() * 0.25})`; g.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
  g.save(); g.translate(60, 26); g.rotate(-0.02);
  g.fillStyle = '#fbfbf6'; g.fillRect(0, 0, 300, 310);
  g.fillStyle = '#1d4f7a'; g.fillRect(0, 0, 300, 46);
  g.fillStyle = '#fff'; g.font = 'bold 26px system-ui'; g.fillText('PERMIT TO WORK', 16, 32);
  g.fillStyle = '#333'; g.font = 'bold 18px system-ui'; g.fillText(PROC.permit.number + '  Mud Pump 1', 16, 78);
  g.font = '16px system-ui';
  for (let i = 0; i < 9; i++) { g.fillStyle = '#c9ccd1'; g.fillRect(16, 100 + i * 20, 200 + (i * 37) % 70, 6); }
  g.restore();
  const stamp = { none: ['AWAITING', 'SIGNATURE', '#8a8f96'], signed: ['ISSUED', 'SIGNED', '#1f8a4c'], closed: ['CLOSED', 'JOB DONE', '#1d4f7a'] }[status];
  g.save(); g.translate(400, 200); g.rotate(-0.25);
  g.strokeStyle = stamp[2]; g.lineWidth = 8; g.strokeRect(-95, -50, 190, 100);
  g.fillStyle = stamp[2]; g.textAlign = 'center'; g.font = 'bold 34px system-ui'; g.fillText(stamp[0], 0, -6); g.font = 'bold 22px system-ui'; g.fillText(stamp[1], 0, 26);
  g.restore();
  t.needsUpdate = true;
}
function drawTag(name) {
  const t = P.tagTex, c = t.userData.canvas, g = t.userData.ctx, w = c.width, h = c.height;
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#c0392b'; g.fillRect(0, 0, w, 120);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = 'bold 44px system-ui'; g.fillText('DANGER', w / 2, 74);
  g.fillStyle = '#111'; g.font = 'bold 30px system-ui'; g.fillText('DO NOT', w / 2, 170); g.fillText('OPERATE', w / 2, 206);
  g.font = '22px system-ui'; g.fillText('Locked by', w / 2, 262);
  g.font = 'bold 30px system-ui'; g.fillText(name.slice(0, 11), w / 2, 300);
  g.beginPath(); g.arc(w / 2, 335, 10, 0, 7); g.stroke();
  t.needsUpdate = true;
}

function setNeedle(p) { const a0 = Math.PI * 0.75, span = Math.PI * 1.5; P.needle.rotation.x = a0 + span * clamp(p, 0, 5000) / 5000 + Math.PI / 2; }
function setLamp(id) { const b = P.breakers[id]; const on = G.state.breakers[id] === 'on'; b.lamp.material.emissive.set(on ? '#22ff66' : '#ff3322'); b.lamp.material.emissiveIntensity = 1.4; }
function setHandle(id) { P.breakers[id].handle.rotation.x = G.state.breakers[id] === 'on' ? 0 : Math.PI / 2; setLamp(id); }

function applyState() {
  const S = G.state;
  for (const p of PROC.ppe) { const o = P.ppe[p.id]; if (o) { o.visible = !S.ppe.includes(p.id); o.scale.setScalar(1); } }
  for (const t of PROC.tools) { const o = P.tools[t.id]; o.obj.visible = !S.tools.includes(t.id) || S.trayCleared; o.obj.position.copy(o.home); o.obj.scale.setScalar(1); o.obj.rotation.set(0, 0, 0); }
  P.toolTray.visible = S.toolsOut && !S.trayCleared;
  for (const id of Object.keys(P.breakers)) setHandle(id);
  P.pump2Speed = S.breakers.mp2 === 'on' ? 1 : 0;
  P.pump1Speed = S.pump1 === 'on' ? 1 : 0;
  P.hasp.visible = S.breakers.mp1 === 'off';
  P.haspGlow.visible = S.breakers.mp1 === 'off' && !S.locked;
  P.lock.visible = S.locked; P.lock.position.copy(P.lockHome); P.lock.scale.setScalar(1); P.lock.rotation.set(0, 0, 0);
  P.shackle.position.y = 0; P.tagPivot.rotation.x = 0;
  P.valves.suction.rotation.y = 0; P.valves.discharge.rotation.x = 0;
  P.bleedLever.rotation.x = S.bleed === 'open' ? Math.PI / 2 : 0;
  setNeedle(S.pressure);
  const cv = P.pump1.covers[1];
  if (S.cover === 'on') { cv.position.copy(P.coverHome); cv.rotation.set(0, 0, 0); } else { cv.position.copy(P.coverAside); cv.rotation.set(0, 0, -Math.PI / 2); }
  const ol = P.oldLiner, nl = P.newLiner;
  ol.visible = true; ol.rotation.set(0, 0, 0);
  if (S.oldLiner === 'in') ol.position.copy(P.linerIn);
  else if (S.oldLiner === 'mat') { ol.position.copy(P.linerMat); ol.rotation.y = Math.PI / 2; }
  else { ol.position.copy(P.linerBin); ol.rotation.set(0.5, 0.3, 0.9); }
  nl.rotation.set(0, 0, 0);
  nl.position.copy(S.newLiner === 'in' ? P.linerIn : P.linerStand);
  if (S.oldLiner === 'in' && S.newLiner === 'in') ol.visible = false;
  drawPermit(S.permit);
  P.npc.visible = S.distractor === 'pending';
  updateHUD();
}

// ---------- HUD ----------
function toast(msg, kind = 'info', ms = 3400) {
  const box = $('toasts');
  const el = document.createElement('div'); el.className = 'toast ' + kind; el.textContent = msg;
  box.prepend(el);
  while (box.children.length > 3) box.lastChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, ms);
}
function info(msg) { toast(msg, 'info'); sfx.click(); }
function flash(kind) { const f = $('flash'); f.className = ''; void f.offsetWidth; f.className = kind; }

function currentStep() { return PROC.steps.find((s) => !isDone(s.id) && !s.hidden); }
function inAssessment() { return G.mode === 'assess' && isDone('visit_muster') && isDone('visit_pump') && isDone('visit_mcc'); }

function highlightsFor(step) {
  const S = G.state; if (!step) return [];
  const v = (k) => 'valve_' + k;
  switch (step.id) {
    case 'visit_muster': return ['muster_sign'];
    case 'permit': case 'close_permit': return ['permit_board'];
    case 'ppe': return PROC.ppe.filter((p) => !S.ppe.includes(p.id)).map((p) => 'ppe_' + p.id);
    case 'breaker_off': return PROC.breakers.map((b) => 'breaker_' + b.id);
    case 'lock': return ['hasp_mp1'];
    case 'valves': return ['suction', 'discharge'].filter((k) => S[k] === 'open').map(v);
    case 'bleed': return ['bleed'];
    case 'verify': case 'test_run': return ['start_btn'];
    case 'tools': return PROC.tools.filter((t) => !S.tools.includes(t.id)).map((t) => 'tool_' + t.id);
    case 'open_cover': case 'close_cover': return ['cover2'];
    case 'remove_old': return ['liner_old'];
    case 'fit_new': return ['liner_new'];
    case 'clear': return [!S.trayCleared && 'tool_tray', S.oldLiner === 'mat' && 'liner_old'].filter(Boolean);
    case 'restore_valves': return S.bleed === 'open' ? ['bleed'] : ['suction', 'discharge'].filter((k) => S[k] === 'closed').map(v);
    case 'unlock': return ['lock_mp1'];
    case 'breaker_on': return ['breaker_mp1'];
    default: return [];
  }
}
let beaconTarget = null;
function updateGuides() {
  const step = currentStep();
  const guided = G && !inAssessment() && mode === 'play';
  const hl = guided ? highlightsFor(step) : [];
  world.setHighlights(hl);
  beaconTarget = null;
  if (guided && step) {
    if (step.visit || !hl.length) beaconTarget = world.stations[step.target].center.clone();
    else { const e = world.byId[hl[0]]; beaconTarget = new THREE.Box3().setFromObject(e.obj).getCenter(new THREE.Vector3()); }
  }
  P.beacon.group.visible = !!beaconTarget;
  if (beaconTarget) { P.beacon.group.position.set(beaconTarget.x, 0, beaconTarget.z); P.beacon.y = Math.max(2.4, beaconTarget.y + 0.8); }
}

function updateHUD() {
  if (!G) return;
  const S = G.state; const step = currentStep();
  const visible = PROC.steps.filter((s) => !s.hidden);
  const doneN = visible.filter((s) => isDone(s.id)).length;
  $('phase').textContent = step ? step.phase : 'Done';
  if (inAssessment()) { $('objTitle').textContent = 'Assessment: do the job safely'; $('objHint').textContent = 'No hints from here. ' + PROC.job; }
  else { $('objTitle').textContent = step ? step.title : 'Job complete'; $('objHint').textContent = step ? step.hint : ''; }
  $('objCount').textContent = `${doneN} / ${visible.length}`;
  $('objBar').style.width = (100 * doneN / visible.length) + '%';
  const list = $('objList'); list.innerHTML = '';
  for (const s of visible) {
    const li = document.createElement('li');
    const d = isDone(s.id); const hidden = inAssessment() && !d;
    li.className = d ? 'done' : (s === step && !inAssessment() ? 'now' : '');
    li.textContent = hidden ? '? ? ?' : s.title; list.appendChild(li);
  }
  $('mistakes').textContent = G.mistakes; $('incidents').textContent = G.incidents;
  document.querySelectorAll('#ppeBar [data-ppe]').forEach((el) => el.classList.toggle('on', S.ppe.includes(el.dataset.ppe)));
  const tb = $('toolBar'); tb.innerHTML = '';
  PROC.tools.filter((t) => t.correct).forEach((t) => { const d = document.createElement('span'); d.className = 'chip' + (S.tools.includes(t.id) && !S.trayCleared ? ' on' : ''); d.textContent = '🔧'; d.title = t.label; tb.appendChild(d); });
  updateGuides();
}

// ---------- procedure engine ----------
function recordMistake(key, check, message) {
  sfx.error();
  if (G.counted.has(key)) { toast(message, 'warn'); return; }
  G.counted.add(key); G.mistakes++;
  G.events.push({ type: 'mistake', check: check || null, message, t: Math.round(elapsed()) });
  toast(message, 'bad', 5200); flash('warn'); updateHUD();
}
function attempt(id, perform, opts = {}) {
  if (G.busy) return false;
  const step = STEP[id];
  const missing = (step.requires || []).filter((r) => !isDone(r.step));
  const block = missing.find((r) => r.outcome === 'block');
  if (block) {
    if (block.check) recordMistake(id + ':' + block.step, block.check, block.message);
    else { toast(block.message, 'warn', 4200); sfx.error(); }
    return false;
  }
  const inc = missing.find((r) => r.outcome === 'incident');
  if (inc) { incident(inc.incident, inc.check, opts.prelude); return false; }
  for (const r of missing.filter((r) => r.outcome === 'mistake')) {
    recordMistake(id + ':' + r.step, r.check, r.message);
    if (r.effect === 'pump_runs') { pumpRunsBriefly(); return false; }
  }
  perform();
  return true;
}
function complete(id) {
  if (isDone(id)) return;
  G.state.done.push(id);
  const s = STEP[id];
  if (!s.hidden) { toast('✓ ' + s.title, 'good', 2600); sfx.ok(); }
  updateHUD();
  if (id === 'remove_old') wait(1.0).then(() => { if (G && !G.finished && G.state.distractor === 'none') startDistractor(); });
  if (id === 'close_permit') finish();
}

async function pumpRunsBriefly() {
  G.busy = true; pressStart(); sfx.pumpStart(); shakeT = 0.5;
  await anim(0.6, (k) => { P.pump1Speed = k; });
  await wait(1.6);
  await anim(0.8, (k) => { P.pump1Speed = 1 - k; });
  P.pump1Speed = 0; G.busy = false;
}

// incidents
const spray = (() => {
  const N = 260, geo = new THREE.BufferGeometry(); const pos = new Float32Array(N * 3); const vel = [];
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#5a3d22', size: 0.07, transparent: true, opacity: 0.95 }));
  pts.visible = false; pts.userData.noPick = true; pts.frustumCulled = false; scene.add(pts);
  let life = 0;
  return {
    fire(o) { life = 1.8; pts.visible = true; vel.length = 0; for (let i = 0; i < N; i++) { pos.set([o.x, o.y, o.z], i * 3); vel.push(V3(-2 - Math.random() * 5, Math.random() * 3.5, (Math.random() - 0.5) * 4)); } },
    update(dt) { if (!pts.visible) return; life -= dt; for (let i = 0; i < N; i++) { const v = vel[i]; v.y -= 9.8 * dt; pos[i * 3] += v.x * dt; pos[i * 3 + 1] = Math.max(0.02, pos[i * 3 + 1] + v.y * dt); pos[i * 3 + 2] += v.z * dt; } geo.attributes.position.needsUpdate = true; if (life <= 0) pts.visible = false; },
    hide() { pts.visible = false; },
  };
})();

async function incident(kind, check, prelude) {
  G.busy = true;
  G.snapshot = JSON.parse(JSON.stringify(G.state));
  G.incidents++;
  G.events.push({ type: 'incident', check: check || null, kind, message: PROC.incidents[kind].title, t: Math.round(elapsed()) });
  updateHUD();
  world.setHighlights([]); P.beacon.group.visible = false;
  if (prelude) await prelude();
  await wait(0.4);
  if (kind === 'no_bleed') {
    sfx.burst(); spray.fire(P.coverHome.clone().add(V3(-0.2, 0, 0)));
    const cv = P.pump1.covers[1]; const from = cv.position.clone();
    tween(0.5, (k) => { cv.position.set(from.x - k * 3, from.y + Math.sin(k * Math.PI) * 0.8, from.z + k * 0.6); cv.rotation.z = k * 6; });
    shakeT = 1.2; flash('red');
  } else {
    sfx.pumpStart(); shakeT = 1.4;
    tween(0.4, (k) => { P.pump1Speed = k * 2.4; });
    await wait(0.3); flash('red');
  }
  sfx.alarm(2.4);
  await wait(1.7);
  showIncidentCard(kind);
}
function showIncidentCard(kind) {
  const inc = PROC.incidents[kind];
  mode = 'incident';
  $('incTitle').textContent = inc.title;
  $('incWhat').textContent = inc.what;
  $('incLesson').textContent = inc.lesson;
  if (inc.source === 'iadc') { $('incRealLabel').textContent = 'This really happened'; $('incReal').textContent = PROC.incidentSource.plain; $('incSrc').textContent = PROC.incidentSource.title; $('incSrc').href = PROC.incidentSource.url; $('incSrc').hidden = false; }
  else { $('incRealLabel').textContent = 'The rule'; $('incReal').textContent = PROC.iogp.plain; $('incSrc').textContent = PROC.iogp.title; $('incSrc').removeAttribute('href'); $('incSrc').hidden = false; }
  $('incident').hidden = false;
  P.pump1Speed = 0.0;
}
$('incRetry').addEventListener('click', () => {
  sfx.click();
  $('incident').hidden = true;
  tweens.length = 0; spray.hide();
  G.state = G.snapshot; G.snapshot = null; G.busy = false; mode = 'play';
  applyState();
  if (G.state.distractor === 'pending') { placeNpc(); showDistractor(); }
  else toast('Rewound to just before the incident. Do it safely this time.', 'info', 4000);
});

// ---------- interactions ----------
function interact(iid) {
  if (!G || G.busy || mode !== 'play') return;
  const S = G.state;
  if (iid === 'tool_tray') return doTray();
  if (iid.startsWith('ppe_')) return doPPE(iid.slice(4));
  if (iid.startsWith('tool_')) return doTool(iid.slice(5));
  if (iid.startsWith('breaker_')) return doBreaker(iid.slice(8));
  switch (iid) {
    case 'muster_sign': return info('Muster Point 1. If the alarm sounds: stop work, make safe, come here and wait for the headcount.');
    case 'permit_board': return doPermitBoard();
    case 'hasp_mp1': return attempt('lock', applyLock);
    case 'lock_mp1': return doLockTap();
    case 'valve_suction': return doValve('suction');
    case 'valve_discharge': return doValve('discharge');
    case 'bleed': return doBleed();
    case 'gauge': return info(`Discharge pressure: ${Math.round(S.pressure)} psi. ` + (S.pressure > 1 ? 'The line is live.' : 'Zero pressure.'));
    case 'start_btn': return doStart();
    case 'cover1': case 'cover3': return info('Wrong module. The job card says module #2, the middle one.');
    case 'cover2': return doCover();
    case 'liner_old': return doOldLiner();
    case 'liner_new': return attempt('fit_new', fitNew);
    case 'pump2': return info('Mud Pump 2 is in service and keeps drilling going. Leave it running. Your job is Pump 1.');
  }
}

function doPPE(id) {
  const S = G.state; if (S.ppe.includes(id)) return;
  S.ppe.push(id); sfx.equip();
  const o = P.ppe[id]; const y0 = o.position.y;
  tween(0.35, (k) => { o.position.y = y0 + k * 0.3; o.scale.setScalar(1 - k); }, () => { o.visible = false; o.position.y = y0; });
  const def = PROC.ppe.find((p) => p.id === id);
  toast(def.label + ' on', 'info', 1600); updateHUD();
  if (PROC.ppe.every((p) => S.ppe.includes(p.id))) complete('ppe');
}

function doTool(id) {
  const S = G.state; const def = PROC.tools.find((t) => t.id === id);
  if (S.tools.includes(id)) return info(def.label + ' is already in your tray.');
  const o = P.tools[id].obj;
  if (!def.correct) {
    recordMistake('tool:' + id, 'tools', def.why);
    tween(0.5, (k) => { o.rotation.z = Math.sin(k * 20) * 0.12 * (1 - k); });
    return;
  }
  S.tools.push(id); sfx.equip();
  tween(0.35, (k) => { o.position.z = P.tools[id].home.z + k * 0.4; o.scale.setScalar(1 - k * 0.9); }, () => { o.visible = false; });
  toast(def.label + ' in your tray', 'info', 1800); updateHUD();
  if (PROC.tools.filter((t) => t.correct).every((t) => S.tools.includes(t.id))) { S.toolsOut = true; P.toolTray.visible = true; complete('tools'); }
}

async function doBreaker(id) {
  const S = G.state, b = S.breakers;
  if (id !== 'mp1') {
    if (b[id] !== 'on') return;
    const def = PROC.breakers.find((x) => x.id === id);
    b[id] = 'off'; flipHandle(id); sfx.clack(); if (id === 'mp2') P.pump2Speed = 0;
    recordMistake('breaker:' + id, 'right_breaker', def.why);
    G.busy = true; await wait(1.5); b[id] = 'on'; flipHandle(id); sfx.clack(); if (id === 'mp2') P.pump2Speed = 1; G.busy = false;
    return;
  }
  if (b.mp1 === 'on') {
    if (!isDone('breaker_off')) return attempt('breaker_off', () => { b.mp1 = 'off'; flipHandle('mp1'); sfx.clack(); P.hasp.visible = true; P.haspGlow.visible = true; complete('breaker_off'); });
    return info('Pump 1 has power.');
  }
  if (S.locked) return info('Locked out with your padlock and tag. Nobody can switch it on.');
  if (isDone('unlock')) return attempt('breaker_on', () => { b.mp1 = 'on'; flipHandle('mp1'); sfx.clack(); P.hasp.visible = false; complete('breaker_on'); });
  return info('Breaker is OFF. Now put your padlock on the hasp so nobody can switch it back on.');
}
function flipHandle(id) {
  const h = P.breakers[id].handle; const from = h.rotation.x; const to = G.state.breakers[id] === 'on' ? 0 : Math.PI / 2;
  tween(0.18, (k) => { h.rotation.x = from + (to - from) * ease(k); }); setLamp(id);
}

async function applyLock() {
  const S = G.state; G.busy = true; S.locked = true;
  P.haspGlow.visible = false;
  const L = P.lock; L.visible = true;
  const home = P.lockHome; const from = home.clone().add(V3(-0.5, -0.3, 0.15));
  P.shackle.position.y = 0.05; P.tagPivot.rotation.x = 0;
  await anim(0.6, (k) => { const e = ease(k); L.position.lerpVectors(from, home, e); L.scale.setScalar(0.5 + 0.5 * e); L.rotation.x = (1 - e) * 1.2; });
  await anim(0.1, (k) => { P.shackle.position.y = 0.05 * (1 - k); });
  sfx.lockSnap(); shakeT = 0.15;
  tween(1.8, (k) => { P.tagPivot.rotation.x = Math.sin(k * 20) * 0.45 * (1 - k); });
  G.busy = false;
  complete('lock');
  toast(`Your tag reads: DANGER, DO NOT OPERATE. Locked by ${G.name}.`, 'info', 3600);
}
async function removeLockAnim() {
  const L = P.lock; const home = P.lockHome.clone();
  await anim(0.12, (k) => { P.shackle.position.y = 0.05 * k; }); sfx.lockSnap();
  await anim(0.5, (k) => { L.position.set(home.x - 0.4 * k, home.y - 0.3 * k, home.z); L.scale.setScalar(1 - 0.7 * k); });
  L.visible = false;
}
function doLockTap() {
  const S = G.state; if (!S.locked) return;
  if (!isDone('open_cover')) return info('Your lock stays on until the job is finished and the pump is closed up.');
  attempt('unlock', async () => {
    G.busy = true; await removeLockAnim(); S.locked = false; P.haspGlow.visible = false; G.busy = false; complete('unlock');
  }, { prelude: async () => { toast('You take your lock off the breaker...', 'info', 2000); await removeLockAnim(); } });
}

function spinValve(k, dir) {
  sfx.ratchet(); const w = P.valves[k];
  if (k === 'suction') { const r0 = w.rotation.y; tween(0.8, (t) => { w.rotation.y = r0 + dir * t * Math.PI * 4; }); }
  else { const r0 = w.rotation.x; tween(0.8, (t) => { w.rotation.x = r0 + dir * t * Math.PI * 4; }); }
}
function doValve(k) {
  const S = G.state;
  if (!isDone('close_cover')) {
    if (S[k] === 'closed') return info(`${cap(k)} valve is closed. Keep it closed until the pump is boxed up.`);
    return attempt('valves', () => {
      S[k] = 'closed'; spinValve(k, 1);
      if (S.suction === 'closed' && S.discharge === 'closed') complete('valves');
      else { toast(`${cap(k)} valve closed. Now the other one.`, 'info', 2200); updateHUD(); }
    });
  }
  if (S[k] === 'open') return info(`${cap(k)} valve is open.`);
  if (S.bleed === 'open') { toast('Close the bleed valve first, or mud sprays out of the bleed line.', 'warn'); sfx.error(); return; }
  attempt('restore_valves', () => { S[k] = 'open'; spinValve(k, -1); checkRestore(); });
}
function checkRestore() {
  const S = G.state;
  if (S.discharge === 'open' && S.pressure < 1) { const p0 = S.pressure; tween(1.4, (k) => { S.pressure = p0 + (3000 - p0) * k; setNeedle(S.pressure); }); }
  if (S.suction === 'open' && S.discharge === 'open' && S.bleed === 'closed') complete('restore_valves');
  else updateHUD();
}
function doBleed() {
  const S = G.state;
  if (!isDone('close_cover')) {
    if (S.bleed === 'open') return info('The bleed is open. Leave it open while you work so pressure cannot build up.');
    return attempt('bleed', async () => {
      G.busy = true; S.bleed = 'open';
      const L = P.bleedLever; tween(0.3, (k) => { L.rotation.x = k * Math.PI / 2; });
      sfx.hiss(2.6); const p0 = S.pressure;
      await anim(2.6, (k) => { S.pressure = p0 * Math.pow(1 - k, 1.6); setNeedle(S.pressure); });
      S.pressure = 0; setNeedle(0); G.busy = false;
      complete('bleed'); toast('Gauge reads 0 psi. Zero energy in the line.', 'info', 2600);
    });
  }
  if (S.bleed === 'closed') return info('The bleed valve is closed.');
  attempt('restore_valves', () => {
    S.bleed = 'closed'; const L = P.bleedLever; tween(0.3, (k) => { L.rotation.x = (1 - k) * Math.PI / 2; }); sfx.click();
    checkRestore(); if (!isDone('restore_valves')) toast('Bleed closed. Now open suction and discharge.', 'info', 2400);
  });
}
function pressStart() { const b = P.startBtn; tween(0.25, (k) => { b.position.x = -0.1 + Math.sin(k * Math.PI) * 0.02; }); sfx.click(); }
function doStart() {
  const S = G.state;
  if (!isDone('verify')) {
    if (S.breakers.mp1 === 'off' && !S.locked) { pressStart(); recordMistake('verify:unlocked', 'own_lock', 'Nothing happens, but the breaker is not locked. Anyone could switch it back on while you work. Lock it first.'); return; }
    return attempt('verify', async () => {
      G.busy = true; pressStart(); await wait(0.5); sfx.thunk(); await wait(0.5);
      G.busy = false; complete('verify'); toast('Nothing happens. Isolation verified.', 'good', 2600);
    });
  }
  if (isDone('close_cover') && !isDone('test_run')) {
    return attempt('test_run', async () => {
      G.busy = true; pressStart(); sfx.pumpStart(); S.pump1 = 'on';
      await anim(1.2, (k) => { P.pump1Speed = k; });
      G.busy = false; complete('test_run'); toast('Pump 1 is running smoothly. No leaks at module #2.', 'good', 3000);
    });
  }
  if (S.pump1 === 'on') return info('Pump 1 is running.');
  pressStart(); info('Still isolated. Nothing happens.');
}

async function openCoverAnim() {
  const cv = P.pump1.covers[1]; const h = P.coverHome;
  sfx.ratchet();
  await anim(0.9, (k) => { cv.position.set(h.x - 0.18 * k, h.y, h.z); cv.rotation.x = -k * Math.PI * 3; });
  const a = cv.position.clone();
  await anim(0.7, (k) => { const e = ease(k); cv.position.lerpVectors(a, P.coverAside, e); cv.position.y += Math.sin(k * Math.PI) * 0.25; cv.rotation.set(0, 0, -e * Math.PI / 2); });
  sfx.thunk();
}
function doCover() {
  const S = G.state;
  if (S.cover === 'on') {
    if (isDone('close_cover')) return info('The cover is back on and torqued up.');
    return attempt('open_cover', async () => { G.busy = true; S.cover = 'off'; await openCoverAnim(); G.busy = false; complete('open_cover'); }, { prelude: openCoverAnim });
  }
  if (S.newLiner !== 'in') return info(S.oldLiner === 'in' ? 'Pull the worn liner out first.' : 'Fit the new liner before you close up.');
  attempt('close_cover', async () => {
    G.busy = true; const cv = P.pump1.covers[1]; const a = cv.position.clone(); const h = P.coverHome;
    const pre = V3(h.x - 0.18, h.y, h.z);
    await anim(0.7, (k) => { const e = ease(k); cv.position.lerpVectors(a, pre, e); cv.position.y += Math.sin(k * Math.PI) * 0.25; cv.rotation.set(0, 0, -(1 - e) * Math.PI / 2); });
    sfx.ratchet();
    await anim(0.9, (k) => { cv.position.set(pre.x + 0.18 * k, h.y, h.z); cv.rotation.x = k * Math.PI * 3; });
    cv.rotation.set(0, 0, 0); sfx.thunk(); S.cover = 'on'; G.busy = false; complete('close_cover');
  });
}
function doOldLiner() {
  const S = G.state;
  if (S.oldLiner === 'in') { if (S.cover === 'on') return info('The module cover is still on.'); return attempt('remove_old', removeOld); }
  if (S.oldLiner === 'mat') { if (!isDone('close_cover')) return info('Leave it on the mat for now. It goes in the scrap bin when you clear up.'); return attempt('clear', binOld); }
}
async function removeOld() {
  const S = G.state, L = P.oldLiner; G.busy = true; sfx.slide();
  await anim(0.9, (k) => { L.position.lerpVectors(P.linerIn, P.linerOut, ease(k)); });
  await anim(0.7, (k) => { const e = ease(k); L.position.lerpVectors(P.linerOut, P.linerMat, e); L.position.y += Math.sin(k * Math.PI) * 0.3; L.rotation.y = e * Math.PI / 2; });
  sfx.thunk(); S.oldLiner = 'mat'; G.busy = false; complete('remove_old');
}
async function fitNew() {
  const S = G.state, L = P.newLiner; G.busy = true;
  await anim(0.8, (k) => { const e = ease(k); L.position.lerpVectors(P.linerStand, P.linerOut, e); L.position.y += Math.sin(k * Math.PI) * 0.3; });
  sfx.slide();
  await anim(0.9, (k) => { L.position.lerpVectors(P.linerOut, P.linerIn, ease(k)); });
  sfx.thunk(); S.newLiner = 'in'; G.busy = false; complete('fit_new');
}
async function binOld() {
  const S = G.state, L = P.oldLiner; G.busy = true; const a = L.position.clone();
  await anim(0.8, (k) => { const e = ease(k); L.position.lerpVectors(a, P.linerBin, e); L.position.y += Math.sin(k * Math.PI) * 0.9; L.rotation.set(0.5 * e, Math.PI / 2 * (1 - e) + 0.3 * e, 0.9 * e); });
  sfx.thunk(); S.oldLiner = 'bin'; G.busy = false; checkClear();
}
function doTray() {
  const S = G.state; if (!S.toolsOut || S.trayCleared) return;
  attempt('clear', () => {
    S.trayCleared = true; sfx.equip(); const t = P.toolTray;
    tween(0.35, (k) => { t.scale.setScalar(1 - k); }, () => { t.visible = false; t.scale.setScalar(1); applyState(); });
    checkClear();
  });
}
function checkClear() {
  const S = G.state;
  if (S.trayCleared && S.oldLiner === 'bin') complete('clear');
  else { toast(S.trayCleared ? 'Tools away. Now the old liner goes in the scrap bin.' : 'Old liner binned. Now put the tools away (tap the red tray).', 'info', 2600); updateHUD(); }
}

// ---------- modals ----------
function openModal(html, cls = '') {
  const m = $('modal'); $('modalBody').innerHTML = html; $('modalCard').className = 'card modal-card ' + cls; m.hidden = false; mode = 'modal';
  autoWalk = null; for (const k in keys) keys[k] = false;
  const f = m.querySelector('button.primary, input'); if (f && !isTouch) setTimeout(() => f.focus(), 50);
}
function closeModal() { $('modal').hidden = true; if (mode === 'modal') mode = 'play'; }
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function doPermitBoard() {
  const S = G.state;
  if (S.permit === 'none') return openPermit();
  if (S.permit === 'signed' && isDone('test_run')) return openClosePermit();
  if (S.permit === 'closed') return info('Permit closed. Job done.');
  info(`Permit ${PROC.permit.number} is issued.` + (inAssessment() ? ' Carry on with the job.' : ` Next: ${currentStep() ? currentStep().title : ''}.`));
}
function openPermit() {
  const opts = PROC.permit.options.map((o) => `<label class="chk"><input type="checkbox" value="${o.id}"><span>${esc(o.label)}</span></label>`).join('');
  openModal(`<div class="permit">
    <div class="permit-head"><span>PERMIT TO WORK</span><span>No. ${PROC.permit.number}</span></div>
    <div class="permit-meta"><div><b>Job</b> ${esc(PROC.job)}</div><div><b>Location</b> Mud pump area, main deck</div><div><b>Issued to</b> ${esc(G.name)}</div></div>
    <p class="permit-q">Tick every control this job needs before the supervisor signs:</p>
    <div class="chks">${opts}</div>
    <div id="permitFb" class="fb" role="status"></div>
    <div class="row"><button class="ghost" id="mCancel">Not now</button><button class="primary" id="permitSign">Sign and issue</button></div></div>`, 'paper');
  $('mCancel').onclick = () => { sfx.click(); closeModal(); };
  $('permitSign').onclick = () => {
    const picked = new Set([...document.querySelectorAll('.chks input:checked')].map((i) => i.value));
    const wrong = PROC.permit.options.filter((o) => picked.has(o.id) && !o.correct);
    const missing = PROC.permit.options.filter((o) => !picked.has(o.id) && o.correct);
    if (wrong.length || missing.length) {
      const lines = wrong.map((o) => `<li><b>Untick:</b> ${esc(o.why)}</li>`).concat(missing.length ? [`<li><b>Missing:</b> ${missing.length} control${missing.length > 1 ? 's' : ''} this job needs.</li>`] : []);
      $('permitFb').innerHTML = `<ul>${lines.join('')}</ul>`;
      recordMistake('permit_form', 'permit_form', 'The supervisor sent the permit back. Fix it and sign again.');
      return;
    }
    sfx.success(); closeModal(); G.state.permit = 'signed'; drawPermit('signed'); complete('permit');
    toast(`Supervisor signed ${PROC.permit.number}. You may start.`, 'good', 3000);
  };
}
function openClosePermit() {
  openModal(`<div class="permit"><div class="permit-head"><span>HAND BACK THE PERMIT</span><span>No. ${PROC.permit.number}</span></div>
    <p>Pump 1 is boxed up, tested and back in service. Your lock is off and the area is clear.</p>
    <div class="row"><button class="ghost" id="mCancel">Not yet</button><button class="primary" id="closeSign">Sign off the job</button></div></div>`, 'paper');
  $('mCancel').onclick = () => { sfx.click(); closeModal(); };
  $('closeSign').onclick = () => { closeModal(); G.state.permit = 'closed'; drawPermit('closed'); complete('close_permit'); };
}

// ---------- the interruption (stop work authority) ----------
function placeNpc() {
  const n = P.npc; n.visible = true;
  n.position.copy(G.npcPos); n.rotation.y = Math.atan2(player.x - n.position.x, player.z - n.position.z);
}
async function startDistractor() {
  const S = G.state; S.distractor = 'pending'; G.busy = true;
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw), rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
  const target = V3(player.x + fx * 1.5 - rx * 0.9, 0, player.z + fz * 1.5 - rz * 0.9);
  target.x = clamp(target.x, -1.5, 1.9); target.z = clamp(target.z, -6.0, -2.0);
  if (Math.hypot(target.x - player.x, target.z - player.z) < 1) target.x = player.x + 1.2;
  G.npcPos = target;
  const start = V3(-3.5, 0, -1.0);
  const n = P.npc; n.visible = true;
  n.rotation.y = Math.atan2(target.x - start.x, target.z - start.z);
  toast('Someone is coming over...', 'info', 1800);
  await anim(1.8, (k) => { n.position.lerpVectors(start, target, k); P.npcArms[0].rotation.x = Math.sin(k * 18) * 0.4; P.npcArms[1].rotation.x = -Math.sin(k * 18) * 0.4; });
  n.rotation.y = Math.atan2(player.x - n.position.x, player.z - n.position.z);
  P.npcArms[0].rotation.x = P.npcArms[1].rotation.x = 0;
  faceTowards(V3(n.position.x, 1.45, n.position.z), 0.6);
  await wait(0.6);
  showDistractor();
}
function showDistractor() {
  G.busy = true;
  const d = PROC.distractor;
  const choices = [...d.choices].sort(() => Math.random() - 0.5);
  openModal(`<div class="npc"><div class="npc-who"><span class="avatar">👷🏾‍♂️</span><b>${esc(d.speaker)}</b></div>
    <p class="npc-line">“${esc(d.line)}”</p>
    <div class="choices">${choices.map((c) => `<button class="choice" data-id="${c.id}">${esc(c.label)}</button>`).join('')}</div></div>`, 'npc-card');
  document.querySelectorAll('.choice').forEach((b) => (b.onclick = () => chooseDistractor(b.dataset.id)));
}
async function chooseDistractor(id) {
  const d = PROC.distractor; const c = d.choices.find((x) => x.id === id);
  closeModal();
  if (c.correct) {
    sfx.success(); G.state.distractor = 'done';
    toast(`${d.speaker.split(' ')[0]}: “${c.reply}”`, 'info', 3200);
    toast('Stop Work Authority used. Your lock stays on.', 'good', 3600);
    complete('stop_work');
    const n = P.npc; const a = n.position.clone(); const b = V3(-3.5, 0, -1.0);
    n.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
    G.busy = false;
    await anim(1.8, (k) => { n.position.lerpVectors(a, b, k); P.npcArms[0].rotation.x = Math.sin(k * 18) * 0.4; P.npcArms[1].rotation.x = -Math.sin(k * 18) * 0.4; });
    n.visible = false;
    return;
  }
  incident('lock_removed', 'stop_work', async () => {
    const n = P.npc; const a = n.position.clone(); const b = V3(6, 0, 1.5);
    n.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
    toast(`${d.speaker.split(' ')[0]} walks off to the MCC with your lock...`, 'info', 2400);
    await anim(1.6, (k) => { n.position.lerpVectors(a, b, k); P.npcArms[0].rotation.x = Math.sin(k * 18) * 0.4; });
    n.visible = false; P.lock.visible = false; P.haspGlow.visible = false;
    await wait(0.8);
    toast('Up on the drill floor, the driller primes the pump.', 'bad', 2400);
    await wait(0.6);
  });
}

// ---------- finish + score ----------
function fmtTime(s) { const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`; }
async function finish() {
  G.finished = true; mode = 'score'; world.setHighlights([]); P.beacon.group.visible = false;
  const secs = Math.round(elapsed());
  const sc = PROC.scoring;
  const score = clamp(sc.start - G.mistakes * sc.mistake - G.incidents * sc.incident, 0, 100);
  const pass = G.incidents === 0 && score >= PROC.passMark;
  const readiness = G.incidents > 0 ? 'Not ready' : score >= PROC.readyMark ? 'Ready' : pass ? 'Ready with coaching' : 'Needs practice';
  const failed = new Set(G.events.map((e) => e.check).filter(Boolean));
  const checklist = Object.entries(PROC.checks).map(([id, label]) => ({ id, label, ok: !failed.has(id) }));
  const rec = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: G.name, mode: G.mode === 'assess' ? 'Assessment' : 'Practice',
    module: PROC.module, date: new Date().toISOString(), seconds: secs, mistakes: G.mistakes, incidents: G.incidents, score, pass, readiness,
    failed: checklist.filter((c) => !c.ok).map((c) => c.label), events: G.events,
  };
  try { await saveAttempt(rec); } catch (e) { console.warn('save failed', e); }
  sfx.success();
  $('scName').textContent = G.name;
  $('scMode').textContent = rec.mode;
  $('scScore').textContent = score;
  $('scRing').style.setProperty('--p', score);
  $('scVerdict').textContent = pass ? 'PASS' : 'FAIL';
  $('scVerdict').className = 'verdict ' + (pass ? 'pass' : 'fail');
  $('scReady').textContent = readiness;
  $('scTime').textContent = fmtTime(secs);
  $('scMistakes').textContent = G.mistakes;
  $('scIncidents').textContent = G.incidents;
  $('scMistakesL').textContent = G.mistakes === 1 ? 'mistake' : 'mistakes';
  $('scIncidentsL').textContent = G.incidents === 1 ? 'incident' : 'incidents';
  $('scList').innerHTML = checklist.map((c) => `<li class="${c.ok ? 'ok' : 'bad'}"><span>${c.ok ? '✔' : '✖'}</span>${esc(c.label)}</li>`).join('');
  const notes = G.events.map((e) => `<li class="${e.type}"><b>${e.type === 'incident' ? '⚠️ Incident' : 'Mistake'}</b> at ${fmtTime(e.t)}: ${esc(e.message)}</li>`);
  $('scNotes').innerHTML = notes.length ? notes.join('') : '<li class="clean">No mistakes. Textbook lockout.</li>';
  setTimeout(() => { $('score').hidden = false; $('hud').hidden = true; }, 900);
}

// ---------- flow: title, briefing, play ----------
const nameInput = $('nameInput');
nameInput.value = localStorage.getItem('rigready.name') || '';
let chosenMode = localStorage.getItem('rigready.mode') || 'practice';
document.querySelectorAll('[data-mode]').forEach((b) => {
  b.classList.toggle('on', b.dataset.mode === chosenMode);
  b.addEventListener('click', () => { chosenMode = b.dataset.mode; localStorage.setItem('rigready.mode', chosenMode); document.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x === b)); });
});
$('startBtn').addEventListener('click', () => {
  const name = nameInput.value.trim().slice(0, 24);
  if (!name) { nameInput.focus(); nameInput.classList.add('shake'); setTimeout(() => nameInput.classList.remove('shake'), 500); $('nameErr').hidden = false; return; }
  localStorage.setItem('rigready.name', name);
  initAudio(); sfx.click();
  $('title').hidden = true;
  showBriefing(name);
});
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('startBtn').click(); });
function showBriefing(name) {
  const ctrl = isTouch
    ? '<li><b>Move:</b> joystick bottom left, or tap the deck to walk there</li><li><b>Look:</b> drag anywhere</li><li><b>Act:</b> tap equipment. Tap something far away to walk to it.</li>'
    : '<li><b>Move:</b> W A S D or arrow keys, or click the deck to walk there</li><li><b>Look:</b> click and drag</li><li><b>Act:</b> click equipment. Click something far away to walk to it.</li>';
  mode = 'brief';
  openModal(`<div class="brief"><div class="eyebrow">Job card</div><h2>${esc(PROC.job)}</h2>
    <p>First walk the deck: find the <b>muster point</b>, <b>Mud Pump 1</b> and the <b>breaker panel</b>. Then do the job the safe way. Mistakes cost points. Skipping isolation ends badly.</p>
    <ul class="ctrl">${ctrl}</ul>
    ${chosenMode === 'assess' ? '<p class="tagline-sm">Assessment mode: hints switch off after the deck walk.</p>' : ''}
    <div class="row"><button class="primary" id="goBtn">Start the deck walk</button></div></div>`);
  $('goBtn').onclick = () => { closeModal(); begin(name); };
}
function begin(name) {
  tweens.length = 0; spray.hide();
  G = { name, mode: chosenMode, start: performance.now(), state: freshState(), events: [], counted: new Set(), mistakes: 0, incidents: 0, busy: false, finished: false, snapshot: null, npcPos: V3(0, 0, -3) };
  Object.assign(player, SPAWN); autoWalk = null; faceTween = null;
  drawTag(name);
  $('score').hidden = true; $('hud').hidden = false; $('incident').hidden = true;
  mode = 'play';
  applyState();
  toast('Follow the glowing beacon. Your objectives are top left.', 'info', 4000);
}
$('againBtn').addEventListener('click', () => { sfx.click(); begin(G.name); });
$('titleBtn').addEventListener('click', toTitle);
function toTitle() { sfx.click(); $('score').hidden = true; $('hud').hidden = true; $('incident').hidden = true; closeModal(); mode = 'title'; G = null; world.setHighlights([]); P.beacon.group.visible = false; P.npc.visible = false; $('title').hidden = false; }
$('exitBtn').addEventListener('click', () => {
  if (!G || G.busy) return;
  openModal(`<div class="brief"><h2>Leave this attempt?</h2><p>Your progress on this run will not be saved.</p><div class="row"><button class="ghost" id="mCancel">Keep going</button><button class="primary" id="leaveBtn">Leave</button></div></div>`);
  $('mCancel').onclick = () => { sfx.click(); closeModal(); };
  $('leaveBtn').onclick = toTitle;
});
$('objCard').addEventListener('click', () => { $('objCard').classList.toggle('open'); });
const muteBtn = $('muteBtn');
function syncMute() { muteBtn.textContent = isMuted() ? '🔇' : '🔊'; muteBtn.setAttribute('aria-label', isMuted() ? 'Unmute sound' : 'Mute sound'); }
muteBtn.addEventListener('click', () => { setMuted(!isMuted()); syncMute(); });
syncMute();

// rotate hint
function checkRotate() {
  const portrait = window.innerHeight > window.innerWidth;
  $('rotate').hidden = !(isTouch && portrait && !sessionStorage.getItem('rigready.portraitOk'));
}
$('portraitOk').addEventListener('click', () => { sessionStorage.setItem('rigready.portraitOk', '1'); checkRotate(); });

// ---------- loop ----------
const compass = $('compass'), compassArrow = $('compassArrow'), compassDist = $('compassDist');
let last = performance.now();
let fps = 60, fpsN = 0, fpsT = 0;
function frame(now) {
  const real = Math.min(0.25, (now - last) / 1000); last = now; const t = now / 1000;
  const dt = Math.min(0.05, real);
  fpsN++; fpsT += real; if (fpsT > 1) { fps = fpsN / fpsT; fpsN = 0; fpsT = 0; }
  updateTweens(real);
  updatePlayer(dt);
  if (G && mode === 'play' && !G.busy) {
    for (const s of PROC.steps) if (s.visit && !isDone(s.id)) { const c = world.stations[s.target]; if (Math.hypot(player.x - c.center.x, player.z - c.center.z) < c.visitR) complete(s.id); }
  }
  updateCamera(dt);
  world.update(real, t);
  spray.update(Math.min(real, 0.1));
  if (beaconTarget && mode === 'play') {
    const dx = beaconTarget.x - player.x, dz = beaconTarget.z - player.z, d = Math.hypot(dx, dz);
    P.beacon.col.visible = d > 2.6;
    if (d > 3.2) {
      const ang = Math.atan2(-dx, -dz) - player.yaw; const rel = Math.atan2(Math.sin(ang), Math.cos(ang));
      compass.hidden = false; compassArrow.style.transform = `rotate(${-rel}rad)`; compassDist.textContent = Math.round(d) + ' m';
    } else compass.hidden = true;
  } else compass.hidden = true;
  if (G && mode === 'play' && !G.finished) $('timer').textContent = fmtTime(elapsed());
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
resize();
drawPermit('none');
requestAnimationFrame(frame);
document.body.classList.add('ready');

// Test hooks (used by the automated playtest; harmless in production).
window.__rig = {
  get mode() { return mode; },
  get state() { return G && G.state; },
  get attempt() { return G && { mistakes: G.mistakes, incidents: G.incidents, busy: G.busy, finished: G.finished, done: G.state.done.slice() }; },
  pick: (x, y) => { const p = pick(x, y); return p && { iid: p.iid, floor: !!p.floor, blocked: !!p.blocked }; },
  interact, goToStation, currentStep: () => currentStep() && currentStep().id,
  get fps() { return fps; },
  get calls() { return renderer.info.render.calls; },
  get tris() { return renderer.info.render.triangles; },
  screenPos(iid) { const e = world.byId[iid]; const v = new THREE.Box3().setFromObject(e.obj).getCenter(new THREE.Vector3()); v.project(camera); const r = canvas.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, onScreen: Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z < 1 }; },
  player,
};
