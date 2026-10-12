import * as THREE from 'three';

// Iluminación "PS2": luces puntuales de la sala (bombillas, lámparas) y la
// sombra proyectada de la linterna. Sólo se dibuja una sala a la vez, así que
// estos uniforms son GLOBALES y compartidos por todos los materiales (salas en
// caché, stalker, examen): al entrar en una sala se reescriben una vez y cada
// frame sólo se tocan intensidades (parpadeo).

export const MAX_SCENE_LIGHTS = 4;

export interface SceneLightDef {
  position: [number, number, number];
  color?: [number, number, number];
  range?: number;
  intensity?: number;
  // 0 = estable; >0 = parpadeo de bombilla vieja (amplitud 0–1).
  flicker?: number;
  // Bombilla rota que se apaga a ratos (cortes largos).
  broken?: boolean;
}

export interface SceneLightUniforms {
  u_light_count: { value: number };
  u_light_pos: { value: THREE.Vector3[] };
  u_light_color: { value: THREE.Vector3[] };
  u_light_range: { value: number[] };
  u_shadow_on: { value: number };
  u_shadow_map: { value: THREE.Texture | null };
  u_shadow_matrix: { value: THREE.Matrix4 };
  u_shadow_texel: { value: number };
  u_time: { value: number };
  u_eye_pos: { value: THREE.Vector3 };
}

export const SCENE_LIGHT_UNIFORMS: SceneLightUniforms = {
  u_light_count: { value: 0 },
  u_light_pos: { value: Array.from({ length: MAX_SCENE_LIGHTS }, () => new THREE.Vector3()) },
  u_light_color: { value: Array.from({ length: MAX_SCENE_LIGHTS }, () => new THREE.Vector3()) },
  u_light_range: { value: Array.from({ length: MAX_SCENE_LIGHTS }, () => 1) },
  u_shadow_on: { value: 0 },
  u_shadow_map: { value: null },
  u_shadow_matrix: { value: new THREE.Matrix4() },
  u_shadow_texel: { value: 1 / 1024 },
  u_time: { value: 0 },
  u_eye_pos: { value: new THREE.Vector3() },
};

interface ActiveLight {
  def: SceneLightDef;
  base: THREE.Vector3;
  phase: number;
}

let active: ActiveLight[] = [];
let time = 0;

export function setSceneLights(lights: readonly SceneLightDef[] | null | undefined): void {
  fireSlot = -1;
  active = (lights ?? []).slice(0, MAX_SCENE_LIGHTS).map((def, index) => {
    const color = def.color ?? [1, 0.85, 0.65];
    const intensity = Math.max(0, def.intensity ?? 1);
    return {
      def,
      base: new THREE.Vector3(color[0] * intensity, color[1] * intensity, color[2] * intensity),
      phase: index * 13.37 + def.position[0] * 3.1 + def.position[2] * 1.7,
    };
  });
  const uniforms = SCENE_LIGHT_UNIFORMS;
  uniforms.u_light_count.value = active.length;
  active.forEach((light, index) => {
    const [x, y, z] = light.def.position;
    uniforms.u_light_pos.value[index].set(x, y, z);
    uniforms.u_light_range.value[index] = Math.max(0.5, light.def.range ?? 6);
    uniforms.u_light_color.value[index].copy(light.base);
  });
  for (let i = active.length; i < MAX_SCENE_LIGHTS; i += 1) {
    uniforms.u_light_color.value[i].set(0, 0, 0);
  }
}

// Parpadeo de bombillas: barato (sólo escala colores), una vez por frame.
export function updateSceneLights(dt: number): void {
  time += dt;
  SCENE_LIGHT_UNIFORMS.u_time.value = time % 1000;
  active.forEach((light, index) => {
    if (index === fireSlot) {
      return;
    }
    let scale = 1;
    const amount = light.def.flicker ?? 0;
    const t = time + light.phase;
    if (amount > 0) {
      const wobble = Math.sin(t * 23.0) * Math.sin(t * 7.3) * 0.5 + 0.5;
      scale *= 1 - amount * 0.35 * wobble;
      if (Math.sin(t * 1.7) > 0.985) {
        scale *= 0.25;
      }
    }
    if (light.def.broken) {
      const cycle = (t * 0.37) % 1;
      if (cycle > 0.82) {
        scale *= Math.sin(t * 60) > 0 ? 0.08 : 0.5;
      }
    }
    SCENE_LIGHT_UNIFORMS.u_light_color.value[index].copy(light.base).multiplyScalar(scale);
  });
}

// Luz pasajera (el afiche ardiendo): ocupa el hueco libre tras las luces de
// la sala, o el último si la sala ya tiene las 4. null la retira.
let fireSlot = -1;

export function setFireLight(
  position: THREE.Vector3 | null,
  color: [number, number, number] = [1, 0.5, 0.18],
  intensity = 1,
  range = 4,
): void {
  const uniforms = SCENE_LIGHT_UNIFORMS;
  if (!position) {
    if (fireSlot >= 0) {
      fireSlot = -1;
      setSceneLights(active.map((light) => light.def));
    }
    return;
  }
  if (fireSlot < 0) {
    fireSlot = Math.min(active.length, MAX_SCENE_LIGHTS - 1);
  }
  uniforms.u_light_pos.value[fireSlot].copy(position);
  uniforms.u_light_color.value[fireSlot].set(color[0] * intensity, color[1] * intensity, color[2] * intensity);
  uniforms.u_light_range.value[fireSlot] = range;
  uniforms.u_light_count.value = Math.max(active.length, fireSlot + 1);
}
