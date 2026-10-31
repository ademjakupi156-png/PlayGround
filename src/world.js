import * as THREE from 'three';
import {
  makeNoise2D, fbm, mulberry32, rand, randInt, pick, clamp, lerp, TAU,
  colorize, mergeGeometries, transformed, glowTexture, beamTexture, smokeTexture
} from './util.js';

/* ==================================================================
   WORLD — fog, pines, a dead road, a broken car, twenty lost pieces
   ================================================================== */

const PART_TYPES = [
  { name: 'WHEEL', kind: 'wheel' },
  { name: 'DISTRIBUTOR', kind: 'distributor' },
  { name: 'DOOR PANEL', kind: 'door' },
  { name: 'HEADLIGHT', kind: 'headlight' },
  { name: 'FRONT BUMPER', kind: 'bumper' },
  { name: 'BATTERY', kind: 'battery' },
  { name: 'SPARK PLUG', kind: 'sparkplug' },
  { name: 'SIDE MIRROR', kind: 'mirror' },
  { name: 'HOOD', kind: 'hood' },
  { name: 'EXHAUST PIPE', kind: 'pipe' },
  { name: 'GEARBOX', kind: 'gearbox' },
  { name: 'RADIATOR', kind: 'radiator' },
  { name: 'TAIL LIGHT', kind: 'taillight' },
  { name: 'FAN BELT', kind: 'belt' },
  { name: 'AXLE', kind: 'axle' },
  { name: 'CARBURETOR', kind: 'carb' },
  { name: 'SEAT', kind: 'seat' },
  { name: 'LICENSE PLATE', kind: 'plate' },
  { name: 'WIPER', kind: 'wiper' },
  { name: 'STEERING WHEEL', kind: 'steering' }
];

export class World {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this.parts = [];
    this.colliders = [];
    this.glow = glowTexture();
    this.beamTex = beamTexture();
    this.smokeTex = smokeTexture();
    this.noise = makeNoise2D(1337);
    this.jitter = makeNoise2D(991);
    this.wreckPos = new THREE.Vector3(0, 0, 0);
    this.collected = 0;
    this.trees = [];
    this.motes = null;
    this.wreckLight = null;
    this.beacon = null;
    this.wrect = new THREE.Group();
    this._buildSky();
    this._buildLights();
    this._buildTerrain();
    this._buildRoad();
    this._buildTrees();
    this._buildUndergrowth();
    this._buildWreck();
    this._buildParts();
    this._buildMotes();
    this._buildMist();
  }

  /* ------------------------------ terrain ------------------------------ */
  heightAt(x, z) {
    const base = fbm(this.noise, x * 0.016, z * 0.016, 3) * 2.4;
    const detail = fbm(this.noise, x * 0.09 + 31, z * 0.09 - 17, 2) * 0.38;
    const flatten = 1 - Math.exp(-((x * x + z * z) / 90));
    return (base + detail) * (0.25 + 0.75 * flatten);
  }

  roadPoint(t) {
    return this.roadCurve.getPointAt(clamp(t, 0, 1));
  }

  roadDist(x, z) {
    let best = Infinity;
    for (const p of this.roadSamples) {
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  _buildSky() {
    const geo = new THREE.SphereGeometry(300, 24, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color('#02050a') },
        mid: { value: new THREE.Color('#0d1914') },
        bottom: { value: new THREE.Color('#1a2b20') }
      },
      vertexShader: `varying vec3 vWorld; void main(){ vWorld = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        varying vec3 vWorld; uniform vec3 top; uniform vec3 mid; uniform vec3 bottom;
        void main(){
          float h = vWorld.y;
          vec3 c = mix(bottom, mid, smoothstep(-0.08, 0.22, h));
          c = mix(c, top, smoothstep(0.18, 0.75, h));
          gl_FragColor = vec4(c, 1.0);
        }`
    });
    const sky = new THREE.Mesh(geo, mat);
    sky.renderOrder = -10;
    this.scene.add(sky);

    // stars
    const rnd = mulberry32(44);
    const count = 520;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = rnd() * TAU;
      const y = 0.12 + rnd() * 0.88;
      const r = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(theta) * r * 260;
      pos[i * 3 + 1] = y * 260;
      pos[i * 3 + 2] = Math.sin(theta) * r * 260;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const sm = new THREE.PointsMaterial({ color: '#aab5a0', size: 0.9, sizeAttenuation: true, transparent: true, opacity: 0.65, fog: false, depthWrite: false });
    this.stars = new THREE.Points(sg, sm);
    this.scene.add(this.stars);

    // moon
    const moonPos = new THREE.Vector3(-120, 105, -190);
    const moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: '#a9bda6', transparent: true, opacity: 0.5, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    moonGlow.position.copy(moonPos);
    moonGlow.scale.setScalar(82);
    this.scene.add(moonGlow);
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(5.6, 16, 12),
      new THREE.MeshBasicMaterial({ color: '#e8edd6', fog: false, toneMapped: false })
    );
    moon.position.copy(moonPos).multiplyScalar(0.965);
    this.scene.add(moon);

    // ragged clouds drifting across the moon
    this.clouds = [];
    const rndc = mulberry32(9);
    for (let i = 0; i < 9; i++) {
      const cloud = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.smokeTex, color: '#070c09', transparent: true, opacity: 0.55,
        depthWrite: false, fog: false
      }));
      const off = new THREE.Vector3((rndc() - 0.5) * 150, (rndc() - 0.5) * 34, (rndc() - 0.5) * 60);
      cloud.position.copy(moonPos).multiplyScalar(0.9).add(off);
      cloud.scale.set(rand(64, 120), rand(14, 32), 1);
      cloud.userData = { drift: rand(0.5, 1.6) * (i % 2 ? 1 : -1), left: cloud.position.x };
      this.scene.add(cloud);
      this.clouds.push(cloud);
    }
  }

  _buildLights() {
    const hemi = new THREE.HemisphereLight('#50685e', '#090c07', 0.78);
    this.scene.add(hemi);
    const moon = new THREE.DirectionalLight('#a7bec0', 0.92);
    moon.position.set(-60, 80, -30);
    this.scene.add(moon);
    const fill = new THREE.DirectionalLight('#2f4740', 0.35);
    fill.position.set(40, 20, 60);
    this.scene.add(fill);
    this.scene.fog = new THREE.FogExp2('#0d1a14', 0.035);
  }

  _buildTerrain() {
    const size = 270, seg = 150;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const soil = new THREE.Color('#24251a');
    const moss = new THREE.Color('#333f24');
    const dirt = new THREE.Color('#2d271e');
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = this.heightAt(x, z);
      pos.setY(i, y);
      const n = fbm(this.noise, x * 0.06 + 5, z * 0.06 - 3, 3);
      const m = fbm(this.noise, x * 0.018 - 8, z * 0.018 + 4, 2);
      c.copy(soil).lerp(moss, clamp(0.35 + n * 0.65, 0, 1) * 0.7);
      c.lerp(dirt, clamp(m * 0.8 + 0.2, 0, 1) * 0.45);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    this.ground = new THREE.Mesh(geo, mat);
    this.ground.receiveShadow = false;
    this.scene.add(this.ground);

    // damp patches — faint reflective sheets
    const patchMat = new THREE.MeshStandardMaterial({ color: '#131a16', roughness: 0.18, metalness: 0.1, transparent: true, opacity: 0.55 });
    for (let i = 0; i < 26; i++) {
      const x = rand(-110, 110), z = rand(-110, 110);
      if (x * x + z * z < 100) continue;
      const g = new THREE.CircleGeometry(rand(0.6, 2.4), 9);
      g.rotateX(-Math.PI / 2);
      g.scale(1, 1, rand(0.5, 1.4));
      const m = new THREE.Mesh(g, patchMat);
      m.position.set(x, this.heightAt(x, z) + 0.03, z);
      m.rotation.y = rand(0, TAU);
      this.scene.add(m);
    }
  }

  _buildRoad() {
    const pts = [
      [-118, 108], [-96, 82], [-78, 61], [-58, 40], [-37, 22], [-17, 8],
      [0, 0], [13, -11], [25, -27], [33, -48], [34, -70], [28, -92], [18, -114]
    ];
    this.roadCurve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)));
    this.roadSamples = [];
    for (let i = 0; i <= 90; i++) this.roadSamples.push(this.roadCurve.getPointAt(i / 90));
    const N = 220;
    const positions = [], colors = [], indices = [];
    const c1 = new THREE.Color('#2a261d'), c2 = new THREE.Color('#332d22');
    const widths = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const p = this.roadCurve.getPointAt(t);
      const tan = this.roadCurve.getTangentAt(t);
      const side = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
      const w = 2.9 + Math.sin(t * 17) * 0.35 + Math.sin(t * 41) * 0.18;
      widths.push(w);
      for (const s of [-1, 1]) {
        const x = p.x + side.x * w * s, z = p.z + side.z * w * s;
        positions.push(x, this.heightAt(x, z) + 0.055, z);
        const col = (i % 3 === 0) ? c2 : c1;
        colors.push(col.r, col.g, col.b);
      }
      if (i < N) {
        const a = i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.52, metalness: 0.12 });
    this.road = new THREE.Mesh(geo, mat);
    this.scene.add(this.road);

    // dead centre line, dashed and half-buried
    const lp = [], li = [], lc = [];
    let vi = 0;
    for (let i = 0; i < 70; i++) {
      if (i % 2) continue;
      const t0 = i / 70, t1 = (i + 1) / 70;
      const p0 = this.roadCurve.getPointAt(t0), p1 = this.roadCurve.getPointAt(t1);
      const t0a = this.roadCurve.getTangentAt(t0), t1a = this.roadCurve.getTangentAt(t1);
      const s0 = new THREE.Vector3(-t0a.z, 0, t0a.x).normalize().multiplyScalar(0.075);
      const s1 = new THREE.Vector3(-t1a.z, 0, t1a.x).normalize().multiplyScalar(0.075);
      const quad = [
        p0.x - s0.x, this.heightAt(p0.x - s0.x, p0.z - s0.z) + 0.075, p0.z - s0.z,
        p0.x + s0.x, this.heightAt(p0.x + s0.x, p0.z + s0.z) + 0.075, p0.z + s0.z,
        p1.x - s1.x, this.heightAt(p1.x - s1.x, p1.z - s1.z) + 0.075, p1.z - s1.z,
        p1.x + s1.x, this.heightAt(p1.x + s1.x, p1.z + s1.z) + 0.075, p1.z + s1.z
      ];
      lp.push(...quad);
      lc.push(0.42, 0.41, 0.33, 0.42, 0.41, 0.33, 0.42, 0.41, 0.33, 0.42, 0.41, 0.33);
      li.push(vi, vi + 2, vi + 1, vi + 1, vi + 2, vi + 3);
      vi += 4;
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    lg.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3));
    lg.setIndex(li);
    lg.computeVertexNormals();
    const lm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05 });
    this.scene.add(new THREE.Mesh(lg, lm));
  }

  /* ------------------------------ trees -------------------------------- */
  _treeTemplate(rnd, dead = false) {
    const geoms = [];
    const H = dead ? rand(9, 15) : rand(12, 20);
    const lean = rand(-0.04, 0.04);
    const baseR = rand(0.26, 0.46);
    const trunkColor = dead ? '#332e28' : '#382f25';
    const segs = 4;
    let prevY = 0, prevX = 0, prevZ = 0;
    for (let s = 0; s < segs; s++) {
      const y0 = (s / segs) * H, y1 = ((s + 1) / segs) * H;
      const r0 = baseR * (1 - s / segs * 0.82), r1 = baseR * (1 - (s + 1) / segs * 0.82);
      const offX = lean * y0 + (rnd() - 0.5) * 0.12;
      const offZ = (rnd() - 0.5) * 0.12;
      const bend = Math.atan2(offX - prevX, 0.01) * 0;
      const g = new THREE.CylinderGeometry(r1, r0, y1 - y0 + 0.12, 7, 1);
      g.translate(0, (y0 + y1) / 2, 0);
      g.rotateZ(Math.atan2(offX - prevX, y1 - y0));
      g.translate(prevX, 0, prevZ);
      geoms.push(colorize(g, trunkColor, 0.24, rnd));
      prevX += offX - prevX; prevZ += offZ;
    }

    // branch arms
    const branchCount = dead ? randInt(5, 8) : randInt(3, 6);
    for (let i = 0; i < branchCount; i++) {
      const h = H * rand(0.28, dead ? 0.9 : 0.62);
      const len = (dead ? rand(1.4, 3.6) : rand(0.8, 2.2));
      const ang = rnd() * TAU;
      const g = new THREE.CylinderGeometry(0.025, 0.085, len, 5, 1);
      g.translate(0, len / 2, 0);
      g.rotateZ(rand(0.9, 1.5));
      g.rotateY(ang);
      g.translate(prevX * (h / H), h, prevZ * (h / H));
      geoms.push(colorize(g, trunkColor, 0.2, rnd));
      if (dead && rnd() < 0.5) {
        const tw = new THREE.CylinderGeometry(0.015, 0.035, len * 0.5, 4, 1);
        tw.translate(0, len * 0.25, 0);
        tw.rotateZ(rand(0.2, 0.8));
        tw.rotateY(rnd() * TAU);
        tw.translate(0, len * 0.7, 0);
        tw.rotateY(ang); tw.translate(prevX * (h / H), h, prevZ * (h / H));
        geoms.push(colorize(tw, trunkColor, 0.2, rnd));
      }
    }

    if (!dead) {
      // roots
      for (let i = 0; i < 5; i++) {
        const g = new THREE.ConeGeometry(0.18, 0.7, 4);
        g.rotateZ(Math.PI / 2 + rand(0.1, 0.5));
        g.rotateY((i / 5) * TAU + rnd());
        g.translate(0, 0.18, 0);
        geoms.push(colorize(g, '#241f19', 0.2, rnd));
      }
      // pine canopy
      const layers = randInt(7, 10);
      const start = H * rand(0.3, 0.4);
      const span = H - start;
      const greens = ['#1c2917', '#25331b', '#1a2513', '#2a381e'];
      for (let i = 0; i < layers; i++) {
        const t = i / (layers - 1);
        const rad = (1 - t) * (H * 0.155) + 0.28;
        const h = (span / layers) * rand(1.5, 2.1);
        const g = new THREE.ConeGeometry(rad, h, 8, 1);
        g.rotateY(rnd() * TAU);
        g.translate(prevX * (start / H) + (rnd() - 0.5) * 0.5, start + t * span + h * 0.25, prevZ * (start / H) + (rnd() - 0.5) * 0.5);
        geoms.push(colorize(g, pick(greens), 0.28, rnd));
      }
      // ragged side clusters break the symmetry
      for (let i = 0; i < 4; i++) {
        const hh = H * rand(0.34, 0.85);
        const rad = H * rand(0.07, 0.12);
        const g = new THREE.ConeGeometry(rad, H * rand(0.1, 0.18), 6);
        const ang = rnd() * TAU;
        const off = H * rand(0.04, 0.12);
        g.rotateY(ang);
        g.translate(prevX * (hh / H) + Math.cos(ang) * off, hh, prevZ * (hh / H) + Math.sin(ang) * off);
        geoms.push(colorize(g, pick(greens), 0.3, rnd));
      }
      // dead limbs push through the needles
      for (let i = 0; i < 3; i++) {
        const hh = H * rand(0.4, 0.8);
        const len = rand(0.9, 2.0);
        const g = new THREE.CylinderGeometry(0.018, 0.06, len, 4, 1);
        g.translate(0, len / 2, 0);
        g.rotateZ(rand(1.05, 1.45));
        g.rotateY(rnd() * TAU);
        g.translate(prevX * (hh / H), hh, prevZ * (hh / H));
        geoms.push(colorize(g, '#2a241d', 0.2, rnd));
      }
      // crown
      const crown = new THREE.ConeGeometry(0.35, 1.8, 6);
      crown.translate(prevX, H + 0.4, prevZ);
      geoms.push(colorize(crown, '#1c2618', 0.3, rnd));
    }
    return mergeGeometries(geoms);
  }

  _buildTrees() {
    const rnd = mulberry32(2024);
    const templates = [
      this._treeTemplate(rnd, false),
      this._treeTemplate(rnd, false),
      this._treeTemplate(rnd, false),
      this._treeTemplate(rnd, true)
    ];
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0, flatShading: true });
    const counts = [150, 150, 150, 70];
    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();
    const placed = [];

    const positions = [];
    let guard = 0;
    while (positions.length < 520 && guard++ < 9000) {
      const a = rnd() * TAU;
      const r = 9 + Math.sqrt(rnd()) * 118;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (x * x + z * z > 124 * 124) continue;
      // keep the road clear
      if (this.roadDist(x, z) < 6.4) continue;
      if (x * x + z * z < 11 * 11) continue;
      let ok = true;
      for (const p of placed) {
        if ((p.x - x) ** 2 + (p.z - z) ** 2 < 4.2) { ok = false; break; }
      }
      if (!ok) continue;
      positions.push([x, z]);
      placed.push({ x, z });
    }

    // distribute across templates, keeping the dead ones spread out
    const buckets = [[], [], [], []];
    positions.forEach((p, i) => buckets[i % 11 === 0 ? 3 : i % 3].push(p));

    this.treeTemplates = templates;
    buckets.forEach((list, ti) => {
      const geo = templates[ti];
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach(([x, z], i) => {
        const y = this.heightAt(x, z);
        const s = ti === 3 ? rand(0.8, 1.25) : rand(0.75, 1.45);
        dummy.position.set(x, y - 0.15, z);
        dummy.rotation.set(rand(-0.03, 0.03), rand(0, TAU), rand(-0.03, 0.03));
        dummy.scale.set(s * rand(0.9, 1.1), s, s * rand(0.9, 1.1));
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        const shade = rand(0.85, 1.18);
        tint.setRGB(shade, shade * rand(0.94, 1.04), shade * rand(0.92, 1.02));
        mesh.setColorAt(i, tint);
        this.colliders.push({ x, z, r: 0.42 * s });
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = true;
      this.scene.add(mesh);
    });
  }

  _buildUndergrowth() {
    const rnd = mulberry32(77);
    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();

    // ferns — six bent blades
    const blades = [];
    for (let i = 0; i < 7; i++) {
      const g = new THREE.PlaneGeometry(0.09, rand(0.5, 1.1), 1, 3);
      g.translate(0, 0.4, 0);
      g.rotateX(rand(-0.5, -0.15));
      g.rotateY((i / 7) * TAU + rnd() * 0.4);
      blades.push(colorize(g, i % 2 ? '#1e2a18' : '#26331c', 0.3, rnd));
    }
    const fernGeo = mergeGeometries(blades);
    const fernMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide, flatShading: true });
    const ferns = new THREE.InstancedMesh(fernGeo, fernMat, 900);
    for (let i = 0; i < 900; i++) {
      const a = rnd() * TAU, r = 6 + Math.sqrt(rnd()) * 112;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (this.roadDist(x, z) < 5.4) { ferns.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0)); continue; }
      dummy.position.set(x, this.heightAt(x, z) - 0.05, z);
      dummy.rotation.set(0, rnd() * TAU, 0);
      const s = rand(0.6, 1.4);
      dummy.scale.set(s, s * rand(0.7, 1.5), s);
      dummy.updateMatrix();
      ferns.setMatrixAt(i, dummy.matrix);
      tint.setRGB(rand(0.8, 1.2), rand(0.85, 1.25), rand(0.75, 1.1));
      ferns.setColorAt(i, tint);
    }
    ferns.instanceMatrix.needsUpdate = true;
    if (ferns.instanceColor) ferns.instanceColor.needsUpdate = true;
    this.scene.add(ferns);

    // rocks
    const rockGeo = colorize(new THREE.IcosahedronGeometry(0.55, 0), '#2c2e27', 0.35, rnd);
    const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true });
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 150);
    for (let i = 0; i < 150; i++) {
      const a = rnd() * TAU, r = 7 + Math.sqrt(rnd()) * 116;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (this.roadDist(x, z) < 6.0) { rocks.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0)); continue; }
      dummy.position.set(x, this.heightAt(x, z) + 0.05, z);
      dummy.rotation.set(rnd(), rnd() * TAU, rnd());
      const s = rand(0.4, 1.8);
      dummy.scale.set(s * rand(0.8, 1.6), s * rand(0.5, 1), s * rand(0.8, 1.6));
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);
      const v = rand(0.75, 1.2);
      tint.setRGB(v, v, v * 0.95);
      rocks.setColorAt(i, tint);
    }
    rocks.instanceMatrix.needsUpdate = true;
    if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
    this.scene.add(rocks);

    // forest floor litter
    const leafGeo = new THREE.PlaneGeometry(0.15, 0.09);
    const leafMat = new THREE.MeshStandardMaterial({ roughness: 1, side: THREE.DoubleSide, vertexColors: false });
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, 1600);
    for (let i = 0; i < 1600; i++) {
      const a = rnd() * TAU;
      const r = 2 + Math.sqrt(rnd()) * 55;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      dummy.position.set(x, this.heightAt(x, z) + 0.035, z);
      dummy.rotation.set(-Math.PI / 2 + rand(-0.15, 0.15), rand(0, TAU), rand(-0.2, 0.2));
      const sc = rand(0.6, 1.8);
      dummy.scale.set(sc, sc, sc);
      dummy.updateMatrix();
      leaves.setMatrixAt(i, dummy.matrix);
      const tone = rand(0.55, 1.25);
      tint.setRGB(0.20 * tone, 0.17 * tone, 0.11 * tone);
      leaves.setColorAt(i, tint);
    }
    leaves.instanceMatrix.needsUpdate = true;
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
    this.scene.add(leaves);

    // scattered twigs
    const twigGeo = new THREE.BoxGeometry(0.035, 0.025, 0.7);
    const twigMat = new THREE.MeshStandardMaterial({ color: '#2f281f', roughness: 1 });
    const twigs = new THREE.InstancedMesh(twigGeo, twigMat, 220);
    for (let i = 0; i < 220; i++) {
      const a = rnd() * TAU, r = 2 + Math.sqrt(rnd()) * 45;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      dummy.position.set(x, this.heightAt(x, z) + 0.04, z);
      dummy.rotation.set(0, rand(0, TAU), 0);
      const sc = rand(0.5, 1.4);
      dummy.scale.set(sc, sc, sc);
      dummy.updateMatrix();
      twigs.setMatrixAt(i, dummy.matrix);
    }
    twigs.instanceMatrix.needsUpdate = true;
    this.scene.add(twigs);

    // fallen logs
    const logMat = new THREE.MeshStandardMaterial({ color: '#2a241c', roughness: 1, flatShading: true });
    for (let i = 0; i < 14; i++) {
      const a = rand(0, TAU), r = rand(14, 100);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const len = rand(3, 8);
      const g = new THREE.CylinderGeometry(rand(0.16, 0.32), rand(0.22, 0.4), len, 7);
      const m = new THREE.Mesh(g, logMat);
      m.position.set(x, this.heightAt(x, z) + 0.2, z);
      m.rotation.set(Math.PI / 2 + rand(-0.1, 0.1), rand(0, TAU), rand(0, TAU));
      this.scene.add(m);
      this.colliders.push({ x, z, r: 0.4 });
    }
  }

  /* ------------------------------ wreck -------------------------------- */
  _buildWreck() {
    const grp = new THREE.Group();
    const gy = this.heightAt(0, 0);
    grp.position.set(0, gy, 0);
    grp.rotation.y = 0.42;
    grp.rotation.z = 0.045;

    const paint = new THREE.MeshStandardMaterial({ color: '#40241f', roughness: 0.55, metalness: 0.5 });
    const paintDark = new THREE.MeshStandardMaterial({ color: '#2c1a17', roughness: 0.7, metalness: 0.35 });
    const rust = new THREE.MeshStandardMaterial({ color: '#3d2a1c', roughness: 0.98, metalness: 0.1 });
    const chrome = new THREE.MeshStandardMaterial({ color: '#555851', roughness: 0.35, metalness: 0.8 });
    const rubber = new THREE.MeshStandardMaterial({ color: '#0b0b0a', roughness: 0.98 });
    const glass = new THREE.MeshStandardMaterial({ color: '#0a1212', roughness: 0.1, metalness: 0.5, transparent: true, opacity: 0.45 });
    const hole = new THREE.MeshBasicMaterial({ color: '#050605' });

    // skid marks leading in
    for (const side of [-0.62, 0.62]) {
      const pts = [];
      for (let i = 0; i <= 12; i++) {
        const t = 0.475 + i / 12 * 0.078;
        const p = this.roadCurve.getPointAt(t);
        const tan = this.roadCurve.getTangentAt(t);
        const nx = -tan.z, nz = tan.x;
        const x = p.x + nx * side, z = p.z + nz * side;
        pts.push(new THREE.Vector3(x, this.heightAt(x, z) + 0.07, z));
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const len = a.distanceTo(b);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.18, len), new THREE.MeshStandardMaterial({ color: '#101010', roughness: 0.62, metalness: 0.2 }));
        m.position.copy(a).lerp(b, 0.5);
        m.rotation.x = -Math.PI / 2;
        m.rotation.z = -Math.atan2(b.x - a.x, b.z - a.z);
        this.scene.add(m);
      }
    }

    // chassis + crumpled body
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.42, 4.15), paint);
    chassis.position.y = 0.7;
    chassis.rotation.x = 0.012;
    grp.add(chassis);

    const rocker = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.14, 3.1), paintDark);
    rocker.position.set(0, 0.48, -0.15);
    grp.add(rocker);

    // crumpled hood, hinged upward
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.07, 1.3), paint);
    hood.position.set(0.04, 1.0, 1.38);
    hood.rotation.x = -0.16;
    hood.rotation.z = 0.045;
    grp.add(hood);
    const hoodLip = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.12, 0.16), rust);
    hoodLip.position.set(0.02, 1.12, 2.0);
    hoodLip.rotation.z = 0.07;
    grp.add(hoodLip);

    // engine bay revealed
    const bay = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.3, 1.15), hole);
    bay.position.set(0, 0.83, 1.4);
    grp.add(bay);
    const engine = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.36, 0.7), new THREE.MeshStandardMaterial({ color: '#393b36', roughness: 0.7, metalness: 0.5 }));
    engine.position.set(-0.08, 1.02, 1.32);
    engine.rotation.z = 0.12;
    grp.add(engine);
    for (let i = 0; i < 4; i++) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.4, 5), chrome);
      pipe.position.set(-0.35 + i * 0.12, 1.2, 1.5);
      pipe.rotation.z = 0.3;
      grp.add(pipe);
    }

    // cabin
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.62, 1.95), paint);
    cabin.position.set(0, 1.22, -0.38);
    cabin.rotation.z = 0.015;
    grp.add(cabin);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.09, 1.5), paintDark);
    roof.position.set(-0.03, 1.58, -0.44);
    roof.rotation.z = 0.05;
    roof.rotation.x = -0.02;
    grp.add(roof);

    // windows — mostly gone, one intact and reflecting the moon
    const windshield = new THREE.Mesh(new THREE.PlaneGeometry(1.42, 0.55), glass);
    windshield.position.set(0, 1.3, 0.61);
    windshield.rotation.x = -0.47;
    grp.add(windshield);
    const shattered = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.4), new THREE.MeshStandardMaterial({ color: '#101b1a', roughness: 0.08, metalness: 0.6, transparent: true, opacity: 0.32 }));
    shattered.position.set(-0.34, 1.3, 0.62);
    shattered.rotation.set(-0.47, 0.15, 0.1);
    grp.add(shattered);
    for (const sx of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.44), hole);
      side.position.set(sx * 0.876, 1.33, -0.3);
      side.rotation.y = sx * Math.PI / 2;
      grp.add(side);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 1.2), paintDark);
      frame.position.set(sx * 0.87, 1.55, -0.3);
      grp.add(frame);
    }
    const rearGlass = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.4), hole);
    rearGlass.position.set(0, 1.32, -1.34);
    rearGlass.rotation.x = 0.2;
    grp.add(rearGlass);

    // doors, driver's hanging open
    const doorHinge = new THREE.Group();
    doorHinge.position.set(-0.94, 1.02, 0.4);
    doorHinge.rotation.y = -0.9;
    grp.add(doorHinge);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.72, 1.45), paint);
    door.position.set(0, 0, -0.68);
    doorHinge.add(door);
    const doorWindow = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.42), hole);
    doorWindow.position.set(-0.05, 0.27, -0.6);
    doorWindow.rotation.y = -Math.PI / 2;
    doorHinge.add(doorWindow);
    const doorHandle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.035, 0.16), chrome);
    doorHandle.position.set(-0.06, 0.02, -0.15);
    doorHinge.add(doorHandle);

    // trunk lid popped
    const trunk = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.9), paint);
    trunk.position.set(0.03, 1.18, -1.85);
    trunk.rotation.x = 0.26;
    grp.add(trunk);

    // wheels — two flat rear, front right gone
    const wheelGeo = new THREE.TorusGeometry(0.37, 0.155, 8, 16);
    const rimGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.18, 8);
    const addWheel = (x, y, z, rot, flat = 1, rim = true) => {
      const w = new THREE.Mesh(wheelGeo, rubber);
      w.position.set(x, y, z);
      w.rotation.set(0, Math.PI / 2, 0.12);
      w.scale.set(1, flat, 1);
      grp.add(w);
      if (rim) {
        const r = new THREE.Mesh(rimGeo, chrome);
        r.position.set(x, y, z);
        r.rotation.z = Math.PI / 2;
        grp.add(r);
      }
    };
    addWheel(-0.98, 0.35, -1.3, 0, 0.72);
    addWheel(0.98, 0.33, -1.3, 0, 0.66);
    addWheel(0.98, 0.31, 1.15, 0, 0.55);

    // detached wheel in the ferns
    const spare = new THREE.Mesh(wheelGeo, rubber);
    spare.position.set(-2.9, gy + 0.24, 2.2);
    spare.rotation.set(Math.PI / 2, 0.4, 0.3);
    spare.scale.set(1, 1, 0.9);
    this.scene.add(spare);
    this.colliders.push({ x: -2.9, z: 2.2, r: 0.5 });

    // front bumper hanging by one bolt
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.18, 0.26), chrome);
    bumper.position.set(0.16, 0.55, 2.25);
    bumper.rotation.set(0.1, 0.05, -0.22);
    grp.add(bumper);

    // grille
    const grille = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.34, 0.08), hole);
    grille.position.set(0.02, 0.9, 2.12);
    grp.add(grille);
    for (let i = 0; i < 7; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.32, 0.03), chrome);
      bar.position.set(-0.58 + i * 0.195, 0.9, 2.17);
      grp.add(bar);
    }

    // headlights — one dead, one still burning
    const deadLamp = new THREE.Mesh(new THREE.CircleGeometry(0.17, 12), hole);
    deadLamp.position.set(-0.63, 0.96, 2.17);
    deadLamp.rotation.y = Math.PI;
    grp.add(deadLamp);
    const liveLamp = new THREE.Mesh(
      new THREE.CircleGeometry(0.16, 14),
      new THREE.MeshStandardMaterial({ color: '#fff4cd', emissive: '#ffe5a0', emissiveIntensity: 3.2, roughness: 0.2 })
    );
    liveLamp.position.set(0.63, 0.96, 2.17);
    liveLamp.rotation.y = Math.PI;
    grp.add(liveLamp);
    const lampGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: '#ffe6ad', transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false }));
    lampGlow.position.set(0.63, 0.96, 2.2);
    lampGlow.scale.setScalar(1.7);
    grp.add(lampGlow);
    this.wreckGlow = lampGlow;

    // license plate
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.02), new THREE.MeshStandardMaterial({ color: '#9a9a7f', roughness: 0.8 }));
    plate.position.set(0.1, 0.62, 2.34);
    plate.rotation.x = 0.1;
    grp.add(plate);

    // rust + moss
    for (let i = 0; i < 7; i++) {
      const patch = new THREE.Mesh(new THREE.PlaneGeometry(rand(0.2, 0.6), rand(0.15, 0.4)), rust);
      patch.position.set(rand(-0.9, 0.9), rand(0.9, 1.4), rand(-1.2, 1.2));
      patch.rotation.set(rand(-0.2, 0.2), rand(0, TAU), rand(-0.2, 0.2));
      if (Math.abs(patch.position.x) < 0.7) patch.position.x = Math.sign(patch.position.x || 1) * rand(0.8, 0.92);
      grp.add(patch);
    }
    for (let i = 0; i < 5; i++) {
      const moss = new THREE.Mesh(new THREE.PlaneGeometry(rand(0.2, 0.5), rand(0.2, 0.5)), new THREE.MeshStandardMaterial({ color: '#2f3b21', roughness: 1 }));
      moss.position.set(rand(-0.55, 0.55), 1.635, rand(-1.0, 0.1));
      moss.rotation.set(-Math.PI / 2, 0, rand(0, TAU));
      grp.add(moss);
    }

    // glass on the ground
    const glassMat = new THREE.MeshStandardMaterial({ color: '#93a49e', roughness: 0.08, metalness: 0.5, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
    for (let i = 0; i < 26; i++) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(rand(0.05, 0.24), rand(0.05, 0.2)), glassMat);
      s.rotation.set(-Math.PI / 2 + rand(-0.2, 0.2), rand(0, TAU), 0);
      s.position.set(rand(-2.6, 2.8), 0.055, rand(-1.4, 3.0));
      grp.add(s);
    }

    // interior dome glow
    const dome = new THREE.PointLight('#d99b55', 4, 3, 1.5);
    dome.position.set(0, 1.3, -0.4);
    grp.add(dome);

    // smoking engine
    this.smokeSprites = [];
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, color: '#9aa79a', transparent: true, opacity: 0.09, depthWrite: false }));
      s.position.set(rand(-0.25, 0.35), 1.25 + i * 0.26, 1.35 + rand(-0.15, 0.15));
      s.scale.setScalar(rand(0.8, 1.8));
      s.userData = { speed: rand(0.2, 0.45), offset: rand(0, TAU), baseY: s.position.y };
      grp.add(s);
      this.smokeSprites.push(s);
    }

    // headlight light
    this.wreckLight = new THREE.PointLight('#ffdca0', 30, 16, 1.45);
    this.wreckLight.position.set(0.6, 1.0, 2.1);
    grp.add(this.wreckLight);

    this.scene.add(grp);
    this.wreck = grp;
    this.colliders.push({ x: 0.2, z: 0.4, r: 2.0 });
  }

  /* ------------------------------ parts -------------------------------- */
  _partGeometry(kind) {
    const g = [];
    const metal = '#c9b374';
    switch (kind) {
      case 'wheel':
        g.push(colorize(new THREE.TorusGeometry(0.34, 0.13, 7, 16), '#2b2b29', 0.2));
        g.push(colorize(new THREE.CylinderGeometry(0.2, 0.2, 0.17, 8), '#8f9a92', 0.1));
        break;
      case 'door':
        g.push(colorize(new THREE.BoxGeometry(1.0, 0.72, 0.09), '#4a4238', 0.14));
        g.push(colorize(new THREE.BoxGeometry(0.86, 0.34, 0.1), '#0e1415', 0.1));
        g.push(colorize(new THREE.BoxGeometry(0.1, 0.1, 0.14), '#bda56a', 0.1));
        break;
      case 'headlight':
        g.push(colorize(new THREE.SphereGeometry(0.25, 10, 8), '#e8e1bd', 0.08));
        g.push(colorize(new THREE.CylinderGeometry(0.24, 0.18, 0.18, 10), '#3b3b36', 0.1));
        break;
      case 'bumper':
        g.push(colorize(new THREE.BoxGeometry(1.4, 0.19, 0.24), '#4b4c48', 0.1));
        g.push(colorize(new THREE.BoxGeometry(0.3, 0.24, 0.26), '#2b2c2a', 0.1));
        break;
      case 'battery':
        g.push(colorize(new THREE.BoxGeometry(0.44, 0.32, 0.3), '#22282a', 0.1));
        g.push(colorize(new THREE.CylinderGeometry(0.045, 0.045, 0.1, 6), '#a8905c', 0.1));
        g.push(colorize(new THREE.CylinderGeometry(0.04, 0.04, 0.1, 6), '#8b3b2c', 0.1));
        break;
      case 'sparkplug':
        g.push(colorize(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6), '#aeb7ac', 0.1));
        g.push(colorize(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 6), '#8a8f86', 0.1));
        break;
      case 'mirror':
        g.push(colorize(new THREE.BoxGeometry(0.28, 0.18, 0.08), '#3f4642', 0.1));
        g.push(colorize(new THREE.BoxGeometry(0.05, 0.22, 0.05), '#333833', 0.1));
        break;
      case 'hood':
        g.push(colorize(new THREE.BoxGeometry(1.15, 0.08, 1.0), '#40382e', 0.12));
        break;
      case 'pipe':
        g.push(colorize(new THREE.CylinderGeometry(0.075, 0.09, 0.95, 7), '#6d6f66', 0.1));
        g.push(colorize(new THREE.CylinderGeometry(0.13, 0.13, 0.12, 7), '#595b53', 0.1));
        break;
      case 'gearbox':
        g.push(colorize(new THREE.CylinderGeometry(0.19, 0.22, 0.55, 7), '#62655c', 0.1));
        g.push(colorize(new THREE.SphereGeometry(0.15, 7, 6), '#4c4f47', 0.1));
        break;
      case 'radiator':
        g.push(colorize(new THREE.BoxGeometry(0.9, 0.5, 0.09), '#3b3f3a', 0.1));
        break;
      case 'taillight':
        g.push(colorize(new THREE.BoxGeometry(0.3, 0.17, 0.1), '#8e3328', 0.1));
        break;
      case 'belt':
        g.push(colorize(new THREE.TorusGeometry(0.27, 0.045, 5, 14), '#282a27', 0.1));
        break;
      case 'axle':
        g.push(colorize(new THREE.CylinderGeometry(0.07, 0.07, 1.2, 6), '#5c5e56', 0.1));
        g.push(colorize(new THREE.CylinderGeometry(0.13, 0.13, 0.22, 6), '#3f423b', 0.1));
        break;
      case 'carb':
        g.push(colorize(new THREE.CylinderGeometry(0.19, 0.15, 0.26, 7), '#6c6a5c', 0.1));
        g.push(colorize(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 7), '#8a8370', 0.1));
        break;
      case 'seat':
        g.push(colorize(new THREE.BoxGeometry(0.46, 0.16, 0.48), '#33291f', 0.1));
        g.push(colorize(new THREE.BoxGeometry(0.46, 0.6, 0.13), '#2c231b', 0.1));
        break;
      case 'plate':
        g.push(colorize(new THREE.BoxGeometry(0.55, 0.16, 0.03), '#a9a98f', 0.1));
        break;
      case 'wiper':
        g.push(colorize(new THREE.BoxGeometry(0.7, 0.04, 0.04), '#2b2d2a', 0.1));
        break;
      case 'steering':
        g.push(colorize(new THREE.TorusGeometry(0.26, 0.045, 5, 14), '#2c2a26', 0.1));
        g.push(colorize(new THREE.BoxGeometry(0.4, 0.05, 0.05), '#413d35', 0.1));
        break;
      case 'distributor':
        g.push(colorize(new THREE.CylinderGeometry(0.13, 0.16, 0.26, 7), '#525d55', 0.1));
        g.push(colorize(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 4), metal, 0.1));
        break;
      default:
        g.push(colorize(new THREE.BoxGeometry(0.4, 0.3, 0.3), '#746a4d', 0.15));
    }
    return mergeGeometries(g);
  }

  _buildParts() {
    const rnd = mulberry32(88);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.3, metalness: 0.75,
      emissive: '#8a7432', emissiveIntensity: 0.55
    });
    const positions = [];
    let guard = 0;
    while (positions.length < 20 && guard++ < 5000) {
      const a = rnd() * TAU;
      const r = 16 + Math.sqrt(rnd()) * 88;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (x * x + z * z > 112 * 112) continue;
      let ok = true;
      for (const p of positions) if ((p.x - x) ** 2 + (p.z - z) ** 2 < 11 * 11) { ok = false; break; }
      if (!ok) continue;
      // not inside a tree / wreck
      for (const c of this.colliders) {
        if ((c.x - x) ** 2 + (c.z - z) ** 2 < (c.r + 1.2) ** 2) { ok = false; break; }
      }
      if (!ok) continue;
      positions.push({ x, z });
    }
    // fallback fill
    while (positions.length < 20) {
      const a = rnd() * TAU, r = 18 + rnd() * 80;
      positions.push({ x: Math.cos(a) * r, z: Math.sin(a) * r });
    }

    for (let i = 0; i < 20; i++) {
      const type = PART_TYPES[i];
      const { x, z } = positions[i];
      const y = this.heightAt(x, z);
      const grp = new THREE.Group();
      grp.position.set(x, y, z);

      const geo = this._partGeometry(type.kind);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = 0.85;
      mesh.rotation.set(rnd() * 0.4, rnd() * TAU, rnd() * 0.3);
      grp.add(mesh);

      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.glow, color: '#ffe6a8', transparent: true, opacity: 0.65,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      halo.position.y = 0.85;
      halo.scale.setScalar(1.7);
      grp.add(halo);

      const beam = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.beamTex, color: '#e8d49a', transparent: true, opacity: 0.16,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      beam.position.y = 3.8;
      beam.scale.set(1.15, 7.5, 1);
      grp.add(beam);

      const ringGeo = new THREE.RingGeometry(0.55, 0.72, 24);
      ringGeo.rotateX(-Math.PI / 2);
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#cfbd83', transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      ring.position.y = 0.08;
      grp.add(ring);

      this.scene.add(grp);
      this.parts.push({ group: grp, mesh, halo, beam, ring, name: type.name, x, z, baseY: 0.85, taken: false, seed: rnd() * TAU });
    }
  }

  _buildMotes() {
    const rnd = mulberry32(12);
    const count = 340;
    const pos = new Float32Array(count * 3);
    const seeds = [];
    for (let i = 0; i < count; i++) {
      const x = rand(-80, 80), z = rand(-80, 80);
      pos[i * 3] = x;
      pos[i * 3 + 1] = this.heightAt(x, z) + rand(0.4, 6);
      pos[i * 3 + 2] = z;
      seeds.push({ y: pos[i * 3 + 1], ph: rnd() * TAU, sp: rand(0.2, 0.7) });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ map: this.glow, color: '#c9d6a8', size: 0.11, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, alphaTest: 0.01 });
    this.motes = new THREE.Points(g, m);
    this.moteSeeds = seeds;
    this.scene.add(this.motes);
  }

  _buildMist() {
    this.mist = [];
    for (let i = 0; i < 34; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, color: '#4d6157', transparent: true, opacity: rand(0.05, 0.115), depthWrite: false }));
      const a = rand(0, TAU), r = rand(8, 60);
      s.position.set(Math.cos(a) * r, this.heightAt(Math.cos(a) * r, Math.sin(a) * r) + rand(0.8, 3.5), Math.sin(a) * r);
      s.scale.set(rand(14, 32), rand(6, 13), 1);
      s.userData = { drift: rand(-0.25, 0.25), ph: rand(0, TAU) };
      this.scene.add(s);
      this.mist.push(s);
    }
  }

  /* ------------------------------ queries ------------------------------ */
  nearestPart(pos) {
    let best = null, bestD = Infinity;
    for (const p of this.parts) {
      if (p.taken) continue;
      const d = (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2;
      if (d < bestD) { bestD = d; best = p; }
    }
    return { part: best, dist: Math.sqrt(bestD) };
  }

  collect(pos, radius = 2.0) {
    for (const p of this.parts) {
      if (p.taken) continue;
      const d = (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2;
      if (d < radius * radius) {
        p.taken = true;
        p.group.visible = false;
        this.collected++;
        this._pickupBurst(p);
        return p;
      }
    }
    return null;
  }

  _pickupBurst(p) {
    const count = 16;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const vel = [];
    for (let i = 0; i < count; i++) {
      pos[i * 3] = p.group.position.x;
      pos[i * 3 + 1] = p.group.position.y + 0.9;
      pos[i * 3 + 2] = p.group.position.z;
      vel.push(new THREE.Vector3(rand(-1, 1), rand(1, 3), rand(-1, 1)));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ map: this.glow, color: '#ffe8ad', size: 0.28, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    const pts = new THREE.Points(geo, mat);
    pts.userData = { vel, life: 0 };
    this.scene.add(pts);
    (this.bursts ||= []).push(pts);
  }

  /** Collision resolve against tree trunks & wreck. */
  resolveCollision(pos, radius = 0.36) {
    for (const c of this.colliders) {
      const dx = pos.x - c.x, dz = pos.z - c.z;
      const min = c.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        const push = (min - d) / d;
        pos.x += dx * push;
        pos.z += dz * push;
      }
    }
    const r = Math.hypot(pos.x, pos.z);
    if (r > 118) {
      pos.x *= 118 / r; pos.z *= 118 / r;
    }
  }

  showBeacon() {
    if (this.beacon) return;
    const g = new THREE.Group();
    const beam = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.beamTex, color: '#bcd3a0', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    beam.scale.set(3.4, 26, 1);
    beam.position.y = 13;
    g.add(beam);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: '#cfe3af', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(7);
    glow.position.y = 1.5;
    g.add(glow);
    g.position.set(0, this.heightAt(0, 0), 0);
    this.scene.add(g);
    this.beacon = g;
  }

  repair() {
    for (const p of this.parts) p.group.visible = false;
    this.wreckLight && (this.wreckLight.intensity = 9);
  }

  /* ------------------------------ update ------------------------------- */
  update(dt, t, playerPos, lightOn) {
    this.time = t;
    this.stars.rotation.y = t * 0.004;

    if (this.clouds) {
      for (const c of this.clouds) {
        c.position.x += c.userData.drift * dt * 0.25;
        if (c.position.x > c.userData.left + 80) c.position.x = c.userData.left - 80;
        if (c.position.x < c.userData.left - 80) c.position.x = c.userData.left + 80;
      }
    }

    if (this.motes) {
      const pos = this.motes.geometry.attributes.position;
      for (let i = 0; i < this.moteSeeds.length; i++) {
        const s = this.moteSeeds[i];
        pos.setY(i, s.y + Math.sin(t * s.sp + s.ph) * 0.7);
        pos.setX(i, pos.getX(i) + Math.sin(t * 0.12 + s.ph) * dt * 0.08);
      }
      pos.needsUpdate = true;
    }

    for (const p of this.parts) {
      if (p.taken) continue;
      const bob = Math.sin(t * 1.1 + p.seed) * 0.12;
      p.mesh.position.y = p.baseY + bob;
      p.mesh.rotation.y += dt * 0.35;
      p.mesh.rotation.z = Math.sin(t * 0.6 + p.seed) * 0.12;
      p.halo.position.y = p.baseY + bob;
      const pulse = 0.55 + Math.sin(t * 2.1 + p.seed) * 0.14;
      p.halo.material.opacity = pulse;
      p.ring.material.opacity = 0.16 + Math.sin(t * 2.1 + p.seed) * 0.06;
      p.beam.material.opacity = 0.10 + Math.sin(t * 1.5 + p.seed) * 0.035;
    }

    for (const s of this.smokeSprites) {
      s.position.y += s.userData.speed * dt;
      s.position.x += Math.sin(t * 0.5 + s.userData.offset) * dt * 0.15;
      s.material.opacity = 0.11 * (1 - (s.position.y - s.userData.baseY) / 3.0);
      s.scale.setScalar(1.2 + (s.position.y - s.userData.baseY) * 0.45);
      if (s.position.y > s.userData.baseY + 2.8) {
        s.position.y = s.userData.baseY;
        s.material.opacity = 0.11;
        s.scale.setScalar(1.2);
      }
    }
    if (this.wreckLight) {
      const flick = playerPos ? Math.max(0, 1 - playerPos.distanceTo(this.wreck.position) / 60) : 1;
      this.wreckLight.intensity = (1.4 + Math.sin(t * 13.0) * 0.25 + Math.sin(t * 31.7) * 0.15) * (0.4 + flick * 0.6);
    }
    if (this.beacon) {
      this.beacon.children[0].material.opacity = 0.28 + Math.sin(t * 1.2) * 0.12;
    }
    for (const m of this.mist) {
      m.position.x += m.userData.drift * dt;
      m.position.y += Math.sin(t * 0.13 + m.userData.ph) * dt * 0.08;
      if (m.position.x > 70) m.position.x = -70;
      if (m.position.x < -70) m.position.x = 70;
    }

    if (this.bursts) {
      for (let i = this.bursts.length - 1; i >= 0; i--) {
        const b = this.bursts[i];
        b.userData.life += dt;
        const pos = b.geometry.attributes.position;
        for (let j = 0; j < pos.count; j++) {
          const v = b.userData.vel[j];
          pos.setXYZ(j, pos.getX(j) + v.x * dt, pos.getY(j) + v.y * dt, pos.getZ(j) + v.z * dt);
          v.y -= 4.5 * dt;
        }
        pos.needsUpdate = true;
        b.material.opacity = Math.max(0, 1 - b.userData.life * 1.4);
        if (b.userData.life > 0.8) {
          this.scene.remove(b);
          b.geometry.dispose();
          b.material.dispose();
          this.bursts.splice(i, 1);
        }
      }
    }
  }
}
