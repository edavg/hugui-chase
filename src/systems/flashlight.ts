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
const right = new THREE.Vector3();
const up = new THREE.Vector3();
const eye = new THREE.Vector3();
const aim = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// La linterna va "en el pecho", a la derecha y algo por debajo de los ojos:
// así el haz proyecta sombras visibles (si saliera de los ojos, cada sombra
// quedaría escondida justo detrás de su objeto).
const OFFSET_RIGHT = 0.2;
const OFFSET_DOWN = 0.24;
const CONVERGE_DISTANCE = 4.5;

export class Flashlight {
  owned = false;
  on = false;

  private time = 0;
  private castsShadow = false;
  private readonly casterPosition = new THREE.Vector3();
  private readonly casterDirection = new THREE.Vector3(0, 0, -1);

  constructor(private readonly config: PsxConfig) {}

  // Parámetros del foco para el pase de sombra (null si está apagada).
  shadowCaster(): { position: THREE.Vector3; direction: THREE.Vector3; angleDeg: number; range: number } | null {
    if (!this.castsShadow) {
      return null;
    }
    return {
      position: this.casterPosition,
      direction: this.casterDirection,
      angleDeg: Math.max(4, Math.min(80, this.config.flashlight.angle_deg)),
      range: Math.max(1, this.config.flashlight.range),
    };
  }

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
    camera.getWorldPosition(eye);
    camera.getWorldDirection(forward);
    right.crossVectors(forward, UP);
    if (right.lengthSq() < 1e-6) {
      right.set(1, 0, 0);
    }
    right.normalize();
    up.crossVectors(right, forward).normalize();
    this.casterPosition
      .copy(eye)
      .addScaledVector(right, OFFSET_RIGHT)
      .addScaledVector(up, -OFFSET_DOWN)
      .addScaledVector(forward, 0.05);
    aim.copy(eye).addScaledVector(forward, CONVERGE_DISTANCE);
    this.casterDirection.copy(aim).sub(this.casterPosition).normalize();
    FLASHLIGHT_UNIFORMS.u_flash_pos.value.copy(this.casterPosition);
    (FLASHLIGHT_UNIFORMS.u_flash_dir.value as THREE.Vector3).copy(this.casterDirection);

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
    this.castsShadow = active;
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
