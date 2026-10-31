/* ==================================================================
   THE HOLLOW — procedural audio (no samples, all synthesized)
   ================================================================== */
import { clamp, rand } from './util.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.danger = 0;
    this._heartTimer = 0;
    this._ambientTimer = 0;
    this._growlTimer = 6;
    this._lastScare = -10;
    this._time = 0;
    this.wolfPan = 0;
    this.wolfDist = 40;
  }

  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 12;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    this.master.connect(limiter);
    limiter.connect(ctx.destination);

    this.dry = ctx.createGain();
    this.dry.gain.value = 1;
    this.dry.connect(this.master);

    // synthetic reverb impulse
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(2.6, 2.2);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.55;
    this.reverb.connect(this.wet);
    this.wet.connect(this.master);

    this.noise = this._noiseBuffer(2, false);
    this.brown = this._noiseBuffer(4, true);

    // simple master lowpass for the "underwater" muffling during scares
    this.ready = true;
    if (ctx.state === 'suspended') ctx.resume();
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (1 - Math.exp(-i / 400));
      }
    }
    return buf;
  }

  _noiseBuffer(seconds, brown) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
      else d[i] = w;
    }
    return buf;
  }

  _gain(v = 1) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  _pan(pan = 0) {
    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (p) p.pan.value = clamp(pan, -1, 1);
    return p;
  }

  _out(node, { pan = 0, wet = 0.25, dest = null } = {}) {
    let chain = node;
    const p = this._pan(pan);
    if (p) { chain.connect(p); chain = p; }
    chain.connect(dest || this.dry);
    if (wet > 0) {
      const send = this._gain(wet);
      chain.connect(send);
      send.connect(this.reverb);
    }
    return chain;
  }

  _noiseSrc(rate = 1, brown = false) {
    const src = this.ctx.createBufferSource();
    src.buffer = brown ? this.brown : this.noise;
    src.loop = true;
    src.playbackRate.value = rate;
    return src;
  }

  /* --------------------------- ambience --------------------------- */
  startAmbience() {
    if (!this.ready || this.ambient) return;
    const ctx = this.ctx;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(0.55, ctx.currentTime + 3);
    g.connect(this.master);

    // wind: brown noise, band-limited, slowly breathing
    const wind = this._noiseSrc(0.6, true);
    const wf = ctx.createBiquadFilter();
    wf.type = 'bandpass'; wf.frequency.value = 420; wf.Q.value = 0.5;
    const wg = ctx.createGain(); wg.gain.value = 0.22;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.055;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.12;
    lfo.connect(lfoG); lfoG.connect(wg.gain);
    wind.connect(wf); wf.connect(wg); wg.connect(g);
    wind.start(); lfo.start();

    // high pine hiss
    const hiss = this._noiseSrc(1.1, false);
    const hf = ctx.createBiquadFilter(); hf.type = 'highpass'; hf.frequency.value = 2600;
    const hg = ctx.createGain(); hg.gain.value = 0.028;
    const hissLfo = ctx.createOscillator(); hissLfo.frequency.value = 0.11;
    const hissLfoG = ctx.createGain(); hissLfoG.gain.value = 0.018;
    hissLfo.connect(hissLfoG); hissLfoG.connect(hg.gain);
    hiss.connect(hf); hf.connect(hg); hg.connect(g);
    hiss.start(); hissLfo.start();

    // sub drone
    const droneG = this._gain(0.07);
    droneG.connect(g);
    [36.5, 55, 73.2].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      const og = this._gain(i === 0 ? 0.9 : i === 1 ? 0.3 : 0.12);
      const slow = ctx.createOscillator(); slow.frequency.value = 0.03 + i * 0.017;
      const slowG = this._gain(f * 0.012);
      slow.connect(slowG); slowG.connect(o.frequency);
      o.connect(og); og.connect(droneG);
      o.start(); slow.start();
    });

    // distant night air tone
    const eerie = ctx.createOscillator();
    eerie.type = 'sine'; eerie.frequency.value = 174;
    const eg = this._gain(0.008);
    const elfo = ctx.createOscillator(); elfo.frequency.value = 0.07;
    const elfoG = this._gain(0.004);
    elfo.connect(elfoG); elfoG.connect(eg.gain);
    eerie.connect(eg); eg.connect(g);
    eerie.start(); elfo.start();

    this.ambient = { g, wind, hiss, droneG };
  }

  setAmbient(level) {
    if (!this.ambient) return;
    this.ambient.g.gain.setTargetAtTime(level, this.ctx.currentTime, 1.5);
  }

  scuff() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = this._noiseSrc(rand(0.9, 1.15));
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = rand(380, 700);
    const g = this._gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(rand(0.025, 0.05), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    src.connect(f); f.connect(g);
    this._out(g, { pan: rand(-0.25, 0.25), wet: 0.1 });
    src.start(t, rand(0, 1)); src.stop(t + 0.2);
  }

  step(running = false) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = this._noiseSrc(rand(0.8, 1.2), true);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = running ? 900 : 620;
    const g = this._gain(0);
    const vol = running ? rand(0.09, 0.13) : rand(0.035, 0.06);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (running ? 0.19 : 0.14));
    src.connect(f); f.connect(g);
    this._out(g, { pan: rand(-0.15, 0.15), wet: 0.12 });

    // soft debris crackle
    if (Math.random() < 0.45) {
      const c = this._noiseSrc(1.6);
      const cf = ctx.createBiquadFilter(); cf.type = 'highpass'; cf.frequency.value = 2200;
      const cg = this._gain(0);
      cg.gain.setValueAtTime(0.02, t + 0.01);
      cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      c.connect(cf); cf.connect(cg);
      this._out(cg, { pan: rand(-0.5, 0.5), wet: 0.2 });
      c.start(t, rand(0, 1)); c.stop(t + 0.09);
    }
    src.start(t, rand(0, 1)); src.stop(t + 0.22);
  }

  twig() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = this._noiseSrc(rand(0.8, 1.5));
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = rand(1200, 2600); f.Q.value = 1.4;
    const g = this._gain(0);
    g.gain.setValueAtTime(0.0, t);
    g.gain.linearRampToValueAtTime(rand(0.05, 0.12), t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    src.connect(f); f.connect(g);
    this._out(g, { pan: rand(-0.85, 0.85), wet: 0.45 });
    src.start(t, rand(0, 1)); src.stop(t + 0.12);

    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = rand(170, 300);
    const og = this._gain(0);
    og.gain.setValueAtTime(0.035, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(og); this._out(og, { pan: rand(-0.5, 0.5), wet: 0.3 });
    o.start(t); o.stop(t + 0.1);
  }

  pickup(index = 0) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const base = 520 + (index % 6) * 60;
    [1, 2.01, 2.98].forEach((mult, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = base * mult;
      const g = this._gain(0);
      g.gain.setValueAtTime(0, t + i * 0.012);
      g.gain.linearRampToValueAtTime(0.10 / (i + 1), t + i * 0.012 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9 + i * 0.25);
      o.connect(g); this._out(g, { pan: rand(-0.25, 0.25), wet: 0.65 });
      o.start(t + i * 0.012); o.stop(t + 1.4 + i * 0.25);
    });
    // metal tick
    const src = this._noiseSrc(1.4);
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2400;
    const g = this._gain(0);
    g.gain.setValueAtTime(0.09, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    src.connect(f); f.connect(g); this._out(g, { pan: 0, wet: 0.4 });
    src.start(t, rand(0, 1)); src.stop(t + 0.15);
  }

  /* --------------------------- wolf ------------------------------- */
  growl(intensity = 0.6, pan = this.wolfPan, dist = this.wolfDist) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const vol = clamp(0.22 - dist * 0.0035, 0.02, 0.22) * (0.5 + intensity);
    const g = this._gain(0);
    const dur = rand(1.1, 2.2);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.25);
    g.gain.setValueAtTime(vol, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 240 + intensity * 320;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 48 + Math.random() * 16;
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = rand(17, 29);
    const lg = this._gain(9 + intensity * 10);
    lfo.connect(lg); lg.connect(o.frequency);
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 96 + Math.random() * 20;
    const o2g = this._gain(0.12);
    o.connect(f); o2.connect(o2g); o2g.connect(f);
    f.connect(g);
    this._out(g, { pan, wet: 0.5, dest: null });
    o.start(t); o2.start(t); lfo.start(t);
    o.stop(t + dur); o2.stop(t + dur); lfo.stop(t + dur);

    // breath
    const b = this._noiseSrc(0.5, true);
    const bf = ctx.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 500; bf.Q.value = 0.8;
    const bg = this._gain(vol * 0.4);
    b.connect(bf); bf.connect(bg); this._out(bg, { pan, wet: 0.4 });
    b.start(t); b.stop(t + dur);
  }

  snarl(pan = this.wolfPan) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const g = this._gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.5);
    const dist = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 511) - 1; curve[i] = Math.tanh(x * 5); }
    dist.curve = curve;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 520; f.Q.value = 0.8;
    o.connect(dist); dist.connect(f); f.connect(g);
    this._out(g, { pan, wet: 0.35 });
    o.start(t); o.stop(t + 0.6);
  }

  howl(pan = 0, dist = 45) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const vol = clamp(0.16 - dist * 0.0016, 0.02, 0.16);
    const g = this._gain(0);
    const dur = rand(2.4, 3.4);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.4);
    g.gain.setValueAtTime(vol, t + dur * 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(rand(330, 380), t);
    o.frequency.linearRampToValueAtTime(rand(430, 500), t + 0.5);
    o.frequency.linearRampToValueAtTime(rand(300, 350), t + dur * 0.8);
    o.frequency.linearRampToValueAtTime(rand(180, 220), t + dur);
    const o2 = ctx.createOscillator(); o2.type = 'triangle';
    o2.frequency.value = 2;
    const vib = this._gain(7);
    o2.connect(vib); vib.connect(o.frequency);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1600;
    o.connect(f); f.connect(g);
    this._out(g, { pan, wet: 0.85 });
    o.start(t); o2.start(t); o.stop(t + dur); o2.stop(t + dur);
  }

  wolfStep(pan = 0, dist = 20) {
    if (!this.ready || dist > 34) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const vol = clamp(0.3 - dist * 0.011, 0.015, 0.28);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(72, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.2);
    const g = this._gain(0);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g); this._out(g, { pan, wet: 0.2 });
    o.start(t); o.stop(t + 0.3);
    const src = this._noiseSrc(0.7, true);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
    const ng = this._gain(vol * 0.5);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    src.connect(f); f.connect(ng); this._out(ng, { pan, wet: 0.2 });
    src.start(t); src.stop(t + 0.18);
  }

  heartbeat(strong = 1) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const beat = (offset, gain) => {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(58, t + offset);
      o.frequency.exponentialRampToValueAtTime(30, t + offset + 0.18);
      const g = this._gain(0);
      g.gain.setValueAtTime(0, t + offset);
      g.gain.linearRampToValueAtTime(0.30 * gain * strong, t + offset + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.26);
      o.connect(g); g.connect(this.master);
      o.start(t + offset); o.stop(t + offset + 0.3);
    };
    beat(0, 1);
    beat(0.17, 0.6);
  }

  /* --------------------------- story ------------------------------ */
  crash() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    // impact
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.8);
    const og = this._gain(0);
    og.gain.setValueAtTime(0.9, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    o.connect(og); og.connect(this.master);
    o.start(t); o.stop(t + 1.3);

    const src = this._noiseSrc(0.7, true);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
    const g = this._gain(0);
    g.gain.setValueAtTime(0.8, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    src.connect(f); f.connect(g); this._out(g, { pan: 0, wet: 0.4 });
    src.start(t); src.stop(t + 1.2);

    // glass + metal
    for (let i = 0; i < 7; i++) {
      const dt = rand(0, 0.7);
      const s = this._noiseSrc(rand(1.2, 2.4));
      const hf = ctx.createBiquadFilter(); hf.type = 'highpass'; hf.frequency.value = rand(1800, 5200);
      const hg = this._gain(0);
      hg.gain.setValueAtTime(rand(0.04, 0.14), t + dt);
      hg.gain.exponentialRampToValueAtTime(0.0001, t + dt + rand(0.1, 0.4));
      s.connect(hf); hf.connect(hg); this._out(hg, { pan: rand(-1, 1), wet: 0.4 });
      s.start(t + dt, rand(0, 1)); s.stop(t + dt + 0.45);
    }
  }

  jumpscare() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const now = ctx.currentTime;
    if (now - this._lastScare < 1.2) return;
    this._lastScare = now;

    // huge sub hit
    const boom = ctx.createOscillator(); boom.type = 'sine';
    boom.frequency.setValueAtTime(95, t);
    boom.frequency.exponentialRampToValueAtTime(24, t + 1.3);
    const bg = this._gain(0);
    bg.gain.setValueAtTime(1.0, t);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
    boom.connect(bg); bg.connect(this.master);
    boom.start(t); boom.stop(t + 1.8);

    // distorted screech cluster
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) { const x = (i / 1023.5) - 1; curve[i] = Math.tanh(x * 6); }
    shaper.curve = curve;
    const sg = this._gain(0);
    sg.gain.setValueAtTime(0.34, t);
    sg.gain.setValueAtTime(0.34, t + 1.05);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
    shaper.connect(sg); sg.connect(this.master);
    [1340, 1600, 1815, 2210].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = i % 2 ? 'sawtooth' : 'square';
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * rand(1.25, 1.8), t + 0.18);
      o.frequency.exponentialRampToValueAtTime(f * 0.45, t + 1.5);
      const og = this._gain(0.06);
      const det = ctx.createOscillator(); det.type = 'sine'; det.frequency.value = rand(7, 15);
      const dg = this._gain(rand(20, 60));
      det.connect(dg); dg.connect(o.frequency);
      o.connect(og); og.connect(shaper);
      o.start(t); det.start(t); o.stop(t + 1.8); det.stop(t + 1.8);
    });

    // screaming noise
    const src = this._noiseSrc(1.4);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(2600, t);
    bp.frequency.exponentialRampToValueAtTime(700, t + 1.2); bp.Q.value = 2.5;
    const ng = this._gain(0);
    ng.gain.setValueAtTime(0.36, t);
    ng.gain.setValueAtTime(0.3, t + 1.1);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    src.connect(bp); bp.connect(ng); this._out(ng, { pan: 0, wet: 0.6 });
    src.start(t, rand(0, 1)); src.stop(t + 1.9);

    // violin cluster swell
    [220, 277.2, 329.6, 440].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * 1.02;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 6 + i;
      const lg = this._gain(3);
      lfo.connect(lg); lg.connect(o.frequency);
      const g = this._gain(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.03, t + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
      const f2 = ctx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 1400;
      o.connect(f2); f2.connect(g); this._out(g, { pan: rand(-0.6, 0.6), wet: 0.8 });
      o.start(t); lfo.start(t); o.stop(t + 2); lfo.stop(t + 2);
    });
  }

  sting() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    [55, 58.3, 116].forEach(f => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const g = this._gain(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.06, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 300;
      o.connect(flt); flt.connect(g); this._out(g, { wet: 0.6 });
      o.start(t); o.stop(t + 1.7);
    });
  }

  carStart() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(28 + i * 3, t + i * 0.32);
      o.frequency.linearRampToValueAtTime(42, t + i * 0.32 + 0.28);
      const g = this._gain(0);
      g.gain.setValueAtTime(0, t + i * 0.32);
      g.gain.linearRampToValueAtTime(0.12, t + i * 0.32 + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.32 + 0.3);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 280;
      o.connect(f); f.connect(g); this._out(g, { wet: 0.2 });
      o.start(t + i * 0.32); o.stop(t + i * 0.32 + 0.34);
    }
  }

  startEngine() {
    if (!this.ready || this.engine) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._gain(0);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(0.16, t + 1.2);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 340;
    filter.Q.value = 2.2;
    filter.connect(out); out.connect(this.master);
    out.connect(this.reverb);

    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 42;
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 21;
    const o2g = this._gain(0.4);
    o1.connect(filter); o2.connect(o2g); o2g.connect(filter);

    // road/tyre noise
    const n = this._noiseSrc(0.35, true);
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 260; nf.Q.value = 0.6;
    const ng = this._gain(0.22);
    n.connect(nf); nf.connect(ng); ng.connect(out);

    const lfo = ctx.createOscillator(); lfo.frequency.value = 7.5;
    const lg = this._gain(3.5);
    lfo.connect(lg); lg.connect(o1.frequency);

    o1.start(t); o2.start(t); n.start(t); lfo.start(t);
    this.engine = { out, filter, o1, o2, n, lfo };
  }

  stopEngine(fade = 0.5) {
    if (!this.engine) return;
    const e = this.engine;
    const t = this.ctx.currentTime;
    e.out.gain.cancelScheduledValues(t);
    e.out.gain.setValueAtTime(e.out.gain.value, t);
    e.out.gain.linearRampToValueAtTime(0, t + fade);
    try { e.o1.stop(t + fade + 0.05); e.o2.stop(t + fade + 0.05); e.n.stop(t + fade + 0.05); e.lfo.stop(t + fade + 0.05); } catch {}
    this.engine = null;
  }

  /* --------------------------- update ----------------------------- */
  update(dt, { danger = 0, wolfPan = 0, wolfDist = 40, sprinting = false } = {}) {
    if (!this.ready) return;
    this._time += dt;
    this.danger = danger;
    this.wolfPan = wolfPan;
    this.wolfDist = wolfDist;

    // heartbeat
    if (danger > 0.12) {
      this._heartTimer -= dt;
      if (this._heartTimer <= 0) {
        const interval = 1.55 - danger * 1.05;
        this._heartTimer = Math.max(0.34, interval + (Math.random() - 0.5) * 0.06);
        this.heartbeat(clamp(0.35 + danger * 0.9, 0.3, 1));
      }
    } else this._heartTimer = 0;

    // ambient growls / howls
    this._ambientTimer -= dt;
    if (this._ambientTimer <= 0) {
      this._ambientTimer = rand(16, 38);
      if (danger < 0.55 && Math.random() < 0.55) this.howl(wolfPan * 0.6, wolfDist + 25);
      else if (Math.random() < 0.5) this.growl(0.3, wolfPan, wolfDist + 8);
    }

    if (danger > 0.3) {
      this._growlTimer -= dt;
      if (this._growlTimer <= 0) {
        this._growlTimer = rand(4, 9);
        this.growl(danger, wolfPan, wolfDist);
      }
    }
  }
}
