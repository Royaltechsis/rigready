// Sound effects, all synthesised with the Web Audio API (no audio files to download).
let ctx = null;
let master = null;
let muted = localStorage.getItem('rigready.muted') === '1';
let noiseBuf = null;
let ambient = null;

export function isMuted() { return muted; }

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.9;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  startAmbient();
}

export function setMuted(m) {
  muted = m;
  localStorage.setItem('rigready.muted', m ? '1' : '0');
  if (master) master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.05);
}

function noise(dur, { type = 'bandpass', freq = 1000, q = 1, gain = 0.3, attack = 0.005, at = 0 } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + dur + 0.05);
  return { f, g, t };
}

function tone(freq, dur, { type = 'sine', gain = 0.2, at = 0, slideTo = null, attack = 0.005 } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}

function startAmbient() {
  // Wind and sea, a generator hum, and Pump 2 chugging in the background.
  const wind = ctx.createBufferSource(); wind.buffer = noiseBuf; wind.loop = true;
  const wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 380;
  const wg = ctx.createGain(); wg.gain.value = 0.05;
  wind.connect(wf); wf.connect(wg); wg.connect(master); wind.start();

  const hum = ctx.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 50;
  const hf = ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 160;
  const hg = ctx.createGain(); hg.gain.value = 0.018;
  hum.connect(hf); hf.connect(hg); hg.connect(master); hum.start();

  const chug = ctx.createBufferSource(); chug.buffer = noiseBuf; chug.loop = true;
  const cf = ctx.createBiquadFilter(); cf.type = 'lowpass'; cf.frequency.value = 140;
  const cg = ctx.createGain(); cg.gain.value = 0.04;
  const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 2.1;
  const lg = ctx.createGain(); lg.gain.value = 0.04;
  lfo.connect(lg); lg.connect(cg.gain);
  chug.connect(cf); cf.connect(cg); cg.connect(master); chug.start(); lfo.start();
  ambient = { wind, hum, chug };
}

export const sfx = {
  click() { tone(1200, 0.05, { type: 'triangle', gain: 0.08 }); },
  equip() { tone(520, 0.08, { type: 'sine', gain: 0.15 }); tone(780, 0.1, { type: 'sine', gain: 0.12, at: 0.06 }); },
  ok() { [523, 659, 784].forEach((f, i) => tone(f, 0.18, { type: 'triangle', gain: 0.12, at: i * 0.07 })); },
  success() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.35, { type: 'triangle', gain: 0.13, at: i * 0.1 })); },
  error() { tone(180, 0.14, { type: 'square', gain: 0.07 }); tone(140, 0.2, { type: 'square', gain: 0.07, at: 0.12 }); },
  clack() { noise(0.09, { freq: 1800, q: 2, gain: 0.5 }); tone(90, 0.15, { gain: 0.35 }); },
  lockSnap() { noise(0.04, { freq: 4200, q: 6, gain: 0.5 }); noise(0.05, { freq: 3000, q: 8, gain: 0.6, at: 0.09 }); tone(2400, 0.06, { type: 'square', gain: 0.05, at: 0.09 }); },
  ratchet() { for (let i = 0; i < 8; i++) noise(0.03, { freq: 2600, q: 5, gain: 0.25, at: i * 0.09 }); },
  hiss(dur = 2.6) { noise(dur, { type: 'highpass', freq: 2500, q: 0.5, gain: 0.35, attack: 0.05 }); },
  thunk() { tone(70, 0.3, { gain: 0.5 }); noise(0.12, { type: 'lowpass', freq: 400, gain: 0.4 }); },
  slide() { noise(0.6, { type: 'bandpass', freq: 600, q: 1.5, gain: 0.15, attack: 0.1 }); },
  pumpStart() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(30, t); o.frequency.exponentialRampToValueAtTime(95, t + 1.6);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.25); g.gain.setValueAtTime(0.4, t + 2.0);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.0);
    o.connect(f); f.connect(g); g.connect(master); o.start(t); o.stop(t + 3.1);
    for (let i = 0; i < 9; i++) tone(60, 0.12, { gain: 0.45, at: 0.1 + i * (0.32 - i * 0.02) });
  },
  alarm(dur = 2.4) {
    for (let i = 0; i < dur / 0.4; i++) {
      tone(660, 0.2, { type: 'square', gain: 0.06, at: i * 0.4 });
      tone(880, 0.2, { type: 'square', gain: 0.06, at: i * 0.4 + 0.2 });
    }
  },
  burst() { noise(0.8, { type: 'lowpass', freq: 900, gain: 0.7, attack: 0.002 }); tone(55, 0.6, { gain: 0.5 }); },
  pumpRun(dur = 2.5) {
    for (let i = 0; i < dur / 0.24; i++) tone(65, 0.1, { gain: 0.3, at: i * 0.24 });
    noise(dur, { type: 'lowpass', freq: 300, gain: 0.15, attack: 0.3 });
  }
};
