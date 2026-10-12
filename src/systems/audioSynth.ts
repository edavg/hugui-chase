// Síntesis procedural de todo el audio de Mondyi (sin binarios).
//
// v2 (M12): sonidos por capas al estilo de los survival horror de PS2 —
// cada efecto combina impacto, cuerpo resonante (bancos de filtros modales),
// textura (granos, crepitar, roce) y cola. Las bisagras usan un tren de
// impulsos "stick-slip" (como el chirrido real de una bisagra), el fuego un
// generador de crepitar, los pasos golpe de talón + punta + material, y los
// ambientes van en estéreo con eventos lejanos panoramizados. Cada efecto
// admite variantes (el AudioSystem renderiza varias y elige al azar).

export type OneShotId =
  | 'door_open_wood'
  | 'door_open_metal'
  | 'door_close_wood'
  | 'door_close_metal'
  | 'door_locked'
  | 'padlock_unlock'
  | 'latch'
  | 'pickup_note'
  | 'pickup_key'
  | 'paper_turn'
  | 'burn'
  | 'flash_click'
  | 'stinger'
  | 'attack_warn'
  | 'ending_stinger'
  | 'heartbeat'
  | 'breath'
  | 'stalker_step'
  | 'hurt'
  | 'eat';

export type FootstepMaterial = 'wood' | 'tile' | 'stone' | 'metal' | 'brick' | 'dirt' | 'grass';
export type AmbienceId = 'house' | 'basement' | 'outdoor';
export type MusicLayerId = 1 | 2 | 3;
export type ReverbPresetId = 'small' | 'hall' | 'cave' | 'corridor';

// Cuántas variantes distintas merece cada efecto (repetirlo idéntico delata la síntesis).
export const ONE_SHOT_VARIANTS: Partial<Record<OneShotId, number>> = {
  door_open_wood: 3,
  door_open_metal: 2,
  door_close_wood: 3,
  door_close_metal: 2,
  door_locked: 2,
  burn: 2,
  stalker_step: 4,
  breath: 3,
  pickup_key: 2,
  paper_turn: 2,
  hurt: 2,
  eat: 2,
  attack_warn: 2,
};

export const FOOTSTEP_VARIANTS = 4;

const LOOP_XFADE = 0.4;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

type Ctx = OfflineAudioContext;

function createOffline(sampleRate: number, seconds: number, channels = 1): Ctx {
  return new OfflineAudioContext(channels, Math.max(1, Math.ceil(sampleRate * seconds)), sampleRate);
}

const rand = (min: number, max: number): number => min + Math.random() * (max - min);

function noiseBuffer(ctx: BaseAudioContext, seconds: number, color: 'white' | 'pink' | 'brown' = 'white'): AudioBuffer {
  const length = Math.max(1, Math.ceil(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let last = 0;
  for (let i = 0; i < length; i += 1) {
    const white = Math.random() * 2 - 1;
    if (color === 'brown') {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    } else if (color === 'pink') {
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.2;
    } else {
      data[i] = white;
    }
  }
  return buffer;
}

function bufferFrom(ctx: BaseAudioContext, data: Float32Array): AudioBuffer {
  const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
  buffer.getChannelData(0).set(data);
  return buffer;
}

function out(ctx: Ctx, pan = 0): AudioNode {
  if (pan === 0 || ctx.destination.channelCount < 2) {
    return ctx.destination;
  }
  const panner = ctx.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, pan));
  panner.connect(ctx.destination);
  return panner;
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
  dest?: AudioNode;
}

function noiseBurst(ctx: Ctx, noise: AudioBuffer, options: BurstOptions): void {
  const at = options.at ?? 0;
  const duration = Math.max(0.005, options.duration);
  const source = ctx.createBufferSource();
  source.buffer = noise;
  source.loop = true;
  source.playbackRate.value = options.rate ?? 0.94 + Math.random() * 0.12;
  const filter = ctx.createBiquadFilter();
  filter.type = options.type ?? 'lowpass';
  const frequency = options.frequency ?? 1000;
  filter.frequency.setValueAtTime(frequency, at);
  if (options.endFrequency) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(30, options.endFrequency), at + duration);
  }
  filter.Q.value = options.q ?? 0.7;
  const gain = ctx.createGain();
  const peak = Math.max(0.0002, options.gain ?? 0.5);
  const attack = Math.min(options.attack ?? 0.003, duration * 0.5);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(options.dest ?? ctx.destination);
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
  vibrato?: { rate: number; depth: number };
  dest?: AudioNode;
}

function tone(ctx: Ctx, options: ToneOptions): void {
  const at = options.at ?? 0;
  const duration = Math.max(0.01, options.duration);
  const oscillator = ctx.createOscillator();
  oscillator.type = options.type ?? 'sine';
  oscillator.frequency.setValueAtTime(Math.max(20, options.frequency), at);
  if (options.endFrequency) {
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, options.endFrequency), at + duration);
  }
  if (options.vibrato) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = options.vibrato.rate;
    const depth = ctx.createGain();
    depth.gain.value = options.vibrato.depth;
    lfo.connect(depth);
    depth.connect(oscillator.frequency);
    lfo.start(at);
    lfo.stop(at + duration + 0.02);
  }
  const gain = ctx.createGain();
  const peak = Math.max(0.0002, options.gain ?? 0.3);
  const attack = Math.min(options.attack ?? 0.005, duration * 0.5);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  oscillator.connect(gain);
  gain.connect(options.dest ?? ctx.destination);
  oscillator.start(at);
  oscillator.stop(at + duration + 0.02);
}

// Banco de resonadores (modos de un cuerpo: tabla, puerta, chapa).
function resonator(ctx: Ctx, modes: Array<[number, number]>, q: number, dest: AudioNode = ctx.destination): GainNode {
  const input = ctx.createGain();
  for (const [frequency, level] of modes) {
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = frequency;
    band.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = level;
    input.connect(band);
    band.connect(gain);
    gain.connect(dest);
  }
  return input;
}

// Parcial metálico con decaimiento largo (campanas, chapa, llaves).
function ring(ctx: Ctx, at: number, frequencies: number[], decay: number, gain: number, dest?: AudioNode): void {
  frequencies.forEach((frequency, index) => {
    tone(ctx, {
      at,
      frequency: frequency * rand(0.995, 1.005),
      duration: decay * (1 - index * 0.12),
      gain: gain / (1 + index * 0.6),
      attack: 0.001,
      dest,
    });
  });
}

// Tren de impulsos stick-slip: el chirrido real de una bisagra o una tabla.
function creakSignal(
  sampleRate: number,
  seconds: number,
  pitch: (t: number) => number,
  amp: (t: number) => number,
  jitter = 0.18,
): Float32Array {
  // Cada "slip" es un clic corto y coherente (no ruido): así el tren de
  // impulsos tiene armónicos reales y suena a madera/metal que chirría.
  const data = new Float32Array(Math.ceil(sampleRate * seconds));
  let next = 0;
  let level = 0;
  let drift = 0;
  for (let i = 0; i < data.length; i += 1) {
    const t = i / sampleRate;
    if (i >= next) {
      drift += (Math.random() - 0.5) * 0.08;
      drift *= 0.97;
      const period = 1 / Math.max(30, pitch(t) * (1 + drift));
      next = i + Math.max(2, Math.round(period * sampleRate * (1 + (Math.random() - 0.5) * jitter * 0.3)));
      level = amp(t) * (0.75 + Math.random() * 0.25);
    }
    data[i] = level;
    level *= -0.55;
  }
  return data;
}

// Crepitar: impulsos dispersos con decaimiento individual (fuego, grava, papel).
function crackleSignal(sampleRate: number, seconds: number, density: (t: number) => number, amp: (t: number) => number): Float32Array {
  const data = new Float32Array(Math.ceil(sampleRate * seconds));
  for (let i = 0; i < data.length; i += 1) {
    const t = i / sampleRate;
    if (Math.random() < density(t) / sampleRate) {
      const length = Math.floor(sampleRate * rand(0.0006, 0.004));
      const a = amp(t) * rand(0.3, 1);
      for (let k = 0; k < length && i + k < data.length; k += 1) {
        data[i + k] += a * (Math.random() * 2 - 1) * Math.exp((-5 * k) / length);
      }
    }
  }
  return data;
}

function playSignal(ctx: Ctx, data: Float32Array, at: number, dest: AudioNode, gain = 1): void {
  const source = ctx.createBufferSource();
  source.buffer = bufferFrom(ctx, data);
  const level = ctx.createGain();
  level.gain.value = gain;
  source.connect(level);
  level.connect(dest);
  source.start(at);
}

function filtered(ctx: Ctx, type: BiquadFilterType, frequency: number, q = 0.7, dest: AudioNode = ctx.destination): BiquadFilterNode {
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  filter.connect(dest);
  return filter;
}

function normalize(buffer: AudioBuffer, peak = 0.85): AudioBuffer {
  let max = 0;
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i += 1) {
      const value = Math.abs(data[i]);
      if (value > max) max = value;
    }
  }
  if (max > 0.0001) {
    const scale = peak / max;
    for (let c = 0; c < buffer.numberOfChannels; c += 1) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i += 1) data[i] *= scale;
    }
  }
  return buffer;
}

function loopify(source: AudioBuffer, lengthSeconds: number): AudioBuffer {
  const rate = source.sampleRate;
  const total = Math.max(1, Math.ceil(rate * lengthSeconds));
  const fade = Math.max(1, Math.min(Math.floor(rate * LOOP_XFADE), Math.floor(total / 4)));
  const output = new AudioBuffer({ length: total, numberOfChannels: source.numberOfChannels, sampleRate: rate });
  for (let c = 0; c < source.numberOfChannels; c += 1) {
    const data = source.getChannelData(c);
    const target = output.getChannelData(c);
    for (let i = 0; i < total; i += 1) target[i] = data[i];
    for (let i = 0; i < fade; i += 1) {
      const blend = i / fade;
      const tailIndex = total + i;
      if (tailIndex < data.length) {
        target[i] = target[i] * blend + data[tailIndex] * (1 - blend);
      }
    }
  }
  return output;
}

// Ráfagas de viento: automatiza un gain con puntos aleatorios suaves.
function gusts(param: AudioParam, seconds: number, low: number, high: number, step = 0.8): void {
  param.setValueAtTime(low, 0);
  for (let t = step; t < seconds; t += step * rand(0.6, 1.4)) {
    param.linearRampToValueAtTime(rand(low, high), t);
  }
  param.linearRampToValueAtTime(low, seconds);
}

// ---------------------------------------------------------------------------
// Pasos
// ---------------------------------------------------------------------------

interface FootstepProfile {
  cutoff: number;
  thump: number;
  thumpGain: number;
  body: Array<[number, number]>;
  bodyQ: number;
  hiss: number;
  grit?: number;
  ring?: number[];
  rustle?: boolean;
  creakChance?: number;
}

const FOOTSTEP_PROFILES: Record<FootstepMaterial, FootstepProfile> = {
  wood: { cutoff: 1400, thump: 95, thumpGain: 0.55, body: [[180, 1], [420, 0.6], [910, 0.3]], bodyQ: 6, hiss: 0.12, creakChance: 0.35 },
  tile: { cutoff: 5200, thump: 150, thumpGain: 0.3, body: [[1900, 0.6], [3400, 0.5]], bodyQ: 9, hiss: 0.3 },
  stone: { cutoff: 2600, thump: 120, thumpGain: 0.45, body: [[260, 0.7], [700, 0.4]], bodyQ: 3, hiss: 0.18, grit: 0.4 },
  brick: { cutoff: 2200, thump: 115, thumpGain: 0.45, body: [[240, 0.7], [640, 0.4]], bodyQ: 3, hiss: 0.15, grit: 0.3 },
  metal: { cutoff: 4200, thump: 110, thumpGain: 0.35, body: [[430, 0.6], [1150, 0.5]], bodyQ: 14, hiss: 0.15, ring: [523, 1310, 2390, 3870] },
  dirt: { cutoff: 900, thump: 80, thumpGain: 0.5, body: [[160, 0.6]], bodyQ: 2, hiss: 0.1, grit: 0.25 },
  grass: { cutoff: 700, thump: 75, thumpGain: 0.4, body: [[150, 0.5]], bodyQ: 2, hiss: 0.05, rustle: true },
};

export async function renderFootstep(
  sampleRate: number,
  material: FootstepMaterial,
  variant: number,
  running: boolean,
): Promise<AudioBuffer> {
  const profile = FOOTSTEP_PROFILES[material] ?? FOOTSTEP_PROFILES.wood;
  const shift = 0.86 + (variant % FOOTSTEP_VARIANTS) * 0.09 + rand(-0.03, 0.03);
  const boost = running ? 1.35 : 1;
  const toeDelay = running ? rand(0.022, 0.035) : rand(0.05, 0.08);
  const ctx = createOffline(sampleRate, 0.55);
  const noise = noiseBuffer(ctx, 0.6, 'pink');
  const body = resonator(ctx, profile.body.map(([f, g]) => [f * shift, g]), profile.bodyQ);

  // Talón: golpe seco + cuerpo del suelo.
  noiseBurst(ctx, noise, { duration: 0.05, gain: 0.7 * boost, type: 'lowpass', frequency: profile.cutoff * shift, dest: body });
  noiseBurst(ctx, noise, { duration: 0.035, gain: 0.45 * boost, type: 'lowpass', frequency: profile.cutoff * shift });
  tone(ctx, { frequency: profile.thump * shift, endFrequency: profile.thump * shift * 0.6, duration: 0.11, gain: profile.thumpGain * boost, attack: 0.002 });
  // Punta: más corta y suave.
  noiseBurst(ctx, noise, { at: toeDelay, duration: 0.03, gain: 0.35 * boost, type: 'lowpass', frequency: profile.cutoff * shift * 1.2, dest: body });
  // Roce de suela.
  noiseBurst(ctx, noise, { at: toeDelay * 0.5, duration: running ? 0.06 : 0.1, gain: profile.hiss * boost, type: 'bandpass', frequency: 3200 * shift, q: 0.8, attack: 0.02 });

  if (profile.grit) {
    const grit = crackleSignal(sampleRate, 0.12, (t) => 900 * Math.exp(-t * 25), (t) => profile.grit! * Math.exp(-t * 18));
    playSignal(ctx, grit, 0.004, filtered(ctx, 'highpass', 2500), boost);
  }
  if (profile.ring) {
    ring(ctx, 0.002, profile.ring.map((f) => f * shift), running ? 0.25 : 0.38, 0.09 * boost);
  }
  if (profile.rustle) {
    const rustle = crackleSignal(sampleRate, 0.25, (t) => 2200 * Math.exp(-t * 9), (t) => 0.35 * Math.exp(-t * 7));
    playSignal(ctx, rustle, 0.0, filtered(ctx, 'bandpass', 3800, 0.6), boost);
    noiseBurst(ctx, noise, { duration: 0.2, gain: 0.12 * boost, type: 'bandpass', frequency: 2400, q: 0.5, attack: 0.03 });
  }
  if (profile.creakChance && variant === 3 && !running) {
    const creak = creakSignal(sampleRate, 0.22, (t) => 210 + t * 300, (t) => 0.5 * Math.sin(Math.PI * Math.min(1, t / 0.22)));
    playSignal(ctx, creak, 0.04, resonator(ctx, [[720, 1], [1460, 0.6]], 9), 0.5);
  }
  return normalize(await ctx.startRendering(), running ? 0.9 : 0.78);
}

// ---------------------------------------------------------------------------
// Puertas
// ---------------------------------------------------------------------------

function latchClicks(ctx: Ctx, noise: AudioBuffer, at: number, gain: number, metal = false): void {
  // Picaporte: resorte + pestillo que entra/sale.
  noiseBurst(ctx, noise, { at, duration: 0.012, gain, type: 'highpass', frequency: 2800 });
  ring(ctx, at, metal ? [2300, 3560, 5100] : [2900, 4300], 0.08, gain * 0.12);
  noiseBurst(ctx, noise, { at: at + rand(0.06, 0.1), duration: 0.018, gain: gain * 0.8, type: 'bandpass', frequency: 1900, q: 3 });
  tone(ctx, { at: at + 0.005, frequency: 640, endFrequency: 420, duration: 0.05, gain: gain * 0.08 });
}

async function renderDoorOpen(sampleRate: number, metal: boolean): Promise<AudioBuffer> {
  const duration = metal ? 1.8 : 1.6;
  const ctx = createOffline(sampleRate, duration + 0.4);
  const noise = noiseBuffer(ctx, 2, 'pink');
  latchClicks(ctx, noise, 0.02, 0.8, metal);

  // Bisagra: stick-slip con tono que sube y amplitud a tirones.
  const start = 0.2;
  const base = metal ? rand(330, 420) : rand(150, 210);
  const rise = metal ? rand(260, 420) : rand(120, 260);
  const wobble = rand(2.5, 5);
  const creak = creakSignal(
    sampleRate,
    duration - start,
    (t) => base + rise * Math.sin(Math.min(1, t / (duration - start)) * Math.PI * 0.8) + 25 * Math.sin(t * wobble * 6.28),
    (t) => {
      const x = t / (duration - start);
      const envelope = Math.min(1, x * 5) * Math.pow(1 - x, 0.6);
      return envelope * (0.55 + 0.45 * Math.abs(Math.sin(t * wobble * 3.1)));
    },
    metal ? 0.08 : 0.22,
  );
  const hinge = resonator(
    ctx,
    metal ? [[880, 1], [1960, 0.8], [3420, 0.5], [5200, 0.25]] : [[560, 1], [1180, 0.7], [2250, 0.35], [3600, 0.15]],
    metal ? 16 : 10,
  );
  playSignal(ctx, creak, start, hinge, 0.9);

  // Aire que mueve la hoja y cuerpo de la puerta.
  noiseBurst(ctx, noise, { at: start, duration: duration * 0.8, gain: 0.08, type: 'lowpass', frequency: 500, endFrequency: 250, attack: 0.3 });
  noiseBurst(ctx, noise, { at: 0.03, duration: 0.15, gain: 0.25, type: 'lowpass', frequency: metal ? 700 : 300, dest: resonator(ctx, metal ? [[140, 1], [380, 0.6]] : [[110, 1], [260, 0.5]], 5) });
  if (metal) {
    ring(ctx, duration * 0.7, [190, 470, 1130], 0.9, 0.05);
  }
  return normalize(await ctx.startRendering(), 0.78);
}

async function renderDoorClose(sampleRate: number, metal: boolean): Promise<AudioBuffer> {
  const duration = metal ? 1.6 : 1.0;
  const ctx = createOffline(sampleRate, duration);
  const noise = noiseBuffer(ctx, 1.2, 'pink');
  // Barrido de aire de la hoja cerrándose.
  noiseBurst(ctx, noise, { duration: 0.22, gain: 0.18, type: 'bandpass', frequency: 300, endFrequency: 900, q: 0.7, attack: 0.18 });
  const hit = 0.2;
  // Golpe contra el marco: cuerpo resonante + subgrave.
  const frame = resonator(ctx, metal ? [[160, 1], [420, 0.8], [1010, 0.6], [2380, 0.4]] : [[95, 1], [210, 0.8], [470, 0.5], [980, 0.25]], metal ? 18 : 7);
  noiseBurst(ctx, noise, { at: hit, duration: 0.08, gain: 1, type: 'lowpass', frequency: metal ? 3000 : 1200, dest: frame });
  noiseBurst(ctx, noise, { at: hit, duration: 0.04, gain: 0.6, type: 'lowpass', frequency: metal ? 4000 : 1800 });
  tone(ctx, { at: hit, frequency: metal ? 75 : 62, endFrequency: 38, duration: 0.35, gain: 0.8, attack: 0.002 });
  latchClicks(ctx, noise, hit + 0.015, 0.6, metal);
  // Traqueteo de la hoja en el marco.
  for (let i = 0; i < 4; i += 1) {
    noiseBurst(ctx, noise, { at: hit + 0.06 + i * rand(0.035, 0.055), duration: 0.015, gain: 0.25 / (i + 1), type: 'bandpass', frequency: metal ? 2600 : 1500, q: 2 });
  }
  if (metal) {
    ring(ctx, hit, [212, 538, 1290, 2710, 4180], 1.2, 0.09);
  }
  return normalize(await ctx.startRendering(), 0.9);
}

async function renderDoorLocked(sampleRate: number): Promise<AudioBuffer> {
  const ctx = createOffline(sampleRate, 0.9);
  const noise = noiseBuffer(ctx, 1, 'pink');
  const leaf = resonator(ctx, [[120, 1], [300, 0.6], [760, 0.3]], 6);
  // Dos o tres sacudidas del picaporte contra el pestillo.
  const shakes = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < shakes; i += 1) {
    const at = 0.02 + i * rand(0.18, 0.24);
    noiseBurst(ctx, noise, { at, duration: 0.014, gain: 0.8, type: 'highpass', frequency: 2400 });
    ring(ctx, at, [2100, 3300], 0.07, 0.1);
    noiseBurst(ctx, noise, { at: at + 0.02, duration: 0.05, gain: 0.5, type: 'lowpass', frequency: 900, dest: leaf });
    noiseBurst(ctx, noise, { at: at + 0.09, duration: 0.012, gain: 0.45, type: 'bandpass', frequency: 1700, q: 3 });
  }
  return normalize(await ctx.startRendering(), 0.8);
}

async function renderPadlockUnlock(sampleRate: number): Promise<AudioBuffer> {
  // Sincronizado con la animación: llave entrando (0–0.3 s), giro (0.4),
  // grillete que salta (0.6) y candado que cae al suelo (~1.1 s).
  const ctx = createOffline(sampleRate, 1.9);
  const noise = noiseBuffer(ctx, 2, 'pink');
  const scrape = crackleSignal(sampleRate, 0.3, (t) => 1800 + 2500 * t, () => 0.35);
  playSignal(ctx, scrape, 0.02, filtered(ctx, 'bandpass', 4200, 1.2), 1);
  noiseBurst(ctx, noise, { at: 0.02, duration: 0.3, gain: 0.12, type: 'bandpass', frequency: 3600, q: 2, attack: 0.05 });
  const lockBody = resonator(ctx, [[1650, 1], [2900, 0.7], [4700, 0.4]], 14);
  noiseBurst(ctx, noise, { at: 0.38, duration: 0.012, gain: 0.9, type: 'highpass', frequency: 2400, dest: lockBody });
  noiseBurst(ctx, noise, { at: 0.47, duration: 0.01, gain: 0.7, type: 'highpass', frequency: 2600, dest: lockBody });
  // Grillete: chasquido de muelle con un "tink".
  noiseBurst(ctx, noise, { at: 0.62, duration: 0.01, gain: 1, type: 'highpass', frequency: 3000 });
  ring(ctx, 0.62, [3150, 4890, 7100], 0.35, 0.12);
  // Caída: golpe de hierro contra el suelo, rebote y tintineo.
  for (const [at, gain] of [[1.1, 1], [1.24, 0.45], [1.32, 0.2]] as Array<[number, number]>) {
    noiseBurst(ctx, noise, { at, duration: 0.03, gain, type: 'lowpass', frequency: 3500, dest: resonator(ctx, [[180, 1], [420, 0.6]], 6) });
    ring(ctx, at, [1180, 2730, 4310], 0.45 * gain + 0.1, 0.12 * gain);
  }
  tone(ctx, { at: 1.1, frequency: 110, endFrequency: 60, duration: 0.15, gain: 0.35, attack: 0.002 });
  return normalize(await ctx.startRendering(), 0.85);
}

async function renderEat(sampleRate: number): Promise<AudioBuffer> {
  // Mordisco crujiente + masticar + un "mmm" corto de alivio.
  const ctx = createOffline(sampleRate, 1.5);
  const noise = noiseBuffer(ctx, 1.6, 'pink');
  const bite = crackleSignal(sampleRate, 0.12, () => 2600, () => 0.7);
  playSignal(ctx, bite, 0.02, filtered(ctx, 'bandpass', 2400, 0.8), 1);
  noiseBurst(ctx, noise, { at: 0.02, duration: 0.07, gain: 0.5, type: 'lowpass', frequency: 1800 });
  for (let i = 0; i < 4; i += 1) {
    const at = 0.25 + i * rand(0.16, 0.2);
    noiseBurst(ctx, noise, { at, duration: 0.09, gain: 0.25, type: 'lowpass', frequency: 700, endFrequency: 300 });
    const crunch = crackleSignal(sampleRate, 0.06, () => 900, () => 0.25);
    playSignal(ctx, crunch, at, filtered(ctx, 'bandpass', 1800, 1), 1);
  }
  tone(ctx, { at: 1.0, frequency: 150, endFrequency: 125, duration: 0.4, gain: 0.12, attack: 0.05, vibrato: { rate: 5, depth: 3 }, dest: resonator(ctx, [[500, 1], [1100, 0.4]], 3) });
  noiseBurst(ctx, noise, { at: 1.0, duration: 0.35, gain: 0.05, type: 'bandpass', frequency: 600, q: 2, attack: 0.05 });
  return normalize(await ctx.startRendering(), 0.8);
}

async function renderLatch(sampleRate: number): Promise<AudioBuffer> {
  const ctx = createOffline(sampleRate, 0.4);
  const noise = noiseBuffer(ctx, 0.4);
  latchClicks(ctx, noise, 0.01, 0.8);
  return normalize(await ctx.startRendering(), 0.85);
}

// ---------------------------------------------------------------------------
// Objetos
// ---------------------------------------------------------------------------

async function renderFlashClick(sampleRate: number): Promise<AudioBuffer> {
  const ctx = createOffline(sampleRate, 0.25);
  const noise = noiseBuffer(ctx, 0.3);
  const shell = resonator(ctx, [[1800, 1], [3400, 0.5]], 7);
  noiseBurst(ctx, noise, { at: 0.005, duration: 0.006, gain: 1, type: 'highpass', frequency: 3000, dest: shell });
  noiseBurst(ctx, noise, { at: 0.005, duration: 0.004, gain: 0.6, type: 'highpass', frequency: 5000 });
  noiseBurst(ctx, noise, { at: 0.045, duration: 0.008, gain: 0.5, type: 'highpass', frequency: 2500, dest: shell });
  tone(ctx, { at: 0.006, frequency: 260, endFrequency: 140, duration: 0.04, gain: 0.12 });
  return normalize(await ctx.startRendering(), 0.75);
}

async function renderPaper(sampleRate: number, duration: number, gain: number): Promise<AudioBuffer> {
  const ctx = createOffline(sampleRate, duration + 0.15);
  const noise = noiseBuffer(ctx, 0.8, 'pink');
  const crinkle = crackleSignal(sampleRate, duration, (t) => 900 * Math.sin(Math.PI * Math.min(1, t / duration)) + 80, () => gain);
  playSignal(ctx, crinkle, 0, filtered(ctx, 'highpass', 2200), 1);
  const swish = ctx.createBufferSource();
  swish.buffer = noise;
  swish.loop = true;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, 0);
  env.gain.linearRampToValueAtTime(gain * 0.35, duration * 0.35);
  env.gain.linearRampToValueAtTime(0.0001, duration);
  swish.connect(filtered(ctx, 'bandpass', 4200, 0.6, env));
  env.connect(ctx.destination);
  swish.start(0);
  swish.stop(duration + 0.05);
  return normalize(await ctx.startRendering(), 0.75);
}

async function renderBurn(sampleRate: number): Promise<AudioBuffer> {
  // Acompaña la animación de 1.6 s del afiche ardiendo.
  const duration = 2.3;
  const ctx = createOffline(sampleRate, duration);
  const noise = noiseBuffer(ctx, 2.4, 'pink');
  // Cerilla: raspado + chispazo.
  noiseBurst(ctx, noise, { duration: 0.12, gain: 0.5, type: 'bandpass', frequency: 3600, endFrequency: 1800, q: 1.2, attack: 0.02 });
  const strike = crackleSignal(sampleRate, 0.12, () => 2500, () => 0.4);
  playSignal(ctx, strike, 0, filtered(ctx, 'highpass', 3000), 1);
  // Ignición (whoosh grave que se abre).
  noiseBurst(ctx, noise, { at: 0.1, duration: 0.6, gain: 0.8, type: 'lowpass', frequency: 250, endFrequency: 2400, attack: 0.08 });
  // Rugido de llama sostenido.
  const roar = ctx.createBufferSource();
  roar.buffer = noise;
  roar.loop = true;
  const roarGain = ctx.createGain();
  roarGain.gain.setValueAtTime(0.0001, 0.2);
  roarGain.gain.linearRampToValueAtTime(0.32, 0.5);
  gusts(roarGain.gain, duration, 0.18, 0.34, 0.12);
  roarGain.gain.linearRampToValueAtTime(0.0001, duration);
  roar.connect(filtered(ctx, 'bandpass', 700, 0.8, roarGain));
  roarGain.connect(ctx.destination);
  roar.start(0.2);
  roar.stop(duration);
  // Crepitar del papel y chasquidos.
  const crackle = crackleSignal(
    sampleRate,
    duration - 0.2,
    (t) => 140 + 260 * Math.sin(Math.PI * Math.min(1, t / 1.8)),
    (t) => 0.7 * (t < 1.7 ? 1 : Math.max(0, 1 - (t - 1.7) / 0.4)),
  );
  playSignal(ctx, crackle, 0.2, filtered(ctx, 'highpass', 1400), 1);
  for (let i = 0; i < 6; i += 1) {
    const at = rand(0.4, 1.8);
    noiseBurst(ctx, noise, { at, duration: 0.02, gain: 0.5, type: 'bandpass', frequency: rand(1800, 4000), q: 4 });
  }
  return normalize(await ctx.startRendering(), 0.85);
}

async function renderKeyPickup(sampleRate: number): Promise<AudioBuffer> {
  const ctx = createOffline(sampleRate, 1.0);
  const noise = noiseBuffer(ctx, 0.5);
  const count = 3 + Math.floor(Math.random() * 3);
  let at = 0.02;
  for (let i = 0; i < count; i += 1) {
    const base = rand(1900, 3300);
    ring(ctx, at, [base, base * 2.76, base * 5.4], rand(0.25, 0.45), rand(0.18, 0.3));
    noiseBurst(ctx, noise, { at, duration: 0.008, gain: 0.4, type: 'highpass', frequency: 5000 });
    at += rand(0.04, 0.13);
  }
  return normalize(await ctx.startRendering(), 0.8);
}

// ---------------------------------------------------------------------------
// Amenaza
// ---------------------------------------------------------------------------

function stringCluster(ctx: Ctx, at: number, duration: number, notes: number[], gain: number, tremolo = 0, dest: AudioNode = ctx.destination): void {
  const bus = ctx.createGain();
  bus.gain.setValueAtTime(0.0001, at);
  bus.gain.exponentialRampToValueAtTime(gain, at + duration * 0.6);
  bus.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(500, at);
  filter.frequency.exponentialRampToValueAtTime(3200, at + duration * 0.7);
  filter.Q.value = 1.5;
  bus.connect(filter);
  filter.connect(dest);
  if (tremolo > 0) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = tremolo;
    const depth = ctx.createGain();
    depth.gain.value = gain * 0.5;
    lfo.connect(depth);
    depth.connect(bus.gain);
    lfo.start(at);
    lfo.stop(at + duration);
  }
  for (const note of notes) {
    for (const detune of [-6, 0, 7]) {
      const oscillator = ctx.createOscillator();
      oscillator.type = 'sawtooth';
      oscillator.frequency.value = note;
      oscillator.detune.value = detune + rand(-3, 3);
      const voice = ctx.createGain();
      voice.gain.value = 0.12;
      oscillator.connect(voice);
      voice.connect(bus);
      oscillator.start(at);
      oscillator.stop(at + duration);
    }
  }
}

async function renderStinger(sampleRate: number): Promise<AudioBuffer> {
  const duration = 3.0;
  const ctx = createOffline(sampleRate, duration, 2);
  const noise = noiseBuffer(ctx, 3, 'pink');
  // Cuerdas disonantes que crecen (cluster de semitonos, trémolo nervioso).
  stringCluster(ctx, 0, 1.25, [174.6, 185, 196, 261.6, 277.2], 0.5, 11, out(ctx, -0.3));
  stringCluster(ctx, 0.05, 1.2, [349.2, 370, 523.3], 0.3, 13, out(ctx, 0.35));
  // Golpe: boom + chapa raspada.
  const hit = 1.05;
  tone(ctx, { at: hit, frequency: 62, endFrequency: 28, duration: 1.6, gain: 0.9, attack: 0.003 });
  noiseBurst(ctx, noise, { at: hit, duration: 0.9, gain: 0.5, type: 'lowpass', frequency: 1400, endFrequency: 120 });
  noiseBurst(ctx, noise, { at: hit, duration: 1.4, gain: 0.25, type: 'bandpass', frequency: 5200, endFrequency: 1600, q: 3, dest: out(ctx, 0.5) });
  ring(ctx, hit, [151, 389, 937, 1720], 1.8, 0.08, out(ctx, -0.4));
  return normalize(await ctx.startRendering(), 0.88);
}

async function renderAttackWarn(sampleRate: number): Promise<AudioBuffer> {
  const duration = 1.2;
  const ctx = createOffline(sampleRate, duration);
  const noise = noiseBuffer(ctx, 1.4, 'pink');
  // Gruñido: diente de sierra grave modulado por ruido, a través de formantes.
  const formants = resonator(ctx, [[420, 1], [880, 0.7], [2300, 0.25]], 5);
  const growl = ctx.createOscillator();
  growl.type = 'sawtooth';
  growl.frequency.setValueAtTime(rand(70, 85), 0);
  growl.frequency.linearRampToValueAtTime(rand(115, 140), duration * 0.8);
  const rasp = ctx.createBufferSource();
  rasp.buffer = noise;
  rasp.loop = true;
  const raspDepth = ctx.createGain();
  raspDepth.gain.value = 22;
  rasp.connect(filtered(ctx, 'lowpass', 60, 0.7, raspDepth));
  raspDepth.connect(growl.frequency);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, 0);
  env.gain.exponentialRampToValueAtTime(0.7, 0.35);
  env.gain.linearRampToValueAtTime(0.9, duration * 0.8);
  env.gain.exponentialRampToValueAtTime(0.0001, duration);
  growl.connect(env);
  env.connect(formants);
  growl.start(0);
  growl.stop(duration);
  rasp.start(0);
  rasp.stop(duration);
  noiseBurst(ctx, noise, { duration: duration * 0.9, gain: 0.3, type: 'bandpass', frequency: 900, endFrequency: 2600, q: 1.2, attack: 0.4 });
  return normalize(await ctx.startRendering(), 0.85);
}

async function renderEndingStinger(sampleRate: number): Promise<AudioBuffer> {
  const duration = 5.0;
  const ctx = createOffline(sampleRate, duration, 2);
  // Acorde que por fin "resuelve" (re mayor añadido), con campanas lejanas.
  for (const [frequency, pan] of [[73.4, 0], [146.8, -0.3], [220, 0.3], [293.7, -0.2], [370, 0.25], [440, 0]] as Array<[number, number]>) {
    tone(ctx, { frequency, duration: 4.6, gain: 0.16, attack: 1.8, vibrato: { rate: 4.5, depth: frequency * 0.003 }, dest: out(ctx, pan) });
  }
  for (const [at, base, pan] of [[0.8, 587, -0.5], [1.6, 740, 0.5], [2.5, 880, 0]] as Array<[number, number, number]>) {
    ring(ctx, at, [base, base * 2.01, base * 2.76, base * 4.1], 2.2, 0.08, out(ctx, pan));
  }
  return normalize(await ctx.startRendering(), 0.8);
}

async function renderHeartbeat(sampleRate: number): Promise<AudioBuffer> {
  const ctx = createOffline(sampleRate, 1.2);
  const noise = noiseBuffer(ctx, 0.6, 'brown');
  const chest = resonator(ctx, [[48, 1], [95, 0.6]], 3);
  for (const [at, gain] of [[0, 1], [0.28, 0.7]] as Array<[number, number]>) {
    tone(ctx, { at, frequency: 58, endFrequency: 34, duration: 0.2, gain: 0.9 * gain, attack: 0.006 });
    noiseBurst(ctx, noise, { at, duration: 0.12, gain: 0.8 * gain, type: 'lowpass', frequency: 160, dest: chest });
  }
  return normalize(await ctx.startRendering(), 0.85);
}

async function renderBreath(sampleRate: number): Promise<AudioBuffer> {
  const duration = 3.2;
  const ctx = createOffline(sampleRate, duration);
  const noise = noiseBuffer(ctx, 1.6, 'pink');
  // Respiración húmeda y ronca: ruido por formantes + carraspeo (AM a 30–45 Hz).
  const formants = resonator(ctx, [[rand(550, 700), 1], [rand(1100, 1300), 0.7], [2600, 0.3]], 4);
  const source = ctx.createBufferSource();
  source.buffer = noise;
  source.loop = true;
  const env = ctx.createGain();
  const inhale = rand(0.8, 1.1);
  env.gain.setValueAtTime(0.0001, 0);
  env.gain.linearRampToValueAtTime(0.35, inhale * 0.7);
  env.gain.linearRampToValueAtTime(0.04, inhale);
  env.gain.linearRampToValueAtTime(0.5, inhale + 0.35);
  env.gain.linearRampToValueAtTime(0.25, inhale + 1.1);
  env.gain.linearRampToValueAtTime(0.0001, inhale + 1.9);
  const rasp = ctx.createGain();
  rasp.gain.value = 0.6;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = rand(30, 45);
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 0.4;
  lfo.connect(lfoDepth);
  lfoDepth.connect(rasp.gain);
  source.connect(env);
  env.connect(rasp);
  rasp.connect(formants);
  source.start(0);
  source.stop(duration);
  lfo.start(0);
  lfo.stop(duration);
  return normalize(await ctx.startRendering(), 0.7);
}

async function renderStalkerStep(sampleRate: number): Promise<AudioBuffer> {
  const ctx = createOffline(sampleRate, 0.9);
  const noise = noiseBuffer(ctx, 1, 'pink');
  const floor = resonator(ctx, [[85, 1], [190, 0.7], [430, 0.35]], 5);
  // Pisada pesada (descalza), arrastre del pie y algún crujido de hueso.
  tone(ctx, { frequency: 55, endFrequency: 32, duration: 0.45, gain: 1, attack: 0.004 });
  noiseBurst(ctx, noise, { duration: 0.1, gain: 0.9, type: 'lowpass', frequency: 700, dest: floor });
  noiseBurst(ctx, noise, { at: 0.08, duration: rand(0.25, 0.4), gain: 0.18, type: 'bandpass', frequency: 1500, endFrequency: 700, q: 0.8, attack: 0.08 });
  if (Math.random() < 0.6) {
    const crack = crackleSignal(sampleRate, 0.06, () => 600, () => 0.5);
    playSignal(ctx, crack, rand(0.02, 0.08), filtered(ctx, 'bandpass', 2200, 1.5), 1);
  }
  return normalize(await ctx.startRendering(), 0.9);
}

async function renderHurt(sampleRate: number): Promise<AudioBuffer> {
  const duration = 1.6;
  const ctx = createOffline(sampleRate, duration, 2);
  const noise = noiseBuffer(ctx, 1.6, 'pink');
  // Impacto sordo en el cuerpo + pitido de oído.
  tone(ctx, { frequency: 90, endFrequency: 36, duration: 0.35, gain: 1, attack: 0.002 });
  noiseBurst(ctx, noise, { duration: 0.12, gain: 0.8, type: 'lowpass', frequency: 1800, endFrequency: 200 });
  noiseBurst(ctx, noise, { at: 0.005, duration: 0.03, gain: 0.5, type: 'highpass', frequency: 2500 });
  tone(ctx, { at: 0.05, frequency: rand(3300, 3900), duration: duration - 0.1, gain: 0.06, attack: 0.08, dest: out(ctx, rand(-0.3, 0.3)) });
  return normalize(await ctx.startRendering(), 0.9);
}

// ---------------------------------------------------------------------------
// Ambientes (estéreo, en bucle)
// ---------------------------------------------------------------------------

function distantCreak(ctx: Ctx, sampleRate: number, at: number, pan: number, gain: number): void {
  const length = rand(0.4, 0.9);
  const creak = creakSignal(sampleRate, length, (t) => rand(120, 160) + t * rand(60, 160), (t) => Math.sin(Math.PI * (t / length)) * 0.6);
  const body = resonator(ctx, [[480, 1], [1050, 0.5]], 8, out(ctx, pan));
  playSignal(ctx, creak, at, body, gain);
}

async function renderHouseAmbience(sampleRate: number): Promise<AudioBuffer> {
  const length = 20;
  const total = length + LOOP_XFADE;
  const ctx = createOffline(sampleRate, total, 2);
  // Viento contra la fachada, una capa por canal (estéreo ancho).
  for (const pan of [-0.8, 0.8]) {
    const wind = ctx.createBufferSource();
    wind.buffer = noiseBuffer(ctx, total, 'brown');
    const gain = ctx.createGain();
    gusts(gain.gain, total, 0.05, 0.22, 1.2);
    const filter = filtered(ctx, 'lowpass', 380, 0.9, gain);
    wind.connect(filter);
    gain.connect(out(ctx, pan));
    wind.start(0);
    const whistle = ctx.createBufferSource();
    whistle.buffer = noiseBuffer(ctx, total, 'pink');
    const whistleGain = ctx.createGain();
    gusts(whistleGain.gain, total, 0.0, 0.03, 1.6);
    whistle.connect(filtered(ctx, 'bandpass', rand(900, 1400), 12, whistleGain));
    whistleGain.connect(out(ctx, pan * 0.6));
    whistle.start(0);
  }
  // Zumbido eléctrico de la casa (50 Hz y armónicos), muy bajo.
  for (const [frequency, gain] of [[50, 0.05], [100, 0.025], [150, 0.012]] as Array<[number, number]>) {
    tone(ctx, { frequency, duration: total, gain, attack: 1.5 });
  }
  // Reloj de pared en otra sala.
  const noise = noiseBuffer(ctx, 0.3);
  const clock = resonator(ctx, [[1900, 1], [3100, 0.6]], 18, out(ctx, -0.45));
  for (let t = 0.3; t < length; t += 1.0) {
    noiseBurst(ctx, noise, { at: t, duration: 0.008, gain: (t | 0) % 2 === 0 ? 0.07 : 0.05, type: 'highpass', frequency: 1500, dest: clock });
  }
  // Crujidos lejanos de la estructura y un golpe en el piso de arriba.
  for (const at of [2.4, 7.9, 12.6, 16.8]) {
    distantCreak(ctx, sampleRate, at + rand(-0.4, 0.4), rand(-0.9, 0.9), rand(0.08, 0.16));
  }
  tone(ctx, { at: 10.2, frequency: 70, endFrequency: 40, duration: 0.5, gain: 0.12, attack: 0.004, dest: out(ctx, 0.3) });
  // Trueno lejano.
  noiseBurst(ctx, noiseBuffer(ctx, 4, 'brown'), { at: 14.0, duration: 3.5, gain: 0.25, type: 'lowpass', frequency: 220, endFrequency: 70, attack: 0.6 });
  return normalize(loopify(await ctx.startRendering(), length), 0.7);
}

async function renderBasementAmbience(sampleRate: number): Promise<AudioBuffer> {
  const length = 20;
  const total = length + LOOP_XFADE;
  const ctx = createOffline(sampleRate, total, 2);
  // Caldera: zumbido grave que late + ronroneo.
  const hum = ctx.createGain();
  gusts(hum.gain, total, 0.1, 0.18, 2.2);
  hum.connect(ctx.destination);
  for (const [frequency, gain] of [[46, 0.6], [92, 0.25], [138, 0.12], [47.3, 0.4]] as Array<[number, number]>) {
    const oscillator = ctx.createOscillator();
    oscillator.frequency.value = frequency;
    const level = ctx.createGain();
    level.gain.value = gain;
    oscillator.connect(level);
    level.connect(hum);
    oscillator.start(0);
  }
  const rumble = ctx.createBufferSource();
  rumble.buffer = noiseBuffer(ctx, total, 'brown');
  const rumbleGain = ctx.createGain();
  rumbleGain.gain.value = 0.16;
  rumble.connect(filtered(ctx, 'lowpass', 160, 0.7, rumbleGain));
  rumbleGain.connect(ctx.destination);
  rumble.start(0);
  // Goteo con cola (cada gota: blip con caída de tono).
  for (let t = 0.6; t < length; t += rand(1.1, 2.6)) {
    const pan = rand(-0.8, 0.8);
    tone(ctx, { at: t, frequency: rand(1300, 1900), endFrequency: rand(600, 900), duration: 0.09, gain: 0.12, attack: 0.002, dest: out(ctx, pan) });
    tone(ctx, { at: t + 0.01, frequency: rand(2500, 3200), endFrequency: 1500, duration: 0.05, gain: 0.04, attack: 0.002, dest: out(ctx, pan) });
  }
  // Golpes de tubería (metal resonante) y un gemido lejano.
  const noise = noiseBuffer(ctx, 0.5, 'pink');
  for (const at of [3.7, 11.3, 17.2]) {
    const pan = rand(-0.9, 0.9);
    const pipe = resonator(ctx, [[310, 1], [760, 0.7], [1480, 0.4]], 22, out(ctx, pan));
    for (let k = 0; k < 3; k += 1) {
      noiseBurst(ctx, noise, { at: at + k * rand(0.12, 0.2), duration: 0.02, gain: 0.35 / (k + 1), type: 'lowpass', frequency: 2500, dest: pipe });
    }
  }
  tone(ctx, { at: 8.4, frequency: 180, endFrequency: 120, duration: 2.6, gain: 0.05, attack: 0.9, type: 'triangle', vibrato: { rate: 5, depth: 6 }, dest: out(ctx, -0.6) });
  return normalize(loopify(await ctx.startRendering(), length), 0.55);
}

async function renderOutdoorAmbience(sampleRate: number): Promise<AudioBuffer> {
  const length = 20;
  const total = length + LOOP_XFADE;
  const ctx = createOffline(sampleRate, total, 2);
  // Viento entre los árboles y hojas.
  for (const pan of [-0.7, 0.7]) {
    const wind = ctx.createBufferSource();
    wind.buffer = noiseBuffer(ctx, total, 'pink');
    const gain = ctx.createGain();
    gusts(gain.gain, total, 0.04, 0.2, 1.4);
    wind.connect(filtered(ctx, 'bandpass', rand(500, 700), 0.6, gain));
    gain.connect(out(ctx, pan));
    wind.start(0);
    const leaves = crackleSignal(sampleRate, total, (t) => 300 + 260 * Math.sin(t * 0.7 + pan), () => 0.06);
    playSignal(ctx, leaves, 0, filtered(ctx, 'highpass', 3500, 0.7, out(ctx, pan)), 1);
  }
  // Grillos: chirridos a ~4.6 kHz en grupos de 3 pulsos.
  for (const [pan, carrier, period] of [[-0.6, 4600, 0.62], [0.5, 4950, 0.81], [0.1, 4300, 1.1]] as Array<[number, number, number]>) {
    for (let t = rand(0, 0.5); t < length; t += period * rand(0.9, 1.1)) {
      if (Math.random() < 0.15) {
        continue;
      }
      for (let p = 0; p < 3; p += 1) {
        tone(ctx, { at: t + p * 0.035, frequency: carrier, duration: 0.025, gain: 0.03, attack: 0.004, dest: out(ctx, pan) });
      }
    }
  }
  // Búho lejano.
  for (const at of [6.5, 15.2]) {
    tone(ctx, { at, frequency: 395, endFrequency: 360, duration: 0.5, gain: 0.06, attack: 0.08, vibrato: { rate: 6, depth: 4 }, dest: out(ctx, -0.5) });
    tone(ctx, { at: at + 0.75, frequency: 380, endFrequency: 330, duration: 0.8, gain: 0.05, attack: 0.1, vibrato: { rate: 6, depth: 4 }, dest: out(ctx, -0.5) });
  }
  // Valla que cruje con el viento.
  distantCreak(ctx, sampleRate, 11.0, 0.8, 0.12);
  return normalize(loopify(await ctx.startRendering(), length), 0.7);
}

// ---------------------------------------------------------------------------
// Música adaptativa (3 capas)
// ---------------------------------------------------------------------------

async function renderMusicLayer1(sampleRate: number): Promise<AudioBuffer> {
  // Pad grave que respira (re menor con 2ª menor), filtro que se abre y cierra.
  const length = 16;
  const total = length + LOOP_XFADE;
  const ctx = createOffline(sampleRate, total, 2);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 2;
  filter.frequency.setValueAtTime(260, 0);
  filter.frequency.linearRampToValueAtTime(700, length / 2);
  filter.frequency.linearRampToValueAtTime(260, total);
  filter.connect(ctx.destination);
  for (const [frequency, pan] of [[36.7, 0], [73.4, -0.4], [110, 0.4], [116.5, -0.2], [146.8, 0.3]] as Array<[number, number]>) {
    for (const detune of [-5, 5]) {
      const oscillator = ctx.createOscillator();
      oscillator.type = 'sawtooth';
      oscillator.frequency.value = frequency;
      oscillator.detune.value = detune;
      const gain = ctx.createGain();
      gain.gain.value = frequency < 50 ? 0.12 : 0.05;
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan * (detune > 0 ? 1 : -1);
      oscillator.connect(gain);
      gain.connect(panner);
      panner.connect(filter);
      oscillator.start(0);
    }
  }
  const air = ctx.createBufferSource();
  air.buffer = noiseBuffer(ctx, total, 'pink');
  const airGain = ctx.createGain();
  gusts(airGain.gain, total, 0.01, 0.05, 2);
  air.connect(filtered(ctx, 'bandpass', 900, 3, airGain));
  airGain.connect(ctx.destination);
  air.start(0);
  return normalize(loopify(await ctx.startRendering(), length), 0.5);
}

async function renderMusicLayer2(sampleRate: number): Promise<AudioBuffer> {
  // Pulso: tambor grave a 60 bpm + tic metálico irregular (sospecha).
  const length = 16;
  const total = length + LOOP_XFADE;
  const ctx = createOffline(sampleRate, total, 2);
  const noise = noiseBuffer(ctx, 0.6, 'pink');
  const drum = resonator(ctx, [[55, 1], [110, 0.4]], 4);
  for (let i = 0; i < length; i += 1) {
    tone(ctx, { at: i + 0.05, frequency: 64, endFrequency: 40, duration: 0.5, gain: i % 4 === 0 ? 0.5 : 0.32, attack: 0.004 });
    noiseBurst(ctx, noise, { at: i + 0.05, duration: 0.1, gain: 0.3, type: 'lowpass', frequency: 300, dest: drum });
  }
  for (let i = 0; i < 22; i += 1) {
    const at = Math.random() * length;
    ring(ctx, at, [rand(2400, 3800), rand(5200, 6500)], 0.25, 0.05, out(ctx, rand(-0.8, 0.8)));
  }
  return normalize(loopify(await ctx.startRendering(), length), 0.6);
}

async function renderMusicLayer3(sampleRate: number): Promise<AudioBuffer> {
  // Persecución: cuerdas en trémolo disonante + golpes industriales.
  const length = 8;
  const total = length + LOOP_XFADE;
  const ctx = createOffline(sampleRate, total, 2);
  const noise = noiseBuffer(ctx, 1, 'pink');
  stringCluster(ctx, 0, total, [146.8, 155.6, 207.7, 220], 0.45, 12, out(ctx, -0.35));
  stringCluster(ctx, 0, total, [293.7, 311.1, 415.3], 0.3, 14, out(ctx, 0.35));
  for (let beat = 0; beat < length * 2; beat += 1) {
    const at = beat * 0.5;
    if (beat % 4 === 0 || beat % 4 === 3) {
      tone(ctx, { at, frequency: 70, endFrequency: 38, duration: 0.3, gain: 0.55, attack: 0.003 });
      noiseBurst(ctx, noise, { at, duration: 0.14, gain: 0.35, type: 'bandpass', frequency: 1200, q: 1.5 });
    }
    if (beat % 8 === 6) {
      ring(ctx, at, [187, 463, 1105, 2480], 0.6, 0.07, out(ctx, rand(-0.6, 0.6)));
    }
  }
  return normalize(loopify(await ctx.startRendering(), length), 0.62);
}

// ---------------------------------------------------------------------------
// Reverb (respuestas al impulso estéreo)
// ---------------------------------------------------------------------------

const REVERB_PROFILES: Record<
  ReverbPresetId,
  { seconds: number; damping: number; decay: number; reflections: number[]; predelay: number }
> = {
  small: { seconds: 0.8, damping: 5500, decay: 3.4, reflections: [0.007, 0.013, 0.019], predelay: 0.004 },
  hall: { seconds: 2.6, damping: 4200, decay: 2.3, reflections: [0.017, 0.029, 0.041], predelay: 0.012 },
  cave: { seconds: 4.0, damping: 1800, decay: 1.9, reflections: [0.035, 0.061, 0.089, 0.12], predelay: 0.02 },
  corridor: { seconds: 1.7, damping: 4800, decay: 2.5, reflections: [0.011, 0.045, 0.09, 0.135], predelay: 0.008 },
};

export async function renderReverbImpulse(sampleRate: number, id: ReverbPresetId): Promise<AudioBuffer> {
  const profile = REVERB_PROFILES[id];
  const length = Math.max(1, Math.ceil(sampleRate * profile.seconds));
  const buffer = new AudioBuffer({ length, numberOfChannels: 2, sampleRate });
  const alpha = 1 - Math.exp((-2 * Math.PI * profile.damping) / sampleRate);
  const pre = Math.floor(profile.predelay * sampleRate);
  for (let c = 0; c < 2; c += 1) {
    const data = buffer.getChannelData(c);
    let lowpassed = 0;
    for (let i = pre; i < length; i += 1) {
      const x = (i - pre) / (length - pre);
      const envelope = Math.pow(1 - x, profile.decay);
      lowpassed += alpha * (1 - x * 0.6) * ((Math.random() * 2 - 1) - lowpassed);
      data[i] = lowpassed * envelope;
    }
    for (const delay of profile.reflections) {
      const offset = pre + Math.floor(delay * sampleRate * (c === 0 ? 1 : 1.07));
      if (offset < length) {
        data[offset] += (c === 0 ? 0.7 : -0.6) * Math.exp(-delay * 8);
      }
    }
  }
  return normalize(buffer, 0.9);
}

// ---------------------------------------------------------------------------
// Entradas públicas
// ---------------------------------------------------------------------------

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
    case 'door_locked':
      return renderDoorLocked(sampleRate);
    case 'padlock_unlock':
      return renderPadlockUnlock(sampleRate);
    case 'latch':
      return renderLatch(sampleRate);
    case 'pickup_note':
      return renderPaper(sampleRate, 0.55, 0.45);
    case 'paper_turn':
      return renderPaper(sampleRate, 0.35, 0.3);
    case 'burn':
      return renderBurn(sampleRate);
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
    case 'hurt':
      return renderHurt(sampleRate);
    case 'eat':
      return renderEat(sampleRate);
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
    case 'outdoor':
      return renderOutdoorAmbience(sampleRate);
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
