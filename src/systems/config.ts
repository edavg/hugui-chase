import { fetchJson } from './fetchJson';

export type ImageMode = 'psx' | 'vhs' | 'bw' | 'crt';

export type ReverbType = 'small' | 'hall' | 'cave' | 'corridor';
export type FloorMaterial = 'wood' | 'tile' | 'stone' | 'metal' | 'brick';
export type AmbienceType = 'house' | 'basement';

export interface AudioConfig {
  enabled: boolean;
  sample_rate: number;
  master: number;
  ambience: number;
  sfx: number;
  music: number;
  ui: number;
}

export interface PsxConfig {
  title: string;
  resolution: [number, number];
  fps: number;
  fov: number;
  near: number;
  far: number;
  color_bits: number;
  alpha_test: number;
  clear_color: [number, number, number];
  effects: {
    vertex_snap: boolean;
    affine_mapping: boolean;
    // Rango de mezcla affine: a ≤ affine_near la UV es perspectiva correcta y a
    // ≥ affine_far es affine pura (look PSX). Opcionales (1.5 / 5.0 m).
    affine_near?: number;
    affine_far?: number;
    dither: boolean;
    fog: {
      enabled: boolean;
      start: number;
      end: number;
      color: [number, number, number];
    };
    image_mode: ImageMode;
    post_intensity: number;
    integer_scaling: boolean;
    brightness: number;
    gamma: number;
  };
  player: {
    walk: number;
    run: number;
    control_scheme: 'modern' | 'tank';
    turn_deg_s: number;
    eye_height: number;
    radius: number;
    head_bob: number;
    look_sensitivity: number;
    interact_radius: number;
    interact_fov_deg: number;
    invert_look: boolean;
    // Corazones del jugador (estilo Zelda) y tiempo de invulnerabilidad tras
    // recibir un golpe. Opcionales: si faltan se usan los valores por defecto.
    hearts?: number;
    hit_invuln_seconds?: number;
  };
  enemy: {
    chase_speed: number;
    sight_deg: number;
    sight_range: number;
    ai_hz: number;
    patrol_speed: number;
    search_speed: number;
    turn_speed: number;
    hearing_walk: number;
    hearing_run: number;
    notice_radius: number;
    catch_radius: number;
    // Ataque con aviso: el stalker se queda quieto y "carga" el golpe durante
    // attack_windup_seconds antes de hacer daño, dando tiempo a escapar.
    attack_range?: number;
    attack_windup_seconds?: number;
    attack_recover_seconds?: number;
    attack_cooldown_seconds?: number;
    lose_sight_seconds: number;
    suspect_seconds: number;
    search_seconds: number;
    search_variance: number;
    body_radius: number;
    height: number;
    // Velocidad natural (m/s) de los clips de andar/correr con timeScale 1.
    // El animador ajusta el timeScale para que los pies no patinen.
    walk_clip_speed?: number;
    run_clip_speed?: number;
    spawn_room: string;
    patrol_rooms: string[];
    forbidden_rooms: string[];
    forbidden_seconds: number;
  };
  loading: {
    authentic: boolean;
    min_seconds: number;
    door_anim_seconds: number;
    fade_seconds: number;
    preload_radius: number;
  };
  flashlight: {
    // Cono de la linterna: rango en metros, ángulo exterior (grados), borde
    // suave (0–1), intensidad, color y amplitud del parpadeo.
    range: number;
    angle_deg: number;
    softness: number;
    intensity: number;
    color: [number, number, number];
    flicker: number;
  };
  budgets: {
    scene_tris: number;
    texture_mb: number;
    audio_voices: number;
  };
  audio: AudioConfig;
  save: {
    slots: number;
    autosave: boolean;
  };
  language: 'es' | 'en';
}

export type EnemyConfig = PsxConfig['enemy'];

export async function loadConfig(): Promise<PsxConfig> {
  const url = `${import.meta.env.BASE_URL}config/psx_config.json`;
  return fetchJson<PsxConfig>(url);
}
