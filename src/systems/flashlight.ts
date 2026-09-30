import * as THREE from 'three';
import type { PsxConfig } from './config';

// Uniforms compartidos por TODOS los materiales PSX (incluidas las salas en
// caché): al actualizarlos una vez por frame, la linterna ilumina cualquier
// sala sin re-sincronizar materiales.
export interface FlashlightUniforms {
  u_flash_on: { value: number };
  u_flash_pos: { value: THREE.Vector3 };
  u_flash_dir: { value: THREE.Vector3 };
  u_flash_color: { value: THREE.Vector3 };
  u_flash_cos_outer: { value: number };
  u_flash_cos_inner: { value: number };
  u_flash_range: { value: number };
  u_flash_intensity: { value: number };
}

export const FLASHLIGHT_UNIFORMS: FlashlightUniforms = {
  u_flash_on: { value: 0 },
  u_flash_pos: { value: new THREE.Vector3() },
  u_flash_dir: { value: new THREE.Vector3(0, 0, -1) },
  u_flash_color: { value: new THREE.Vector3(1, 0.93, 0.75) },
  u_flash_cos_outer: { value: Math.cos(THREE.MathUtils.degToRad(30)) },
  u_flash_cos_inner: { value: Math.cos(THREE.MathUtils.degToRad(16)) },
  u_flash_range: { value: 9 },
  u_flash_intensity: { value: 0 },
};

const STUTTER_PERIOD = 6.7;
const STUTTER_WINDOW = 0.045;
const STUTTER_SCALE = 0.35;

const forward = new THREE.Vector3();

export class Flashlight {
  owned = false;
  on = false;

  private time = 0;

  constructor(private readonly config: PsxConfig) {}

  get intensity(): number {
    return FLASHLIGHT_UNIFORMS.u_flash_intensity.value;
  }

  reset(): void {
    this.owned = false;
    this.on = false;
    this.time = 0;
    this.applyUniforms();
  }

  give(): void {
    this.owned = true;
  }

  toggle(): boolean {
    if (!this.owned) {
      return false;
    }
    this.on = !this.on;
    this.time = 0;
    this.applyUniforms();
    return true;
  }

  update(dt: number, camera: THREE.Camera, allowLight: boolean): void {
    this.time += dt;
    camera.updateMatrixWorld();
    camera.getWorldPosition(FLASHLIGHT_UNIFORMS.u_flash_pos.value);
    camera.getWorldDirection(forward);
    (FLASHLIGHT_UNIFORMS.u_flash_dir.value as THREE.Vector3).copy(forward);

    const tuning = this.config.flashlight;
    const outer = Math.max(4, Math.min(80, tuning.angle_deg));
    const inner = outer * THREE.MathUtils.clamp(tuning.softness, 0.05, 1);
    FLASHLIGHT_UNIFORMS.u_flash_cos_outer.value = Math.cos(THREE.MathUtils.degToRad(outer));
    FLASHLIGHT_UNIFORMS.u_flash_cos_inner.value = Math.cos(THREE.MathUtils.degToRad(inner));
    FLASHLIGHT_UNIFORMS.u_flash_range.value = Math.max(1, tuning.range);
    (FLASHLIGHT_UNIFORMS.u_flash_color.value as THREE.Vector3).set(
      tuning.color[0],
      tuning.color[1],
      tuning.color[2],
    );
    this.applyUniforms(allowLight);
  }

  private applyUniforms(allowLight = true): void {
    const active = this.on && this.owned && allowLight;
    const tuning = this.config.flashlight;
    FLASHLIGHT_UNIFORMS.u_flash_on.value = active ? 1 : 0;
    FLASHLIGHT_UNIFORMS.u_flash_intensity.value = active
      ? Math.max(0, tuning.intensity) * this.flicker()
      : 0;
  }

  private flicker(): number {
    const amount = THREE.MathUtils.clamp(this.config.flashlight.flicker, 0, 0.5);
    if (amount <= 0) {
      return 1;
    }
    const t = this.time;
    const wobble = Math.sin(t * 37.1) * Math.sin(t * 12.7) * 0.5 + Math.sin(t * 6.3) * 0.5;
    let value = 1 - amount * (0.5 + 0.5 * wobble);
    const phase = (t % STUTTER_PERIOD) / STUTTER_PERIOD;
    if (phase > 1 - STUTTER_WINDOW) {
      value *= STUTTER_SCALE + (1 - STUTTER_SCALE) * Math.abs(Math.sin(t * 90));
    }
    return THREE.MathUtils.clamp(value, 0.15, 1.1);
  }
}
