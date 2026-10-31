import * as THREE from 'three';
import { clamp, damp, lerp, rand, mulberry32, TAU, shortestAngle, glowTexture } from './util.js';

/* ==================================================================
   THE WOLF — a very tall thing with very little skin on its bones
   ================================================================== */

const FUR = '#151512';
const FUR_LIGHT = '#211f1a';
const BONE = '#cfc4a4';
const EYE = '#dff2b6';

function furCone(r, h, color = FUR, seg = 5) {
  const g = new THREE.ConeGeometry(r, h, seg);
  g.translate(0, h / 2, 0);
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }));
}

/** Head that faces +Z. Re-used for the body and the close-up scare. */
export function buildWolfHead({ scare = false } = {}) {
  const head = new THREE.Group();
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({
    color, roughness: 0.92, metalness: 0.02, flatShading: true, fog: !scare, ...extra
  });
  const dark = mat('#161513');
  const mid = mat('#211d18');
  const flesh = mat('#3a1d18', { roughness: 1 });
  const toothMat = mat(BONE, { roughness: 0.55 });
  const eyeMat = new THREE.MeshStandardMaterial({
    color: '#f5ffd2', emissive: EYE, emissiveIntensity: scare ? 2.6 : 1.9,
    roughness: 0.25, fog: !scare
  });

  // skull
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.52, 12, 10), dark);
  skull.scale.set(1.02, 0.94, 1.12);
  head.add(skull);

  // cheekbones / gaunt hollows
  for (const s of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.21, 8, 7), mid);
    cheek.position.set(s * 0.28, -0.1, 0.42);
    cheek.scale.set(0.8, 0.65, 1.3);
    head.add(cheek);
    const hollow = new THREE.Mesh(new THREE.SphereGeometry(0.12, 7, 6), mat('#0c0b0a'));
    hollow.position.set(s * 0.3, -0.16, 0.5);
    hollow.scale.set(0.6, 1, 1.4);
    head.add(hollow);
  }

  // muzzle — shorter and broader for the close-up
  const muzzleLen = scare ? 0.82 : 1.06;
  const muzzleZ = scare ? 0.76 : 0.86;
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(scare ? 0.2 : 0.18, scare ? 0.42 : 0.36, muzzleLen, 7, 2), mid);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.set(0, -0.07, muzzleZ);
  head.add(muzzle);
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(scare ? 0.34 : 0.3, 0.16, muzzleLen * 0.85), mid);
  bridge.position.set(0, 0.14, muzzleZ - 0.08);
  bridge.rotation.x = -0.04;
  head.add(bridge);

  // nose
  const nose = new THREE.Mesh(new THREE.SphereGeometry(scare ? 0.14 : 0.12, 8, 7), mat('#080808', { roughness: 0.28 }));
  nose.position.set(0, 0.04, muzzleZ + muzzleLen * 0.58);
  nose.scale.set(1.1, 0.8, 0.8);
  head.add(nose);

  // upper teeth
  const upperTeeth = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const z = (scare ? 0.5 : 0.58) + i * (scare ? 0.1 : 0.12);
    for (let s of [-1, 1]) {
      const len = i < 2 ? 0.34 : i < 5 ? 0.2 : 0.13;
      const t = new THREE.Mesh(new THREE.ConeGeometry(scare ? 0.042 : 0.035, len, 5), toothMat);
      t.position.set(s * ((scare ? 0.22 : 0.2) + (i < 4 ? 0.045 : 0)), -0.27, z);
      t.rotation.x = Math.PI;
      t.rotation.z = s * (0.06 + Math.random() * 0.08);
      upperTeeth.add(t);
    }
  }
  head.add(upperTeeth);

  // lower jaw (pivot at back of mouth)
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.3, 0.36);
  head.add(jaw);
  const jawShape = new THREE.Mesh(new THREE.BoxGeometry(scare ? 0.46 : 0.38, 0.13, scare ? 0.82 : 0.95), mid);
  jawShape.position.set(0, -0.04, scare ? 0.38 : 0.45);
  jawShape.scale.set(1, 0.9, 1);
  jaw.add(jawShape);
  const jawTip = new THREE.Mesh(new THREE.ConeGeometry(scare ? 0.19 : 0.17, 0.35, 6), mid);
  jawTip.rotation.x = -Math.PI / 2;
  jawTip.position.set(0, -0.03, scare ? 0.84 : 0.98);
  jaw.add(jawTip);
  // lower teeth
  for (let i = 0; i < 6; i++) {
    const z = (scare ? 0.26 : 0.3) + i * (scare ? 0.1 : 0.12);
    for (let s of [-1, 1]) {
      const t = new THREE.Mesh(new THREE.ConeGeometry(scare ? 0.038 : 0.03, i < 2 ? 0.26 : 0.15, 5), toothMat);
      t.position.set(s * ((scare ? 0.17 : 0.15) + (i < 3 ? 0.03 : 0)), 0.06, z);
      t.rotation.z = s * 0.1;
      jaw.add(t);
    }
  }
  // tongue + throat
  const tongue = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.7), flesh);
  tongue.position.set(0, 0.02, 0.5);
  tongue.rotation.x = 0.05;
  jaw.add(tongue);
  const throat = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), mat('#120706', { roughness: 0.9 }));
  throat.position.set(0, -0.12, 0.18);
  throat.scale.set(0.8, 0.6, 0.9);
  head.add(throat);
  jaw.userData.base = 0.02;

  // eyes — sunken, wet, wrong
  const eyes = [];
  for (const s of [-1, 1]) {
    const socket = new THREE.Mesh(new THREE.SphereGeometry(0.135, 8, 7), mat('#070706', { roughness: 0.8 }));
    socket.position.set(s * 0.285, 0.22, 0.66);
    head.add(socket);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), eyeMat);
    eye.position.set(s * 0.285, 0.22, 0.74);
    eye.scale.set(1, 0.9, 0.8);
    head.add(eye);
    eyes.push(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.034, 6, 5), mat('#d6ddb0', { emissive: '#9aa35e', emissiveIntensity: 0.25, fog: !scare }));
    pupil.position.set(s * 0.285, 0.225, 0.812);
    head.add(pupil);
    // brow
    const brow = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.4, 5), dark);
    brow.position.set(s * 0.33, 0.36, 0.66);
    brow.rotation.set(Math.PI / 2.15, 0, s * 0.5);
    head.add(brow);
  }

  // ears
  const ears = [];
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.62, 5), mid);
    ear.position.set(s * 0.33, 0.55, -0.05);
    ear.rotation.z = -s * 0.35;
    ear.rotation.x = -0.18;
    head.add(ear);
    ears.push(ear);
  }

  // shaggy neck ruff + scars
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU;
    const c = furCone(0.07 + Math.random() * 0.05, 0.35 + Math.random() * 0.35, i % 3 ? FUR : FUR_LIGHT, 5);
    c.position.set(Math.cos(a) * 0.4, Math.sin(a) * 0.34 - 0.05, -0.35 - Math.random() * 0.15);
    c.rotation.set(rand(-0.4, 0.4), rand(0, TAU), Math.PI * 0.5 + rand(-0.6, 0.6));
    head.add(c);
  }
  // scalp tufts
  for (let i = 0; i < 7; i++) {
    const c = furCone(0.06, 0.22, FUR, 4);
    c.position.set(rand(-0.25, 0.25), 0.45, rand(-0.1, 0.35));
    c.rotation.set(rand(-0.5, 0.5), rand(0, TAU), rand(-0.5, 0.5));
    head.add(c);
  }
  // scar across the muzzle
  const scar = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.5), mat('#5a2e25', { roughness: 0.8 }));
  scar.position.set(-0.22, 0.2, 0.75);
  scar.rotation.set(0, 0.1, 0.6);
  head.add(scar);
  const scar2 = scar.clone();
  scar2.position.set(0.12, 0.27, 0.64);
  scar2.rotation.z = -0.7;
  head.add(scar2);

  head.userData = { jaw, eyes, ears, scare };
  return head;
}

/* ==================================================================
   SCARE HEAD — built only for the full-screen close-up.
   Faces +Z, origin roughly between the eyes.
   ================================================================== */
export function buildScareHead() {
  const head = new THREE.Group();
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({
    color, roughness: 0.95, metalness: 0.02, flatShading: true, fog: false, ...extra
  });
  const furDark = mat('#0a0908');
  const furMid = mat('#151210');
  const furLight = mat('#211c16');
  const gum = mat('#170607', { roughness: 0.9 });
  const mouth = mat('#120606', { roughness: 1 });
  const tongueMat = mat('#4a1c20', { roughness: 0.6 });
  const toothMat = mat('#bfb498', { roughness: 0.5, metalness: 0.02 });
  const noseMat = mat('#050505', { roughness: 0.22, metalness: 0.05 });

  // cranium
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.64, 16, 13), furDark);
  skull.position.set(0, 0.16, 0.02);
  skull.scale.set(0.94, 0.98, 1.0);
  head.add(skull);
  const crown = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), furMid);
  crown.position.set(0, 0.34, -0.14);
  crown.scale.set(0.86, 0.7, 0.9);
  head.add(crown);

  // cheek masses
  for (const sgn of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), furMid);
    cheek.position.set(sgn * 0.38, -0.04, 0.38);
    cheek.scale.set(0.68, 0.7, 1.25);
    head.add(cheek);
    const hollow = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 7), mat('#080706'));
    hollow.position.set(sgn * 0.36, -0.13, 0.52);
    hollow.scale.set(0.55, 0.85, 1.1);
    head.add(hollow);
  }

  // heavy angry brow
  for (const sgn of [-1, 1]) {
    const brow = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), furDark);
    brow.position.set(sgn * 0.235, 0.25, 0.67);
    brow.scale.set(1.35, 0.42, 0.85);
    brow.rotation.z = sgn * 0.3;
    head.add(brow);
    const browTuft = furCone(0.05, 0.18, '#0f0d0b', 5);
    browTuft.position.set(sgn * 0.3, 0.36, 0.58);
    browTuft.rotation.set(0.35, 0, -sgn * 0.9);
  }

  // sunken sockets + narrow eyes
  const eyes = [];
  for (const sgn of [-1, 1]) {
    const socket = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), mat('#060505', { roughness: 0.85 }));
    socket.position.set(sgn * 0.225, 0.15, 0.62);
    socket.scale.set(1.2, 1.05, 0.8);
    head.add(socket);
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.088, 14, 10),
      new THREE.MeshStandardMaterial({ color: '#ffc25c', emissive: '#ff8a1c', emissiveIntensity: 1.7, roughness: 0.14, metalness: 0, fog: false })
    );
    eye.position.set(sgn * 0.225, 0.15, 0.755);
    eye.scale.set(1.2, 0.74, 0.6);
    head.add(eye);
    eyes.push(eye);
    // vertical slit, sitting proud of the eye surface so it reads
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 7), mat('#010101', { roughness: 0.08 }));
    pupil.position.set(sgn * 0.225, 0.15, 0.823);
    pupil.scale.set(0.5, 2.5, 0.6);
    head.add(pupil);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.011, 5, 4), mat('#f4ffd8', { emissive: '#f4ffd8', emissiveIntensity: 2.4, roughness: 0.1 }));
    glint.position.set(sgn * 0.202, 0.182, 0.826);
    head.add(glint);
    // heavy upper lid narrows the eye
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.05, 0.1), furDark);
    lid.position.set(sgn * 0.225, 0.215, 0.79);
    lid.rotation.z = -sgn * 0.3;
    head.add(lid);
  }

  // muzzle — broad at the root, narrow at the nose
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.31, 1.02, 7, 2), furMid);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.set(0, -0.02, 1.08);
  muzzle.scale.set(1.04, 1, 0.92);
  head.add(muzzle);
  const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.16, 0.92, 5), furMid);
  bridge.rotation.x = Math.PI / 2 - 0.06;
  bridge.position.set(0, 0.17, 1.08);
  bridge.scale.set(1.2, 1, 0.6);
  head.add(bridge);
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, 0.66), furLight);
  ridge.position.set(0, 0.235, 1.05);
  ridge.rotation.x = -0.03;
  head.add(ridge);

  // nose
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.092, 16, 12), mat('#17120f', { roughness: 0.42, metalness: 0.05, flatShading: false }));
  nose.position.set(0, -0.015, 1.565);
  nose.scale.set(1.05, 0.78, 0.78);
  head.add(nose);
  for (const sgn of [-1, 1]) {
    const nostril = new THREE.Mesh(new THREE.SphereGeometry(0.017, 6, 5), mat('#000000'));
    nostril.position.set(sgn * 0.035, -0.03, 1.63);
    nostril.scale.set(0.95, 1.15, 0.5);
    head.add(nostril);
  }
  const philtrum = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.07, 0.01), mat('#000000'));
  philtrum.position.set(0, -0.08, 1.625);
  head.add(philtrum);

  // snout front — separates the eyes from the mouth
  const snout = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), furMid);
  snout.position.set(0, -0.11, 1.34);
  snout.scale.set(0.82, 0.58, 0.82);
  head.add(snout);

  // mouth cavity — lower and narrower so it reads as a mouth, not a second face
  const cavity = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 12), mat('#210708', { roughness: 1 }));
  cavity.position.set(0, -0.46, 0.88);
  cavity.scale.set(1.0, 0.62, 0.66);
  head.add(cavity);
  const palate = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), mat('#2b0b0c', { roughness: 1 }));
  palate.position.set(0, -0.3, 1.0);
  palate.scale.set(0.96, 0.28, 0.5);
  head.add(palate);

  // upper gum + a row of irregular teeth hanging in front of the cavity
  const upperGum = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.035, 0.1), gum);
  upperGum.position.set(0, -0.25, 1.2);
  upperGum.rotation.x = 0.12;
  head.add(upperGum);
  const toothRnd = mulberry32(1337);
  const upperLens = [0.21, 0.12, 0.09, 0.12, 0.21];
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * 0.1;
    const canine = i === 0 || i === 4;
    const len = upperLens[i] + (toothRnd() - 0.5) * 0.02;
    const rad = canine ? 0.036 : 0.022 + toothRnd() * 0.007;
    const t = new THREE.Mesh(new THREE.ConeGeometry(rad, len, 5), toothMat);
    t.position.set(x, -0.27 - len / 2, 1.28 + toothRnd() * 0.015);
    t.rotation.x = Math.PI;
    t.rotation.z = (toothRnd() - 0.5) * 0.16;
    head.add(t);
  }

  // lower jaw — hinged at the back of the mouth, not under the chin
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.28, 0.44);
  head.add(jaw);
  const tongue = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8), tongueMat);
  tongue.position.set(0, 0.06, 0.5);
  tongue.scale.set(0.95, 0.24, 1.45);
  jaw.add(tongue);
  // lower fangs
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * 0.08;
    const canine = i === 0 || i === 4;
    const len = canine ? 0.18 : 0.08 + toothRnd() * 0.06;
    const t = new THREE.Mesh(new THREE.ConeGeometry(canine ? 0.032 : 0.02, len, 5), toothMat);
    t.position.set(x, 0.03 + len / 2, 0.7);
    t.rotation.z = (toothRnd() - 0.5) * 0.18;
    jaw.add(t);
  }
  jaw.rotation.x = 0.02;

  // rounded mouth corners
  for (const sgn of [-1, 1]) {
    const lip = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 7), furMid);
    lip.position.set(sgn * 0.27, -0.3, 1.12);
    lip.scale.set(0.7, 0.8, 1.5);
    head.add(lip);
  }

  // ears with inner ear
  const ears = [];
  for (const sgn of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.72, 5), furMid);
    ear.position.set(sgn * 0.34, 0.72, -0.08);
    ear.rotation.z = -sgn * 0.32;
    ear.rotation.x = -0.22;
    head.add(ear);
    ears.push(ear);
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.46, 5), mat('#241012'));
    inner.position.set(sgn * 0.34, 0.72, 0.0);
    inner.rotation.z = -sgn * 0.32;
    inner.rotation.x = -0.22;
    head.add(inner);
  }

  // neck and shoulder mass
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.56, 1.35, 10), furDark);
  neck.position.set(0, -1.0, -0.28);
  neck.rotation.x = 0.22;
  head.add(neck);
  const ruff = new THREE.Mesh(new THREE.SphereGeometry(0.44, 12, 9), furMid);
  ruff.position.set(0, -0.62, -0.22);
  ruff.scale.set(1.05, 0.55, 0.85);
  head.add(ruff);

  // shaggy silhouette — bristles around cheeks, crown and throat
  const bristleRnd = mulberry32(77);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU;
    const r = 0.52 + bristleRnd() * 0.16;
    const c = furCone(0.035 + bristleRnd() * 0.025, 0.07 + bristleRnd() * 0.09, i % 4 ? '#0a0908' : '#1c1813', 4);
    c.position.set(Math.cos(a) * r, Math.sin(a) * r * 0.72 + 0.13, -0.26 - bristleRnd() * 0.22);
    c.rotation.set(bristleRnd() * 0.6 - 0.3, bristleRnd() * TAU, Math.PI / 2 + bristleRnd() * 0.5 - 0.3);
    head.add(c);
  }
  for (const sgn of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const tuft = furCone(0.045 + bristleRnd() * 0.035, 0.2 + bristleRnd() * 0.2, '#1d1a16', 4);
      tuft.position.set(sgn * (0.44 + i * 0.03), -0.02 + i * 0.1, 0.34 - i * 0.1);
      tuft.rotation.set(0.2, 0, -sgn * (1.2 + bristleRnd() * 0.5));
      head.add(tuft);
    }
  }

  head.userData = { jaw, eyes, ears };
  return head;
}

export class Wolf {
  constructor(scene, world, audio) {
    this.scene = scene;
    this.world = world;
    this.audio = audio;
    this.group = new THREE.Group();
    this.group.position.set(30, 0, -35);
    scene.add(this.group);
    this.state = 'dormant';
    this.stateTime = 0;
    this.caught = false;
    this.pressure = 0;
    this.stepDist = 0;
    this.events = [];
    this.yaw = 0;
    this.speed = 0;
    this.effSpeed = 0;
    this.spawnGrace = 18;
    this.repathTimer = 0;
    this.target = new THREE.Vector3();
    this.eyeGlow = glowTexture();
    this.distToPlayer = 99;
    this.pan = 0;
    this.legPhase = 0;
    this.blinkTimer = 3;
    this.huntingTime = 0;
    this.lostTime = 0;
    this._build();
    this._hide(true);
  }

  /* --------------------------- body --------------------------- */
  _build() {
    const g = this.group;
    const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.98, flatShading: true, ...extra });
    const dark = mat(FUR);
    const darker = mat('#0f0f0d');
    const pale = mat('#2a2822');

    // contact shadow
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1.9, 24),
      new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.42, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.04;
    shadow.scale.set(1, 1.6, 1);
    g.add(shadow);

    // body
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), dark);
    body.scale.set(0.72, 0.62, 1.55);
    body.position.set(0, 2.35, 0.0);
    g.add(body);
    this.body = body;

    const chest = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 9), dark);
    chest.scale.set(0.78, 0.72, 0.9);
    chest.position.set(0, 2.45, 0.85);
    g.add(chest);
    this.chest = chest;

    const hips = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 9), dark);
    hips.scale.set(0.68, 0.6, 0.85);
    hips.position.set(0, 2.3, -0.95);
    g.add(hips);

    // ribs — pale bone pressing through the hide
    for (let i = 0; i < 5; i++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.62 - i * 0.02, 0.022, 4, 12, Math.PI * 1.15), pale);
      rib.position.set(0, 2.22 + i * 0.02, 0.55 - i * 0.28);
      rib.rotation.set(0, 0, Math.PI * 0.93);
      g.add(rib);
    }

    // spine spikes
    for (let i = 0; i < 9; i++) {
      const spike = furCone(0.07, 0.28 + Math.random() * 0.16, FUR_LIGHT, 4);
      spike.position.set(rand(-0.12, 0.12), 2.82 + Math.sin(i) * 0.06, 1.0 - i * 0.24);
      spike.rotation.z = Math.PI + rand(-0.3, 0.3);
      spike.rotation.y = rand(-0.3, 0.3);
      g.add(spike);
    }
    // shoulder shag
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      const c = furCone(0.06 + Math.random() * 0.05, 0.3 + Math.random() * 0.3, FUR, 4);
      c.position.set(Math.cos(a) * 0.55, 2.5 + Math.sin(a) * 0.35, 1.25 + rand(-0.2, 0.2));
      c.rotation.set(rand(-0.4, 0.4), rand(0, TAU), Math.PI * 0.5 + rand(-0.5, 0.5));
      g.add(c);
    }

    // neck
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.52, 1.25, 7), dark);
    neck.position.set(0, 2.95, 1.45);
    neck.rotation.x = -0.62;
    g.add(neck);

    // head
    this.headRig = new THREE.Group();
    this.headRig.position.set(0, 3.32, 2.05);
    g.add(this.headRig);
    this.head = buildWolfHead();
    this.head.scale.setScalar(0.92);
    this.headRig.add(this.head);
    this.jaw = this.head.userData.jaw;

    // eye glows
    this.eyeSprites = [];
    for (const s of [-1, 1]) {
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.eyeGlow, color: '#eaffbb', transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false
      }));
      spr.scale.setScalar(0.62);
      spr.position.set(s * 0.26, 0.2, 0.86);
      this.head.add(spr);
      this.eyeSprites.push(spr);
    }

    // head light — makes the face readable when it's close
    this.headLight = new THREE.PointLight('#b9d59a', 0.0, 7, 2);
    this.headLight.position.set(0, 0.1, 0.4);
    this.head.add(this.headLight);

    // legs
    this.legs = [];
    const legDefs = [
      { x: -0.55, z: 1.15, front: true },
      { x: 0.55, z: 1.15, front: true },
      { x: -0.52, z: -1.05, front: false },
      { x: 0.52, z: -1.05, front: false }
    ];
    for (const def of legDefs) {
      const hip = new THREE.Group();
      hip.position.set(def.x, 2.28, def.z);
      g.add(hip);
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.2, 1.15, 6), dark);
      upper.position.y = -0.57;
      hip.add(upper);
      const knee = new THREE.Group();
      knee.position.y = -1.12;
      hip.add(knee);
      const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.11, 1.0, 6), dark);
      lower.position.y = -0.5;
      knee.add(lower);
      const paw = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.5), darker);
      paw.position.set(0, -1.0, 0.08);
      knee.add(paw);
      // claws
      for (let i = 0; i < 3; i++) {
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.18, 4), mat('#b8b095', { roughness: 0.5 }));
        claw.position.set(-0.09 + i * 0.09, -1.03, 0.34);
        claw.rotation.x = Math.PI / 2.2;
        knee.add(claw);
      }
      this.legs.push({ hip, knee, def, base: def.front ? -0.08 : 0.12 });
    }

    // tail
    this.tail = [];
    let tParent = g;
    for (let i = 0; i < 5; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, 2.28, -1.55 - i * 0.0001);
      if (i === 0) seg.position.y = 2.3;
      if (i > 0) seg.position.z = -0.42;
      const len = 0.55 - i * 0.06;
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.1 - i * 0.012, 0.14 - i * 0.012, len, 5), dark);
      mesh.rotation.x = Math.PI / 2;
      mesh.position.z = -len / 2;
      seg.add(mesh);
      tParent.add(seg);
      tParent = seg;
      this.tail.push(seg);
    }
    this.tail[0].rotation.x = 0.35;

    this.group.visible = false;
  }

  _hide(hidden) {
    this.group.visible = !hidden;
  }

  reset(playerPos, opts = {}) {
    this.caught = false;
    this.state = 'lurk';
    this.stateTime = 0;
    this.spawnGrace = opts.grace ?? 14;
    this.huntingTime = 0;
    this.lostTime = 0;
    this.legPhase = 0;
    this._hide(false);
    const angle = rand(0, TAU);
    const dist = opts.distance ?? 34;
    let x = playerPos.x + Math.cos(angle) * dist;
    let z = playerPos.z + Math.sin(angle) * dist;
    const r = Math.hypot(x, z);
    if (r > 112) { x *= 112 / r; z *= 112 / r; }
    this.group.position.set(x, this.world.heightAt(x, z), z);
    this.yaw = Math.atan2(playerPos.x - x, playerPos.z - z);
    this.group.rotation.y = this.yaw;
    this.target.copy(playerPos);
    this.state = 'lurk';
    this.lurkTimer = 6;
    this.headRig.rotation.set(0, 0, 0);
    this.group.scale.setScalar(0.001);
    this.spawnScale = 1;
  }

  startHunt(force = false) {
    if (this.state === 'caught') return;
    this.state = 'hunt';
    this.stateTime = 0;
    this.huntingTime = 0;
    this.lostTime = 0;
    this.events.push({ type: 'snarl' });
  }

  provoke(playerPos) {
    if (this.state === 'lurk' || this.state === 'prowl') {
      if (this.spawnGrace > 0 && this.state !== 'prowl') return;
      this.startHunt();
    }
  }

  get alive() { return this.state !== 'caught'; }

  /* ------------------------------------------------------------------ */
  /*  update                                                            */
  /* ------------------------------------------------------------------ */
  update(dt, player, camera, flashlightOn) {
    const p = player.position;
    this.distToPlayer = Math.hypot(p.x - this.group.position.x, p.z - this.group.position.z);
    this.stateTime += dt;
    this.spawnGrace = Math.max(0, this.spawnGrace - dt);

    if (this.spawnScale !== undefined && this.spawnScale < 1) {
      this.spawnScale = Math.min(1, this.spawnScale + dt * 0.7);
      this.group.scale.setScalar(this.spawnScale);
    }

    // relative pan for audio
    if (camera) {
      const dx = this.group.position.x - camera.position.x;
      const dz = this.group.position.z - camera.position.z;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      this.pan = clamp((dx * right.x + dz * right.z) / Math.max(6, this.distToPlayer), -1, 1);
    }

    // light reaction
    let lit = false;
    if (flashlightOn && this.distToPlayer < 30) {
      const toWolf = new THREE.Vector3().subVectors(this.group.position, camera.position).normalize();
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      lit = toWolf.dot(forward) > 0.86;
    }
    this.lit = lit;
    this.headLight.intensity = lerp(this.headLight.intensity, this.distToPlayer < 16 ? 1.5 : 0.0, 1 - Math.exp(-3 * dt));

    let desiredSpeed = 0;
    let facePlayer = true;

    switch (this.state) {
      case 'lurk': {
        const spd = 1.1 + this.pressure * 0.35;
        this._moveAround(p, 23 - this.pressure * 3, spd, dt);
        desiredSpeed = spd;
        if (this.stateTime > 11 + rand(0, 3) - this.pressure * 2) {
          this.state = 'prowl';
          this.stateTime = 0;
          if (Math.random() < 0.6) this.events.push({ type: 'howl' });
        }
        if (this.spawnGrace <= 0 && this.distToPlayer < 12) {
          this.startHunt();
        }
        break;
      }
      case 'prowl': {
        const spd = 2.3 + this.pressure * 0.9;
        this._moveToward(p, spd, dt, 2.4);
        desiredSpeed = spd;
        if (this.distToPlayer < 10 + this.pressure * 2) {
          this.startHunt();
          this.events.push({ type: 'howl' });
        }
        if (this.stateTime > 20) {
          this.state = 'lurk';
          this.stateTime = 0;
          this.lurkTimer = 6;
        }
        break;
      }
      case 'hunt': {
        this.huntingTime += dt;
        const base = 4.45 + this.pressure * 0.7 + Math.min(1.9, this.huntingTime * 0.28);
        let spd = base;
        if (lit && this.distToPlayer > 3.5) spd *= 0.58;
        if (this.distToPlayer < 6) spd *= 1.06;
        this._moveToward(p, spd, dt, 0.6);
        desiredSpeed = spd;
        this.lostTime = this.distToPlayer > 34 ? this.lostTime + dt : 0;
        if (this.distToPlayer < 2.2) {
          this._catch(p);
        } else if (this.lostTime > 4 || this.huntingTime > 24) {
          this.state = 'retreat';
          this.stateTime = 0;
          this.events.push({ type: 'howl' });
        }
        break;
      }
      case 'retreat': {
        const away = new THREE.Vector3(p.x - this.group.position.x, 0, p.z - this.group.position.z).normalize().multiplyScalar(-1);
        const t = new THREE.Vector3(this.group.position.x + away.x * 30, 0, this.group.position.z + away.z * 30);
        this._moveToward(t, 7.2, dt, 2.0);
        desiredSpeed = 7.2;
        if (this.stateTime > 4.5) {
          this.state = 'lurk';
          this.stateTime = 0;
          this.spawnGrace = 5;
          this._teleportAround(p, 30, 45);
        }
        break;
      }
      case 'caught': {
        desiredSpeed = 0;
        break;
      }
      default: break;
    }

    // never stray too far for too long — quietly reposition behind the fog
    if (this.distToPlayer > 78 && this.state !== 'caught') {
      this._teleportAround(p, 30, 42);
    }

    this._animate(dt, player, camera, desiredSpeed, facePlayer);
  }

  _findNearby(x, z) {
    return this.world.colliders.filter(c => (c.x - x) ** 2 + (c.z - z) ** 2 < 16);
  }

  _moveToward(target, speed, dt, stopDist = 1.6) {
    const pos = this.group.position;
    const dx = target.x - pos.x, dz = target.z - pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > stopDist) {
      let mx = dx / dist, mz = dz / dist;
      // steer around trunks
      for (const c of this._findNearby(pos.x, pos.z)) {
        const ddx = pos.x - c.x, ddz = pos.z - c.z;
        const d = Math.hypot(ddx, ddz);
        if (d < c.r + 1.5 && d > 0.001) {
          const f = (c.r + 1.5 - d) / (c.r + 1.5) * 1.8;
          mx += (ddx / d) * f;
          mz += (ddz / d) * f;
        }
      }
      const len = Math.hypot(mx, mz) || 1;
      mx /= len; mz /= len;
      const step = Math.min(speed * dt, dist);
      pos.x += mx * step;
      pos.z += mz * step;
      const r = Math.hypot(pos.x, pos.z);
      if (r > 116) { pos.x *= 116 / r; pos.z *= 116 / r; }
      this.effSpeed = speed;
      const targetYaw = Math.atan2(mx, mz);
      this.yaw += shortestAngle(this.yaw, targetYaw) * Math.min(1, dt * 6);
    } else {
      this.effSpeed = 0;
      if (this.state === 'lurk') {
        const targetYaw = Math.atan2(target.x - pos.x, target.z - pos.z);
        this.yaw += shortestAngle(this.yaw, targetYaw) * Math.min(1, dt * 2.5);
      }
    }
    pos.y = this.world.heightAt(pos.x, pos.z);
    this.group.rotation.y = this.yaw;
  }

  _moveAround(player, desiredDist, speed, dt) {
    this.repathTimer -= dt;
    const pos = this.group.position;
    if (this.repathTimer <= 0) {
      this.repathTimer = rand(3, 6);
      const ang = Math.atan2(pos.z - player.z, pos.x - player.x) + rand(-0.9, 0.9);
      let x = player.x + Math.cos(ang) * desiredDist;
      let z = player.z + Math.sin(ang) * desiredDist;
      const r = Math.hypot(x, z);
      if (r > 112) { x *= 112 / r; z *= 112 / r; }
      this.target.set(x, 0, z);
    }
    this._moveToward(this.target, speed, dt, 1.2);
  }

  _teleportAround(player, minD, maxD) {
    const a = rand(0, TAU), d = rand(minD, maxD);
    let x = player.x + Math.cos(a) * d, z = player.z + Math.sin(a) * d;
    const r = Math.hypot(x, z);
    if (r > 112) { x *= 112 / r; z *= 112 / r; }
    this.group.position.set(x, this.world.heightAt(x, z), z);
    this.group.scale.setScalar(1);
    this.spawnScale = 1;
    this.stateTime = 0;
  }

  _catch(p) {
    this.caught = true;
    this.state = 'caught';
    this.stateTime = 0;
    this.events.push({ type: 'catch' });
    // snap in front of the player -- the scare rig takes it from here
    this.group.position.set(p.x, this.world.heightAt(p.x, p.z), p.z);
    this.group.rotation.y = Math.atan2(p.x - this.group.position.x, p.z - this.group.position.z);
  }

  _animate(dt, player, camera, speed, facePlayer) {
    const t = performance.now() / 1000;
    const moving = speed > 0.1;
    this.legPhase += dt * (moving ? speed * 1.55 : 0.4);

    const amp = this.state === 'hunt' ? 0.72 : this.state === 'retreat' ? 0.55 : moving ? 0.34 : 0.05;
    this.legs.forEach((leg, i) => {
      const phase = this.legPhase + (i === 0 || i === 3 ? 0 : Math.PI);
      const swing = Math.sin(phase) * amp;
      leg.hip.rotation.x = leg.base + swing + (this.state === 'hunt' ? 0.1 : 0);
      leg.knee.rotation.x = 0.55 + Math.max(0, Math.sin(phase + 1.1)) * amp * 1.1;
      leg.hip.rotation.z = (leg.def.x < 0 ? 1 : -1) * 0.03;
    });

    // body bob
    const bob = moving ? Math.sin(this.legPhase * 2) * (this.state === 'hunt' ? 0.1 : 0.05) : Math.sin(t * 1.4) * 0.02;
    this.body.position.y = 2.35 + bob;
    this.chest.position.y = 2.45 + bob;
    this.headRig.position.y = 3.32 + bob * 0.7;

    // breathing
    const breath = 1 + Math.sin(t * 1.7) * 0.012;
    this.chest.scale.set(0.78 * breath, 0.72 * breath, 0.9);

    // head track player
    if (facePlayer && camera && this.state !== 'retreat' && this.state !== 'caught') {
      const headWorld = new THREE.Vector3();
      this.headRig.getWorldPosition(headWorld);
      const dir = new THREE.Vector3().subVectors(camera.position, headWorld);
      const local = this.headRig.parent.worldToLocal(headWorld.clone().add(dir));
      const yaw = Math.atan2(local.x, local.z);
      const pitch = Math.atan2(local.y - 0.1, Math.hypot(local.x, local.z));
      this.headRig.rotation.y = lerp(this.headRig.rotation.y, clamp(yaw, -0.85, 0.85), 1 - Math.exp(-4 * dt));
      this.headRig.rotation.x = lerp(this.headRig.rotation.x, clamp(-pitch, -0.5, 0.6), 1 - Math.exp(-4 * dt));
    } else {
      this.headRig.rotation.y = lerp(this.headRig.rotation.y, 0, 1 - Math.exp(-3 * dt));
      this.headRig.rotation.x = lerp(this.headRig.rotation.x, 0, 1 - Math.exp(-3 * dt));
    }

    // jaw — breathing, snarl when hunting
    const jawOpen = this.state === 'hunt'
      ? 0.16 + Math.max(0, Math.sin(t * 2.6)) * 0.18
      : this.state === 'caught' ? 0.9 : 0.03 + Math.max(0, Math.sin(t * 1.2)) * 0.05;
    this.jaw.rotation.x = lerp(this.jaw.rotation.x, jawOpen, 1 - Math.exp(-6 * dt));

    // tail sway
    this.tail.forEach((seg, i) => {
      seg.rotation.y = Math.sin(t * 1.2 + i * 0.6) * 0.12;
      seg.rotation.x = (i === 0 ? 0.35 : 0.04) + Math.sin(t * 0.9 + i) * 0.03;
    });

    // ears
    this.head.userData.ears.forEach((ear, i) => {
      ear.rotation.z = (i === 0 ? 1 : -1) * (0.35 + Math.sin(t * 0.7 + i) * 0.04);
    });

    // eyes: blink (rare), flare in hunt
    this.blinkTimer -= dt;
    let blink = 1;
    if (this.blinkTimer < 0) {
      const k = (-this.blinkTimer) / 0.14;
      blink = k < 1 ? Math.abs(Math.cos(k * Math.PI)) : 1;
      if (-this.blinkTimer > 0.16) this.blinkTimer = rand(3, 7);
    }
    const eyePower = this.state === 'hunt' ? 1.25 : 0.85;
    this.head.userData.eyes.forEach(e => { e.scale.y = 0.9 * blink; });
    this.eyeSprites.forEach(s => {
      s.scale.setScalar((this.state === 'hunt' ? 0.9 : 0.62) * (0.8 + Math.sin(t * 3.1) * 0.1));
      s.material.opacity = clamp(eyePower * (1.1 - this.distToPlayer / 55), 0.25, 1);
    });

    // heavy footsteps
    if (moving) {
      this.stepDist += this.effSpeed * dt;
      if (this.stepDist > (this.state === 'hunt' || this.state === 'retreat' ? 2.2 : 3.0)) {
        this.stepDist = 0;
        this.events.push({ type: 'step' });
      }
    }

    this.group.updateMatrixWorld();
  }
}

/* ==================================================================
   JUMPSCARE — a dedicated close-up shot of the thing's face
   ================================================================== */
export class Jumpscare {
  constructor(audio) {
    this.audio = audio;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#030202');
    this.camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 0.05, 40);
    this.camera.position.set(0, 0.18, 8.2);
    this.camera.lookAt(0, 0.02, 0);

    this.head = buildScareHead();
    this.head.scale.setScalar(2.15);
    this.head.position.set(0, 0.02, -1.7);
    this.scene.add(this.head);
    this.jaw = this.head.userData.jaw;
    this.jaw.rotation.x = 0.02;

    // stage lights — hard key from the front, sickly red rim behind
    const key = new THREE.PointLight('#fff0c8', 34, 17, 1.3);
    key.position.set(2.1, 1.9, 5.6);
    this.scene.add(key);
    const key2 = new THREE.PointLight('#cdd9e8', 18, 14, 1.4);
    key2.position.set(-2.4, 0.9, 4.7);
    this.scene.add(key2);
    const rim = new THREE.PointLight('#5e0b07', 64, 18, 1.45);
    rim.position.set(-2.7, 1.6, -4.0);
    this.scene.add(rim);
    const fill = new THREE.PointLight('#c9c2ab', 9, 9, 1.25);
    fill.position.set(-1.6, -1.6, 4.2);
    this.scene.add(fill);
    this.scene.add(new THREE.AmbientLight('#1e0f0c', 0.22));
    this.under = new THREE.PointLight('#5e1a0d', 5, 7, 1.5);
    this.under.position.set(0, -1.4, 2.4);
    this.scene.add(this.under);

    const eyeGlow = glowTexture();
    this.sprites = [];
    for (const s of [-1, 1]) {
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: eyeGlow, color: '#ffbf66', transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false
      }));
      spr.position.set(s * 0.225, 0.15, 0.72);
      spr.scale.setScalar(0.28);
      this.head.add(spr);
      this.sprites.push(spr);
    }

    this.active = false;
    this.t = 0;
    this.duration = 2.15;
    this.short = false;
    this.key = key;
    this.key2 = key2;
    this.rim = rim;
    this.base = { x: 0, y: 0.02, z: -1.7 };
    this.yawBase = 0.09;
    this.updateCameraAspect();
  }

  updateCameraAspect() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    // portrait phones crop hard with a long lens — pull the camera back
    const portrait = this.camera.aspect < 0.85;
    this.camera.position.z = portrait ? 12.2 : 8.2;
    this.yawBase = portrait ? 0.03 : 0.09;
    this.camera.updateProjectionMatrix();
  }

  show(short = false) {
    this.active = true;
    this.short = short;
    this.t = 0;
    this.duration = short ? 0.95 : 2.15;
    const z = short ? 0.7 : -1.7;
    this.head.position.set(0, 0.02, z);
    this.head.rotation.set(0, this.yawBase, -0.045);
    this.head.scale.setScalar(short ? 2.25 : 2.15);
    this.jaw.rotation.x = short ? 0.42 : 0.1;
    this.updateCameraAspect();
    this.audio?.jumpscare();
  }

  hide() {
    this.active = false;
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const t = this.t;
    const short = this.short;
    // 0 = coiled far away, 1 = nose pressed into the lens
    const lungeEnd = short ? 0.06 : 0.2;
    const recoilEnd = short ? 0.26 : 0.5;
    const holdEnd = short ? 0.62 : 1.5;

    let z, jaw, shake;
    if (t < lungeEnd) {
      const k = t / lungeEnd;
      z = lerp(short ? 1.2 : -2.0, 2.55, Math.pow(k, 0.55));
      jaw = lerp(0.1, 0.48, k);
      shake = 0.025;
    } else if (t < recoilEnd) {
      const k = (t - lungeEnd) / (recoilEnd - lungeEnd);
      z = lerp(2.55, 2.36, Math.sin(k * Math.PI) * 0.5);
      jaw = 0.45 + Math.sin(k * Math.PI) * 0.1;
      shake = 0.06;
    } else if (t < holdEnd) {
      z = 2.5 + Math.sin(t * 47) * 0.03;
      jaw = 0.4;
      shake = 0.07;
    } else {
      const k = clamp((t - holdEnd) / (this.duration - holdEnd), 0, 1);
      z = lerp(2.5, -3.0, k * k);
      jaw = 0.4 * (1 - k * 0.3);
      shake = 0.025;
    }

    this.head.position.z = z;
    this.head.position.x = Math.sin(t * 71) * shake;
    this.head.position.y = 0.02 + Math.sin(t * 57) * shake * 0.7;
    this.head.rotation.z = -0.045 + Math.sin(t * 43) * shake * 0.55;
    this.head.rotation.y = this.yawBase + Math.sin(t * 31) * shake * 0.45;
    this.head.rotation.x = Math.sin(t * 67) * shake * 0.3;
    this.jaw.rotation.x = lerp(this.jaw.rotation.x, jaw, 1 - Math.exp(-22 * dt));
    this.head.userData.ears.forEach((ear, i) => {
      ear.rotation.z = (i === 0 ? 1 : -1) * lerp(0.35, 1.0, clamp(t / 0.2, 0, 1));
    });
    this.sprites.forEach(s => {
      s.scale.setScalar(0.26 + Math.sin(t * 39) * 0.035 + (short ? 0.035 : 0.055));
    });
    this.key.intensity = 34 + Math.sin(t * 61) * 8;
    this.key2.intensity = 12 + Math.sin(t * 37) * 3;
    this.rim.intensity = 64 + Math.sin(t * 23) * 16;
    // aim just below the eyeline so the open mouth and teeth stay in frame
    this.camera.position.x = Math.sin(t * 83) * 0.05;
    this.camera.position.y = 0.18 + Math.cos(t * 67) * 0.04;
    this.camera.lookAt(this.head.position.x * 0.35, -0.16, this.head.position.z);
    this.camera.fov = 34 + Math.sin(t * 51) * 0.9;
    this.camera.updateProjectionMatrix();
    if (t >= this.duration) this.hide();
  }
}
