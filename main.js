import * as THREE from 'three';

// ---------------------------------------------------------------- LAST FRAME
// A midnight bowling lane for Quest 3 (WebXR) and desktop.
// Custom pin physics, full ten-frame scoring, synth audio. No network deps.

const params = new URLSearchParams(location.search);
const SEEK = parseFloat(params.get('seek') || '0'); // deterministic sim seconds for testing
const AUTOTHROW = params.has('seek') || params.has('throw');

// ------------------------------------------------------------------- audio
const Audio_ = {
  ctx: null, master: null, rollGain: null, rollFilter: null, rollSrc: null,
  ready: false,
  init() {
    if (this.ready) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.85;
      this.master.connect(this.ctx.destination);
      // looping roll rumble
      const len = this.ctx.sampleRate * 2;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
      this.rollSrc = this.ctx.createBufferSource();
      this.rollSrc.buffer = buf; this.rollSrc.loop = true;
      this.rollFilter = this.ctx.createBiquadFilter();
      this.rollFilter.type = 'lowpass'; this.rollFilter.frequency.value = 240;
      this.rollGain = this.ctx.createGain(); this.rollGain.gain.value = 0;
      this.rollSrc.connect(this.rollFilter).connect(this.rollGain).connect(this.master);
      this.rollSrc.start();
      // faint room tone
      const tone = this.ctx.createOscillator(); tone.type = 'sine'; tone.frequency.value = 52;
      const tg = this.ctx.createGain(); tg.gain.value = 0.012;
      tone.connect(tg).connect(this.master); tone.start();
      this.ready = true;
    } catch (e) { /* audio stays off */ }
  },
  setRoll(speed) {
    if (!this.ready) return;
    const g = Math.min(0.5, speed * 0.055);
    this.rollGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.08);
    this.rollFilter.frequency.setTargetAtTime(180 + speed * 40, this.ctx.currentTime, 0.1);
  },
  thump(vol = 0.5, freq = 90) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.16);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.25);
  },
  clatter(n = 3) {
    if (!this.ready) return;
    const t0 = this.ctx.currentTime;
    for (let i = 0; i < n; i++) {
      const t = t0 + Math.random() * 0.09 + i * 0.02;
      const len = this.ctx.sampleRate * 0.09;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let k = 0; k < len; k++) d[k] = (Math.random() * 2 - 1) * Math.pow(1 - k / len, 2.2);
      const src = this.ctx.createBufferSource(); src.buffer = buf;
      const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = 900 + Math.random() * 2400; bp.Q.value = 2.5;
      const g = this.ctx.createGain(); g.gain.value = 0.30 + Math.random() * 0.2;
      src.connect(bp).connect(g).connect(this.master); src.start(t);
      const o = this.ctx.createOscillator(); o.type = 'triangle';
      o.frequency.value = 1400 + Math.random() * 1400;
      const og = this.ctx.createGain();
      og.gain.setValueAtTime(0.10, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      o.connect(og).connect(this.master); o.start(t); o.stop(t + 0.08);
    }
  },
  sweep() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const len = this.ctx.sampleRate * 0.9;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let k = 0; k < len; k++) d[k] = (Math.random() * 2 - 1) * Math.sin((k / len) * Math.PI);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const g = this.ctx.createGain(); g.gain.value = 0.22;
    src.connect(lp).connect(g).connect(this.master); src.start(t);
  },
};

// ------------------------------------------------------------------ setup
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d12);
scene.fog = new THREE.Fog(0x0b0d12, 9, 34);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 80);
const rig = new THREE.Group();
rig.add(camera);
rig.position.set(0, 0, 2.3);
scene.add(rig);
camera.position.set(0, 1.7, 0.3);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- constants
const BALL_R = 0.108;
const PIN_R = 0.065;
const PIN_H = 0.38;
const LANE_HALF = 0.53;
const GUTTER_X = 0.648;
const FOUL_Z = 0.8;            // foul line; lane surface runs toward -z
const HEAD_Z = -17.0;          // head pin
const PIT_Z = -19.5;
const RACK_POS = new THREE.Vector3(0.74, 0.92, 1.75);
const M_BALL = 6.8, M_PIN = 1.6;

// lane geometry: player stands at +z, throws toward -z
const LANE = { z0: FOUL_Z, z1: -19.8 }; // playable wood

// ---------------------------------------------------------------- textures
function laneTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 2048;
  const g = c.getContext('2d');
  // maple boards
  for (let i = 0; i < 20; i++) {
    const x = (i / 20) * c.width;
    const hue = 34 + Math.sin(i * 7.3) * 4;
    const lit = 30 + Math.sin(i * 3.1) * 4;
    g.fillStyle = `hsl(${hue}, 34%, ${lit}%)`;
    g.fillRect(x, 0, c.width / 20 + 1, c.height);
  }
  // grain
  g.globalAlpha = 0.10;
  for (let i = 0; i < 340; i++) {
    g.strokeStyle = Math.random() > 0.5 ? '#000' : '#fff';
    g.lineWidth = 1;
    const x = Math.random() * c.width, y = Math.random() * c.height;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 6, y + 60 + Math.random() * 140); g.stroke();
  }
  g.globalAlpha = 1;
  // arrows: seven arrowheads pointing down-lane (canvas y grows toward foul line/player)
  const ay = c.height * 0.72;
  g.fillStyle = 'rgba(20,16,12,0.85)';
  for (let i = 0; i < 7; i++) {
    const x = c.width * (0.14 + i * 0.12);
    g.beginPath();
    g.moveTo(x - 7, ay + 66); g.lineTo(x + 7, ay + 66); g.lineTo(x, ay); g.closePath(); g.fill();
  }
  // dots row
  for (let i = 0; i < 5; i++) {
    const x = c.width * (0.22 + i * 0.14);
    g.beginPath(); g.arc(x, c.height * 0.86, 6, 0, 7); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function pinTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ece7db'; g.fillRect(0, 0, 128, 256);
  const sheen = g.createLinearGradient(0, 0, 128, 0);
  sheen.addColorStop(0, 'rgba(0,0,0,0.16)'); sheen.addColorStop(0.5, 'rgba(255,255,255,0.08)'); sheen.addColorStop(1, 'rgba(0,0,0,0.16)');
  g.fillStyle = sheen; g.fillRect(0, 0, 128, 256);
  // neck stripes (lathe v=0 is bottom; stripes near v .60-.72 -> canvas y 72-102)
  g.fillStyle = '#c8332b';
  g.fillRect(0, 74, 128, 12);
  g.fillRect(0, 94, 128, 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function ballTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#222634'; g.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 26; i++) {
    g.strokeStyle = `hsla(${225 + Math.random() * 40}, 50%, ${34 + Math.random() * 16}%, 0.55)`;
    g.lineWidth = 1 + Math.random() * 3;
    g.beginPath();
    const y = Math.random() * 128;
    g.moveTo(0, y);
    g.bezierCurveTo(80, y + (Math.random() - 0.5) * 60, 170, y + (Math.random() - 0.5) * 60, 256, y + (Math.random() - 0.5) * 30);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function signTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#101319'; g.fillRect(0, 0, 1024, 256);
  g.strokeStyle = '#2a2f3e'; g.lineWidth = 4; g.strokeRect(10, 10, 1004, 236);
  g.font = '600 96px ui-monospace, Menlo, monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#e8e4da';
  g.fillText('LAST FRAME', 512, 112);
  g.font = '28px ui-monospace, Menlo, monospace';
  g.fillStyle = '#c8332b';
  g.fillText('- OPEN ALL NIGHT -', 512, 196);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- environment
const world = new THREE.Group();
scene.add(world);

{
  const laneLen = LANE.z0 - LANE.z1;
  const laneGeo = new THREE.PlaneGeometry(LANE_HALF * 2, laneLen);
  const lane = new THREE.Mesh(laneGeo, new THREE.MeshStandardMaterial({
    map: laneTexture(), roughness: 0.35, metalness: 0.05,
  }));
  lane.rotation.x = -Math.PI / 2;
  lane.position.set(0, 0, (LANE.z0 + LANE.z1) / 2);
  lane.receiveShadow = true;
  world.add(lane);

  // foul line
  const foul = new THREE.Mesh(
    new THREE.BoxGeometry(LANE_HALF * 2 + 0.46, 0.004, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x14110d, roughness: 0.6 }));
  foul.position.set(0, 0.002, FOUL_Z);
  world.add(foul);

  // gutters
  const gutterMat = new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.45, metalness: 0.35 });
  for (const s of [-1, 1]) {
    const gut = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, laneLen, 20, 1, true, Math.PI, Math.PI), gutterMat);
    gut.rotation.x = -Math.PI / 2;
    gut.position.set(s * GUTTER_X, 0.055, (LANE.z0 + LANE.z1) / 2);
    world.add(gut);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, laneLen), gutterMat);
    rail.position.set(s * (GUTTER_X + 0.15), 0.035, (LANE.z0 + LANE.z1) / 2);
    world.add(rail);
  }

  // approach floor (behind foul line)
  const app = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshStandardMaterial({
    color: 0x2b2118, roughness: 0.8 }));
  app.rotation.x = -Math.PI / 2;
  app.position.set(0, -0.001, FOUL_Z + 3);
  app.receiveShadow = true;
  world.add(app);

  // pit
  const pit = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 1.2),
    new THREE.MeshStandardMaterial({ color: 0x05060a, roughness: 1 }));
  pit.position.set(0, -0.05, -20.3);
  world.add(pit);
  const cushion = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 0.25),
    new THREE.MeshStandardMaterial({ color: 0x0d0f14, roughness: 0.9 }));
  cushion.position.set(0, 0.8, -20.85);
  world.add(cushion);

  // masking wall + sign
  const mask = new THREE.Mesh(new THREE.BoxGeometry(8, 2.6, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x12151d, roughness: 0.9 }));
  mask.position.set(0, 1.9, -21.1);
  world.add(mask);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.15),
    new THREE.MeshBasicMaterial({ map: signTexture() }));
  sign.position.set(0, 2.3, -20.97);
  world.add(sign);

  // walls and ceiling
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x1d2130, roughness: 0.95 });
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(30, 4.2), wallMat);
    w.rotation.y = -s * Math.PI / 2;
    w.position.set(s * 3.4, 2.1, -8);
    world.add(w);
  }
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(8, 30),
    new THREE.MeshStandardMaterial({ color: 0x0d0f15, roughness: 1 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, 4.2, -8);
  world.add(ceil);
  const wallBack = new THREE.Mesh(new THREE.PlaneGeometry(8, 4.2), wallMat);
  wallBack.position.set(0, 2.1, 6.5);
  wallBack.rotation.y = Math.PI;
  world.add(wallBack);

  // ceiling light strips
  const stripMat = new THREE.MeshBasicMaterial({ color: 0xffe9c9 });
  for (let i = 0; i < 6; i++) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 2.6), stripMat);
    strip.rotation.x = Math.PI / 2;
    strip.rotation.y = Math.PI / 2;
    strip.position.set(0, 4.19, 2 - i * 4);
    world.add(strip);
  }

  // ball return pedestal
  const pedH = RACK_POS.y - 0.1;
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, pedH, 18),
    new THREE.MeshStandardMaterial({ color: 0x1c202b, roughness: 0.5, metalness: 0.4 }));
  ped.position.set(RACK_POS.x, pedH / 2, RACK_POS.z);
  world.add(ped);
  const cup = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.02, 10, 24),
    new THREE.MeshStandardMaterial({ color: 0x7e2a24, roughness: 0.7, metalness: 0.1 }));
  cup.rotation.x = Math.PI / 2;
  cup.position.set(RACK_POS.x, RACK_POS.y - 0.1, RACK_POS.z);
  world.add(cup);

  // bench
  const bench = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x3a2c20, roughness: 0.7 }));
  bench.position.set(-1.8, 0.55, 4.6);
  world.add(bench);
  for (const dx of [-0.9, 0.9]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x241b13, roughness: 0.8 }));
    leg.position.set(-1.8 + dx, 0.27, 4.6);
    world.add(leg);
  }

  // lights
  scene.add(new THREE.HemisphereLight(0x9aa2bb, 0x241a10, 0.95));
  const key = new THREE.SpotLight(0xfff1dd, 55, 30, Math.PI / 3.4, 0.5, 1.6);
  key.position.set(0, 4.0, -7);
  key.target.position.set(0, 0, -9);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0004;
  scene.add(key, key.target);
  const front = new THREE.SpotLight(0xffe6c4, 30, 20, Math.PI / 3, 0.6, 1.8);
  front.position.set(0, 4.0, 2.5);
  front.target.position.set(0, 0, 0);
  scene.add(front, front.target);
  const fill = new THREE.PointLight(0xffe2b8, 22, 14, 1.3);
  const wash1 = new THREE.PointLight(0x8fa0c8, 10, 16, 1.5);
  wash1.position.set(-2.6, 2.6, -6); scene.add(wash1);
  const wash2 = new THREE.PointLight(0x8fa0c8, 10, 16, 1.5);
  wash2.position.set(2.6, 2.6, -12); scene.add(wash2);
  const fill2 = fill;
  fill.position.set(0, 3.2, 2.6);
  scene.add(fill);
  const pinSpot = new THREE.SpotLight(0xffffff, 40, 14, Math.PI / 4.5, 0.5, 1.6);
  pinSpot.position.set(0, 3.9, -16.5);
  pinSpot.target.position.set(0, 0, -17.4);
  scene.add(pinSpot, pinSpot.target);
}

// ---------------------------------------------------------------- scoreboard
const sbCanvas = document.createElement('canvas');
sbCanvas.width = 1400; sbCanvas.height = 560;
const sbCtx = sbCanvas.getContext('2d');
const sbTex = new THREE.CanvasTexture(sbCanvas);
sbTex.colorSpace = THREE.SRGBColorSpace;
const sbMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.36),
  new THREE.MeshBasicMaterial({ map: sbTex, transparent: true }));
sbMesh.position.set(0, 3.05, -17.9);
world.add(sbMesh);

// ------------------------------------------------------------------- pins
const PIN_PROFILE = [
  [0.001, 0], [0.045, 0], [0.054, 0.02], [0.060, 0.06], [0.062, 0.10],
  [0.059, 0.14], [0.049, 0.18], [0.037, 0.215], [0.031, 0.24], [0.031, 0.27],
  [0.035, 0.30], [0.037, 0.325], [0.031, 0.35], [0.017, 0.365], [0.001, PIN_H],
].map(p => new THREE.Vector2(p[0], p[1]));
const pinGeo = new THREE.LatheGeometry(PIN_PROFILE, 26);
const pinMat = new THREE.MeshStandardMaterial({ map: pinTexture(), roughness: 0.32, metalness: 0.02 });

const PIN_LAYOUT = (() => {
  const s = 0.3048, d = 0.3048 * 0.866;
  return [
    [0, 0],
    [-s / 2, -d], [s / 2, -d],
    [-s, -2 * d], [0, -2 * d], [s, -2 * d],
    [-1.5 * s, -3 * d], [-s / 2, -3 * d], [s / 2, -3 * d], [1.5 * s, -3 * d],
  ].map(p => ({ x: p[0], z: HEAD_Z + p[1] }));
})();

const pins = [];
for (let i = 0; i < 10; i++) {
  const mesh = new THREE.Mesh(pinGeo, pinMat);
  mesh.castShadow = true;
  world.add(mesh);
  pins.push({
    i, mesh,
    home: PIN_LAYOUT[i],
    x: PIN_LAYOUT[i].x, z: PIN_LAYOUT[i].z, y: 0,
    vx: 0, vz: 0,
    state: 'standing',      // standing | falling | fallen | pit | cleared
    fallT: 0, fallAxis: new THREE.Vector3(1, 0, 0), fallDir: 0,
    cooldown: 0, wobble: Math.random() * 6.28,
    counted: false,
  });
}

function placePins(full) {
  for (const p of pins) {
    if (full) {
      p.x = p.home.x; p.z = p.home.z; p.y = 0;
      p.state = 'standing';
    } else if (p.state !== 'standing') {
      continue; // dead pins already swept
    }
    p.vx = 0; p.vz = 0; p.cooldown = 0; p.counted = false;
    p.mesh.rotation.set(0, 0, 0);
    p.mesh.visible = p.state === 'standing';
    p.mesh.position.set(p.x, p.y, p.z);
  }
}
placePins(true);

// ------------------------------------------------------------------- ball
const ball = {
  mesh: new THREE.Mesh(
    new THREE.SphereGeometry(BALL_R, 36, 26),
    new THREE.MeshPhysicalMaterial({
      map: ballTexture(), roughness: 0.22, clearcoat: 0.9, clearcoatRoughness: 0.18,
    })),
  vel: new THREE.Vector3(),
  spin: 0,
  state: 'rack',           // rack | held | thrown | done
  crossedFoul: false, inGutter: false, airborne: false, stillT: 0, fade: 1,
};
ball.mesh.castShadow = true;
ball.mesh.position.copy(RACK_POS);
world.add(ball.mesh);

function returnBall() {
  ball.state = 'rack';
  ball.vel.set(0, 0, 0);
  ball.spin = 0; ball.fade = 1;
  ball.crossedFoul = false; ball.inGutter = false; ball.airborne = false; ball.stillT = 0;
  ball.mesh.visible = true;
  ball.mesh.material.opacity = 1; ball.mesh.material.transparent = false;
  ball.mesh.scale.setScalar(1);
  ball.mesh.position.copy(RACK_POS);
}

// ---------------------------------------------------------------- sweeper
const sweepMesh = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 0.08),
  new THREE.MeshStandardMaterial({ color: 0x2a2e3a, roughness: 0.4, metalness: 0.5 }));
sweepMesh.position.set(0, 0.55, HEAD_Z + 0.35);
sweepMesh.visible = false;
world.add(sweepMesh);
let sweepT = 0;

// ---------------------------------------------------------------- game state
const G = {
  phase: 'ready',   // ready | play | settle | sweep | rack | over
  frame: 1, throwInFrame: 1,
  rolls: [],
  settleT: 0, rackT: 0,
  tenthRack: 0,   // rack count inside frame 10
};

function standingCount() { return pins.filter(p => p.state === 'standing').length; }

function newGame() {
  G.phase = 'ready'; G.frame = 1; G.throwInFrame = 1; G.rolls = []; G.tenthRack = 0;
  placePins(true);
  returnBall();
  drawScore();
  updateHud();
}

function recordThrow() {
  // count pins that fell this throw
  let n = 0;
  for (const p of pins) {
    if (!p.counted && p.state !== 'standing') { p.counted = true; n++; }
  }
  G.rolls.push(n);

  const tenth = G.frame === 10;
  let needRack = false, frameDone = false;

  if (!tenth) {
    if (G.throwInFrame === 1 && n === 10) { frameDone = true; needRack = true; }
    else if (G.throwInFrame === 2) { frameDone = true; needRack = true; }
    else { G.throwInFrame = 2; }
  } else {
    // frame 10: up to 3 throws
    const r = G.rolls;
    const base = r.length - 1; // index of this throw
    const t = G.throwInFrame;
    if (t === 1) {
      needRack = (n === 10);
      G.throwInFrame = 2;
    } else if (t === 2) {
      const first = r[base - 1];
      const strikeFirst = first === 10;
      const spare = !strikeFirst && (first + n === 10);
      if (strikeFirst || spare) { needRack = true; G.throwInFrame = 3; }
      else frameDone = true;
    } else {
      frameDone = true;
    }
    if (needRack) G.tenthRack++;
  }

  if (frameDone) {
    if (G.frame === 10) { G.phase = 'over'; }
    else {
      G.frame++; G.throwInFrame = 1;
      needRack = true;
    }
  }

  G.phase = frameDone && G.frame === 10 ? 'over' : 'sweep';
  G.needRack = needRack;
  sweepT = 0;
  sweepMesh.visible = true;
  Audio_.sweep();
  drawScore();
  updateHud();
}

function pinsStandingAtRack() { return standingCount(); }

// scoring: compute per-frame cumulative from rolls
function computeScores() {
  const r = G.rolls;
  const frames = [];
  let ri = 0, total = 0;
  for (let f = 0; f < 10; f++) {
    if (ri >= r.length) { frames.push(null); continue; }
    const marks = [];
    let done = false, sc = null;
    if (f < 9) {
      if (r[ri] === 10) {
        marks.push('', 'X');
        if (ri + 2 < r.length) { sc = 10 + r[ri + 1] + r[ri + 2]; done = true; }
        else if (ri + 2 === r.length && G.phase === 'over') { sc = 10 + r[ri + 1] + r[ri + 2]; done = true; }
        ri += 1;
      } else if (ri + 1 < r.length) {
        if (r[ri] + r[ri + 1] === 10) {
          marks.push(r[ri] === 0 ? '-' : String(r[ri]), '/');
          if (ri + 2 < r.length) { sc = 10 + r[ri + 2]; done = true; }
          else if (ri + 2 === r.length && G.phase === 'over') { sc = 10 + r[ri + 2]; done = true; }
        } else {
          marks.push(r[ri] === 0 ? '-' : String(r[ri]), r[ri + 1] === 0 ? '-' : String(r[ri + 1]));
          sc = r[ri] + r[ri + 1]; done = true;
        }
        ri += 2;
      } else {
        marks.push(r[ri] === 0 ? '-' : String(r[ri]), '');
        ri += 1;
      }
    } else {
      // 10th frame marks
      const rem = r.slice(ri);
      const m = [];
      for (let k = 0; k < Math.min(3, rem.length); k++) {
        const v = rem[k];
        if (v === 10) m.push('X');
        else if (k > 0 && rem[k - 1] !== 10 && rem[k - 1] + v === 10) m.push('/');
        else if (k > 0 && rem[k - 1] === 10 && v === 10) m.push('X');
        else m.push(v === 0 ? '-' : String(v));
      }
      // spare in 10th after open first ball
      if (rem.length >= 2 && rem[0] !== 10 && rem[0] + rem[1] === 10) m[1] = '/';
      if (rem.length === 3 && rem[1] !== 10 && rem[1] + rem[2] === 10 && rem[0] === 10) m[2] = '/';
      while (m.length < 3) m.push('');
      frames.push({ marks: m, cum: null });
      ri = r.length;
      if (G.phase === 'over') {
        let s10 = 0;
        for (let k = 0; k < Math.min(3, rem.length); k++) s10 += rem[k];
        total += s10;
        frames[9].cum = total;
      }
      continue;
    }
    if (done && sc !== null) { total += sc; frames.push({ marks, cum: total }); }
    else frames.push({ marks, cum: null });
  }
  return frames;
}

function drawScore() {
  const g = sbCtx;
  g.clearRect(0, 0, sbCanvas.width, sbCanvas.height);
  g.fillStyle = 'rgba(10,12,18,0.92)';
  g.fillRect(0, 0, 1400, 560);
  g.strokeStyle = '#2c3140'; g.lineWidth = 3; g.strokeRect(6, 6, 1388, 548);
  g.fillStyle = '#e8e4da';
  g.font = '600 44px ui-monospace, Menlo, monospace';
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillText('LAST FRAME', 40, 80);
  g.fillStyle = '#c8332b';
  g.fillRect(40, 100, 250, 4);

  const fr = computeScores();
  const x0 = 40, y0 = 140, w = 120, mh = 60, ch = 70;
  g.font = '28px ui-monospace, Menlo, monospace';
  for (let f = 0; f < 10; f++) {
    const x = x0 + f * (w + 10);
    const cur = (f + 1 === G.frame && G.phase !== 'over');
    g.fillStyle = cur ? 'rgba(200,51,43,0.18)' : 'rgba(255,255,255,0.04)';
    g.fillRect(x, y0, w, mh + ch);
    g.strokeStyle = cur ? '#c8332b' : '#2c3140'; g.lineWidth = 2;
    g.strokeRect(x, y0, w, mh + ch);
    // frame number
    g.fillStyle = '#6f7488'; g.font = '22px ui-monospace, Menlo, monospace';
    g.textAlign = 'center';
    g.fillText(String(f + 1), x + w / 2, y0 - 12);
    // marks
    const frData = fr[f];
    g.fillStyle = '#e8e4da'; g.font = '600 30px ui-monospace, Menlo, monospace';
    if (frData) {
      const ms = frData.marks;
      if (f < 9) {
        g.fillText(ms[0] || '', x + w * 0.28, y0 + 40);
        g.fillText(ms[1] || '', x + w * 0.72, y0 + 40);
      } else {
        g.fillText(ms[0] || '', x + w * 0.2, y0 + 40);
        g.fillText(ms[1] || '', x + w * 0.5, y0 + 40);
        g.fillText(ms[2] || '', x + w * 0.8, y0 + 40);
      }
      if (frData.cum !== null && frData.cum !== undefined) {
        g.font = '600 40px ui-monospace, Menlo, monospace';
        g.fillStyle = '#b9bdc9';
        g.fillText(String(frData.cum), x + w / 2, y0 + mh + 48);
      }
    }
  }
  // total / status
  const frames = computeScores();
  let total = 0;
  for (const f of frames) if (f && f.cum !== null && f.cum !== undefined) total = f.cum;
  g.textAlign = 'right';
  g.fillStyle = '#e8e4da';
  g.font = '600 60px ui-monospace, Menlo, monospace';
  g.fillText(String(total), 1360, 84);
  g.font = '24px ui-monospace, Menlo, monospace';
  g.fillStyle = '#8b8fa0';
  let status = 'FRAME ' + G.frame + ' - BALL ' + G.throwInFrame;
  if (G.phase === 'over') status = 'GAME OVER - ' + (renderer.xr.isPresenting ? 'TRIGGER TO RESTART' : 'PRESS ENTER FOR NEW GAME');
  g.fillText(status, 1360, 118);
  // last roll banner
  if (G.rolls.length) {
    const last = G.rolls[G.rolls.length - 1];
    g.textAlign = 'left';
    g.font = '600 64px ui-monospace, Menlo, monospace';
    g.fillStyle = last === 10 ? '#c8332b' : '#e8e4da';
    const label = last === 10 ? 'STRIKE' : (last === 0 ? 'GUTTER' : 'LAST BALL: ' + last);
    g.fillText(label, 40, 320);
  }
  sbTex.needsUpdate = true;
}
drawScore();

// ---------------------------------------------------------------- HUD (desktop)
const hudEl = document.getElementById('hud');
const hintEl = document.getElementById('hint');
function updateHud() {
  const frames = computeScores();
  let total = 0;
  for (const f of frames) if (f && f.cum != null) total = f.cum;
  const lines = [];
  lines.push('FRAME ' + G.frame + '  BALL ' + G.throwInFrame + '  TOTAL ' + total);
  const marks = [];
  for (let f = 0; f < 10; f++) {
    const d = frames[f];
    if (!d) { marks.push('[  ]'); continue; }
    marks.push('[' + d.marks.map(m => m || ' ').join('') + (d.cum != null ? ' ' + d.cum : '') + ']');
  }
  lines.push(marks.join(' '));
  if (G.phase === 'over') lines.push('GAME OVER - ENTER for new game');
  hudEl.textContent = lines.join('\n');
}

// ---------------------------------------------------------------- physics
const tmpV = new THREE.Vector3();

function stepBall(dt) {
  if (ball.state !== 'thrown') return;
  const p = ball.mesh.position, v = ball.vel;
  const onLaneSurface = !ball.airborne && !ball.inGutter;

  if (ball.airborne) {
    v.y -= 9.81 * dt;
    p.addScaledVector(v, dt);
    const floorY = ball.inGutter ? BALL_R - 0.06 : BALL_R;
    if (p.y <= floorY) {
      p.y = floorY;
      if (Math.abs(v.y) > 1.2) { Audio_.thump(0.5, 70); v.y = -v.y * 0.22; }
      else { v.y = 0; ball.airborne = false; }
    }
    return;
  }

  if (ball.inGutter) {
    p.y = BALL_R - 0.06;
    p.x += (Math.sign(p.x) * GUTTER_X - p.x) * Math.min(1, 8 * dt);
    v.x *= Math.exp(-6 * dt);
    const sp = Math.hypot(v.x, v.z);
    if (sp > 0) {
      const dec = 0.35 * dt;
      const ns = Math.max(0, sp - dec);
      v.x *= ns / sp; v.z *= ns / sp;
    }
    p.x += v.x * dt; p.z += v.z * dt;
  } else {
    p.y = BALL_R;
    // enter gutter?
    if (p.z < FOUL_Z && Math.abs(p.x) > LANE_HALF + 0.02) {
      ball.inGutter = true;
      Audio_.thump(0.3, 120);
    }
    const sp = Math.hypot(v.x, v.z);
    if (sp > 0) {
      const dec = 0.8 * dt;
      const ns = Math.max(0, sp - dec);
      v.x *= ns / sp; v.z *= ns / sp;
    }
    // hook from spin
    if (Math.abs(ball.spin) > 0.05 && sp > 1) {
      v.x += -ball.spin * 0.30 * Math.min(sp / 9, 1) * dt;
      ball.spin *= Math.exp(-0.5 * dt);
    }
    p.x += v.x * dt; p.z += v.z * dt;
    if (p.z < FOUL_Z) ball.crossedFoul = true;
    if (Math.abs(p.x) > 0.72) p.x = Math.sign(p.x) * 0.72;
  }

  // visual roll
  const sp = Math.hypot(v.x, v.z);
  if (sp > 0.01) {
    tmpV.set(v.z, 0, -v.x).normalize();
    ball.mesh.rotateOnWorldAxis(tmpV, sp * dt / BALL_R);
  }
  ball.mesh.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), ball.spin * dt);
  Audio_.setRoll(ball.inGutter || !ball.airborne ? sp : 0);

  // pit
  if (p.z < PIT_Z) {
    Audio_.setRoll(0);
    Audio_.thump(0.4, 60);
    ball.state = 'done';
    ball.mesh.visible = false;
    return;
  }
  // thrown backward / out of play
  if (p.z > 7 || Math.abs(p.x) > 4) { ball.state = 'done'; ball.mesh.visible = false; return; }

  // stopped short: count it once it crossed the foul line, else return it
  if (sp < 0.06 && !ball.crossedFoul && !ball.inGutter) {
    ball.stillT += dt;
    if (ball.stillT > 1.2) { returnBall(); }
  } else if (sp < 0.06) {
    ball.stillT += dt;
    if (ball.stillT > 1.0) { ball.state = 'done'; ball.mesh.visible = false; }
  } else {
    ball.stillT = 0;
  }
}

function stepPins(dt) {
  for (const p of pins) {
    p.cooldown = Math.max(0, p.cooldown - dt);
    if (p.state === 'standing') {
      const sp = Math.hypot(p.vx, p.vz);
      if (sp > 0.01) {
        const dec = 2.6 * dt;
        const ns = Math.max(0, sp - dec);
        p.vx *= ns / sp; p.vz *= ns / sp;
        p.x += p.vx * dt; p.z += p.vz * dt;
        // fall if hit hard, else wobble
        if (sp > 1.05) {
          p.state = 'falling';
          p.fallT = 0;
          p.fallDir = Math.atan2(p.vz, p.vx);
          p.fallAxis.set(Math.sin(p.fallDir), 0, -Math.cos(p.fallDir)).normalize();
        }
      }
      if (p.state === 'standing') {
        // wobble visual
        p.wobble += dt * 9;
        const sp2 = Math.hypot(p.vx, p.vz);
        const tilt = Math.min(0.16, sp2 * 0.18) * (0.6 + 0.4 * Math.sin(p.wobble));
        p.mesh.rotation.set(Math.cos(p.fallDir || 0) * 0, 0, 0);
        if (sp2 > 0.01) {
          const dir = Math.atan2(p.vz, p.vx);
          p.mesh.rotation.set(Math.sin(dir) * tilt, 0, -Math.cos(dir) * tilt);
        } else {
          p.mesh.rotation.set(0, 0, 0);
        }
        p.mesh.position.set(p.x, 0, p.z);
      }
    }
    if (p.state === 'falling') {
      p.fallT += dt;
      const k = Math.min(1, p.fallT / 0.38);
      const ang = (Math.PI / 2 - 0.06) * (1 - Math.pow(1 - k, 2));
      // slide while falling
      p.x += p.vx * dt; p.z += p.vz * dt;
      p.vx *= Math.exp(-3 * dt); p.vz *= Math.exp(-3 * dt);
      const bounce = k >= 1 ? 0 : Math.sin(k * Math.PI) * 0.02;
      p.mesh.rotation.set(0, 0, 0);
      p.mesh.rotateOnWorldAxis(p.fallAxis, ang);
      // pin pivot: rotate around base contact - approximate by offsetting along fall dir
      const off = Math.sin(ang) * PIN_H * 0.35;
      p.mesh.position.set(
        p.x + Math.cos(p.fallDir) * off,
        bounce + Math.sin(Math.min(ang, Math.PI / 2)) * 0.02,
        p.z + Math.sin(p.fallDir) * off);
      if (k >= 1) {
        p.state = 'fallen';
        p.fallT = 0;
        // off the deck?
        if (p.z < PIT_Z - 0.15 || Math.abs(p.x) > 1.05) { p.state = 'pit'; p.mesh.visible = false; }
      }
    } else if (p.state === 'fallen') {
      p.fallT += dt;
      // dead wood slides a bit
      p.x += p.vx * dt; p.z += p.vz * dt;
      p.vx *= Math.exp(-4 * dt); p.vz *= Math.exp(-4 * dt);
      const ang = Math.PI / 2 - 0.06;
      const off = Math.sin(ang) * PIN_H * 0.35;
      p.mesh.position.set(p.x + Math.cos(p.fallDir) * off, 0.02, p.z + Math.sin(p.fallDir) * off);
      if (p.z < PIT_Z - 0.15 || Math.abs(p.x) > 1.1) { p.state = 'pit'; p.mesh.visible = false; }
    }
  }

  // ball vs pins
  if (ball.state === 'thrown' && !ball.inGutter && !ball.airborne) {
    const bp = ball.mesh.position;
    for (const p of pins) {
      if (p.state === 'pit' || p.state === 'cleared') continue;
      if (p.state === 'fallen' && p.fallT > 0.6) continue;
      const rr = BALL_R + (p.state === 'standing' ? PIN_R : 0.10);
      const dx = p.x - bp.x, dz = p.z - bp.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const nx = dx / d, nz = dz / d;
        const rvx = ball.vel.x - p.vx, rvz = ball.vel.z - p.vz;
        const rel = rvx * nx + rvz * nz;
        if (rel > 0) {
          const e = 0.55;
          const j = (1 + e) * rel / (1 / M_BALL + 1 / M_PIN);
          ball.vel.x -= j / M_BALL * nx; ball.vel.z -= j / M_BALL * nz;
          p.vx += j / M_PIN * nx * 0.9; p.vz += j / M_PIN * nz * 0.9;
          // organic scatter
          p.vx += (Math.random() - 0.5) * 0.5;
          p.vz += (Math.random() - 0.5) * 0.35;
          // separate
          const push = (rr - d) + 0.002;
          p.x += nx * push; p.z += nz * push;
          Audio_.clatter(2 + Math.floor(Math.random() * 3));
          pulseHaptics(0.6, 50);
        }
      }
    }
  }

  // pin vs pin
  for (let i = 0; i < pins.length; i++) {
    const a = pins[i];
    if (a.state === 'pit' || a.state === 'cleared') continue;
    const aActive = a.state === 'standing' || a.state === 'falling' || (a.state === 'fallen' && a.fallT < 0.6);
    if (!aActive) continue;
    const aMoving = Math.hypot(a.vx, a.vz) > 0.05 || a.state === 'falling';
    if (!aMoving) continue;
    for (let j2 = i + 1; j2 < pins.length; j2++) {
      const b = pins[j2];
      if (b.state !== 'standing') continue;
      if (a.cooldown > 0 && b.cooldown > 0) continue;
      const ra = a.state === 'standing' ? PIN_R : 0.10;
      const rr = ra + PIN_R;
      const dx = b.x - a.x, dz = b.z - a.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const nx = dx / d, nz = dz / d;
        const rel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
        if (rel > 0) {
          const e = 0.62;
          const j = (1 + e) * rel / (2 / M_PIN);
          a.vx -= j / M_PIN * nx; a.vz -= j / M_PIN * nz;
          b.vx += j / M_PIN * nx; b.vz += j / M_PIN * nz;
          b.vx += (Math.random() - 0.5) * 0.4;
          b.vz += (Math.random() - 0.5) * 0.3;
          const push = (rr - d) + 0.002;
          b.x += nx * push; b.z += nz * push;
          a.cooldown = 0.1; b.cooldown = 0.1;
          Audio_.clatter(1 + Math.floor(Math.random() * 2));
        }
      }
    }
  }
}

function allPinsSettled() {
  for (const p of pins) {
    if (p.state === 'falling') return false;
    if (p.state === 'standing' && Math.hypot(p.vx, p.vz) > 0.08) return false;
  }
  return true;
}

function stepPhase(dt) {
  if (G.phase === 'play') {
    if (ball.state === 'done') { G.phase = 'settle'; G.settleT = 0; }
  } else if (G.phase === 'settle') {
    G.settleT += dt;
    if (allPinsSettled() || G.settleT > 3.2) recordThrow();
  } else if (G.phase === 'sweep') {
    sweepT += dt;
    // sweeper descends in front of deck, pushes back, lifts
    const m = sweepMesh;
    if (sweepT < 0.35) {
      m.position.y = 0.55 - (0.55 - 0.07) * (sweepT / 0.35);
      m.position.z = HEAD_Z + 0.35;
    } else if (sweepT < 1.25) {
      const k = (sweepT - 0.35) / 0.9;
      m.position.y = 0.07;
      m.position.z = HEAD_Z + 0.35 - k * 3.4;
      // dead pins ride the sweep
      for (const p of pins) {
        if (p.state === 'fallen') {
          p.z = Math.min(p.z, m.position.z - 0.05);
          if (p.z < PIT_Z - 0.1) { p.state = 'pit'; p.mesh.visible = false; }
        }
      }
    } else if (sweepT < 1.6) {
      m.position.y = 0.07 + (sweepT - 1.25) / 0.35 * 0.5;
    } else {
      sweepMesh.visible = false;
      for (const p of pins) {
        if (p.state !== 'standing') { p.state = 'cleared'; p.mesh.visible = false; }
      }
      if (G.phase === 'sweep') {
        if (G.needRack) { G.phase = 'rack'; G.rackT = 0; }
        else {
          G.phase = 'ready';
          placePins(false);
          if (ball.state !== 'rack') returnBall();
          updateHud(); drawScore();
        }
      }
    }
  } else if (G.phase === 'rack') {
    G.rackT += dt;
    const k = Math.min(1, G.rackT / 0.55);
    for (const p of pins) {
      if (p.state === 'cleared' || p.state === 'pit' || p.state === 'fallen') {
        p.state = 'standing';
        p.mesh.visible = true;
      }
      const target = p.home;
      p.x += (target.x - p.x) * Math.min(1, 10 * dt);
      p.z += (target.z - p.z) * Math.min(1, 10 * dt);
      const drop = (1 - k) * 0.45;
      p.mesh.position.set(p.x, drop, p.z);
      p.mesh.rotation.set(0, 0, 0);
      if (k >= 1) { p.x = target.x; p.z = target.z; p.mesh.position.set(p.x, 0, p.z); }
    }
    if (G.rackT > 0.6) {
      placePins(true);
      G.phase = 'ready';
      if (ball.state !== 'rack') returnBall();
      updateHud(); drawScore();
    }
  }
}

function throwBall(origin, vel, spin) {
  ball.state = 'thrown';
  ball.mesh.position.copy(origin);
  ball.vel.copy(vel);
  ball.spin = spin;
  ball.crossedFoul = false; ball.inGutter = false; ball.stillT = 0;
  ball.airborne = vel.y > 0.4 || origin.y > BALL_R + 0.05;
  if (G.phase === 'ready') G.phase = 'play';
  Audio_.thump(0.25, 140);
  pulseHaptics(0.9, 80);
}

// ---------------------------------------------------------------- haptics
const haptics = [];
function pulseHaptics(strength, ms) {
  for (const h of haptics) {
    try { h.pulse(strength, ms); } catch (e) { /* no haptics */ }
  }
}

// ---------------------------------------------------------------- input: desktop
let yaw = 0, pitch = -0.18;
const keys = {};
let pointerLocked = false;
let held = false;
const mouseTrail = []; // {t, dx, dy}

canvas.addEventListener('click', () => {
  if (renderer.xr.isPresenting) return;
  Audio_.init();
  if (!pointerLocked && overlayHidden) canvas.requestPointerLock();
});
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
});
addEventListener('mousemove', (e) => {
  if (!pointerLocked || renderer.xr.isPresenting) return;
  if (held) {
    mouseTrail.push({ t: performance.now(), dx: e.movementX, dy: e.movementY });
    while (mouseTrail.length > 12) mouseTrail.shift();
  } else {
    yaw -= e.movementX * 0.0021;
    pitch -= e.movementY * 0.0021;
    pitch = Math.max(-1.2, Math.min(0.6, pitch));
  }
});
addEventListener('mousedown', (e) => {
  if (!pointerLocked || renderer.xr.isPresenting) return;
  if (e.button !== 0) return;
  if (G.phase === 'over') return;
  if (ball.state !== 'rack') return;
  // reach check
  const d = ball.mesh.position.distanceTo(camera.getWorldPosition(tmpV));
  if (d < 2.6) {
    held = true;
    ball.state = 'held';
    mouseTrail.length = 0;
    Audio_.thump(0.15, 200);
  }
});
addEventListener('mouseup', (e) => {
  if (e.button !== 0 || !held) return;
  held = false;
  // flick velocity from recent mouse trail
  let fx = 0, fy = 0, n = 0;
  const now = performance.now();
  for (const s of mouseTrail) {
    if (now - s.t < 140) { fx += s.dx; fy += s.dy; n++; }
  }
  const flick = Math.min(1.6, Math.hypot(fx, fy) / 60);
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  const speed = 5.5 + flick * 4.5 + Math.max(0, -fy) * 0.045;
  const vel = fwd.clone().multiplyScalar(speed);
  vel.y = Math.max(-0.5, -fy * 0.012) + 0.4;
  vel.x += fx * 0.012;
  const spin = THREE.MathUtils.clamp(-fx * 0.09, -4, 4);
  const origin = ball.mesh.position.clone();
  throwBall(origin, vel, spin);
});
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Enter' && G.phase === 'over') newGame();
  if (e.code === 'KeyN' && G.phase === 'play') { ball.state = 'done'; ball.mesh.visible = false; }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });

function stepDesktop(dt) {
  if (renderer.xr.isPresenting) return;
  rig.rotation.y = yaw;
  camera.rotation.x = pitch;
  const sp = 2.6 * dt;
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  let mx = 0, mz = 0;
  if (keys.KeyW) { mx -= sin * sp; mz -= cos * sp; }
  if (keys.KeyS) { mx += sin * sp; mz += cos * sp; }
  if (keys.KeyA) { mx -= cos * sp; mz += sin * sp; }
  if (keys.KeyD) { mx += cos * sp; mz -= sin * sp; }
  rig.position.x = THREE.MathUtils.clamp(rig.position.x + mx, -1.4, 1.4);
  rig.position.z = THREE.MathUtils.clamp(rig.position.z + mz, 0.4, 5.4);
  camera.position.set(0, 1.7, 0.3);

  if (held) {
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const target = camera.getWorldPosition(new THREE.Vector3())
      .addScaledVector(fwd, 0.85)
      .add(new THREE.Vector3(0, -0.22, 0));
    ball.mesh.position.lerp(target, Math.min(1, 18 * dt));
  }
}

// ---------------------------------------------------------------- input: VR
const controllers = [];
{
  for (let i = 0; i < 2; i++) {
    const c = renderer.xr.getController(i);
    c.userData.trail = [];
    c.userData.holding = false;
    rig.add(c);
    controllers.push(c);
    const grip = renderer.xr.getControllerGrip(i);
    const hand = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 14, 10),
      new THREE.MeshStandardMaterial({ color: 0xd8d4ca, roughness: 0.5 }));
    grip.add(hand);
    rig.add(grip);

    const onDown = () => {
      Audio_.init();
      if (G.phase === 'over') { newGame(); return; }
      if (ball.state !== 'rack') return;
      const cp = c.getWorldPosition(new THREE.Vector3());
      if (cp.distanceTo(ball.mesh.position) < 0.4) {
        c.userData.holding = true;
        ball.state = 'held';
        c.attach(ball.mesh);
        pulseHaptics(0.4, 40);
      }
    };
    const onUp = () => {
      if (!c.userData.holding) return;
      c.userData.holding = false;
      world.attach(ball.mesh);
      // velocity from trail
      const tr = c.userData.trail;
      if (tr.length >= 2) {
        const a = tr[0], b = tr[tr.length - 1];
        const dt = Math.max(0.016, (b.t - a.t) / 1000);
        const vel = b.p.clone().sub(a.p).divideScalar(dt);
        vel.multiplyScalar(1.15);
        if (vel.length() > 0.9) {
          // spin from lateral wrist motion
          const spin = THREE.MathUtils.clamp(-vel.x * 0.35, -4, 4);
          throwBall(ball.mesh.position.clone(), vel, spin);
          return;
        }
      }
      // weak release: drop, it will return
      ball.state = 'thrown';
      ball.vel.set(0, -0.5, 0);
      ball.airborne = true;
      if (G.phase === 'ready') G.phase = 'play';
    };
    c.addEventListener('selectstart', onDown);
    c.addEventListener('squeezestart', onDown);
    c.addEventListener('selectend', onUp);
    c.addEventListener('squeezeend', onUp);
  }
}

let snapCooldown = 0;
function stepVR(dt) {
  if (!renderer.xr.isPresenting) return;
  snapCooldown = Math.max(0, snapCooldown - dt);
  const session = renderer.xr.getSession();
  if (!session) return;
  for (const src of session.inputSources) {
    const gp = src.gamepad;
    if (!gp) continue;
    if (src.handedness === 'left') {
      const ax = gp.axes[2] || gp.axes[0] || 0;
      const ay = gp.axes[3] || gp.axes[1] || 0;
      if (Math.abs(ax) > 0.12 || Math.abs(ay) > 0.12) {
        const sp = 1.8 * dt;
        const sin = Math.sin(rig.rotation.y), cos = Math.cos(rig.rotation.y);
        rig.position.x += (ax * cos - ay * sin) * sp;
        rig.position.z += (ay * cos + ax * sin) * sp;
        rig.position.x = THREE.MathUtils.clamp(rig.position.x, -1.4, 1.4);
        rig.position.z = THREE.MathUtils.clamp(rig.position.z, 0.4, 5.4);
      }
    } else if (src.handedness === 'right') {
      const ax = gp.axes[2] || gp.axes[0] || 0;
      if (Math.abs(ax) > 0.7 && snapCooldown <= 0) {
        rig.rotation.y -= Math.sign(ax) * Math.PI / 4;
        snapCooldown = 0.35;
      }
    }
    if (gp.hapticActuators && gp.hapticActuators[0]) haptics[src.handedness === 'left' ? 0 : 1] = gp.hapticActuators[0];
  }
  // record controller trails for throw velocity
  const now = performance.now();
  for (const c of controllers) {
    const p = c.getWorldPosition(new THREE.Vector3());
    c.userData.trail.push({ t: now, p });
    while (c.userData.trail.length && now - c.userData.trail[0].t > 110) c.userData.trail.shift();
  }
}

// ---------------------------------------------------------------- UI wiring
const overlay = document.getElementById('overlay');
const vrBtn = document.getElementById('vrBtn');
const playBtn = document.getElementById('playBtn');
let overlayHidden = false;

function hideOverlay() {
  overlayHidden = true;
  overlay.classList.add('hidden');
  hudEl.style.display = 'block';
  hintEl.style.display = 'block';
  document.getElementById('cross').style.display = 'block';
  hintEl.textContent = renderer.xr.isPresenting
    ? ''
    : 'CLICK THE BALL TO PICK IT UP - FLICK AND RELEASE TO THROW - WASD MOVES';
  updateHud();
}

playBtn.addEventListener('click', () => {
  Audio_.init();
  hideOverlay();
  canvas.requestPointerLock();
});

if (navigator.xr && navigator.xr.isSessionSupported) {
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
    if (ok) {
      vrBtn.style.display = 'inline-block';
      vrBtn.addEventListener('click', async () => {
        Audio_.init();
        try {
          const session = await navigator.xr.requestSession('immersive-vr', {
            optionalFeatures: ['local-floor', 'bounded-floor'],
          });
          await renderer.xr.setSession(session);
          hideOverlay();
          hudEl.style.display = 'none';
          hintEl.style.display = 'none';
        } catch (e) { /* user cancelled */ }
      });
    }
  }).catch(() => {});
}
renderer.xr.addEventListener('sessionend', () => {
  hudEl.style.display = overlayHidden ? 'block' : 'none';
});

// ---------------------------------------------------------------- main loop
const clock = new THREE.Clock();
let acc = 0;

function stepGame(dt) {
  stepDesktop(dt);
  stepVR(dt);
  stepBall(dt);
  stepPins(dt);
  stepPhase(dt);
}

let frozen = AUTOTHROW;
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  if (!frozen) stepGame(dt);
  renderer.render(scene, camera);
});

// ------------------------------------------------- deterministic test seek
if (AUTOTHROW) {
  hideOverlay();
  hudEl.style.display = 'none';
  hintEl.style.display = 'none';
  document.getElementById('cross').style.display = 'none';
  const t = SEEK || 0;
  if (t > 0) {
    const origin = new THREE.Vector3(0.18, 1.1, 1.6);
    const vel = new THREE.Vector3(0.05, 0.3, -9.4);
    throwBall(origin, vel, 0.5);
    const dt = 1 / 120;
    for (let s = 0; s < t; s += dt) stepGame(dt);
  }
  drawScore();
}

// debug hook (headless verification only)
if (AUTOTHROW) {
  const standing = pins.filter(p => p.state === 'standing').length;
  document.title = `DBG ball=${ball.mesh.position.x.toFixed(2)},${ball.mesh.position.y.toFixed(2)},${ball.mesh.position.z.toFixed(2)} state=${ball.state} phase=${G.phase} standing=${standing} rolls=${G.rolls.join(',')}`;
}
