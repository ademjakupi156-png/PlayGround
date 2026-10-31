import * as THREE from 'three';
import { clamp, damp, lerp, rand, TAU } from './util.js';

export class Player {
  constructor(camera, canvas, world, audio) {
    this.camera = camera;
    this.canvas = canvas;
    this.world = world;
    this.audio = audio;
    this.position = new THREE.Vector3(3, 0, 5);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.keys = new Set();
    this.enabled = false;
    this.pointerLocked = false;
    this.stamina = 100;
    this.battery = 100;
    this.torchOn = true;
    this.crouching = false;
    this.sprinting = false;
    this.moving = false;
    this.eyeHeight = 1.66;
    this.bob = 0;
    this.stepDist = 0;
    this.noise = 0;
    this.touchMove = { x: 0, y: 0 };
    this.touchSprint = false;
    this.lookSensitivity = 0.0022;
    this.sprintingLock = false;
    this._buildTorch();
    this._buildHeldTorch();
    this._bindEvents();
  }

  _buildTorch() {
    const spot = new THREE.SpotLight('#e8ecd0', 0, 50, 0.46, 0.62, 1.15);
    spot.position.set(0.14, -0.1, 0);
    this.spot = spot;
    this.camera.add(spot);
    const target = new THREE.Object3D();
    target.position.set(0, -0.12, -8);
    this.camera.add(target);
    spot.target = target;
    this.spotTarget = target;

    // faint bounce so the world isn't pitch black without the torch
    this.eyeLight = new THREE.PointLight('#4d5a4a', 3.2, 6, 1.6);
    this.eyeLight.position.set(0, 0.1, -0.2);
    this.camera.add(this.eyeLight);
  }

  _buildHeldTorch() {
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: '#23251f', roughness: 0.42, metalness: 0.75 });
    const rubber = new THREE.MeshStandardMaterial({ color: '#101210', roughness: 0.92, metalness: 0.05 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.023, 0.24, 10), metal);
    body.rotation.x = Math.PI / 2;
    g.add(body);
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.004, 4, 10), rubber);
      ring.position.z = -0.05 + i * 0.05;
      g.add(ring);
    }
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.028, 0.085, 10), metal);
    head.rotation.x = Math.PI / 2;
    head.position.z = -0.16;
    g.add(head);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.006, 5, 14), new THREE.MeshBasicMaterial({ color: '#f5e9c4' }));
    rim.position.z = -0.202;
    g.add(rim);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.035, 14), new THREE.MeshBasicMaterial({ color: '#fff8dd' }));
    lens.position.z = -0.2;
    lens.rotation.y = Math.PI;
    g.add(lens);
    const button = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.008, 0.03), new THREE.MeshBasicMaterial({ color: '#a8522e' }));
    button.position.set(0.022, 0.012, 0.02);
    g.add(button);
    this.lens = lens;
    this.rim = rim;
    g.position.set(0.265, -0.36, -0.86);
    g.rotation.set(0.12, -0.16, 0.05);
    g.scale.setScalar(0.9);
    this.camera.add(g);
    this.heldTorch = g;
    this.heldBase = g.position.clone();
  }

  _bindEvents() {
    const onKey = e => {
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', 'control', 'f', 'q', 'e', ' '].includes(k)) e.preventDefault();
      if (e.type === 'keydown') {
        this.keys.add(k);
        if (k === 'f') this.toggleTorch();
        if (k === 'shift') this.sprintingLock = true;
        if (k === 'control') this.crouching = true;
      } else {
        this.keys.delete(k);
        if (k === 'shift') this.sprintingLock = false;
        if (k === 'control') this.crouching = false;
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);

    const mouse = e => {
      if (!this.enabled) return;
      if (document.pointerLockElement === this.canvas) {
        this.addLook(e.movementX, e.movementY);
      }
    };
    document.addEventListener('mousemove', mouse);

    this.canvas.addEventListener('click', () => {
      if (this.enabled && !this.isTouch) this.requestLock();
    });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.sprintingLock = false;
    });
  }

  get isTouch() {
    return window.matchMedia('(hover: none)').matches || 'ontouchstart' in window;
  }

  requestLock() {
    if (this.isTouch) return;
    try { this.canvas.requestPointerLock?.(); } catch { /* ignore */ }
  }

  look(dx, dy) { this.addLook(dx, dy); }

  addLook(dx, dy) {
    const s = this.lookSensitivity * (this.zoomed ? 0.6 : 1);
    this.yaw -= dx * s;
    this.pitch -= dy * s;
    this.pitch = clamp(this.pitch, -1.25, 1.25);
  }

  toggleTorch(force) {
    if (!this.enabled && force === undefined) return;
    const next = force === undefined ? !this.torchOn : force;
    if (next && this.battery < 4) {
      this.audio?.scuff();
      return;
    }
    this.torchOn = next;
  }

  setPose(x, z, yaw = 0, pitch = 0) {
    this.position.set(x, this.world.heightAt(x, z), z);
    this.yaw = yaw; this.pitch = pitch;
    this.syncCamera(0);
  }

  syncCamera(dt) {
    const eye = this.crouching ? 1.12 : this.eyeHeight;
    const speed = this.velocity.length();
    const bobAmt = this.moving ? Math.min(1, speed / 4) : 0;
    this.bob += dt * (this.sprinting ? 11 : 7.5);
    const bx = Math.sin(this.bob) * 0.022 * bobAmt;
    const by = Math.abs(Math.cos(this.bob)) * 0.035 * bobAmt;

    this.camera.position.set(
      this.position.x + bx * Math.cos(this.yaw),
      this.position.y + eye + by,
      this.position.z - bx * Math.sin(this.yaw)
    );
    const roll = Math.sin(this.bob) * 0.008 * bobAmt;
    this.camera.rotation.set(this.pitch, this.yaw, roll, 'YXZ');

    // held torch sway
    if (this.heldTorch) {
      const narrow = this.camera.aspect < 0.85;
      const ts = narrow ? 0.62 : 0.9;
      this.heldTorch.scale.setScalar(ts);
      this.heldTorch.position.x = this.heldBase.x + bx * 0.6;
      this.heldTorch.position.y = this.heldBase.y - by * 0.5 - (narrow ? 0.03 : 0);
      this.heldTorch.visible = true;
      this.lens.material.color.set(this.torchOn ? '#fffbe0' : '#23241f');
      this.rim.material.color.set(this.torchOn ? '#f5e9c4' : '#2c2c26');
    }
  }

  update(dt) {
    if (!this.enabled) {
      this.syncCamera(dt);
      return;
    }
    const k = this.keys;
    let ix = 0, iz = 0;
    if (k.has('w') || k.has('arrowup')) iz -= 1;
    if (k.has('s') || k.has('arrowdown')) iz += 1;
    if (k.has('a') || k.has('arrowleft')) ix -= 1;
    if (k.has('d') || k.has('arrowright')) ix += 1;

    // touch stick
    if (Math.abs(this.touchMove.x) > 0.01 || Math.abs(this.touchMove.y) > 0.01) {
      ix += this.touchMove.x;
      iz += this.touchMove.y;
    }
    const len = Math.hypot(ix, iz);
    if (len > 1) { ix /= len; iz /= len; }

    const wantSprint = (this.sprintingLock || this.touchSprint) && this.stamina > 1 && !this.crouching && len > 0.1;
    this.sprinting = wantSprint;
    const baseSpeed = this.crouching ? 1.55 : 2.85;
    const targetSpeed = this.sprinting ? 5.45 : baseSpeed;

    // stamina
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - 19 * dt);
    } else {
      this.stamina = Math.min(100, this.stamina + (this.moving ? 8 : 15) * dt);
    }

    // torch battery
    if (this.torchOn) {
      this.battery = Math.max(0, this.battery - 1.85 * dt);
      if (this.battery <= 0) this.torchOn = false;
    } else {
      this.battery = Math.min(100, this.battery + 1.2 * dt);
    }

    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = new THREE.Vector3()
      .addScaledVector(forward, -iz)
      .addScaledVector(right, ix);
    if (wish.lengthSq() > 0) wish.normalize();

    const accel = 12;
    this.velocity.x = damp(this.velocity.x, wish.x * targetSpeed, accel, dt);
    this.velocity.z = damp(this.velocity.z, wish.z * targetSpeed, accel, dt);
    if (wish.lengthSq() < 0.01) {
      this.velocity.x = damp(this.velocity.x, 0, 10, dt);
      this.velocity.z = damp(this.velocity.z, 0, 10, dt);
    }

    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.world.resolveCollision(this.position, 0.36);
    this.position.y = this.world.heightAt(this.position.x, this.position.z);

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.moving = speed > 0.35;
    this.noise = this.moving ? (this.sprinting ? 1 : this.crouching ? 0.12 : 0.4) : 0.06;

    // footsteps
    if (this.moving) {
      this.stepDist += speed * dt;
      const stride = this.sprinting ? 2.4 : this.crouching ? 1.35 : 1.85;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        this.audio?.step(this.sprinting);
      }
    }

    // torch flicker when low / hunted
    const low = this.battery < 22;
    let intensity = this.torchOn ? 46 : 0;
    if (this.torchOn && low) {
      const flick = Math.sin(performance.now() * 0.043) * Math.sin(performance.now() * 0.011);
      intensity *= flick > 0.55 ? 0.25 : 0.9;
      this.lens.material.color.set(flick > 0.55 ? '#6a6a58' : '#fffbe0');
    }
    this.spot.intensity = lerp(this.spot.intensity, intensity, 1 - Math.exp(-8 * dt));
    this.spot.angle = 0.46;
    this.spot.distance = 52;
    this.spot.color.set('#e9edd3');

    this.syncCamera(dt);
  }

  /** Returns a 0..1 threat estimate based on torch flicker proximity etc. */
  get torchLit() { return this.torchOn && this.spot.intensity > 0.4; }
}
