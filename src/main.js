import * as THREE from 'three';
import { World } from './world.js';
import { Wolf, Jumpscare } from './wolf.js';
import { Player } from './player.js';
import { AudioEngine } from './audio.js';
import { clamp, lerp, damp, rand, pick, formatTime, TAU } from './util.js';

const $ = id => document.getElementById(id);
const isTouch = window.matchMedia('(hover: none)').matches || 'ontouchstart' in window;

/* ------------------------------------------------------------------ */
/*  renderer / scene                                                   */
/* ------------------------------------------------------------------ */
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 1.8));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.28;
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.08, 340);
camera.rotation.order = 'YXZ';
scene.add(camera);

const audio = new AudioEngine();
const world = new World(scene);
const player = new Player(camera, canvas, world, audio);
const wolf = new Wolf(scene, world, audio);
const jumpscare = new Jumpscare(audio);

const fx = {
  black: $('fx-black'),
  flash: $('fx-flash'),
  danger: $('fx-danger'),
  vignette: $('fx-vignette')
};

/* ------------------------------------------------------------------ */
/*  game state                                                         */
/* ------------------------------------------------------------------ */
const G = {
  mode: 'title',
  time: 0,
  runTime: 0,
  pieces: 0,
  deaths: 0,
  introT: 0,
  wakeT: 0,
  scareT: 0,
  repairT: 0,
  pause: false,
  pendingScare: -1,
  scareCooldown: 0,
  senseUntil: 0,
  senseCooldown: 0,
  senseTarget: null,
  twigTimer: 6,
  respawnT: 0,
  finalPhase: false,
  deathShown: false,
  huntAnnounced: false,
  lastObjective: '',
  bootTime: 0
};

const intro = {
  cockpit: null,
  carRoot: new THREE.Group(),
  headlight: null,
  lights: [],
  t: 0,
  crashed: false,
  speed: 0
};

/* ------------------------------------------------------------------ */
/*  DOM helpers                                                        */
/* ------------------------------------------------------------------ */
function show(el) { el?.classList.remove('hidden'); }
function hide(el) { el?.classList.add('hidden'); }

function buildPips() {
  const pips = $('parts-pips');
  pips.innerHTML = '';
  for (let i = 0; i < 20; i++) {
    const el = document.createElement('i');
    pips.appendChild(el);
  }
}
buildPips();

function updateHUD() {
  $('parts-count').textContent = String(G.pieces).padStart(2, '0');
  const pips = $('parts-pips').children;
  for (let i = 0; i < pips.length; i++) {
    pips[i].classList.toggle('on', i < G.pieces);
    pips[i].classList.toggle('next', i === G.pieces);
  }
  const st = Math.round(player.stamina);
  const ba = Math.round(player.battery);
  $('stamina-pct').textContent = st;
  $('torch-pct').textContent = ba;
  $('stamina-fill').style.width = st + '%';
  $('torch-fill').style.width = ba + '%';
  $('stamina-fill').classList.toggle('low', st < 22);
  $('torch-fill').classList.toggle('low', ba < 18);
}

function setObjective(text) {
  if (text === G.lastObjective) return;
  G.lastObjective = text;
  const el = $('objective');
  el.style.opacity = '0';
  setTimeout(() => {
    el.textContent = text;
    el.style.opacity = '1';
  }, 220);
}

let subtitleTimer = 0;
function subtitle(text, duration = 4.5) {
  const el = $('subtitle');
  el.textContent = text;
  el.classList.add('show');
  subtitleTimer = duration;
}

function toast(text, duration = 2600) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), duration);
}

function flash(kind = 'white') {
  fx.flash.className = 'fx-flash';
  void fx.flash.offsetWidth;
  fx.flash.classList.add(kind);
}

function showDangerWord() {
  const el = $('danger-word');
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
}

function setBlack(v, ms = 1400) {
  fx.black.style.transitionDuration = ms + 'ms';
  fx.black.style.opacity = String(v);
}

let pickupHideTimer = 0;
function showPickup(part) {
  $('pickup-name').textContent = part.name;
  $('pickup-count').textContent = `${String(G.pieces).padStart(2, '0')} / 20 RECOVERED`;
  const card = $('pickup-card');
  card.classList.remove('hidden');
  card.style.opacity = '1';
  pickupHideTimer = 2.2;
}

/* ------------------------------------------------------------------ */
/*  intro cockpit                                                      */
/* ------------------------------------------------------------------ */
function buildIntro() {
  const g = new THREE.Group();
  const dashMat = new THREE.MeshStandardMaterial({ color: '#141110', roughness: 0.9, metalness: 0.05 });
  const trimMat = new THREE.MeshStandardMaterial({ color: '#2b2721', roughness: 0.55, metalness: 0.35 });
  const amber = new THREE.MeshBasicMaterial({ color: '#d08a3e' });
  const amberDim = new THREE.MeshBasicMaterial({ color: '#6b421e' });

  // dashboard — low, wide, black
  const dash = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.26, 1.5), dashMat);
  dash.position.set(0, -0.56, -1.15);
  dash.rotation.x = -0.28;
  g.add(dash);

  const cowl = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.05, 0.46), new THREE.MeshStandardMaterial({ color: '#1c1a16', roughness: 0.85, metalness: 0.1 }));
  cowl.position.set(0, -0.43, -1.7);
  cowl.rotation.x = 0.08;
  g.add(cowl);

  // instrument binnacle + two glowing gauges
  const binnacle = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.17, 0.12), dashMat);
  binnacle.position.set(-0.44, -0.31, -0.92);
  binnacle.rotation.x = -0.32;
  g.add(binnacle);
  for (const off of [-0.115, 0.115]) {
    const face = new THREE.Mesh(
      new THREE.CircleGeometry(0.052, 20),
      new THREE.MeshBasicMaterial({ color: '#1b1208' })
    );
    face.position.set(-0.44 + off, -0.3, -0.862);
    face.rotation.x = -0.26;
    g.add(face);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.006, 5, 18), new THREE.MeshBasicMaterial({ color: '#8a5c28' }));
    ring.position.set(-0.44 + off, -0.3, -0.86);
    ring.rotation.x = -0.26;
    g.add(ring);
    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.0035, 0.04, 0.0035), amberDim);
    needle.position.set(-0.44 + off, -0.29, -0.858);
    needle.rotation.set(-0.26, 0, 0.75 + off * 3);
    g.add(needle);
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.008, 0.002), new THREE.MeshBasicMaterial({ color: '#5a3a18' }));
    tick.position.set(-0.44 + off, -0.26, -0.859);
    tick.rotation.x = -0.26;
    g.add(tick);
  }
  const clusterGlow = new THREE.PointLight('#c98a45', 0.5, 1.4, 1.5);
  clusterGlow.position.set(-0.44, -0.18, -0.8);
  g.add(clusterGlow);

  // radio
  const radio = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.09, 0.03), new THREE.MeshStandardMaterial({ color: '#1a1712', roughness: 0.7, metalness: 0.25 }));
  radio.position.set(0.25, -0.36, -0.94);
  radio.rotation.x = -0.3;
  g.add(radio);
  const dial = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.014), new THREE.MeshBasicMaterial({ color: '#b6742f' }));
  dial.position.set(0.245, -0.348, -0.922);
  dial.rotation.x = -0.3;
  g.add(dial);
  const dialMark = new THREE.Mesh(new THREE.PlaneGeometry(0.004, 0.012), new THREE.MeshBasicMaterial({ color: '#f0c987' }));
  dialMark.position.set(0.29, -0.348, -0.9205);
  dialMark.rotation.x = -0.3;
  g.add(dialMark);
  for (let i = 0; i < 2; i++) {
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.018, 8), trimMat);
    knob.position.set(0.19 + i * 0.1, -0.352, -0.918);
    knob.rotation.x = Math.PI / 2 - 0.3;
    g.add(knob);
  }

  // steering wheel
  const wheel = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.02, 7, 22), new THREE.MeshStandardMaterial({ color: '#1b1916', roughness: 0.6, metalness: 0.3 }));
  wheel.add(rim);
  for (let i = 0; i < 3; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.018, 0.016), trimMat);
    spoke.rotation.z = i * Math.PI * 2 / 3 + Math.PI / 2;
    spoke.position.set(Math.cos(i * Math.PI * 2 / 3 + Math.PI / 2) * 0.085, Math.sin(i * Math.PI * 2 / 3 + Math.PI / 2) * 0.085, 0);
    wheel.add(spoke);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 10), trimMat);
  hub.rotation.x = Math.PI / 2;
  wheel.add(hub);
  wheel.position.set(0.16, -0.5, -0.76);
  wheel.rotation.x = 1.22;
  wheel.rotation.z = 0.06;
  g.add(wheel);
  intro.wheel = wheel;

  // A pillars + roof
  for (const s of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.038, 1.02, 0.08), dashMat);
    pillar.position.set(s * 0.97, 0.02, -1.38);
    pillar.rotation.z = s * 0.19;
    g.add(pillar);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.05, 0.28), dashMat);
  roof.position.set(0, 0.52, -1.32);
  roof.rotation.x = 0.08;
  g.add(roof);
  const header = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.045, 0.05), new THREE.MeshStandardMaterial({ color: '#1d1a16', roughness: 0.9, metalness: 0.05 }));
  header.position.set(0, 0.46, -1.46);
  g.add(header);
  const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.075, 0.04), trimMat);
  mirror.position.set(0.02, 0.34, -1.3);
  g.add(mirror);
  const mirrorGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.225, 0.048), new THREE.MeshBasicMaterial({ color: '#1a2320' }));
  mirrorGlow.position.set(0.02, 0.34, -1.322);
  g.add(mirrorGlow);

  // hood
  const hood = new THREE.Mesh(new THREE.BoxGeometry(2.32, 0.07, 3.0), new THREE.MeshStandardMaterial({ color: '#2c221c', roughness: 0.42, metalness: 0.6 }));
  hood.position.set(0, -0.63, -2.85);
  hood.rotation.x = 0.005;
  g.add(hood);
  const hoodCrease = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.012, 2.7), new THREE.MeshStandardMaterial({ color: '#41332a', roughness: 0.45, metalness: 0.55 }));
  hoodCrease.position.set(0, -0.588, -2.9);
  g.add(hoodCrease);
  const wiper = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.015, 0.02), new THREE.MeshStandardMaterial({ color: '#141414' }));
  wiper.position.set(-0.25, -0.4, -1.72);
  wiper.rotation.z = 0.18;
  g.add(wiper);

  // warm interior bounce
  const interior = new THREE.PointLight('#b8763e', 0.34, 2.0, 1.7);
  interior.position.set(-0.4, -0.18, -1.1);
  g.add(interior);

  // headlights
  const headlight = new THREE.SpotLight('#f5e8c4', 235, 95, 0.56, 0.45, 1.1);
  headlight.position.set(0, -0.5, -4.35);
  const target = new THREE.Object3D();
  target.position.set(0, -1.1, -46);
  g.add(target);
  headlight.target = target;
  g.add(headlight);
  intro.headlight = headlight;

  const spill = new THREE.SpotLight('#e8d9b0', 80, 26, 0.95, 1.0, 0.95);
  spill.position.set(0, -0.5, -5.2);
  const spillTarget = new THREE.Object3D();
  spillTarget.position.set(0, -1.3, -11);
  g.add(spillTarget);
  spill.target = spillTarget;
  g.add(spill);

  const bounce = new THREE.PointLight('#c7b98f', 6, 14, 1.4);
  bounce.position.set(0, -0.3, -8);
  g.add(bounce);

  g.visible = false;
  camera.add(g);
  intro.cockpit = g;
  scene.add(intro.carRoot);
}

function setCockpitVisible(v) {
  if (intro.cockpit) intro.cockpit.visible = v;
  if (intro.headlight) intro.headlight.intensity = v ? 235 : 0;
}

/* ------------------------------------------------------------------ */
/*  title                                                              */
/* ------------------------------------------------------------------ */
function enterTitle() {
  G.mode = 'title';
  world.wreck.visible = false;
  for (const p of world.parts) p.group.visible = false;
  wolf.group.visible = true;
  const h = world.heightAt(-4, -9);
  wolf.group.position.set(-4, h, -9);
  wolf.group.scale.setScalar(1);
  wolf.spawnScale = 1;
  wolf.state = 'dormant';
  wolf.distToPlayer = 18;
  camera.position.set(9, world.heightAt(9, 11) + 1.78, 11);
  camera.lookAt(-7.2, h + 3.1, -9);
  camera.rotation.order = 'YXZ';
  updateHUD();
}

let titleAngle = 0;

function updateTitle(dt) {
  titleAngle += dt * 0.035;
  const a = 0.9 + titleAngle;
  const r = 10.5;
  const x = Math.cos(a) * r, z = Math.sin(a) * r;
  camera.position.set(x, world.heightAt(x, z) + 1.72 + Math.sin(G.time * 0.4) * 0.03, z);
  camera.lookAt(-7.2, world.heightAt(-4, -9) + 3.1, -9);
  camera.rotation.order = 'YXZ';

  // wolf idles, head follows the lens
  wolf.distToPlayer = camera.position.distanceTo(wolf.group.position);
  wolf._animate(dt, { position: camera.position }, camera, 0);
  wolf.headRig.rotation.y = clamp(wolf.headRig.rotation.y, -0.7, 0.7);
  wolf.group.rotation.y = Math.atan2(camera.position.x - wolf.group.position.x, camera.position.z - wolf.group.position.z);
}

/* ------------------------------------------------------------------ */
/*  start -> intro                                                     */
/* ------------------------------------------------------------------ */
function startGame() {
  if (G.mode !== 'title') return;
  audio.init();
  audio.startAmbience();
  audio.startEngine();
  audio.wolfPan = 0;
  $('title-best').textContent = '—';

  const t = $('title');
  t.style.transition = 'opacity 1.1s ease';
  t.style.opacity = '0';
  setTimeout(() => hide(t), 1150);

  G.mode = 'intro';
  G.introT = 0;
  show($('cine'));
  $('cine').classList.add('show');
  G.runTime = 0;
  setBlack(0, 600);
  setCockpitVisible(true);
  world.wreck.visible = false;
  for (const p of world.parts) p.group.visible = false;
  player.enabled = false;
  player.heldTorch.visible = false;

  // place the wolf far up the road, waiting
  const wp = world.roadCurve.getPointAt(0.62);
  wolf.group.visible = true;
  wolf.group.scale.setScalar(1.06);
  wolf.spawnScale = 1;
  wolf.group.position.set(wp.x, world.heightAt(wp.x, wp.z), wp.z);
  wolf.group.rotation.y = Math.PI;
  wolf.distToPlayer = 60;
  wolf.state = 'dormant';

  if (!isTouch) player.requestLock();
}

function updateIntro(dt) {
  G.introT += dt;
  const T = G.introT;

  // car follows the road
  const prog = clamp((T - 1.2) / 9.4, 0, 1);
  const tt = lerp(0.12, 0.548, prog);
  const p = world.roadCurve.getPointAt(tt);
  const tan = world.roadCurve.getTangentAt(tt);
  const y = world.heightAt(p.x, p.z) + 0.62;
  intro.carRoot.position.set(p.x, y, p.z);
  intro.carRoot.rotation.y = Math.atan2(-tan.x, -tan.z);

  const speed = (prog > 0 && prog < 1) ? 8.5 : 0;
  intro.speed = damp(intro.speed, speed, 2, dt);
  const shake = intro.speed * 0.0018;

  camera.position.set(
    p.x + Math.sin(T * 13.1) * shake,
    y + 0.78 + Math.sin(T * 9.7) * shake * 1.4,
    p.z + Math.cos(T * 11.3) * shake
  );
  camera.rotation.set(
    -0.045 + Math.sin(T * 7.3) * shake * 0.5,
    Math.atan2(-tan.x, -tan.z) + Math.sin(T * 2.2) * 0.006,
    Math.sin(T * 4.1) * 0.004
  );
  camera.rotation.order = 'YXZ';

  if (intro.wheel) intro.wheel.rotation.z = Math.sin(T * 1.3) * 0.08;
  if (intro.cockpit) intro.cockpit.position.y = Math.sin(T * 15) * 0.004 * (intro.speed / 8);

  // wolf in the road
  const distanceToCar = camera.position.distanceTo(wolf.group.position);
  if (T > 2) {
    wolf.distToPlayer = distanceToCar;
    wolf._animate(dt, { position: camera.position }, camera, 0);
    wolf.group.rotation.y = Math.atan2(camera.position.x - wolf.group.position.x, camera.position.z - wolf.group.position.z);
    wolf.group.position.y = world.heightAt(wolf.group.position.x, wolf.group.position.z);
  }

  if (T > 7.8 && !intro.howled) {
    intro.howled = true;
    audio.howl(0.1, distanceToCar);
  }

  // it comes for the car
  if (T > 10.65 && !intro.crashed) {
    const lunge = clamp((T - 10.65) / 1.0, 0, 1);
    wolf.group.position.lerp(new THREE.Vector3(camera.position.x, wolf.group.position.y, camera.position.z), lunge * 0.14);
    wolf.group.rotation.y = Math.atan2(camera.position.x - wolf.group.position.x, camera.position.z - wolf.group.position.z);
    wolf.jaw.rotation.x = 0.9;
    wolf.headRig.rotation.x = 0.15;
    if (T > 11.25) {
      // swerve
      const k = clamp((T - 11.25) / 0.35, 0, 1);
      camera.rotation.z = -k * 0.7;
      camera.rotation.y += k * 0.65;
      camera.rotation.x -= k * 0.2;
    }
    if (T > 11.5 && !intro.crashed) {
      intro.crashed = true;
      audio.crash();
      audio.stopEngine(0.35);
      flash('white');
      setBlack(1, 120);
      G.wakeT = 0;
      G.mode = 'wake';
      $('cine').classList.remove('show');
      setTimeout(() => hide($('cine')), 1400);
      setCockpitVisible(false);
      wolf.group.visible = false;
      // the wreck was always here
      world.wreck.visible = true;
      for (const part of world.parts) part.group.visible = true;
      placePlayerAtWreck();
    }
  }

  // skip
  if (G.introT > 1.5) {
    // keyboard skip handled elsewhere
  }
}

function placePlayerAtWreck() {
  // face the car from a few metres away
  player.position.set(4.4, world.heightAt(4.4, 4.2), 4.2);
  player.yaw = Math.atan2(4.4, 4.2);
  player.pitch = 0.11;
  player.velocity.set(0, 0, 0);
  player.stamina = 100;
  player.battery = 100;
  player.torchOn = true;
  player.crouching = false;
  player.heldTorch.visible = true;
  player.enabled = false;
  camera.fov = 72;
  camera.updateProjectionMatrix();
}

/* ------------------------------------------------------------------ */
/*  wake                                                               */
/* ------------------------------------------------------------------ */
function updateWake(dt) {
  G.wakeT += dt;
  const T = G.wakeT;
  const rise = clamp((T - 0.9) / 3.4, 0, 1);
  const ease = rise * rise * (3 - 2 * rise);
  const eye = lerp(0.5, 1.66, ease);
  const roll = lerp(0.34, 0, ease);
  const pitch = lerp(0.24, player.pitch, ease);

  camera.position.set(
    player.position.x + Math.sin(T * 0.6) * 0.02,
    player.position.y + eye,
    player.position.z
  );
  camera.rotation.set(pitch + Math.sin(T * 1.4) * 0.01 * (1 - ease), player.yaw, roll);
  camera.rotation.order = 'YXZ';

  if (T > 1.0 && !G.wokeFade) {
    G.wokeFade = true;
    setBlack(0, 2600);
  }
  if (T > 1.6 && !G.hudShown) {
    G.hudShown = true;
    show($('hud'));
    requestAnimationFrame(() => $('hud').classList.add('show'));
    updateHUD();
  }
  if (T > 3.2 && !G.wokeLine) {
    G.wokeLine = true;
    subtitle('You don\'t remember getting out of the car.', 5);
    setObjective('FIND THE TWENTY PIECES OF YOUR CAR');
  }
  if (T > 5.3) {
    G.mode = 'play';
    player.enabled = true;
    player.syncCamera(0.016);
    wolf.reset(player.position, { distance: 38, grace: 18 });
    audio.setAmbient(0.8);
    if (isTouch) {
      show($('touch'));
      $('touch').classList.remove('hidden');
    } else if (!player.pointerLocked) {
      toast('CLICK TO LOOK AROUND', 3200);
    }
    subtitle('Find every piece. Then leave.', 5);
  }
}

/* ------------------------------------------------------------------ */
/*  pickup                                                             */
/* ------------------------------------------------------------------ */
function onPickup(part) {
  G.pieces++;
  updateHUD();
  audio.pickup(G.pieces);
  showPickup(part);
  flash('white');
  if (G.pieces === 1) {
    subtitle('Something moved between the trees.', 4);
  } else if (G.pieces === 5) {
    subtitle('It knows what you\'re doing.', 4);
    schedulePeek();
  } else if (G.pieces === 10) {
    subtitle('It is closer than it sounds.', 4);
    schedulePeek();
  } else if (G.pieces === 15) {
    subtitle('You can hear it breathing.', 4);
    schedulePeek();
  } else if (G.pieces === 19) {
    subtitle('One more. Then the car.', 4);
  }
  if (G.pieces === 20) {
    setObjective('RETURN TO THE WRECK');
    world.showBeacon();
    subtitle('That\'s all of them. Go back to the car. Don\'t look at the trees.', 6);
    wolf.pressure = 1;
    wolf.provoke(player.position);
    audio.sting();
    G.finalPhase = true;
  }
  // each pickup draws it in
  if (G.pieces % 3 === 0 && !G.finalPhase) wolf.provoke(player.position);
  G.senseTarget = null;
}

function schedulePeek() {
  G.pendingScare = 0.55;
}

function triggerPeek() {
  G.pendingScare = -1;
  if (G.mode !== 'play') return;
  player.enabled = false;
  player.velocity.set(0, 0, 0);
  jumpscare.show(true);
  flash('red');
  audio.jumpscare();
  G.peekT = 0.9;
  setTimeout(() => {
    if (G.mode === 'play' && !wolf.caught) {
      player.enabled = true;
      player.requestLock && player.requestLock();
    }
  }, 900);
}

/* ------------------------------------------------------------------ */
/*  death                                                              */
/* ------------------------------------------------------------------ */
const deathLines = [
  'The forest is very quiet now.',
  'It was never a wolf. Not really.',
  'You should have stayed in the car.',
  'The trees lean in to look at you.',
  'Somewhere, an engine turns over. Not yours.'
];

function startDeath() {
  if (G.mode === 'scare' || G.mode === 'dead') return;
  G.mode = 'scare';
  G.scareT = 0;
  G.deathShown = false;
  player.enabled = false;
  player.velocity.set(0, 0, 0);
  wolf.group.visible = false;
  jumpscare.show(false);
  flash('red');
  showDangerWord();
  audio.jumpscare();
  hide($('pickup-card'));
  hide($('hud'));
  $('hud').classList.remove('show');
  hide($('touch'));
  hide($('compass'));
  hide($('reticle'));
  $('subtitle').classList.remove('show');
  if (document.pointerLockElement) document.exitPointerLock();
}

function updateScare(dt) {
  G.scareT += dt;
  jumpscare.update(dt);
  fx.danger.style.opacity = Math.min(0.85, 0.3 + G.scareT);
  if (G.scareT > 1.45 && !G.scareBlack) {
    G.scareBlack = true;
    setBlack(1, 420);
  }
  if (G.scareT > 2.15) {
    G.mode = 'dead';
    G.deaths++;
    hide($('hud'));
    $('hud').classList.remove('show');
    hide($('touch'));
    $('death-parts').textContent = `${String(G.pieces).padStart(2, '0')} / 20`;
    $('death-time').textContent = formatTime(G.runTime);
    $('death-count').textContent = String(G.deaths).padStart(2, '0');
    $('death-flavor').textContent = pick(deathLines);
    const d = $('dead');
    show(d);
    d.classList.add('in');
    setTimeout(() => d.classList.remove('in'), 1400);
    setBlack(0, 50);
    fx.danger.style.opacity = 0;
    audio.setAmbient(0.6);
    jumpscare.hide();
  }
}

function retry() {
  hide($('dead'));
  G.mode = 'wake';
  G.wakeT = 1.0;
  G.wokeFade = true;
  G.hudShown = true;
  G.wokeLine = true;
  G.scareBlack = false;
  G.deathShown = false;
  G.finalPhase = false;
  player.position.set(4.4, world.heightAt(4.4, 4.2), 4.2);
  player.yaw = Math.atan2(4.4, 4.2);
  player.pitch = 0.1;
  player.enabled = false;
  player.stamina = 100;
  player.battery = 100;
  player.torchOn = true;
  player.velocity.set(0, 0, 0);
  setBlack(1, 300);
  setTimeout(() => setBlack(0, 1200), 350);
  world.wreck.visible = true;
  wolf.group.visible = true;
  wolf.reset(player.position, { distance: 40, grace: 20 });
  setObjective(G.pieces >= 20 ? 'RETURN TO THE WRECK' : G.pieces ? 'FIND THE REST OF YOUR CAR' : 'FIND THE TWENTY PIECES OF YOUR CAR');
  $('danger-word').style.opacity = 0;
  show($('hud'));
  requestAnimationFrame(() => $('hud').classList.add('show'));
  updateHUD();
  if (isTouch) show($('touch'));
  if (!isTouch) player.requestLock();
  audio.startAmbience();
  audio.setAmbient(0.8);
  setTimeout(() => {
    subtitle('It dragged you back. You keep what you found.', 5);
  }, 1500);
  // land in play after a short rise
  G.wakeT = 5.4;
  G.mode = 'play';
  player.enabled = false;
  G.respawnT = 1.2;
  player.syncCamera(0);
}

/* ------------------------------------------------------------------ */
/*  repair / ending                                                    */
/* ------------------------------------------------------------------ */
function startRepair() {
  if (G.mode !== 'play') return;
  G.mode = 'repair';
  G.repairT = 0;
  player.enabled = false;
  player.velocity.set(0, 0, 0);
  hide($('hud'));
  hide($('touch'));
  hide($('compass'));
  hide($('pickup-card'));
  if (document.pointerLockElement) document.exitPointerLock();
  setBlack(0, 300);
  world.repair();
  world.beacon && (world.beacon.visible = false);
  audio.carStart();
  flash('white');
  $('hud').classList.remove('show');
}

function updateRepair(dt) {
  G.repairT += dt;
  const T = G.repairT;
  const orbit = Math.min(1, T / 2.5);
  const angle = lerp(0.95, 2.2, orbit);
  const r = lerp(6.2, 4.3, orbit);
  camera.position.set(Math.cos(angle) * r, world.heightAt(0, 0) + lerp(1.7, 2.0, orbit), Math.sin(angle) * r);
  const target = new THREE.Vector3(0, world.heightAt(0, 0) + 0.9, 0);
  camera.lookAt(target);
  camera.rotation.order = 'YXZ';

  if (T > 1.6 && !G.repairLine) {
    G.repairLine = true;
    subtitle('The engine turns over.', 3.5);
    audio.startEngine();
  }
  if (T > 2.8) {
    $('hud').classList.remove('show');
    world.wreckLight.intensity = 10;
    if (!G.finalWolf) {
      G.finalWolf = true;
      wolf.group.visible = true;
      const wx = -1.6, wz = -8.5;
      wolf.group.position.set(wx, world.heightAt(wx, wz), wz);
      wolf.group.rotation.y = Math.atan2(camera.position.x - wx, camera.position.z - wz);
      wolf.group.scale.setScalar(1.12);
      wolf.state = 'dormant';
      wolf.distToPlayer = 10;
      wolf.jaw.rotation.x = 0.15;
      audio.howl(-0.2, 12);
      audio.stopEngine(0.8);
    }
    // headlights find it
    const facing = new THREE.Vector3(0, 0, 0);
    camera.lookAt(wolf.group.position.x, wolf.group.position.y + 3.0, wolf.group.position.z);
  }
  if (T > 4.2 && !G.finalScare) {
    G.finalScare = true;
    jumpscare.show(false);
    flash('red');
    showDangerWord();
    audio.jumpscare();
    setBlack(0, 50);
  }
  if (G.finalScare) {
    jumpscare.update(dt);
    if (T > 6.2 && !G.endBlack) {
      G.endBlack = true;
      setBlack(1, 900);
    }
    if (T > 7.1) {
      G.mode = 'ending';
      G.finalWolf = false;
      jumpscare.hide();
      $('end-time').textContent = formatTime(G.runTime);
      $('end-deaths').textContent = String(G.deaths);
      show($('ending'));
      setBlack(0, 50);
      hide($('hud'));
      audio.setAmbient(0.3);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  sense / compass                                                    */
/* ------------------------------------------------------------------ */
function useSense() {
  if (G.mode !== 'play') return;
  if (G.senseCooldown > 0) {
    toast(`SENSE RECHARGING — ${Math.ceil(G.senseCooldown)}s`);
    return;
  }
  const { part, dist } = world.nearestPart(player.position);
  if (!part) return;
  G.senseTarget = part;
  G.senseUntil = G.time + 9;
  G.senseCooldown = 13;
  show($('compass'));
  $('compass').classList.remove('hidden');
  $('compass').style.opacity = '1';
  audio.sting();
  toast(`${Math.round(dist)}M — FOLLOW THE LIGHT`, 2200);
}

function updateSense(dt) {
  G.senseCooldown = Math.max(0, G.senseCooldown - dt);
  if (G.senseUntil <= G.time || !G.senseTarget || G.senseTarget.taken) {
    const c = $('compass');
    c.style.opacity = '0';
    if (G.senseUntil <= G.time) {
      $('compass').classList.add('hidden');
      if (G.senseTarget && !G.senseTarget.taken) G.senseTarget = null;
    }
    return;
  }
  const p = G.senseTarget;
  const dx = p.x - player.position.x;
  const dz = p.z - player.position.z;
  const bearing = Math.atan2(dx, dz);
  const camBearing = player.yaw + Math.PI;
  let rel = bearing - camBearing;
  rel = Math.atan2(Math.sin(rel), Math.cos(rel));
  $('compass-arrow').style.transform = `rotate(${rel * 180 / Math.PI}deg)`;
  // make the target glow harder while sensed
  if (p.beam) {
    p.beam.material.opacity = Math.max(p.beam.material.opacity, 0.42);
    p.halo.material.opacity = 1;
  }
  const d = Math.hypot(dx, dz);
  $('compass-label').textContent = `NEAREST PIECE · ${Math.round(d)}M`;
}

/* ------------------------------------------------------------------ */
/*  play update                                                        */
/* ------------------------------------------------------------------ */
function potentialDanger() {
  const d = wolf.distToPlayer;
  const hunting = wolf.state === 'hunt';
  if (hunting) return clamp(1 - d / 36, 0.25, 1);
  if (wolf.state === 'prowl') return clamp(0.42 - d / 90, 0.18, 0.5);
  if (wolf.state === 'lurk' && d < 30) return 0.16;
  return 0;
}

function updatePlay(dt) {
  G.runTime += dt;
  if (G.respawnT > 0) {
    G.respawnT -= dt;
    player.syncCamera(dt);
    if (G.respawnT <= 0) player.enabled = true;
    return;
  }

  const wasHunting = wolf.state === 'hunt';
  player.update(dt);
  if (G.peekT > 0) {
    G.peekT -= dt;
    jumpscare.update(dt);
    if (G.peekT <= 0) jumpscare.hide();
  }
  wolf.update(dt, player, camera, player.torchLit);

  if (wolf.state === 'hunt' && !wasHunting) {
    if (wolf.distToPlayer < 26) {
      showDangerWord();
      flash('red');
    }
    G.huntAnnounced = true;
  }

  // pickups
  const got = world.collect(player.position, 2.1);
  if (got) onPickup(got);

  // death
  if (wolf.caught && G.mode === 'play') startDeath();

  // repair trigger
  if (G.finalPhase && G.pieces >= 20) {
    const d = Math.hypot(player.position.x, player.position.z);
    if (d < 4.6) startRepair();
  }

  // events from the wolf
  for (const e of wolf.events.splice(0)) {
    if (e.type === 'step') audio.wolfStep(wolf.pan, wolf.distToPlayer);
    else if (e.type === 'snarl') audio.snarl(wolf.pan);
    else if (e.type === 'howl') audio.howl(wolf.pan, wolf.distToPlayer);
    else if (e.type === 'growl') audio.growl(0.8, wolf.pan, wolf.distToPlayer);
    else if (e.type === 'catch') startDeath();
  }

  // ambient twigs
  G.twigTimer -= dt;
  if (G.twigTimer <= 0) {
    G.twigTimer = rand(7, 17) * (1 - G.pieces / 40);
    const pan = rand(-1, 1);
    audio.twig();
    if (wolf.distToPlayer < 24 && Math.random() < 0.5) audio.growl(0.5, wolf.pan, wolf.distToPlayer);
  }

  // danger visuals + audio
  const danger = potentialDanger();
  fx.danger.style.opacity = String(danger * 0.9);
  audio.update(dt, { danger, wolfPan: wolf.pan, wolfDist: wolf.distToPlayer, sprinting: player.sprinting });

  // HUD
  if (Math.random() < 0.25) updateHUD();
  updateSense(dt);

  // pending scheduled peek scare
  if (G.pendingScare > 0) {
    G.pendingScare -= dt;
    if (G.pendingScare <= 0) triggerPeek();
  }

  if (subtitleTimer > 0) {
    subtitleTimer -= dt;
    if (subtitleTimer <= 0) $('subtitle').classList.remove('show');
  }
  if (pickupHideTimer > 0) {
    pickupHideTimer -= dt;
    if (pickupHideTimer <= 0) {
      $('pickup-card').style.opacity = '0';
      setTimeout(() => $('pickup-card').classList.add('hidden'), 360);
    }
  }

  // hint fades once you've been playing a while
  if (G.runTime > 40 && !G.hintFaded) {
    G.hintFaded = true;
    $('hud-hint').classList.add('fade');
  }
}

/* ------------------------------------------------------------------ */
/*  pause                                                              */
/* ------------------------------------------------------------------ */
function setPaused(v) {
  if (v && G.mode === 'play') {
    G.mode = 'paused';
    player.enabled = false;
    show($('pause'));
    if (document.pointerLockElement) document.exitPointerLock();
  } else if (!v && G.mode === 'paused') {
    hide($('pause'));
    G.mode = 'play';
    player.enabled = true;
    audio.ctx?.resume();
    if (!isTouch) player.requestLock();
  }
}

/* ------------------------------------------------------------------ */
/*  events                                                             */
/* ------------------------------------------------------------------ */
$('btn-play').addEventListener('click', startGame);
$('btn-howto').addEventListener('click', () => { show($('howto')); });
$('btn-howto-close').addEventListener('click', () => { hide($('howto')); });
$('btn-pause').addEventListener('click', () => setPaused(true));
$('btn-resume').addEventListener('click', () => setPaused(false));
$('btn-quit').addEventListener('click', () => {
  setBlack(1, 700);
  setTimeout(() => location.reload(), 800);
});
$('btn-retry').addEventListener('click', retry);
$('btn-again').addEventListener('click', () => {
  setBlack(1, 500);
  setTimeout(() => location.reload(), 600);
});

$('btn-touch-torch').addEventListener('click', () => player.toggleTorch());
$('btn-sense').addEventListener('click', useSense);

// sprint button hold
const sprintBtn = $('btn-sprint');
const sprintStart = e => { e.preventDefault(); player.touchSprint = true; sprintBtn.classList.add('on'); };
const sprintEnd = e => { e.preventDefault(); player.touchSprint = false; sprintBtn.classList.remove('on'); };
sprintBtn.addEventListener('pointerdown', sprintStart);
sprintBtn.addEventListener('pointerup', sprintEnd);
sprintBtn.addEventListener('pointercancel', sprintEnd);
sprintBtn.addEventListener('pointerleave', sprintEnd);

canvas.addEventListener('click', () => {
  if (G.mode === 'play' && !isTouch && !player.pointerLocked) player.requestLock();
});

window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k === 'escape') {
    if (G.mode === 'play') setPaused(true);
    else if (G.mode === 'paused') setPaused(false);
  }
  if (k === 'q' && G.mode === 'play') useSense();
  if (k === 'f' && G.mode === 'play') player.toggleTorch();
  if ((k === ' ' || k === 'enter') && G.mode === 'intro' && G.introT > 1.5) {
    // skip to the crash
    G.introT = 11.51;
  }
  if (k === 'm' && audio.ready) {
    audio.muted = !audio.muted;
    audio.master.gain.value = audio.muted ? 0 : 0.9;
    toast(audio.muted ? 'SOUND OFF' : 'SOUND ON');
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && G.mode === 'play') setPaused(true);
});

window.addEventListener('resize', () => {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 1.8));
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  jumpscare.updateCameraAspect();
});

/* ------------------------------ touch controls ---------------------- */
const stickZone = $('stick-zone');
const stickKnob = $('stick-knob');
const lookZone = $('look-zone');
let stickId = null, stickCenter = { x: 0, y: 0 }, lookId = null, lookLast = { x: 0, y: 0 };

function stickStart(e) {
  if (G.mode !== 'play') return;
  stickId = e.pointerId;
  stickZone.setPointerCapture?.(e.pointerId);
  const rect = stickZone.getBoundingClientRect();
  stickCenter = { x: rect.left + 95, y: rect.bottom - 95 };
  stickMove(e);
}
function stickMove(e) {
  if (e.pointerId !== stickId) return;
  const dx = e.clientX - stickCenter.x;
  const dy = e.clientY - stickCenter.y;
  const max = 46;
  const len = Math.hypot(dx, dy);
  const cl = len > max ? max / len : 1;
  const kx = dx * cl, ky = dy * cl;
  stickKnob.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
  player.touchMove.x = clamp(dx / max, -1, 1);
  player.touchMove.y = clamp(dy / max, -1, 1);
}
function stickEnd(e) {
  if (e.pointerId !== stickId) return;
  stickId = null;
  player.touchMove.x = 0; player.touchMove.y = 0;
  stickKnob.style.transform = 'translate(-50%,-50%)';
}
stickZone.addEventListener('pointerdown', stickStart);
stickZone.addEventListener('pointermove', stickMove);
stickZone.addEventListener('pointerup', stickEnd);
stickZone.addEventListener('pointercancel', stickEnd);

function lookStart(e) {
  if (G.mode !== 'play') return;
  lookId = e.pointerId;
  lookLast = { x: e.clientX, y: e.clientY };
  lookZone.setPointerCapture?.(e.pointerId);
}
function lookMove(e) {
  if (e.pointerId !== lookId) return;
  const dx = e.clientX - lookLast.x, dy = e.clientY - lookLast.y;
  lookLast = { x: e.clientX, y: e.clientY };
  player.addLook(dx * 1.6, dy * 1.6);
}
function lookEnd(e) {
  if (e.pointerId === lookId) lookId = null;
}
lookZone.addEventListener('pointerdown', lookStart);
lookZone.addEventListener('pointermove', lookMove);
lookZone.addEventListener('pointerup', lookEnd);
lookZone.addEventListener('pointercancel', lookEnd);

/* ------------------------------------------------------------------ */
/*  boot + loop                                                        */
/* ------------------------------------------------------------------ */
buildIntro();
enterTitle();
setBlack(0, 2600);

const clock = new THREE.Clock();
let booted = false;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  G.time += dt;

  // world atmosphere always runs
  world.update(dt, G.time, camera.position, player.torchLit);

  switch (G.mode) {
    case 'title':
      updateTitle(dt);
      break;
    case 'intro':
      updateIntro(dt);
      break;
    case 'wake':
      updateWake(dt);
      break;
    case 'play':
      updatePlay(dt);
      break;
    case 'scare':
      updateScare(dt);
      break;
    case 'repair':
      updateRepair(dt);
      break;
    case 'paused':
    case 'dead':
    case 'ending':
      break;
    default:
      break;
  }

  if (jumpscare.active) {
    if (!jumpscare.short) {
      hide($('hud'));
      $('hud').classList.remove('show');
      hide($('touch'));
      hide($('compass'));
      hide($('reticle'));
      $('subtitle').classList.remove('show');
    }
    renderer.render(jumpscare.scene, jumpscare.camera);
  } else {
    renderer.render(scene, camera);
  }

  if (!booted) {
    booted = true;
    setTimeout(() => {
      $('boot').classList.add('gone');
      setTimeout(() => $('boot').remove(), 1200);
    }, 500);
  }
}

animate();

// expose for debugging / automated tests
window.__hollow = { G, world, wolf, player, audio, jumpscare, camera, scene, renderer, useSense, startGame };
