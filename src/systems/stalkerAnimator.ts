import * as THREE from 'three';
import type { StalkerRig } from './stalkerModel';

export const IDLE_CLIP = 'Idle_Watchful';
export const WALK_CLIP = 'Walk_Nervous';
export const RUN_CLIP = 'Run_Frantic';
export const ATTACK_CLIP = 'Attack_Lunge';
export const SCREAM_CLIP = 'Scream.lol';
export const WALL_SLAM_CLIP = 'WallSlam_Recover';

export const CLIP_SPEED_MIN = 0.3;
export const CLIP_SPEED_MAX = 4.5;

// Velocidad a la que avanza el pie plantado con timeScale = 1, medida sobre el
// clip renderizado (el pie retrocede respecto al cuerpo a esa velocidad). Si la
// velocidad real del stalker no coincide, los pies patinan.
export const DEFAULT_CLIP_SPEEDS: Record<string, number> = {
  [WALK_CLIP]: 0.35,
  [RUN_CLIP]: 2.0,
};

export interface AnimatorUpdateOptions {
  groundSpeed?: number;
  sync?: boolean;
}

export class StalkerAnimator {
  activeClip: string | null = null;

  private readonly actions = new Map<string, THREE.AnimationAction>();

  constructor(
    private readonly rig: StalkerRig,
    private readonly clipSpeeds: Record<string, number> = DEFAULT_CLIP_SPEEDS,
  ) {
    for (const [name, clip] of rig.clips) {
      this.actions.set(name, rig.mixer.clipAction(clip));
    }
  }

  clipNames(): string[] {
    return [...this.actions.keys()];
  }

  clipDuration(name: string): number {
    return this.actions.get(name)?.getClip().duration ?? 0;
  }

  naturalSpeed(name: string): number | null {
    const speed = this.clipSpeeds[name];
    return typeof speed === 'number' && speed > 0 ? speed : null;
  }

  action(name: string): THREE.AnimationAction | null {
    return this.actions.get(name) ?? null;
  }

  current(): THREE.AnimationAction | null {
    return this.activeClip ? (this.actions.get(this.activeClip) ?? null) : null;
  }

  timeScale(): number {
    return this.current()?.getEffectiveTimeScale() ?? 1;
  }

  restart(name: string, fade = 0): void {
    this.activeClip = null;
    this.play(name, fade);
  }

  play(name: string, fade = 0.25): void {
    if (this.activeClip === name) {
      return;
    }
    const next = this.actions.get(name);
    if (!next) {
      console.warn(`[stalker] El modelo no trae el clip "${name}"`);
      return;
    }
    this.current()?.fadeOut(fade);
    next
      .reset()
      .setLoop(THREE.LoopRepeat, Infinity)
      .setEffectiveWeight(1)
      .fadeIn(fade)
      .play();
    this.activeClip = name;
  }

  playOnce(name: string, fade = 0.12, clamp = true): THREE.AnimationAction | null {
    const action = this.actions.get(name);
    if (!action) {
      console.warn(`[stalker] El modelo no trae el clip "${name}"`);
      return null;
    }
    const previous = this.current();
    if (previous && previous !== action) {
      previous.fadeOut(fade);
    }
    action.reset().setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = clamp;
    action.setEffectiveWeight(1).fadeIn(fade).play();
    this.activeClip = name;
    return action;
  }

  setTimeScale(scale: number): void {
    this.current()?.setEffectiveTimeScale(scale);
  }

  update(dt: number, options: AnimatorUpdateOptions = {}): void {
    const action = this.current();
    if (action && options.sync && options.groundSpeed !== undefined) {
      const reference = this.activeClip ? this.naturalSpeed(this.activeClip) : null;
      if (reference) {
        action.setEffectiveTimeScale(
          THREE.MathUtils.clamp(options.groundSpeed / reference, CLIP_SPEED_MIN, CLIP_SPEED_MAX),
        );
      }
    }
    this.rig.mixer.update(dt);
  }
}
