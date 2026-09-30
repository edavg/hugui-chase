import {
  renderAmbience,
  renderFootstep,
  renderMusicLayer,
  renderOneShot,
  renderReverbImpulse,
  type OneShotId,
} from './audioSynth';
import type { AmbienceType, AudioConfig, FloorMaterial, ReverbType } from './config';
import type { RoomAudio } from './roomBuilder';

const MAX_VOICES = 24;
const MAX_DISTANCE = 14;
const STEP_GAIN = 0.5;
const RUN_STEP_GAIN = 0.7;
const SEND_GAIN = 0.5;
const MUSIC_SEND_GAIN = 0.15;
const AMBIENCE_FADE = 0.8;
const REVERB_RAMP = 0.4;
const MUSIC_RAMP = 1.5;
const VOLUME_RAMP = 0.1;
const MUTE_RAMP = 0.08;
const PAN_WIDTH = 0.8;
const STEP_RATE_MIN = 0.96;
const STEP_RATE_MAX = 1.06;
const REVERB_ORDER: ReverbType[] = ['small', 'hall', 'cave', 'corridor'];
const REVERB_WET: Record<ReverbType, number> = { small: 0.18, hall: 0.35, cave: 0.5, corridor: 0.3 };
const MUSIC_TARGETS: Record<0 | 1 | 2, [number, number, number]> = {
  0: [1, 0, 0],
  1: [1, 0.7, 0],
  2: [0.9, 0.7, 0.8],
};

interface Voice {
  source: AudioBufferSourceNode;
  startedAt: number;
}

interface AmbienceHandle {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

interface MusicHandle {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

type SynthFootstepMaterial = Parameters<typeof renderFootstep>[1];
type SynthAmbienceId = Parameters<typeof renderAmbience>[1];
type SynthReverbPreset = Parameters<typeof renderReverbImpulse>[1];

function toFootstepMaterial(material: FloorMaterial): SynthFootstepMaterial {
  return material as unknown as SynthFootstepMaterial;
}

function toAmbienceId(ambience: AmbienceType): SynthAmbienceId {
  return ambience as unknown as SynthAmbienceId;
}

function toReverbPreset(reverb: ReverbType): SynthReverbPreset {
  return reverb as unknown as SynthReverbPreset;
}

export class AudioSystem {
  private config: AudioConfig;
  private ctx: AudioContext | null = null;
  private disabled = false;
  private muted = false;
  private room: RoomAudio | null = null;
  private floorMaterial: FloorMaterial | null = null;
  private masterGain: GainNode | null = null;
  private ambienceGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private uiGain: GainNode | null = null;
  private convolverNode: ConvolverNode | null = null;
  private reverbWetGain: GainNode | null = null;
  private voices: Voice[] = [];
  private footstepBuffers = new Map<string, Promise<AudioBuffer>>();
  private oneShotBuffers = new Map<OneShotId, Promise<AudioBuffer>>();
  private ambienceBuffers = new Map<string, Promise<AudioBuffer>>();
  private reverbBuffers = new Map<ReverbType, AudioBuffer>();
  private currentAmbience: AmbienceHandle | null = null;
  private currentAmbienceId: string | null = null;
  private musicLayers: Array<MusicHandle | null> = [null, null, null];
  private musicBuffers = new Map<1 | 2 | 3, Promise<AudioBuffer>>();
  private musicPending = new Set<number>();
  private musicLevel: 0 | 1 | 2 = 0;
  private footsteps = 0;
  private readonly onGesture = (): void => {
    this.unlock();
  };

  constructor(config: AudioConfig) {
    this.config = config;
    this.muted = !config.enabled;
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', this.onGesture, { once: true });
      window.addEventListener('keydown', this.onGesture, { once: true });
    }
  }

  unlock(): void {
    this.detachGestures();
    if (this.ctx || this.disabled) {
      return;
    }
    try {
      let ctx: AudioContext;
      try {
        ctx = new AudioContext({ sampleRate: this.config.sample_rate });
      } catch (error) {
        console.info('[M6] Sample rate no soportado, usando el del sistema', error);
        ctx = new AudioContext();
      }
      this.ctx = ctx;
      this.buildGraph(ctx);
      ctx.resume().catch((error) => {
        console.info('[M6] No se pudo reanudar el contexto', error);
      });
      this.prepare(ctx).catch((error) => {
        console.info('[M6] Error al preparar el audio', error);
      });
    } catch (error) {
      console.info('[M6] Web Audio no disponible', error);
      this.disabled = true;
      this.ctx = null;
      this.masterGain = null;
      this.ambienceGain = null;
      this.sfxGain = null;
      this.musicGain = null;
      this.uiGain = null;
      this.convolverNode = null;
      this.reverbWetGain = null;
    }
  }

  setVolumes(config: AudioConfig): void {
    this.config = config;
    this.applyVolumes();
  }

  setRoom(room: RoomAudio): void {
    this.room = room;
    this.floorMaterial = room.floor_material;
    const ctx = this.ctx;
    if (!ctx) {
      return;
    }
    const buffer = this.reverbBuffers.get(room.reverb);
    if (buffer && this.convolverNode) {
      this.convolverNode.buffer = buffer;
    }
    this.rampGain(this.reverbWetGain, REVERB_WET[room.reverb], ctx.currentTime, REVERB_RAMP);
    this.startAmbience(room.ambience, AMBIENCE_FADE);
  }

  footstep(running: boolean): void {
    const ctx = this.ctx;
    const material = this.floorMaterial;
    if (!ctx || !material) {
      return;
    }
    const variant: 0 | 1 = Math.random() < 0.5 ? 0 : 1;
    const key = `${material}-${variant}-${running ? 'run' : 'walk'}`;
    let promise = this.footstepBuffers.get(key);
    if (!promise) {
      promise = renderFootstep(ctx.sampleRate, toFootstepMaterial(material), variant, running).catch((error) => {
        this.footstepBuffers.delete(key);
        throw error;
      });
      this.footstepBuffers.set(key, promise);
    }
    this.footsteps += 1;
    promise
      .then((buffer) => {
        if (!this.ctx || !this.sfxGain) {
          return;
        }
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = STEP_RATE_MIN + Math.random() * (STEP_RATE_MAX - STEP_RATE_MIN);
        const gain = ctx.createGain();
        gain.gain.value = running ? RUN_STEP_GAIN : STEP_GAIN;
        source.connect(gain);
        gain.connect(this.sfxGain);
        this.trackVoice(source, ctx.currentTime);
        source.start();
      })
      .catch((error) => {
        console.info('[M6] Paso no disponible', error);
      });
  }

  play(id: OneShotId, volume = 1): void {
    this.playBuffer(id, volume, null);
  }

  playAt(
    id: OneShotId,
    x: number,
    z: number,
    listenerX: number,
    listenerZ: number,
    yaw: number,
    volume = 1,
  ): void {
    const dx = x - listenerX;
    const dz = z - listenerZ;
    const distance = Math.hypot(dx, dz);
    if (distance > MAX_DISTANCE) {
      return;
    }
    const attenuation = Math.pow(Math.max(0, Math.min(1, 1 - distance / MAX_DISTANCE)), 1.5);
    const dirX = distance > 0 ? dx / distance : 0;
    const dirZ = distance > 0 ? dz / distance : 0;
    const pan = Math.max(-1, Math.min(1, dirX * Math.cos(yaw) - dirZ * Math.sin(yaw))) * PAN_WIDTH;
    this.playBuffer(id, volume * attenuation, pan);
  }

  playStinger(): void {
    this.play('stinger');
  }

  setMusicIntensity(level: 0 | 1 | 2): void {
    this.musicLevel = level;
    if (!this.ctx) {
      return;
    }
    this.applyMusicGains();
    if (level > 0) {
      if (!this.musicLayers[1]) {
        this.ensureMusicLayer(2);
      }
      if (!this.musicLayers[2]) {
        this.ensureMusicLayer(3);
      }
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    const ctx = this.ctx;
    if (!ctx) {
      return;
    }
    this.rampGain(this.masterGain, this.masterTarget(), ctx.currentTime, MUTE_RAMP);
  }

  get contextState(): AudioContextState | 'idle' {
    return this.ctx?.state ?? 'idle';
  }

  get footstepCount(): number {
    return this.footsteps;
  }

  get voiceCount(): number {
    return this.voices.length;
  }

  private buildGraph(ctx: AudioContext): void {
    const master = ctx.createGain();
    master.gain.value = this.masterTarget();
    master.connect(ctx.destination);

    const ambience = ctx.createGain();
    ambience.gain.value = this.config.ambience;
    const sfx = ctx.createGain();
    sfx.gain.value = this.config.sfx;
    const music = ctx.createGain();
    music.gain.value = this.config.music;
    const ui = ctx.createGain();
    ui.gain.value = this.config.ui;
    ambience.connect(master);
    sfx.connect(master);
    music.connect(master);
    ui.connect(master);

    const send = ctx.createGain();
    send.gain.value = SEND_GAIN;
    sfx.connect(send);
    ambience.connect(send);

    const convolver = ctx.createConvolver();
    const wet = ctx.createGain();
    wet.gain.value = REVERB_WET.small;
    send.connect(convolver);

    const musicSend = ctx.createGain();
    musicSend.gain.value = MUSIC_SEND_GAIN;
    music.connect(musicSend);
    musicSend.connect(convolver);

    convolver.connect(wet);
    wet.connect(master);

    this.masterGain = master;
    this.ambienceGain = ambience;
    this.sfxGain = sfx;
    this.musicGain = music;
    this.uiGain = ui;
    this.convolverNode = convolver;
    this.reverbWetGain = wet;
  }

  private async prepare(ctx: AudioContext): Promise<void> {
    const rate = ctx.sampleRate;
    const rendered = await Promise.all(
      REVERB_ORDER.map(async (preset): Promise<[ReverbType, AudioBuffer] | null> => {
        try {
          return [preset, await renderReverbImpulse(rate, toReverbPreset(preset))];
        } catch (error) {
          console.info(`[M6] Impulso ${preset} no disponible`, error);
          return null;
        }
      }),
    );
    let impulses = 0;
    for (const entry of rendered) {
      if (!entry) {
        continue;
      }
      this.reverbBuffers.set(entry[0], entry[1]);
      impulses += 1;
    }
    const room = this.room;
    if (room) {
      this.assignReverb(room.reverb);
      this.startAmbience(room.ambience, 0);
    }
    try {
      const buffer = await renderMusicLayer(rate, 1);
      this.startMusicLayer(1, buffer);
    } catch (error) {
      console.info('[M6] Capa 1 de música no disponible', error);
    }
    console.info(`[M6] Audio listo (rate=${rate} Hz, IRs=${impulses})`);
  }

  private assignReverb(reverb: ReverbType): void {
    const buffer = this.reverbBuffers.get(reverb);
    if (buffer && this.convolverNode) {
      this.convolverNode.buffer = buffer;
    }
    if (this.reverbWetGain) {
      this.reverbWetGain.gain.value = REVERB_WET[reverb];
    }
  }

  private startAmbience(id: AmbienceType, fadeSeconds: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.ambienceGain) {
      return;
    }
    let promise = this.ambienceBuffers.get(id);
    if (!promise) {
      promise = renderAmbience(ctx.sampleRate, toAmbienceId(id)).catch((error) => {
        this.ambienceBuffers.delete(id);
        throw error;
      });
      this.ambienceBuffers.set(id, promise);
    }
    promise
      .then((buffer) => {
        if (!this.ctx || !this.ambienceGain) {
          return;
        }
        if (this.currentAmbienceId === id && this.currentAmbience) {
          return;
        }
        if (this.room && this.room.ambience !== id) {
          return;
        }
        this.crossfadeAmbience(id, buffer, fadeSeconds);
      })
      .catch((error) => {
        console.info(`[M6] Ambiente ${id} no disponible`, error);
      });
  }

  private crossfadeAmbience(id: AmbienceType, buffer: AudioBuffer, fadeSeconds: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.ambienceGain) {
      return;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = ctx.createGain();
    const previous = this.currentAmbience;
    const now = ctx.currentTime;
    if (previous && fadeSeconds > 0) {
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + fadeSeconds);
      previous.gain.gain.cancelScheduledValues(now);
      previous.gain.gain.setValueAtTime(previous.gain.gain.value, now);
      previous.gain.gain.linearRampToValueAtTime(0, now + fadeSeconds);
      try {
        previous.source.stop(now + fadeSeconds + 0.05);
      } catch (error) {
        console.info('[M6] No se pudo detener el ambiente anterior', error);
      }
    } else {
      gain.gain.value = 1;
      if (previous) {
        previous.gain.gain.value = 0;
        try {
          previous.source.stop();
        } catch (error) {
          console.info('[M6] No se pudo detener el ambiente anterior', error);
        }
      }
    }
    source.connect(gain);
    gain.connect(this.ambienceGain);
    source.start();
    this.currentAmbience = { source, gain };
    this.currentAmbienceId = id;
  }

  private startMusicLayer(layer: 1 | 2 | 3, buffer: AudioBuffer): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain || this.musicLayers[layer - 1]) {
      return;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(this.musicGain);
    source.start();
    this.musicLayers[layer - 1] = { source, gain };
    this.applyMusicGains();
  }

  private ensureMusicLayer(layer: 2 | 3): void {
    const ctx = this.ctx;
    if (!ctx || this.musicLayers[layer - 1] || this.musicPending.has(layer)) {
      return;
    }
    let promise = this.musicBuffers.get(layer);
    if (!promise) {
      promise = renderMusicLayer(ctx.sampleRate, layer).catch((error) => {
        this.musicBuffers.delete(layer);
        throw error;
      });
      this.musicBuffers.set(layer, promise);
    }
    this.musicPending.add(layer);
    promise
      .then((buffer) => {
        this.musicPending.delete(layer);
        this.startMusicLayer(layer, buffer);
      })
      .catch((error) => {
        this.musicPending.delete(layer);
        console.info(`[M6] Capa de música ${layer} no disponible`, error);
      });
  }

  private applyMusicGains(): void {
    const ctx = this.ctx;
    if (!ctx) {
      return;
    }
    const targets = MUSIC_TARGETS[this.musicLevel];
    const now = ctx.currentTime;
    for (let i = 0; i < targets.length; i += 1) {
      const handle = this.musicLayers[i];
      if (!handle) {
        continue;
      }
      const param = handle.gain.gain;
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(targets[i], now + MUSIC_RAMP);
    }
  }

  private playBuffer(id: OneShotId, volume: number, pan: number | null): void {
    const ctx = this.ctx;
    if (!ctx) {
      return;
    }
    const bus = id === 'paper_turn' ? this.uiGain : this.sfxGain;
    if (!bus) {
      return;
    }
    let promise = this.oneShotBuffers.get(id);
    if (!promise) {
      promise = renderOneShot(ctx.sampleRate, id).catch((error) => {
        this.oneShotBuffers.delete(id);
        throw error;
      });
      this.oneShotBuffers.set(id, promise);
    }
    promise
      .then((buffer) => {
        if (!this.ctx) {
          return;
        }
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const gain = ctx.createGain();
        gain.gain.value = volume;
        source.connect(gain);
        if (pan === null) {
          gain.connect(bus);
        } else {
          const panner = ctx.createStereoPanner();
          panner.pan.value = pan;
          gain.connect(panner);
          panner.connect(bus);
        }
        this.trackVoice(source, ctx.currentTime);
        source.start();
      })
      .catch((error) => {
        console.info(`[M6] No se pudo reproducir ${id}`, error);
      });
  }

  private trackVoice(source: AudioBufferSourceNode, startedAt: number): void {
    if (this.voices.length >= MAX_VOICES) {
      const oldest = this.voices.reduce((a, b) => (a.startedAt <= b.startedAt ? a : b));
      try {
        oldest.source.stop();
      } catch (error) {
        console.info('[M6] No se pudo detener la voz más antigua', error);
      }
      const index = this.voices.indexOf(oldest);
      if (index >= 0) {
        this.voices.splice(index, 1);
      }
    }
    const voice: Voice = { source, startedAt };
    source.onended = () => {
      const index = this.voices.indexOf(voice);
      if (index >= 0) {
        this.voices.splice(index, 1);
      }
    };
    this.voices.push(voice);
  }

  private applyVolumes(): void {
    const ctx = this.ctx;
    if (!ctx) {
      return;
    }
    const now = ctx.currentTime;
    this.rampGain(this.masterGain, this.masterTarget(), now, VOLUME_RAMP);
    this.rampGain(this.ambienceGain, this.config.ambience, now, VOLUME_RAMP);
    this.rampGain(this.sfxGain, this.config.sfx, now, VOLUME_RAMP);
    this.rampGain(this.musicGain, this.config.music, now, VOLUME_RAMP);
    this.rampGain(this.uiGain, this.config.ui, now, VOLUME_RAMP);
  }

  private rampGain(node: GainNode | null, value: number, now: number, seconds: number): void {
    if (!node) {
      return;
    }
    const param = node.gain;
    if (seconds <= 0) {
      param.value = value;
      return;
    }
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + seconds);
  }

  private masterTarget(): number {
    if (this.muted || !this.config.enabled) {
      return 0;
    }
    return this.config.master;
  }

  private detachGestures(): void {
    if (typeof window === 'undefined') {
      return;
    }
    window.removeEventListener('pointerdown', this.onGesture);
    window.removeEventListener('keydown', this.onGesture);
  }
}
