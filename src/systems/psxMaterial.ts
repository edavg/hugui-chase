import * as THREE from 'three';
import type { PsxConfig } from './config';
import { FLASHLIGHT_UNIFORMS } from './flashlight';
import psxVert from '../shaders/psx.vert.glsl?raw';
import psxFrag from '../shaders/psx.frag.glsl?raw';

export interface Atmosphere {
  fog_start?: number;
  fog_end?: number;
  fog_color?: [number, number, number];
  ambient?: number;
}

export interface PsxMaterialHandle {
  material: THREE.ShaderMaterial;
  sync: (config: PsxConfig, atmosphere?: Atmosphere | null) => void;
}

const BASE_AMBIENT = 0.45;

export function createPsxMaterial(
  config: PsxConfig,
  texture: THREE.Texture,
  atmosphere?: Atmosphere | null,
): PsxMaterialHandle {
  const material = new THREE.ShaderMaterial({
    vertexShader: psxVert,
    fragmentShader: psxFrag,
    uniforms: {
      u_tex: { value: texture },
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
      u_light_dir: { value: new THREE.Vector3(0.9, 0.45, 0.2).normalize() },
      u_ambient: { value: BASE_AMBIENT },
      u_alpha_test: { value: config.alpha_test },
      u_color_bits: { value: config.color_bits },
      ...FLASHLIGHT_UNIFORMS,
    },
    side: THREE.DoubleSide,
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
    uniforms.u_color_bits.value = next.color_bits;
    uniforms.u_alpha_test.value = next.alpha_test;
  };

  sync(config, atmosphere);

  return { material, sync };
}
