// Builds the rig deck from simple primitives. Everything is low-poly and generated in code,
// so the whole world downloads as a few kilobytes of JavaScript.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.userData = { canvas: c, ctx: g };
  return t;
}

export function textTexture(lines, { w = 512, h = 128, bg = '#1d2b36', fg = '#ffffff', font = 'bold 54px system-ui, sans-serif', sub = 'bold 34px system-ui, sans-serif' } = {}) {
  return canvasTex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    const arr = Array.isArray(lines) ? lines : [lines];
    if (arr.length === 1) { g.font = font; g.fillText(arr[0], w / 2, h / 2 + 2); }
    else { g.font = font; g.fillText(arr[0], w / 2, h * 0.36); g.font = sub; g.fillText(arr[1], w / 2, h * 0.74); }
  });
}

function label(text, { scale = 1, bg = 'rgba(13,27,42,0.82)', fg = '#fff', accent = '#ffb000' } = {}) {
  const meas = document.createElement('canvas').getContext('2d'); meas.font = 'bold 50px system-ui, sans-serif';
  const W = Math.ceil(meas.measureText(text).width + 100), H = 112;
  const tex = canvasTex(W, H, (g, w, h) => {
    g.fillStyle = bg;
    const r = 26; g.beginPath(); g.moveTo(r, 0); g.arcTo(w, 0, w, h, r); g.arcTo(w, h, 0, h, r); g.arcTo(0, h, 0, 0, r); g.arcTo(0, 0, w, 0, r); g.fill();
    g.fillStyle = accent; g.fillRect(24, 30, 10, 52);
    g.font = 'bold 50px system-ui, sans-serif'; g.fillStyle = fg; g.textBaseline = 'middle'; g.textAlign = 'left';
    g.fillText(text, 54, h / 2 + 2);
  });
  const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const s = new THREE.Sprite(m); s.scale.set(0.5 * scale * W / H, 0.5 * scale, 1); s.renderOrder = 5;
  return s;
}

export function buildWorld(scene, { shadows = true, shadowSize = 2048, breakers = [], tools = [] } = {}) {
  const interactables = [];
  const byId = {};
  const obstacles = [];
  const parts = {};
  const updaters = [];

  const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2, ...o });
  const mat = {
    steel: M('#8b939a', { metalness: 0.6, roughness: 0.45 }),
    dark: M('#3a4148', { metalness: 0.5, roughness: 0.55 }),
    darker: M('#23282d', { metalness: 0.4, roughness: 0.6 }),
    yellow: M('#f0b92b', { roughness: 0.55 }),
    pump: M('#2f5f8c', { metalness: 0.35, roughness: 0.45 }),
    fluid: M('#7a8189', { metalness: 0.6, roughness: 0.4 }),
    orange: M('#e66c25'),
    white: M('#e9edf0', { metalness: 0.1, roughness: 0.7 }),
    red: M('#c1362b'),
    chrome: M('#dfe3e6', { metalness: 0.95, roughness: 0.18 }),
    rust: M('#6e4426', { metalness: 0.3, roughness: 0.9 }),
    rubber: M('#1b1b1b', { roughness: 0.9, metalness: 0 }),
    green: M('#1f8a4c'),
    beige: M('#c8cbc2', { metalness: 0.3, roughness: 0.6 }),
    glass: M('#8fb9d6', { metalness: 0.2, roughness: 0.1 }),
    blueC: M('#2a5d8f', { roughness: 0.7 }),
    orangeC: M('#c4571f', { roughness: 0.7 }),
    greyC: M('#8f989e', { roughness: 0.7 }),
    derrick: M('#c9562a', { metalness: 0.3, roughness: 0.6 }),
    skin: M('#5b3a24', { roughness: 0.8, metalness: 0 }),
    coverall: M('#e35b14', { roughness: 0.8, metalness: 0 }),
  };
  parts.mat = mat;

  function mesh(geo, m, x = 0, y = 0, z = 0, parent = scene) {
    const o = new THREE.Mesh(geo, m); o.position.set(x, y, z);
    o.castShadow = shadows; o.receiveShadow = shadows; parent.add(o); return o;
  }
  const box = (w, h, d, m, x, y, z, p) => mesh(new THREE.BoxGeometry(w, h, d), m, x, y, z, p);
  const cyl = (r, h, m, x, y, z, p, seg = 20, axis = 'y') => {
    const o = mesh(new THREE.CylinderGeometry(r, r, h, seg), m, x, y, z, p);
    if (axis === 'x') o.rotation.z = Math.PI / 2; if (axis === 'z') o.rotation.x = Math.PI / 2; return o;
  };
  function orient(g, a, b) {
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
    g.applyMatrix4(new THREE.Matrix4().compose(mid, q, V(1, 1, 1))); return g;
  }
  const beamGeo = (a, b, t) => orient(new THREE.BoxGeometry(t, a.distanceTo(b), t), a, b);
  const pipeGeo = (a, b, r) => orient(new THREE.CylinderGeometry(r, r, a.distanceTo(b), 14), a, b);
  function pipeRun(points, r, m) {
    const geos = [];
    for (let i = 0; i < points.length - 1; i++) geos.push(pipeGeo(points[i], points[i + 1], r));
    for (let i = 1; i < points.length - 1; i++) { const s = new THREE.SphereGeometry(r * 1.05, 14, 8); s.translate(points[i].x, points[i].y, points[i].z); geos.push(s.toNonIndexed ? s : s); }
    return mesh(mergeGeometries(geos.map((g) => g.index ? g.toNonIndexed() : g)), m);
  }
  function obstacle(minX, maxX, minZ, maxZ) { obstacles.push({ minX, maxX, minZ, maxZ }); }
  function register(obj, iid, station, name) {
    obj.userData.iid = iid;
    const meshes = [];
    obj.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); meshes.push(o); } });
    const entry = { iid, obj, station, name, meshes };
    interactables.push(entry); byId[iid] = entry; return entry;
  }
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const hit = (parent, w, h, d, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), hitMat); o.position.set(x, y, z); parent.add(o); return o; };
  const textPlane = (t, w, h, x, y, z, ry, opts) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: textTexture(t, opts) })); p.position.set(x, y, z); p.rotation.y = ry; scene.add(p); return p; };

  // ---------- sky, sea, light ----------
  scene.background = canvasTex(4, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#5f97c7'); gr.addColorStop(0.55, '#a9c9de'); gr.addColorStop(1, '#d8e5ec');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  scene.fog = new THREE.Fog('#c3d6e2', 45, 190);
  scene.add(new THREE.HemisphereLight('#d5e6ff', '#4a4a44', 0.8));
  const sun = new THREE.DirectionalLight('#fff1dc', 2.3); sun.position.set(18, 30, 14);
  sun.castShadow = shadows;
  if (shadows) {
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    const c = sun.shadow.camera; c.left = -26; c.right = 26; c.top = 26; c.bottom = -26; c.near = 5; c.far = 80;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
  }
  scene.add(sun);
  const fill = new THREE.DirectionalLight('#c9dcf0', 0.9); fill.position.set(-20, 12, -6); scene.add(fill);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshStandardMaterial({ color: '#2a5f80', roughness: 0.35, metalness: 0.2 }));
  sea.rotation.x = -Math.PI / 2; sea.position.y = -14; scene.add(sea);

  // ---------- deck ----------
  const deckTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#6c7378'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { const v = 90 + Math.random() * 40; g.fillStyle = `rgba(${v},${v + 4},${v + 8},0.25)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    g.strokeStyle = 'rgba(255,255,255,0.10)'; g.lineWidth = 2;
    for (let y = 8; y < h; y += 16) for (let x = (y / 16) % 2 ? 0 : 8; x < w; x += 16) { g.beginPath(); g.moveTo(x, y + 3); g.lineTo(x + 6, y - 3); g.stroke(); }
    g.strokeStyle = 'rgba(20,24,28,0.55)'; g.lineWidth = 4;
    for (let p = 0; p <= w; p += 256) { g.beginPath(); g.moveTo(p, 0); g.lineTo(p, h); g.stroke(); g.beginPath(); g.moveTo(0, p); g.lineTo(w, p); g.stroke(); }
  }, [42 / 8, 30 / 8]);
  const deckTop = new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.85, metalness: 0.3 });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(42, 1.2, 30), [mat.dark, mat.dark, deckTop, mat.dark, mat.dark, mat.dark]);
  deck.position.y = -0.6; deck.receiveShadow = shadows; scene.add(deck);
  parts.floor = deck;

  const paint = (w, d, x, z, color, rot = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color, roughness: 0.8 })); m.rotation.x = -Math.PI / 2; m.rotation.z = rot; m.position.set(x, 0.011, z); m.receiveShadow = shadows; scene.add(m); return m; };
  const walk = '#e1b52c';
  paint(0.12, 22, -1.6, 1.5, walk); paint(0.12, 22, 0.2 - 0.0, 1.5, walk);
  paint(36, 0.12, 0, 12.6, walk); paint(36, 0.12, 0, 10.8, walk);
  const hz = canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#f0b92b'; g.fillRect(0, 0, w, h); g.fillStyle = '#1b1b1b'; for (let i = -64; i < 128; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 16, 0); g.lineTo(i + 16 - 64, 64); g.lineTo(i - 64, 64); g.fill(); } });
  const hzLine = (len, x, z, rot) => { const t = hz.clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(len / 0.5, 1); t.needsUpdate = true; const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.22), new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 })); m.rotation.x = -Math.PI / 2; m.rotation.z = rot; m.position.set(x, 0.012, z); scene.add(m); };
  hzLine(6.6, 5.5, -2.3, 0); hzLine(6.6, 5.5, -13.2, 0); hzLine(10.9, 8.8, -7.75, Math.PI / 2);

  // ---------- railings ----------
  const postGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.1, 8); postGeo.translate(0, 0.55, 0);
  const postPos = [];
  for (let x = -20; x <= 20; x += 2) { postPos.push([x, -14], [x, 14]); }
  for (let z = -12; z <= 12; z += 2) { postPos.push([-20, z], [20, z]); }
  const posts = new THREE.InstancedMesh(postGeo, mat.yellow, postPos.length);
  const m4 = new THREE.Matrix4();
  postPos.forEach(([x, z], i) => { m4.makeTranslation(x, 0, z); posts.setMatrixAt(i, m4); });
  posts.castShadow = shadows; scene.add(posts);
  const railGeos = [];
  for (const y of [0.55, 1.08]) {
    railGeos.push(pipeGeo(V(-20, y, -14), V(20, y, -14), 0.035), pipeGeo(V(-20, y, 14), V(20, y, 14), 0.035));
    railGeos.push(pipeGeo(V(-20, y, -14), V(-20, y, 14), 0.035), pipeGeo(V(20, y, -14), V(20, y, 14), 0.035));
  }
  mesh(mergeGeometries(railGeos), mat.yellow);

  // ---------- jack-up legs ----------
  for (const [x, z] of [[-23.5, -12], [23.5, -12], [-23.5, 12], [23.5, 12]]) {
    const geos = []; const r = 1.4;
    for (let k = 0; k < 3; k++) { const a = k * Math.PI * 2 / 3; geos.push(beamGeo(V(x + Math.cos(a) * r, -40, z + Math.sin(a) * r), V(x + Math.cos(a) * r, 26, z + Math.sin(a) * r), 0.3)); }
    for (let y = -40; y < 26; y += 2.2) for (let k = 0; k < 3; k++) {
      const a = k * Math.PI * 2 / 3, b = (k + 1) * Math.PI * 2 / 3;
      geos.push(beamGeo(V(x + Math.cos(a) * r, y, z + Math.sin(a) * r), V(x + Math.cos(b) * r, y + 1.1, z + Math.sin(b) * r), 0.09));
      geos.push(beamGeo(V(x + Math.cos(b) * r, y + 1.1, z + Math.sin(b) * r), V(x + Math.cos(a) * r, y + 2.2, z + Math.sin(a) * r), 0.09));
    }
    const leg = mesh(mergeGeometries(geos), mat.yellow); leg.castShadow = false;
  }

  // ---------- derrick (background) ----------
  {
    const g = new THREE.Group(); g.position.set(0, 0, -22); scene.add(g);
    const geos = [];
    const base = 5, top = 1.0, y0 = 7.5, y1 = 42;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      geos.push(beamGeo(V(sx * 5, -1, sz * 4), V(sx * 5, y0, sz * 4), 0.5));
      geos.push(beamGeo(V(sx * base, y0, sz * base * 0.8), V(sx * top, y1, sz * top), 0.32));
    }
    const lv = 10;
    const ring = (t) => { const y = y0 + (y1 - y0) * t, w = base + (top - base) * t, d = base * 0.8 + (top - base * 0.8) * t; return [V(-w, y, -d), V(w, y, -d), V(w, y, d), V(-w, y, d)]; };
    for (let i = 0; i <= lv; i++) {
      const c = ring(i / lv);
      for (let k = 0; k < 4; k++) geos.push(beamGeo(c[k], c[(k + 1) % 4], 0.14));
      if (i < lv) { const c2 = ring((i + 1) / lv); for (let k = 0; k < 4; k++) geos.push(beamGeo(c[k], c2[(k + 1) % 4], 0.1)); }
    }
    const dm = mesh(mergeGeometries(geos), mat.derrick, 0, 0, 0, g); dm.castShadow = false;
    box(12, 0.6, 10, mat.dark, 0, y0, 0, g);
    box(2.2, 1.6, 2.2, mat.yellow, 0, y1 + 0.8, 0, g);
    box(3, 2.5, 3, mat.white, -4, y0 + 1.55, 3, g);
    box(2.0, 1.2, 0.05, mat.glass, -4, y0 + 1.8, 4.53, g);
  }

  // ---------- office cabin with permit board ----------
  {
    box(4, 2.8, 6, mat.white, -15.5, 1.4, -3);
    box(4.02, 0.3, 6.02, mat.blueC, -15.5, 2.3, -3);
    box(0.05, 2.1, 1.0, mat.dark, -13.48, 1.05, -4.9);
    box(0.05, 0.9, 1.4, mat.glass, -13.48, 1.6, -0.8);
    textPlane('OFFICE', 1.4, 0.35, -13.45, 2.75, -4.0, Math.PI / 2, { w: 512, h: 128, bg: '#1d4f7a' });
    obstacle(-17.5, -13.5, -6, 0);
    const board = new THREE.Group(); board.position.set(-13.44, 1.5, -2.4); scene.add(board);
    box(0.06, 1.0, 1.4, mat.darker, 0, 0, 0, board);
    const ptex = canvasTex(512, 360, () => {});
    const face = mesh(new THREE.PlaneGeometry(1.3, 0.9), new THREE.MeshBasicMaterial({ map: ptex }), 0.035, 0, 0, board);
    face.rotation.y = Math.PI / 2;
    parts.permitTex = ptex;
    register(board, 'permit_board', 'permit', 'Permit board');
    const l = label('PERMIT BOARD', { scale: 0.8 }); l.position.set(-13.2, 2.35, -2.4); scene.add(l);
  }

  // ---------- PPE locker ----------
  {
    const g = new THREE.Group(); g.position.set(-13.25, 0, -7.6); scene.add(g);
    box(0.06, 2.0, 1.6, mat.greyC, -0.22, 1.0, 0, g);
    box(0.5, 2.0, 0.05, mat.greyC, 0, 1.0, -0.8, g); box(0.5, 2.0, 0.05, mat.greyC, 0, 1.0, 0.8, g);
    box(0.5, 0.05, 1.6, mat.greyC, 0, 2.0, 0, g);
    box(0.5, 0.04, 1.6, mat.greyC, 0, 0.88, 0, g); box(0.5, 0.04, 1.6, mat.greyC, 0, 1.42, 0, g);
    const d1 = box(0.04, 1.9, 0.78, mat.greyC, 0.55, 1.0, -1.1, g); d1.rotation.y = 0.9;
    const d2 = box(0.04, 1.9, 0.78, mat.greyC, 0.55, 1.0, 1.1, g); d2.rotation.y = -0.9;
    obstacle(-13.6, -12.5, -8.9, -6.3);
    const items = {};
    const hh = new THREE.Group(); hh.position.set(0.02, 1.45, -0.4); g.add(hh);
    mesh(new THREE.SphereGeometry(0.15, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat.yellow, 0, 0.02, 0, hh);
    cyl(0.2, 0.02, mat.yellow, 0, 0.02, 0, hh);
    items.hardhat = hh;
    const gl = new THREE.Group(); gl.position.set(0.05, 1.52, 0.35); g.add(gl);
    cyl(0.05, 0.015, mat.darker, 0, 0, -0.06, gl, 16, 'x'); cyl(0.05, 0.015, mat.darker, 0, 0, 0.06, gl, 16, 'x');
    box(0.015, 0.02, 0.24, mat.darker, -0.01, 0.04, 0, gl);
    items.glasses = gl;
    const gv = new THREE.Group(); gv.position.set(0.02, 0.92, 0.0); g.add(gv);
    box(0.08, 0.06, 0.22, mat.orange, 0, 0.03, -0.12, gv); box(0.08, 0.06, 0.22, mat.orange, 0, 0.03, 0.12, gv);
    box(0.1, 0.065, 0.06, mat.yellow, 0, 0.033, -0.25, gv); box(0.1, 0.065, 0.06, mat.yellow, 0, 0.033, 0.25, gv);
    items.gloves = gv;
    const bt = new THREE.Group(); g.add(bt);
    for (const z of [-0.15, 0.15]) { box(0.3, 0.12, 0.13, mat.darker, 0.05, 0.06, z, bt); box(0.1, 0.32, 0.13, mat.darker, -0.05, 0.22, z, bt); box(0.08, 0.1, 0.135, mat.yellow, 0.17, 0.06, z, bt); }
    items.boots = bt;
    hit(hh, 0.42, 0.3, 0.42, 0, 0.08, 0); hit(gl, 0.25, 0.2, 0.36); hit(gv, 0.25, 0.2, 0.64, 0, 0.05, 0); hit(bt, 0.45, 0.45, 0.5, 0.05, 0.2, 0);
    for (const [id, o] of Object.entries(items)) register(o, 'ppe_' + id, 'locker', id);
    parts.ppe = items;
    const l = label('PPE LOCKER', { scale: 0.8 }); l.position.set(-13.0, 2.45, -7.6); scene.add(l);
  }

  // ---------- muster point ----------
  {
    const mt = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#1f8a4c'; g.fillRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = 10; g.strokeRect(12, 12, w - 24, h - 24); g.fillStyle = '#fff'; g.font = 'bold 40px system-ui'; g.textAlign = 'center'; g.fillText('MUSTER', w / 2, h / 2 - 8); g.fillText('POINT 1', w / 2, h / 2 + 38); });
    const sq = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshStandardMaterial({ map: mt, roughness: 0.8 }));
    sq.rotation.x = -Math.PI / 2; sq.rotation.z = Math.PI / 4; sq.position.set(-16, 0.013, 10.3); sq.receiveShadow = shadows; scene.add(sq);
    const sg = new THREE.Group(); sg.position.set(-17.8, 0, 8.6); sg.rotation.y = Math.PI / 4; scene.add(sg);
    cyl(0.05, 2.4, mat.steel, -0.6, 1.2, 0, sg); cyl(0.05, 2.4, mat.steel, 0.6, 1.2, 0, sg);
    const st = canvasTex(512, 320, (g, w, h) => {
      g.fillStyle = '#1f8a4c'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff';
      for (const [x, s] of [[170, 1], [256, 1.15], [342, 1]]) { g.beginPath(); g.arc(x, 82 - (s - 1) * 60, 22 * s, 0, 7); g.fill(); g.fillRect(x - 20 * s, 112 - (s - 1) * 40, 40 * s, 80 * s); }
      g.font = 'bold 54px system-ui'; g.textAlign = 'center'; g.fillText('MUSTER POINT 1', w / 2, 270);
    });
    mesh(new THREE.PlaneGeometry(1.5, 0.94), new THREE.MeshBasicMaterial({ map: st }), 0, 1.9, 0.06, sg);
    box(1.56, 1.0, 0.05, mat.dark, 0, 1.9, 0.02, sg);
    register(sg, 'muster_sign', 'muster', 'Muster point');
    const rg = mesh(new THREE.TorusGeometry(0.32, 0.08, 10, 24), mat.orange, -14.6, 1.0, 12.6); rg.rotation.y = 0.4;
    box(0.1, 1.3, 0.1, mat.steel, -14.6, 0.55, 12.75);
  }

  // ---------- clutter: containers, drums, pipe rack, crane ----------
  {
    const container = (x, z, m, y = 0) => {
      const g = new THREE.Group(); g.position.set(x, y, z); scene.add(g);
      box(2.4, 2.6, 6, m, 0, 1.3, 0, g);
      const rib = []; for (let i = -2.7; i <= 2.71; i += 0.45) rib.push(new THREE.BoxGeometry(2.44, 2.4, 0.05).translate(0, 1.3, i));
      mesh(mergeGeometries(rib), m, 0, 0, 0, g);
      return g;
    };
    container(17.6, -4.5, mat.blueC); container(17.6, -11, mat.orangeC); container(17.6, -11, mat.greyC, 2.62);
    obstacle(16.3, 19, -14, -1.4);
    container(-17.8, -11.5, mat.greyC);
    obstacle(-19.2, -16.5, -14, -8.4);
    for (let i = 0; i < 7; i++) cyl(0.3, 0.9, i % 3 ? mat.blueC : mat.red, -14.5 + (i % 4) * 0.66, 0.45, -12.4 + Math.floor(i / 4) * 0.66);
    obstacle(-15, -12.1, -12.9, -11.3);
    for (const [x, z] of [[9, 12.2], [16, 12.2], [9, 13.3], [16, 13.3]]) box(0.2, 1.0, 0.2, mat.yellow, x, 0.5, z);
    const pg = []; for (let k = 0; k < 9; k++) pg.push(pipeGeo(V(8.6, 1.13 + Math.floor(k / 5) * 0.24, 12.1 + (k % 5) * 0.28), V(16.4, 1.13 + Math.floor(k / 5) * 0.24, 12.1 + (k % 5) * 0.28), 0.12));
    mesh(mergeGeometries(pg), mat.steel);
    obstacle(8.5, 16.5, 11.8, 14);
    cyl(1.0, 6, mat.yellow, -18, 3, 3); box(2.2, 1.4, 2.2, mat.white, -18, 6.7, 3);
    const boom = box(0.6, 0.6, 16, mat.yellow, -18, 9.5, -4); boom.rotation.x = -0.35;
    obstacle(-19.2, -16.8, 1.8, 4.2);
  }

  // ---------- mud pumps ----------
  function buildPump(px, pz) {
    const g = new THREE.Group(); g.position.set(px, 0, pz); scene.add(g);
    box(6.0, 0.3, 2.8, mat.dark, 0.4, 0.15, 0, g);
    box(2.4, 1.5, 2.4, mat.pump, 1.9, 1.05, 0, g);
    cyl(0.78, 2.4, mat.pump, 1.9, 1.8, 0, g, 28, 'z');
    box(1.5, 0.5, 1.2, mat.dark, 2.6, 2.55, 0, g);
    cyl(0.48, 1.6, mat.pump, 2.6, 3.1, 0, g, 24, 'z');
    const sheave = new THREE.Group(); sheave.position.set(2.2, 1.5, 1.35); g.add(sheave);
    cyl(0.72, 0.16, mat.darker, 0, 0, 0, sheave, 32, 'z');
    box(1.3, 0.12, 0.18, mat.yellow, 0, 0, 0.02, sheave);
    // cradle (pony rod area): where the IADC 08-14 injury happened
    box(1.7, 0.9, 0.08, mat.dark, -0.15, 1.0, 1.18, g); box(1.7, 0.9, 0.08, mat.dark, -0.15, 1.0, -1.18, g);
    box(1.7, 0.1, 2.3, mat.dark, -0.15, 0.5, 0, g);
    const rods = [];
    for (const z of [-0.75, 0, 0.75]) {
      const r = new THREE.Group(); r.position.set(0, 0, z); g.add(r);
      cyl(0.065, 1.7, mat.chrome, -0.15, 1.0, 0, r, 14, 'x');
      box(0.16, 0.22, 0.22, mat.yellow, -0.45, 1.0, 0, r);
      rods.push(r);
    }
    box(1.0, 1.4, 2.5, mat.fluid, -1.6, 1.0, 0, g);
    for (const z of [-0.75, 0, 0.75]) cyl(0.2, 0.14, mat.fluid, -1.6, 1.77, z, g, 6);
    const covers = [];
    for (const z of [-0.75, 0, 0.75]) {
      cyl(0.36, 0.05, mat.darker, -2.12, 1.0, z, g, 24, 'x');
      const bore = mesh(new THREE.CircleGeometry(0.2, 24), new THREE.MeshBasicMaterial({ color: '#0b0d0f' }), -2.152, 1.0, z, g); bore.rotation.y = -Math.PI / 2;
      const c = new THREE.Group(); c.position.set(px - 2.24, 1.0, pz + z); scene.add(c);
      cyl(0.28, 0.16, mat.fluid, 0, 0, 0, c, 6, 'x');
      cyl(0.12, 0.06, mat.dark, -0.1, 0, 0, c, 6, 'x');
      covers.push(c);
    }
    return { g, rods, sheave, covers };
  }
  const p1 = buildPump(5, -5);
  const p2 = buildPump(5, -11);
  obstacle(2.35, 8.5, -6.5, -3.6); obstacle(2.35, 8.5, -12.5, -9.5);
  parts.pump1 = p1; parts.pump2 = p2;
  register(p2.g, 'pump2', 'pump2', 'Mud Pump 2');
  ['cover1', 'cover2', 'cover3'].forEach((id, i) => register(p1.covers[i], id, 'pump', 'Module cover'));
  parts.coverHome = p1.covers[1].position.clone();
  parts.coverAside = V(1.55, 0.17, -3.95);
  {
    const l1 = label('MUD PUMP 1', { scale: 0.95 }); l1.position.set(5.5, 4.3, -5); scene.add(l1);
    const l2 = label('MUD PUMP 2 · IN SERVICE', { scale: 1.1, accent: '#2ecc71' }); l2.position.set(5.5, 4.3, -11); scene.add(l2);
    for (const [i, z] of [[1, -5.75], [2, -5], [3, -4.25]]) textPlane('#' + i, 0.22, 0.16, 2.845, 1.52, z, -Math.PI / 2, { w: 128, h: 96, bg: '#f0b92b', fg: '#111', font: 'bold 64px system-ui' });
  }

  // ---------- liners ----------
  function liner(m, ring) {
    const g = new THREE.Group();
    cyl(0.17, 0.72, m, 0, 0, 0, g, 22, 'x');
    cyl(0.178, 0.08, ring, -0.32, 0, 0, g, 22, 'x');
    const bore = mesh(new THREE.CircleGeometry(0.1, 16), new THREE.MeshBasicMaterial({ color: '#111' }), -0.362, 0, 0, g); bore.rotation.y = -Math.PI / 2;
    hit(g, 0.12, 0.42, 0.42, -0.37, 0, 0);
    scene.add(g); return g;
  }
  parts.oldLiner = liner(mat.rust, mat.rubber);
  parts.newLiner = liner(mat.chrome, mat.orange);
  parts.linerIn = V(2.85 + 0.33, 1.0, -5);
  parts.linerOut = V(2.15, 1.0, -5);
  parts.linerMat = V(1.85, 0.18, -6.15);
  parts.linerStand = V(1.15, 1.04, -6.75);
  parts.linerBin = V(-0.6, 0.5, -7.9);
  register(parts.oldLiner, 'liner_old', 'pump', 'Worn liner');
  register(parts.newLiner, 'liner_new', 'pump', 'New liner');
  box(1.1, 0.06, 0.7, mat.steel, 1.15, 0.84, -6.75);
  for (const [dx, dz] of [[-0.5, -0.3], [0.5, -0.3], [-0.5, 0.3], [0.5, 0.3]]) box(0.05, 0.84, 0.05, mat.steel, 1.15 + dx, 0.42, -6.75 + dz);
  obstacle(0.5, 1.8, -7.2, -6.3);
  { const l = label('SPARES', { scale: 0.5 }); l.position.set(1.15, 1.6, -6.75); scene.add(l); }
  paint(1.4, 1.0, 1.85, -6.15, '#2b2f33');
  {
    const g = new THREE.Group(); g.position.set(-0.6, 0, -7.9); scene.add(g);
    box(1.3, 0.08, 0.9, mat.orange, 0, 0.04, 0, g);
    box(1.3, 0.9, 0.06, mat.orange, 0, 0.45, -0.42, g); box(1.3, 0.9, 0.06, mat.orange, 0, 0.45, 0.42, g);
    box(0.06, 0.9, 0.9, mat.orange, -0.62, 0.45, 0, g); box(0.06, 0.9, 0.9, mat.orange, 0.62, 0.45, 0, g);
    const l = label('SCRAP BIN', { scale: 0.5 }); l.position.set(-0.6, 1.35, -7.9); scene.add(l);
    obstacle(-1.3, 0.1, -8.4, -7.4);
  }
  {
    const g = new THREE.Group(); g.position.set(1.95, 0, -4.45); scene.add(g);
    box(0.7, 0.08, 0.45, mat.red, 0, 0.04, 0, g);
    box(0.5, 0.05, 0.06, mat.steel, 0, 0.1, -0.1, g); box(0.4, 0.05, 0.05, mat.orange, 0, 0.1, 0.05, g); box(0.45, 0.05, 0.05, mat.steel, 0, 0.1, 0.15, g);
    hit(g, 0.8, 0.3, 0.6, 0, 0.12, 0);
    parts.toolTray = g; register(g, 'tool_tray', 'pump', 'Tool tray');
  }

  // ---------- valve station: suction, discharge, bleed, gauge ----------
  {
    pipeRun([V(1.6, 0.0, -3.2), V(1.6, 0.55, -3.2), V(3.4, 0.55, -3.2), V(3.4, 0.55, -6.3)], 0.13, mat.green);
    box(0.34, 0.34, 0.34, mat.dark, 2.05, 0.55, -3.2);
    cyl(0.04, 0.45, mat.chrome, 2.05, 0.9, -3.2);
    const sw = new THREE.Group(); sw.position.set(2.05, 1.1, -3.2); scene.add(sw);
    mesh(new THREE.TorusGeometry(0.22, 0.03, 8, 28), mat.red, 0, 0, 0, sw).rotation.x = Math.PI / 2;
    box(0.44, 0.03, 0.03, mat.red, 0, 0, 0, sw); box(0.03, 0.03, 0.44, mat.red, 0, 0, 0, sw);
    hit(sw, 0.55, 0.2, 0.55);
    register(sw, 'valve_suction', 'valves', 'Suction valve');
    pipeRun([V(3.4, 1.7, -6.0), V(3.4, 1.95, -6.0), V(3.4, 1.95, -3.2), V(2.15, 1.95, -3.2)], 0.1, mat.steel);
    pipeRun([V(2.1, 1.95, -3.2), V(2.1, 3.3, -3.2), V(2.1, 3.3, -9.2)], 0.1, mat.steel);
    pipeRun([V(3.4, 1.7, -12.0), V(3.4, 1.95, -12.0), V(3.4, 1.95, -9.2), V(2.1, 1.95, -9.2), V(2.1, 3.3, -9.2)], 0.1, mat.steel);
    box(0.3, 0.32, 0.32, mat.dark, 2.1, 1.95, -3.2);
    cyl(0.035, 0.3, mat.chrome, 1.85, 1.95, -3.2, scene, 10, 'x');
    const dw = new THREE.Group(); dw.position.set(1.72, 1.95, -3.2); scene.add(dw);
    mesh(new THREE.TorusGeometry(0.2, 0.03, 8, 28), mat.red, 0, 0, 0, dw).rotation.y = Math.PI / 2;
    box(0.03, 0.4, 0.03, mat.red, 0, 0, 0, dw); box(0.03, 0.03, 0.4, mat.red, 0, 0, 0, dw);
    hit(dw, 0.2, 0.5, 0.5);
    register(dw, 'valve_discharge', 'valves', 'Discharge valve');
    textPlane('SUCTION', 0.42, 0.11, 1.84, 0.7, -3.2, -Math.PI / 2, { w: 384, h: 100, bg: '#f2f2f2', fg: '#111', font: 'bold 56px system-ui' });
    textPlane('DISCHARGE', 0.42, 0.11, 1.6, 2.28, -3.2, -Math.PI / 2, { w: 384, h: 100, bg: '#f2f2f2', fg: '#111', font: 'bold 52px system-ui' });
    // gauge
    cyl(0.025, 0.3, mat.chrome, 2.8, 2.12, -3.2);
    const gtex = canvasTex(256, 256, (g) => {
      g.fillStyle = '#f6f6f2'; g.beginPath(); g.arc(128, 128, 122, 0, 7); g.fill();
      g.lineWidth = 10; g.strokeStyle = '#222'; g.stroke();
      const a0 = Math.PI * 0.75, span = Math.PI * 1.5;
      g.strokeStyle = '#c0392b'; g.lineWidth = 12; g.beginPath(); g.arc(128, 128, 100, a0 + span * 0.8, a0 + span); g.stroke();
      g.strokeStyle = '#222'; g.fillStyle = '#222'; g.font = 'bold 22px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (let i = 0; i <= 10; i++) {
        const a = a0 + span * i / 10; g.lineWidth = i % 2 ? 2 : 4;
        g.beginPath(); g.moveTo(128 + Math.cos(a) * 92, 128 + Math.sin(a) * 92); g.lineTo(128 + Math.cos(a) * 110, 128 + Math.sin(a) * 110); g.stroke();
        if (i % 2 === 0) g.fillText(String(i / 2), 128 + Math.cos(a) * 72, 128 + Math.sin(a) * 72);
      }
      g.font = 'bold 18px system-ui'; g.fillText('PSI x1000', 128, 178); g.fillText('DISCHARGE', 128, 200);
    });
    const gauge = new THREE.Group(); gauge.position.set(2.72, 2.32, -3.2); scene.add(gauge);
    cyl(0.2, 0.08, mat.darker, 0.03, 0, 0, gauge, 28, 'x');
    const face = mesh(new THREE.CircleGeometry(0.185, 32), new THREE.MeshBasicMaterial({ map: gtex }), -0.012, 0, 0, gauge); face.rotation.y = -Math.PI / 2;
    const needle = new THREE.Group(); needle.position.set(-0.02, 0, 0); gauge.add(needle);
    const nm = mesh(new THREE.BoxGeometry(0.008, 0.15, 0.014), new THREE.MeshBasicMaterial({ color: '#c0392b' }), 0, 0.06, 0, needle); nm.castShadow = false;
    parts.needle = needle;
    register(gauge, 'gauge', 'valves', 'Pressure gauge');
    // bleed valve on a tee under the discharge line, hose down to a drain bucket
    pipeRun([V(2.5, 1.95, -3.2), V(2.5, 1.6, -3.2)], 0.04, mat.steel);
    box(0.12, 0.12, 0.12, mat.dark, 2.5, 1.55, -3.2);
    const bl = new THREE.Group(); bl.position.set(2.42, 1.55, -3.2); scene.add(bl);
    box(0.04, 0.05, 0.32, mat.yellow, 0, 0, 0.14, bl);
    hit(bl, 0.2, 0.22, 0.42, 0, 0, 0.12);
    register(bl, 'bleed', 'valves', 'Bleed valve');
    parts.bleedLever = bl;
    pipeRun([V(2.5, 1.49, -3.2), V(2.5, 1.2, -3.0), V(2.6, 0.35, -2.75)], 0.025, mat.rubber);
    cyl(0.18, 0.35, mat.dark, 2.6, 0.18, -2.75);
    textPlane('BLEED', 0.24, 0.08, 2.43, 1.42, -3.2, -Math.PI / 2, { w: 256, h: 84, bg: '#f0b92b', fg: '#111', font: 'bold 52px system-ui' });
    parts.valves = { suction: sw, discharge: dw };
    obstacle(1.45, 3.6, -3.55, -2.5);
  }

  // ---------- local control station (START / STOP) ----------
  {
    const g = new THREE.Group(); g.position.set(1.25, 0, -1.4); scene.add(g);
    box(0.08, 1.1, 0.08, mat.steel, 0, 0.55, 0, g);
    box(0.18, 0.34, 0.3, mat.yellow, 0, 1.25, 0, g);
    const sb = cyl(0.045, 0.04, M('#1f9d55', { emissive: '#0a3', emissiveIntensity: 0.2 }), -0.1, 1.31, 0, g, 18, 'x');
    cyl(0.045, 0.04, mat.red, -0.1, 1.17, 0, g, 18, 'x');
    textPlane(['PUMP 1', 'START   STOP'], 0.26, 0.12, 1.14, 1.47, -1.4, -Math.PI / 2, { w: 256, h: 120, bg: '#111', fg: '#fff', font: 'bold 40px system-ui', sub: 'bold 26px system-ui' });
    hit(g, 0.3, 0.5, 0.42, 0, 1.25, 0);
    register(g, 'start_btn', 'start', 'Local START button');
    parts.startBtn = sb;
    obstacle(1.05, 1.45, -1.6, -1.2);
  }

  // ---------- MCC (motor control centre) with breakers, padlock and tag ----------
  {
    box(0.6, 2.1, 2.6, mat.beige, 13.7, 1.05, 6);
    box(0.62, 0.1, 2.62, mat.dark, 13.7, 0.05, 6);
    for (const z of [4.85, 7.15]) box(0.02, 2.0, 0.02, mat.dark, 13.39, 1.05, z);
    box(3, 2.8, 5, mat.white, 15.5, 1.4, 6);
    box(3.02, 0.3, 5.02, mat.green, 15.5, 2.3, 6);
    textPlane('SCR HOUSE', 1.6, 0.35, 13.98, 2.6, 4.2, -Math.PI / 2, { w: 512, h: 112, bg: '#1d4f7a' });
    textPlane(['MCC', 'MOTOR CONTROL CENTRE'], 1.2, 0.3, 13.385, 1.95, 6, -Math.PI / 2, { w: 512, h: 128, bg: '#2b2f33', fg: '#fff', font: 'bold 56px system-ui', sub: 'bold 30px system-ui' });
    obstacle(13.35, 17.0, 3.5, 8.5);
    const l = label('MCC / BREAKERS', { scale: 0.9 }); l.position.set(13.2, 2.75, 6); scene.add(l);
    parts.breakers = {};
    const zs = [5.1, 5.7, 6.3, 6.9];
    breakers.forEach((b, i) => {
      const z = zs[i];
      const unit = new THREE.Group(); scene.add(unit);
      box(0.04, 0.48, 0.44, M('#a9ada6', { metalness: 0.3 }), 13.38, 1.33, z, unit);
      const lp = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.15), new THREE.MeshBasicMaterial({ map: textTexture([b.label, b.sub], { w: 320, h: 112, bg: '#f4f4ee', fg: '#111', font: 'bold 52px system-ui', sub: 'bold 28px system-ui' }) }));
      lp.position.set(13.355, 1.66, z); lp.rotation.y = -Math.PI / 2; unit.add(lp);
      const handle = new THREE.Group(); handle.position.set(13.33, 1.33, z); unit.add(handle);
      cyl(0.065, 0.05, mat.darker, 0, 0, 0, handle, 20, 'x');
      box(0.045, 0.2, 0.06, mat.darker, -0.02, 0.09, 0, handle);
      const lamp = mesh(new THREE.SphereGeometry(0.028, 12, 8), new THREE.MeshStandardMaterial({ color: '#222', emissive: '#22ff66', emissiveIntensity: 1.4 }), 13.35, 1.14, z + 0.14, unit);
      lamp.castShadow = false;
      hit(unit, 0.12, 0.6, 0.5, 13.33, 1.4, z);
      const e = register(unit, 'breaker_' + b.id, 'mcc', b.label + ' breaker');
      parts.breakers[b.id] = { handle, lamp: lamp, z };
    });
    // lockout hasp target (glowing ring) for MP-1
    const z1 = zs[0];
    const hasp = new THREE.Group(); hasp.position.set(13.3, 1.33, z1 + 0.2); scene.add(hasp);
    const hr = mesh(new THREE.TorusGeometry(0.035, 0.009, 8, 20), mat.chrome, 0, 0, 0, hasp); hr.rotation.y = Math.PI / 2;
    const glow = mesh(new THREE.SphereGeometry(0.07, 14, 10), new THREE.MeshBasicMaterial({ color: '#ffb000', transparent: true, opacity: 0.35, depthWrite: false }), 0, 0, 0, hasp); glow.castShadow = false;
    parts.hasp = hasp; parts.haspGlow = glow;
    hit(hasp, 0.16, 0.2, 0.16);
    register(hasp, 'hasp_mp1', 'mcc', 'Lockout hasp');
    // padlock + tag
    const lock = new THREE.Group(); scene.add(lock);
    const body = box(0.035, 0.1, 0.085, M('#d0261b', { roughness: 0.4 }), 0, -0.07, 0, lock);
    box(0.036, 0.02, 0.06, mat.chrome, -0.001, -0.1, 0, lock);
    const shackle = new THREE.Group(); lock.add(shackle);
    const sm = mesh(new THREE.TorusGeometry(0.03, 0.007, 8, 18, Math.PI), mat.chrome, 0, 0, 0, shackle); sm.rotation.y = Math.PI / 2;
    for (const dz of [-0.03, 0.03]) cyl(0.007, 0.03, mat.chrome, 0, -0.015, dz, shackle, 8);
    const tagPivot = new THREE.Group(); tagPivot.position.set(0, -0.12, 0); lock.add(tagPivot);
    const tagTex = canvasTex(200, 360, () => {});
    const tag = mesh(new THREE.PlaneGeometry(0.11, 0.2), new THREE.MeshBasicMaterial({ map: tagTex, side: THREE.DoubleSide }), -0.02, -0.12, 0, tagPivot);
    tag.rotation.y = -Math.PI / 2; tag.castShadow = false;
    parts.lock = lock; parts.shackle = shackle; parts.tagPivot = tagPivot; parts.tagTex = tagTex;
    parts.lockHome = V(13.27, 1.33, z1 + 0.2);
    lock.position.copy(parts.lockHome);
    hit(lock, 0.12, 0.3, 0.16, 0, -0.08, 0);
    register(lock, 'lock_mp1', 'mcc', 'Your padlock');
  }

  // ---------- tool rack ----------
  {
    const g = new THREE.Group(); g.position.set(-3, 0, -12.7); scene.add(g);
    const peg = canvasTex(256, 128, (c, w, h) => { c.fillStyle = '#39414a'; c.fillRect(0, 0, w, h); c.fillStyle = '#20262c'; for (let y = 6; y < h; y += 12) for (let x = 6; x < w; x += 12) { c.beginPath(); c.arc(x, y, 2.2, 0, 7); c.fill(); } }, [3, 2]);
    box(0.12, 2.2, 0.12, mat.yellow, -1.8, 1.1, 0, g); box(0.12, 2.2, 0.12, mat.yellow, 1.8, 1.1, 0, g);
    const pb = mesh(new THREE.BoxGeometry(3.5, 1.5, 0.05), new THREE.MeshStandardMaterial({ map: peg, roughness: 0.8 }), 0, 1.3, 0, g);
    textPlane('TOOL STORE', 1.6, 0.3, -3, 2.3, -12.66, 0, { w: 512, h: 96, bg: '#1d4f7a', font: 'bold 54px system-ui' });
    obstacle(-4.95, -1.05, -13.1, -12.3);
    parts.tools = {};
    const toolMat = { a: M('#b9c0c6', { metalness: 0.85, roughness: 0.3 }), r: M('#b8321f'), o: M('#e1782a'), b: M('#2c4f7c'), k: M('#2a2d31', { metalness: 0.5 }) };
    const builders = {
      cover_wrench: (t) => { box(0.07, 0.5, 0.03, toolMat.o, 0, -0.12, 0, t); const h = mesh(new THREE.TorusGeometry(0.085, 0.032, 8, 6), toolMat.a, 0, 0.21, 0, t); },
      pipe_wrench: (t) => { box(0.06, 0.5, 0.03, toolMat.r, 0, -0.1, 0, t); box(0.14, 0.07, 0.04, toolMat.a, 0.03, 0.2, 0, t); box(0.04, 0.12, 0.04, toolMat.a, 0.08, 0.14, 0, t); },
      clamp_wrench: (t) => { box(0.05, 0.42, 0.025, toolMat.a, 0, -0.08, 0, t); const h = mesh(new THREE.TorusGeometry(0.06, 0.022, 8, 14, Math.PI * 1.5), toolMat.a, 0, 0.18, 0, t); h.rotation.z = -Math.PI * 0.25; },
      cheater: (t) => { cyl(0.032, 0.9, toolMat.k, 0, 0, 0, t, 12); },
      liner_puller: (t) => { cyl(0.02, 0.6, toolMat.a, 0, -0.02, 0, t, 10); cyl(0.022, 0.3, toolMat.o, 0, 0.28, 0, t, 10, 'x'); const h = mesh(new THREE.TorusGeometry(0.05, 0.015, 8, 12, Math.PI), toolMat.a, 0.05, -0.32, 0, t); h.rotation.z = Math.PI; },
      grinder: (t) => { cyl(0.05, 0.32, toolMat.b, 0, 0.05, 0, t, 14); cyl(0.11, 0.012, toolMat.k, 0, -0.16, 0.03, t, 24, 'z'); cyl(0.03, 0.14, toolMat.k, 0.09, 0.15, 0, t, 10, 'x'); },
    };
    tools.forEach((td, i) => {
      const x = -4.45 + i * 0.58;
      const t = new THREE.Group(); t.position.set(x, 1.42, -12.62); scene.add(t);
      (builders[td.id] || builders.cheater)(t);
      textPlane(td.label, 0.54, 0.11, x, 0.68, -12.665, 0, { w: 400, h: 84, bg: '#f4f4ee', fg: '#111', font: 'bold 40px system-ui' });
      hit(t, 0.42, 0.95, 0.15, 0, -0.05, 0);
      register(t, 'tool_' + td.id, 'rack', td.label);
      parts.tools[td.id] = { obj: t, home: t.position.clone() };
    });
  }

  // ---------- crewmate (for the mid-repair interruption) ----------
  {
    const n = new THREE.Group(); scene.add(n);
    box(0.16, 0.8, 0.2, mat.coverall, -0.11, 0.4, 0, n); box(0.16, 0.8, 0.2, mat.coverall, 0.11, 0.4, 0, n);
    box(0.17, 0.08, 0.28, mat.darker, -0.11, 0.04, 0.04, n); box(0.17, 0.08, 0.28, mat.darker, 0.11, 0.04, 0.04, n);
    mesh(new THREE.CapsuleGeometry(0.22, 0.45, 6, 14), mat.coverall, 0, 1.12, 0, n);
    box(0.46, 0.05, 0.3, M('#d8e021'), 0, 1.0, 0, n);
    const arms = []; for (const x of [-0.29, 0.29]) { const a = new THREE.Group(); a.position.set(x, 1.38, 0); n.add(a); mesh(new THREE.CapsuleGeometry(0.06, 0.45, 4, 8), mat.coverall, 0, -0.27, 0, a); arms.push(a); }
    mesh(new THREE.SphereGeometry(0.13, 16, 12), mat.skin, 0, 1.6, 0, n);
    mesh(new THREE.SphereGeometry(0.155, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat.white, 0, 1.66, 0, n);
    cyl(0.18, 0.015, mat.white, 0, 1.665, 0.02, n, 20);
    n.visible = false; parts.npc = n; parts.npcArms = arms;
  }

  // ---------- beacon + move marker ----------
  {
    const btex = canvasTex(4, 128, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,176,0,0)'); gr.addColorStop(1, 'rgba(255,176,0,0.55)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
    const b = new THREE.Group(); scene.add(b);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 5, 24, 1, true), new THREE.MeshBasicMaterial({ map: btex, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    col.position.y = 2.5; b.add(col);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 32), new THREE.MeshBasicMaterial({ color: '#ffb000', transparent: true, opacity: 0.8, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; b.add(ring);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.36, 4), new THREE.MeshBasicMaterial({ color: '#ffb000' }));
    arrow.rotation.x = Math.PI; b.add(arrow);
    b.visible = false; parts.beacon = { group: b, col, ring, arrow, y: 2.6 };
    const mm = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.26, 28), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false }));
    mm.rotation.x = -Math.PI / 2; mm.position.y = 0.03; mm.visible = false; scene.add(mm); parts.moveMarker = mm;
  }

  const stations = {
    muster: { center: V(-16, 0, 10.3), stand: [-14.1, 9.3], look: V(-17.6, 1.8, 8.8), visitR: 3.4 },
    pump: { center: V(2.2, 0, -5), stand: [-0.45, -4.75], look: V(2.5, 0.8, -5.3), visitR: 3.8 },
    valves: { center: V(1.9, 0, -3.1), stand: [0.55, -2.2], look: V(2.15, 1.55, -3.2) },
    start: { center: V(1.25, 0, -1.4), stand: [-0.3, -1.2], look: V(1.2, 1.25, -1.4) },
    mcc: { center: V(12.8, 0, 6), stand: [11.85, 5.85], look: V(13.35, 1.4, 5.85), visitR: 3.8 },
    permit: { center: V(-12.9, 0, -2.4), stand: [-11.6, -2.4], look: V(-13.44, 1.5, -2.4) },
    locker: { center: V(-12.8, 0, -7.6), stand: [-11.3, -7.6], look: V(-13.2, 1.0, -7.6) },
    rack: { center: V(-3, 0, -11.8), stand: [-3, -10.5], look: V(-3, 1.2, -12.6) },
    pump2: { center: V(2.2, 0, -11), stand: [0.3, -9.4], look: V(3, 1.1, -11) },
  };

  // ---------- per-frame updates ----------
  let highlighted = new Set();
  const hiColor = new THREE.Color('#ffb000');
  const black = new THREE.Color('#000');
  parts.pump1Speed = 0; parts.pump2Speed = 1;
  const phase = { p1: 0, p2: 0 };
  function animatePump(p, key, speed, dt) {
    phase[key] += dt * speed * 7;
    p.sheave.rotation.z = -phase[key];
    const amp = Math.min(1, speed); p.rods.forEach((r, i) => { r.position.x = Math.sin(phase[key] + i * 2.094) * 0.12 * amp; });
  }
  function update(dt, t) {
    animatePump(p2, 'p2', parts.pump2Speed, dt);
    animatePump(p1, 'p1', parts.pump1Speed, dt);
    if (parts.pump2Speed > 0.5) p2.g.position.y = Math.sin(t * 40) * 0.003;
    const bc = parts.beacon;
    if (bc.group.visible) { bc.arrow.position.y = bc.y + Math.sin(t * 3) * 0.15; bc.arrow.rotation.y = t * 1.5; bc.ring.scale.setScalar(1 + (t * 0.8 % 1) * 0.5); bc.ring.material.opacity = 0.8 * (1 - (t * 0.8 % 1)); }
    const pulse = 0.35 + 0.3 * Math.sin(t * 5);
    for (const e of interactables) {
      const on = highlighted.has(e.iid);
      for (const m of e.meshes) { const mt = m.material; if (!mt.emissive || mt === undefined) continue; if (e.iid.startsWith('breaker_') && m.geometry.type === 'SphereGeometry') continue; if (on) { mt.emissive.copy(hiColor); mt.emissiveIntensity = pulse; } else if (mt.emissiveIntensity !== 0 && !mt.userData.keep) { mt.emissive.copy(black); mt.emissiveIntensity = 0; } }
    }
    parts.haspGlow.material.opacity = 0.2 + 0.2 * Math.sin(t * 5);
  }
  function setHighlights(ids) { highlighted = new Set(ids); }

  return { interactables, byId, obstacles, parts, stations, update, setHighlights, mat };
}
