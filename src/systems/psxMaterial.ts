import * as THREE from 'three';
import type { PsxConfig } from './config';
import { FLASHLIGHT_UNIFORMS } from './flashlight';
import { SCENE_LIGHT_UNIFORMS, type SceneLightDef } from './sceneLights';
import psxVert from '../shaders/psx.vert.glsl?raw';
import psxFrag from '../shaders/psx.frag.glsl?raw';

export interface AtmosphereLamp {
  // Foco puntual fijo de la sala (p. ej. la bombilla sobre la mesa de la
  // linterna). Se convierte en una luz de sala más (ver sceneLights).
  position: [number, number, number];
  color?: [number, number, number];
  range?: number;
  intensity?: number;
}

export interface Atmosphere {
  fog_start?: number;
  fog_end?: number;
  fog_color?: [number, number, number];
  ambient?: number;
  ambient_color?: [number, number, number];
  // Peso del relleno lunar direccional (0 = sin luz de "luna").
  direct?: number;
  lamp?: AtmosphereLamp;
  // Luces puntuales de la sala (bombillas, lámparas). Máximo 4.
  lights?: SceneLightDef[];
  // Exterior: sin techo, cielo nocturno.
  outdoor?: boolean;
}

export interface SurfaceOptions {
  normalMap?: THREE.Texture | null;
  normalStrength?: number;
  // Especular (0 = mate). Azulejo, metal y cristal brillan; yeso y tela no.
  spec?: number;
  gloss?: number;
  // Auto-iluminación (cristal de ventana con luna, ascuas).
  emissive?: number;
  // El afiche y similares ignoran el relleno lunar.
  noDirect?: boolean;
  // Decal con mezcla alfa (manchas): sin alpha test duro, bordes suaves.
  blend?: boolean;
  // Margen en UV (0–0.5) en el que un decal 1:1 se funde hacia sus bordes.
  edgeFade?: number;
}

export interface PsxMaterialHandle {
  material: THREE.ShaderMaterial;
  sync: (config: PsxConfig, atmosphere?: Atmosphere | null) => void;
}

export const BASE_AMBIENT = 0.3;
const BASE_AMBIENT_COLOR: [number, number, number] = [0.82, 0.82, 0.9];
const DEFAULT_GLOSS = 24;

export function createPsxMaterial(
  config: PsxConfig,
  texture: THREE.Texture,
  atmosphere?: Atmosphere | null,
  surface: SurfaceOptions = {},
): PsxMaterialHandle {
  const material = new THREE.ShaderMaterial({
    vertexShader: psxVert,
    fragmentShader: psxFrag,
    uniforms: {
      u_tex: { value: texture },
      u_normal_map: { value: surface.normalMap ?? null },
      u_has_normal: { value: surface.normalMap ? 1 : 0 },
      u_normal_strength: { value: surface.normalStrength ?? 1 },
      u_spec: { value: surface.spec ?? 0.12 },
      u_gloss: { value: surface.gloss ?? DEFAULT_GLOSS },
      u_emissive: { value: surface.emissive ?? 0 },
      u_alpha_out: { value: surface.blend ? 1 : 0 },
      u_edge_fade: { value: surface.edgeFade ?? 0 },
      u_res: { value: new THREE.Vector2(config.resolution[0], config.resolution[1]) },
      u_snap: { value: config.effects.vertex_snap ? 1 : 0 },
      u_affine: { value: config.effects.affine_mapping ? 1 : 0 },
      u_affine_near: { value: config.effects.affine_near ?? 1.5 },
      u_affine_far: { value: config.effects.affine_far ?? 5.0 },
      u_dither: { value: config.effects.dither ? 1 : 0 },
      u_fog_enabled: { value: config.effects.fog.enabled ? 1 : 0 },
      u_fog_start: { value: config.effects.fog.start },
      u_fog_end: { value: config.effects.fog.end },
      u_fog_color: {
        value: new THREE.Vector3(
          config.effects.fog.color[0],
          config.effects.fog.color[1],
          config.effects.fog.color[2],
        ),
      },
      u_light_dir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      u_ambient: { value: BASE_AMBIENT },
      u_ambient_color: { value: new THREE.Vector3(...BASE_AMBIENT_COLOR) },
      u_direct: { value: 1 },
      u_alpha_test: { value: config.alpha_test },
      u_color_bits: { value: config.color_bits },
      ...FLASHLIGHT_UNIFORMS,
      ...SCENE_LIGHT_UNIFORMS,
    },
    side: THREE.DoubleSide,
    transparent: surface.blend ?? false,
    depthWrite: !(surface.blend ?? false),
  });

  const sync = (next: PsxConfig, nextAtmosphere?: Atmosphere | null): void => {
    const uniforms = material.uniforms;
    const room = nextAtmosphere ?? atmosphere ?? null;
    uniforms.u_res.value.set(next.resolution[0], next.resolution[1]);
    uniforms.u_snap.value = next.effects.vertex_snap ? 1 : 0;
    uniforms.u_affine.value = next.effects.affine_mapping ? 1 : 0;
    uniforms.u_affine_near.value = next.effects.affine_near ?? 1.5;
    uniforms.u_affine_far.value = next.effects.affine_far ?? 5.0;
    uniforms.u_dither.value = next.effects.dither ? 1 : 0;
    uniforms.u_fog_enabled.value = next.effects.fog.enabled ? 1 : 0;
    uniforms.u_fog_start.value = room?.fog_start ?? next.effects.fog.start;
    uniforms.u_fog_end.value = room?.fog_end ?? next.effects.fog.end;
    const fogColor = room?.fog_color ?? next.effects.fog.color;
    (uniforms.u_fog_color.value as THREE.Vector3).set(fogColor[0], fogColor[1], fogColor[2]);
    uniforms.u_ambient.value = room?.ambient ?? BASE_AMBIENT;
    const ambientColor = room?.ambient_color ?? BASE_AMBIENT_COLOR;
    (uniforms.u_ambient_color.value as THREE.Vector3).set(ambientColor[0], ambientColor[1], ambientColor[2]);
    uniforms.u_direct.value = surface.noDirect ? 0 : (room?.direct ?? 1);
    uniforms.u_color_bits.value = next.color_bits;
    uniforms.u_alpha_test.value = surface.blend ? 0.02 : next.alpha_test;
  };

  sync(config, atmosphere);

  return { material, sync };
}

// Luces efectivas de una atmósfera: la "lamp" heredada pasa a ser una luz más.
export function atmosphereLights(atmosphere: Atmosphere | null | undefined): SceneLightDef[] {
  if (!atmosphere) {
    return [];
  }
  const lights = [...(atmosphere.lights ?? [])];
  if (atmosphere.lamp) {
    lights.unshift({
      position: atmosphere.lamp.position,
      color: atmosphere.lamp.color,
      range: atmosphere.lamp.range,
      intensity: atmosphere.lamp.intensity,
      flicker: 0.15,
    });
  }
  return lights;
}
