export type OneShotId =
  | 'door_open_wood'
  | 'door_open_metal'
  | 'door_close_wood'
  | 'door_close_metal'
  | 'latch'
  | 'pickup_note'
  | 'pickup_key'
  | 'paper_turn'
  | 'flash_click'
  | 'stinger'
  | 'attack_warn'
  | 'ending_stinger'
  | 'heartbeat'
  | 'breath'
  | 'stalker_step';

export type FootstepMaterial = 'wood' | 'tile' | 'stone' | 'metal' | 'brick' | 'dirt';
export type AmbienceId = 'house' | 'basement';
export type MusicLayerId = 1 | 2 | 3;
export type ReverbPresetId = 'small' | 'hall' | 'cave' | 'corridor';

const LOOP_XFADE = 0.25;

function createOffline(sampleRate: number, seconds: number): OfflineAudioContext {
  return new OfflineAudioContext(1, Math.max(1, Math.ceil(sampleRate * seconds)), sampleRate);
}

function noiseBuffer(ctx: BaseAudioContext, seconds: number, brown = false): AudioBuffer {
  const length = Math.max(1, Math.ceil(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i += 1) {
    const white = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    } else {
      data[i] = white;
    }
  }
  return buffer;
}

interface BurstOptions {
  at?: number;
  duration: number;
  gain?: number;
  attack?: number;
  type?: BiquadFilterType;
  frequency?: number;
  endFrequency?: number;
  q?: number;
  rate?: number;
}

function noiseBurst(ctx: OfflineAudioContext, noise: AudioBuffer, options: BurstOptions): void {
  const at = options.at ?? 0;
  const duration = Math.max(0.01, options.duration);
  const source = ctx.createBufferSource();
  source.buffer = noise;
  source.loop = true;
  source.playbackRate.value = options.rate ?? 0.94 + Math.random() * 0.12;
  const filter = ctx.createBiquadFilter();
  filter.type = options.type ?? 'lowpass';
  const frequency = options.frequency ?? 1000;
  filter.frequency.setValueAtTime(frequency, at);
  if (options.endFrequency) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, options.endFrequency), at + duration);
  }
  filter.Q.value = options.q ?? 0.7;
  const gain = ctx.createGain();
  const peak = Math.max(0.0002, options.gain ?? 0.5);
  const attack = Math.min(options.attack ?? 0.004, duration * 0.5);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  const offset = Math.random() * Math.max(0, noise.duration - duration);
  source.start(at, offset);
  source.stop(at + duration + 0.05);
}

interface ToneOptions {
  at?: number;
  frequency: number;
  endFrequency?: number;
  duration: number;
  gain?: number;
  type?: OscillatorType;
  attack?: number;
}

function tone(ctx: OfflineAudioContext, options: ToneOptions): void {
  const at = options.at ?? 0;
  const duration = Math.max(0.01, options.duration);
  const oscillator = ctx.createOscillator();
  oscillator.type = options.type ?? 'sine';
  oscillator.frequency.setValueAtTime(Math.max(20, options.frequency), at);
  if (options.endFrequency) {
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, options.endFrequency), at + duration);
  }
  const gain = ctx.createGain();
  const peak = Math.max(0.0002, options.gain ?? 0.3);
  const attack = Math.min(options.attack ?? 0.005, duration * 0.5);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(at);
  oscillator.stop(at + duration + 0.02);
}

function normalize(buffer: AudioBuffer, peak = 0.85): AudioBuffer {
  const data = buffer.getChannelData(0);
  let max = 0;
  for (let i = 0; i < data.length; i += 1) {
    const value = Math.abs(data[i]);
    if (value > max) {
      max = value;
    }
  }
  if (max > 0.0001) {
    const scale = peak / max;
    for (let i = 0; i < data.length; i += 1) {
      data[i] *= scale;
    }
  }
  return buffer;
}

function loopify(source: AudioBuffer, lengthSeconds: number): AudioBuffer {
  const rate = source.sampleRate;
  const total = Math.max(1, Math.ceil(rate * lengthSeconds));
  const fade = Math.max(1, Math.min(Math.floor(rate * LOOP_XFADE), Math.floor(total / 4)));
  const data = source.getChannelData(0);
  const output = new AudioBuffer({ length: total, numberOfChannels: 1, sampleRate: rate });
  const out = output.getChannelData(0);
  for (let i = 0; i < total; i += 1) {
    out[i] = data[i];
  }
  for (let i = 0; i < fade; i += 1) {
    const blend = i / fade;
    const tailIndex = total + i;
    if (tailIndex < data.length) {
      out[i] = out[i] * blend + data[tailIndex] * (1 - blend);
    }
  }
  return output;
}

interface FootstepProfile {
  duration: number;
  noise: { frequency: number; type: BiquadFilterType; duration: number; gain: number; q?: number };
  thump: { frequency: number; gain: number; duration: number };
  click?: { frequency: number; gain: number; duration: number };
  partials?: number[];
}

const FOOTSTEP_PROFILES: Record<FootstepMaterial, FootstepProfile> = {
  wood: {
    duration: 0.24,
    noise: { frequency: 900, type: 'lowpass', duration: 0.07, gain: 0.32 },
    thump: { frequency: 120, gain: 0.5, duration: 0.12 },
    click: { frequency: 2100, gain: 0.18, duration: 0.02 },
  },
  tile: {
    duration: 0.2,
    noise: { frequency: 1600, type: 'highpass', duration: 0.045, gain: 0.38 },
    thump: { frequency: 190, gain: 0.34, duration: 0.09 },
  },
  stone: {
    duration: 0.28,
    noise: { frequency: 850, type: 'bandpass', duration: 0.1, gain: 0.42, q: 0.9 },
    thump: { frequency: 150, gain: 0.42, duration: 0.14 },
  },
  brick: {
    duration: 0.24,
    noise: { frequency: 720, type: 'lowpass', duration: 0.08, gain: 0.36 },
    thump: { frequency: 140, gain: 0.4, duration: 0.12 },
  },
  metal: {
    duration: 0.34,
    noise: { frequency: 2500, type: 'bandpass', duration: 0.09, gain: 0.3, q: 1.4 },
    thump: { frequency: 160, gain: 0.32, duration: 0.1 },
    partials: [3100, 4700],
  },
  dirt: {
    duration: 0.22,
    noise: { frequency: 600, type: 'lowpass', duration: 0.08, gain: 0.34 },
    thump: { frequency: 105, gain: 0.42, duration: 0.11 },
  },
};

async function renderDoorOpen(sampleRate: number, metal: boolean): Promise<AudioBuffer> {
  const duration = 1.5;
  const ctx = createOffline(sampleRate, duration);
  const noise = noiseBuffer(ctx, 1.6);
  const creak = ctx.createOscillator();
  creak.type = 'sawtooth';
  const base = metal ? 620 : 320;
  const spread = metal ? 800 : 520;
  const steps = 24;
  const step = duration / steps;
  for (let i = 0; i <= steps; i += 1) {
    creak.frequency.setValueAtTime(base + Math.random() * spread + (i / steps) * 180, i * step);
  }
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = metal ? 1400 : 800;
  filter.Q.value = metal ? 2.2 : 1.6;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, 0);
  for (let i = 0; i <= steps; i += 1) {
    gain.gain.linearRampToValueAtTime(0.06 + Math.random() * 0.22, i * step);
  }
  gain.gain.linearRampToValueAtTime(0.0001, duration);
  creak.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  creak.start(0);
  creak.stop(duration);
  noiseBurst(ctx, noise, {
    duration: duration * 0.85,
    gain: metal ? 0.1 : 0.14,
    type: 'bandpass',
    frequency: metal ? 1800 : 1100,
    endFrequency: metal ? 900 : 700,
    q: 0.8,
  });
  if (metal) {
    tone(ctx, { at: duration * 0.6, frequency: 2800, duration: 0.5, gain: 0.08 });
    tone(ctx, { at: duration * 0.62, frequency: 3900, duration: 0.35, gain: 0.05 });
  }
  return normalize(await ctx.startRendering(), 0.75);
}

async function renderDoorClose(sampleRate: number, metal: boolean): Promise<AudioBuffer> {
  const duration = metal ? 0.75 : 0.6;
  const ctx = createOffline(sampleRate, duration);
  const noise = noiseBuffer(ctx, 0.7);
  noiseBurst(ctx, noise, {
    duration: metal ? 0.08 : 0.06,
    gain: metal ? 0.5 : 0.55,
    type: 'lowpass',
    frequency: metal ? 2200 : 1500,
  });
  tone(ctx, {
    frequency: metal ? 130 : 95,
    endFrequency: metal ? 70 : 55,
    duration: metal ? 0.3 : 0.25,
    gain: 0.7,
    attack: 0.002,
  });
  if (metal) {
    tone(ctx, { frequency: 2600, duration: 0.35, gain: 0.14, attack: 0.002 });
    tone(ctx, { frequency: 4100, duration: 0.22, gain: 0.08, attack: 0.002 });
  } else {
    noiseBurst(ctx, noise, {
      at: 0.02,
      duration: 0.05,
      gain: 0.2,
      type: 'bandpass',
      frequency: 900,
      q: 1.2,
    });
  }
  return normalize(await ctx.startRendering(), 0.9);
}

async function renderLatch(sampleRate: number): Promise<AudioBuffer> {
  const ctx = createOffline(sampleRate, 0.35);
  const noise = noiseBuffer(ctx, 0.35);
  for (const at of [0, 0.12]) {
    noiseBurst(ctx, noise, { at, duration: 0.012, gain: 0.8, type: 'highpass', frequency: 2600 });
    noiseBurst(ctx, noise, {
      at: at + 0.008,
      duration: 0.03,
      gain: 0.3,
      type: 'bandpass',
      frequency: 1400,
      q: 2,
    });
  }
  return normalize(await ctx.startRendering(), 0.85);
}

async function renderFlashClick(sampleRate: number): Promise<AudioBuffer> {
  const ctx = createOffline(sampleRate, 0.3);
  const noise = noiseBuffer(ctx, 0.3);
  for (const at of [0.01, 0.07]) {
    noiseBurst(ctx, noise, {
      at,
      duration: 0.008,
      gain: 0.9,
      type: 'highpass',
      frequency: 3200,
      rate: 1.04,
    });
    noiseBurst(ctx, noise, {
      at: at + 0.006,
      duration: 0.02,
      gain: 0.35,
      type: 'bandpass',
      frequency: 2100,
      q: 1.6,
    });
  }
  tone(ctx, { at: 0.012, frequency: 210, endFrequency: 120, duration: 0.05, gain: 0.16 });
  tone(ctx, { at: 0.072, frequency: 180, endFrequency: 110, duration: 0.04, gain: 0.12 });
  return normalize(await ctx.startRendering(), 0.8);
}

async function renderPaper(sampleRate: number, duration: number, gain: number): Promise<AudioBuffer> {
  const ctx = createOffline(sampleRate, duration + 0.1);
  const noise = noiseBuffer(ctx, 0.6);
  const source = ctx.createBufferSource();
  source.buffer = noise;
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 2800;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, 0);
  const steps = Math.max(2, Math.floor(duration / 0.03));
  for (let i = 0; i <= steps; i += 1) {
    env.gain.linearRampToValueAtTime(gain * (0.25 + Math.random() * 0.75), (i / steps) * duration);
  }
  env.gain.linearRampToValueAtTime(0.0001, duration);
  source.connect(filter);
  filter.connect(env);
  env.connect(ctx.destination);
  source.start(0);
  source.stop(duration + 0.05);
  return normalize(await ctx.startRendering(), 0.8);
}

async function renderKeyPickup(sampleRate: number): Promise<AudioBuffer> {
  const ctx = createOffline(sampleRate, 0.8);
  const noise = noiseBuffer(ctx, 0.5);
  const count = 3 + Math.floor(Math.random() * 2);
  let at = 0.02;
  for (let i = 0; i < count; i += 1) {
    tone(ctx, {
      at,
      frequency: 2400 + Math.random() * 1800,
      duration: 0.16,
      gain: 0.3 + Math.random() * 0.2,
      attack: 0.002,
    });
    at += 0.06 + Math.random() * 0.16;
  }
  noiseBurst(ctx, noise, { duration: 0.25, gain: 0.08, type: 'highpass', frequency: 3200 });
  return normalize(await ctx.startRendering(), 0.85);
}

async function renderStinger(sampleRate: number): Promise<AudioBuffer> {
  const duration = 2.2;
  const ctx = createOffline(sampleRate, duration);
  const noise = noiseBuffer(ctx, 1.2);
  for (const frequency of [110, 116, 233, 246]) {
    tone(ctx, { frequency, duration: 1.6, gain: 0.14, attack: 0.7 });
    tone(ctx, { frequency: frequency * 1.5, duration: 0.9, gain: 0.05, attack: 0.5 });
  }
  noiseBurst(ctx, noise, {
    at: 0.75,
    duration: 0.5,
    gain: 0.4,
    type: 'lowpass',
    frequency: 900,
    endFrequency: 180,
  });
  tone(ctx, { at: 0.78, frequency: 58, endFrequency: 34, duration: 1.1, gain: 0.5, attack: 0.005 });
  return normalize(await ctx.startRendering(), 0.85);
}

async function renderAttackWarn(sampleRate: number): Promise<AudioBuffer> {
  const duration = 1.0;
  const ctx = createOffline(sampleRate, duration);
  const noise = noiseBuffer(ctx, 0.8);
  tone(ctx, { frequency: 70, endFrequency: 190, duration: 0.85, gain: 0.4, attack: 0.25 });
  tone(ctx, { frequency: 105, endFrequency: 285, duration: 0.85, gain: 0.18, attack: 0.3 });
  noiseBurst(ctx, noise, {
    duration: 0.7,
    gain: 0.25,
    type: 'bandpass',
    frequency: 500,
    endFrequency: 1600,
    q: 1.2,
  });
  return normalize(await ctx.startRendering(), 0.85);
}

async function renderEndingStinger(sampleRate: number): Promise<AudioBuffer> {
  const duration = 3.2;
  const ctx = createOffline(sampleRate, duration);
  tone(ctx, { frequency: 55, duration: 2.8, gain: 0.3, attack: 1.6 });
  tone(ctx, { frequency: 58.5, duration: 2.8, gain: 0.22, attack: 1.8 });
  tone(ctx, { frequency: 4400, duration: 2.4, gain: 0.04, attack: 1.2 });
  tone(ctx, { frequency: 6600, duration: 1.8, gain: 0.025, attack: 0.9 });
  return normalize(await ctx.startRendering(), 0.8);
}

async function renderHeartbeat(sampleRate: number): Promise<AudioBuffer> {
  const ctx = createOffline(sampleRate, 1.3);
  for (const at of [0, 0.35]) {
    tone(ctx, { at, frequency: 62, endFrequency: 38, duration: 0.22, gain: 0.8, attack: 0.004 });
  }
  return normalize(await ctx.startRendering(), 0.85);
}

async function renderBreath(sampleRate: number): Promise<AudioBuffer> {
  const duration = 2.8;
  const ctx = createOffline(sampleRate, duration);
  const noise = noiseBuffer(ctx, 1.2);
  const source = ctx.createBufferSource();
  source.buffer = noise;
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 700;
  filter.Q.value = 0.9;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, 0);
  env.gain.linearRampToValueAtTime(0.28, 0.55);
  env.gain.linearRampToValueAtTime(0.05, 1.1);
  env.gain.linearRampToValueAtTime(0.34, 1.7);
  env.gain.linearRampToValueAtTime(0.0001, 2.5);
  source.connect(filter);
  filter.connect(env);
  env.connect(ctx.destination);
  source.start(0);
  source.stop(duration);
  return normalize(await ctx.startRendering(), 0.7);
}

async function renderStalkerStep(sampleRate: number): Promise<AudioBuffer> {
  const ctx = createOffline(sampleRate, 0.7);
  const noise = noiseBuffer(ctx, 0.6);
  tone(ctx, { frequency: 58, endFrequency: 35, duration: 0.4, gain: 0.9, attack: 0.006 });
  noiseBurst(ctx, noise, {
    duration: 0.35,
    gain: 0.3,
    type: 'lowpass',
    frequency: 420,
    endFrequency: 120,
  });
  return normalize(await ctx.startRendering(), 0.9);
}

async function renderHouseAmbience(sampleRate: number): Promise<AudioBuffer> {
  const length = 8;
  const total = length + LOOP_XFADE;
  const ctx = createOffline(sampleRate, total);
  const wind = noiseBuffer(ctx, total, true);
  const windSource = ctx.createBufferSource();
  windSource.buffer = wind;
  windSource.loop = true;
  const windFilter = ctx.createBiquadFilter();
  windFilter.type = 'lowpass';
  windFilter.frequency.value = 400;
  windFilter.Q.value = 0.6;
  const windGain = ctx.createGain();
  windGain.gain.value = 0.16;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.07;
  lfo.connect(lfoGain);
  lfoGain.connect(windGain.gain);
  windSource.connect(windFilter);
  windFilter.connect(windGain);
  windGain.connect(ctx.destination);
  windSource.start(0);
  lfo.start(0);
  tone(ctx, { frequency: 45, duration: total, gain: 0.1, attack: 2 });
  for (const at of [1.2, 4.6, 6.9]) {
    tone(ctx, {
      at,
      frequency: 260 + Math.random() * 300,
      endFrequency: 180,
      duration: 0.35,
      gain: 0.05,
      type: 'sawtooth',
      attack: 0.05,
    });
  }
  tone(ctx, { at: 6.1, frequency: 2100, endFrequency: 1200, duration: 0.3, gain: 0.08, attack: 0.004 });
  return normalize(loopify(await ctx.startRendering(), length), 0.75);
}

async function renderBasementAmbience(sampleRate: number): Promise<AudioBuffer> {
  const length = 8;
  const total = length + LOOP_XFADE;
  const ctx = createOffline(sampleRate, total);
  tone(ctx, { frequency: 50, duration: total, gain: 0.14, attack: 0.01 });
  tone(ctx, { frequency: 100, duration: total, gain: 0.05, attack: 0.01 });
  const rumble = noiseBuffer(ctx, total, true);
  const rumbleSource = ctx.createBufferSource();
  rumbleSource.buffer = rumble;
  rumbleSource.loop = true;
  const rumbleFilter = ctx.createBiquadFilter();
  rumbleFilter.type = 'lowpass';
  rumbleFilter.frequency.value = 200;
  const rumbleGain = ctx.createGain();
  rumbleGain.gain.value = 0.12;
  rumbleSource.connect(rumbleFilter);
  rumbleFilter.connect(rumbleGain);
  rumbleGain.connect(ctx.destination);
  rumbleSource.start(0);
  const noise = noiseBuffer(ctx, 0.5);
  tone(ctx, { at: 2.9, frequency: 1900, endFrequency: 1100, duration: 0.4, gain: 0.1, attack: 0.004 });
  tone(ctx, { at: 3.0, frequency: 2650, endFrequency: 1500, duration: 0.28, gain: 0.05, attack: 0.004 });
  noiseBurst(ctx, noise, { at: 5.4, duration: 0.02, gain: 0.35, type: 'bandpass', frequency: 3200, q: 3 });
  tone(ctx, { at: 7.1, frequency: 320, endFrequency: 90, duration: 0.5, gain: 0.08, attack: 0.01, type: 'triangle' });
  return normalize(loopify(await ctx.startRendering(), length), 0.75);
}

async function renderMusicLayer1(sampleRate: number): Promise<AudioBuffer> {
  const length = 12;
  const total = length + LOOP_XFADE;
  const ctx = createOffline(sampleRate, total);
  const drone = ctx.createGain();
  drone.gain.value = 0.16;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.05;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.06;
  lfo.connect(lfoGain);
  lfoGain.connect(drone.gain);
  for (const frequency of [55, 82.5, 82.9, 110.3]) {
    const oscillator = ctx.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    const gain = ctx.createGain();
    gain.gain.value = frequency < 80 ? 0.5 : 0.22;
    oscillator.connect(gain);
    gain.connect(drone);
    oscillator.start(0);
  }
  drone.connect(ctx.destination);
  lfo.start(0);
  const bed = noiseBuffer(ctx, total, true);
  const bedSource = ctx.createBufferSource();
  bedSource.buffer = bed;
  bedSource.loop = true;
  const bedFilter = ctx.createBiquadFilter();
  bedFilter.type = 'lowpass';
  bedFilter.frequency.value = 300;
  const bedGain = ctx.createGain();
  bedGain.gain.value = 0.06;
  bedSource.connect(bedFilter);
  bedFilter.connect(bedGain);
  bedGain.connect(ctx.destination);
  bedSource.start(0);
  return normalize(loopify(await ctx.startRendering(), length), 0.7);
}

async function renderMusicLayer2(sampleRate: number): Promise<AudioBuffer> {
  const length = 12;
  const total = length + LOOP_XFADE;
  const ctx = createOffline(sampleRate, total);
  for (let i = 0; i < 6; i += 1) {
    tone(ctx, { at: i * 2 + 0.1, frequency: 62, endFrequency: 44, duration: 0.5, gain: 0.4, attack: 0.01 });
  }
  tone(ctx, { frequency: 55, duration: total, gain: 0.12, attack: 1.5 });
  const noise = noiseBuffer(ctx, 0.4);
  for (let i = 0; i < 14; i += 1) {
    noiseBurst(ctx, noise, {
      at: Math.random() * length,
      duration: 0.02,
      gain: 0.12,
      type: 'bandpass',
      frequency: 2600 + Math.random() * 2400,
      q: 4,
    });
  }
  return normalize(loopify(await ctx.startRendering(), length), 0.65);
}

async function renderMusicLayer3(sampleRate: number): Promise<AudioBuffer> {
  const length = 12;
  const total = length + LOOP_XFADE;
  const ctx = createOffline(sampleRate, total);
  const cluster = ctx.createGain();
  cluster.gain.setValueAtTime(0.0001, 0);
  cluster.gain.linearRampToValueAtTime(0.22, 6);
  cluster.gain.linearRampToValueAtTime(0.0001, total);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 900;
  for (const frequency of [220, 233, 311, 233.7]) {
    const oscillator = ctx.createOscillator();
    oscillator.type = 'sawtooth';
    oscillator.frequency.value = frequency;
    const gain = ctx.createGain();
    gain.gain.value = 0.25;
    oscillator.connect(gain);
    gain.connect(cluster);
    oscillator.start(0);
  }
  cluster.connect(filter);
  filter.connect(ctx.destination);
  tone(ctx, { frequency: 4400, duration: total, gain: 0.03, attack: 3 });
  return normalize(loopify(await ctx.startRendering(), length), 0.65);
}

const REVERB_PROFILES: Record<
  ReverbPresetId,
  { seconds: number; damping: number; decay: number; reflections: number[] }
> = {
  small: { seconds: 0.7, damping: 6000, decay: 3.5, reflections: [] },
  hall: { seconds: 2.4, damping: 4000, decay: 2.4, reflections: [] },
  cave: { seconds: 3.6, damping: 1600, decay: 2, reflections: [0.04, 0.07, 0.09] },
  corridor: { seconds: 1.5, damping: 5000, decay: 2.6, reflections: [0.06, 0.12, 0.18] },
};

export async function renderFootstep(
  sampleRate: number,
  material: FootstepMaterial,
  variant: 0 | 1,
  running: boolean,
): Promise<AudioBuffer> {
  const profile = FOOTSTEP_PROFILES[material] ?? FOOTSTEP_PROFILES.wood;
  const shift = variant === 0 ? 0.88 : 1.12;
  const boost = running ? 1.3 : 1;
  const shrink = running ? 0.72 : 1;
  const duration = profile.duration * shrink;
  const ctx = createOffline(sampleRate, duration + 0.15);
  const noise = noiseBuffer(ctx, 0.5);
  noiseBurst(ctx, noise, {
    duration: profile.noise.duration * shrink,
    gain: profile.noise.gain * boost,
    type: profile.noise.type,
    frequency: profile.noise.frequency * shift,
    q: profile.noise.q,
  });
  tone(ctx, {
    frequency: profile.thump.frequency * shift,
    endFrequency: profile.thump.frequency * shift * 0.65,
    duration: profile.thump.duration * shrink,
    gain: profile.thump.gain * boost,
    attack: 0.003,
  });
  if (profile.click) {
    noiseBurst(ctx, noise, {
      duration: profile.click.duration,
      gain: profile.click.gain * boost,
      type: 'highpass',
      frequency: profile.click.frequency * shift,
    });
  }
  if (profile.partials) {
    for (const partial of profile.partials) {
      tone(ctx, {
        frequency: partial * shift,
        duration: 0.18 * shrink,
        gain: 0.12 * boost,
        attack: 0.002,
      });
    }
  }
  return normalize(await ctx.startRendering(), running ? 0.9 : 0.8);
}

export async function renderOneShot(sampleRate: number, id: OneShotId): Promise<AudioBuffer> {
  switch (id) {
    case 'door_open_wood':
      return renderDoorOpen(sampleRate, false);
    case 'door_open_metal':
      return renderDoorOpen(sampleRate, true);
    case 'door_close_wood':
      return renderDoorClose(sampleRate, false);
    case 'door_close_metal':
      return renderDoorClose(sampleRate, true);
    case 'latch':
      return renderLatch(sampleRate);
    case 'pickup_note':
      return renderPaper(sampleRate, 0.5, 0.45);
    case 'paper_turn':
      return renderPaper(sampleRate, 0.34, 0.3);
    case 'flash_click':
      return renderFlashClick(sampleRate);
    case 'pickup_key':
      return renderKeyPickup(sampleRate);
    case 'stinger':
      return renderStinger(sampleRate);
    case 'attack_warn':
      return renderAttackWarn(sampleRate);
    case 'ending_stinger':
      return renderEndingStinger(sampleRate);
    case 'heartbeat':
      return renderHeartbeat(sampleRate);
    case 'breath':
      return renderBreath(sampleRate);
    case 'stalker_step':
      return renderStalkerStep(sampleRate);
    default: {
      const exhaustive: never = id;
      throw new Error(`Sonido no soportado: ${String(exhaustive)}`);
    }
  }
}

export async function renderAmbience(sampleRate: number, id: AmbienceId): Promise<AudioBuffer> {
  switch (id) {
    case 'house':
      return renderHouseAmbience(sampleRate);
    case 'basement':
      return renderBasementAmbience(sampleRate);
    default: {
      const exhaustive: never = id;
      throw new Error(`Ambiente no soportado: ${String(exhaustive)}`);
    }
  }
}

export async function renderMusicLayer(sampleRate: number, id: MusicLayerId): Promise<AudioBuffer> {
  switch (id) {
    case 1:
      return renderMusicLayer1(sampleRate);
    case 2:
      return renderMusicLayer2(sampleRate);
    case 3:
      return renderMusicLayer3(sampleRate);
    default: {
      const exhaustive: never = id;
      throw new Error(`Capa no soportada: ${String(exhaustive)}`);
    }
  }
}

export async function renderReverbImpulse(
  sampleRate: number,
  id: ReverbPresetId,
): Promise<AudioBuffer> {
  const profile = REVERB_PROFILES[id];
  const length = Math.max(1, Math.ceil(sampleRate * profile.seconds));
  const buffer = new AudioBuffer({ length, numberOfChannels: 1, sampleRate });
  const data = buffer.getChannelData(0);
  const alpha = 1 - Math.exp((-2 * Math.PI * profile.damping) / sampleRate);
  let lowpassed = 0;
  for (let i = 0; i < length; i += 1) {
    const envelope = Math.pow(1 - i / length, profile.decay);
    const white = Math.random() * 2 - 1;
    lowpassed += alpha * (white - lowpassed);
    data[i] = lowpassed * envelope;
  }
  for (const delay of profile.reflections) {
    const offset = Math.floor(delay * sampleRate);
    const gain = 0.5 * Math.exp(-delay * 4);
    for (let i = offset; i < length; i += 1) {
      data[i] += data[i - offset] * gain;
    }
  }
  return normalize(buffer, 0.9);
}
