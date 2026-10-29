import { fetchJson } from './fetchJson';

export type ImageMode = 'psx' | 'vhs' | 'bw' | 'crt';

export type ReverbType = 'small' | 'hall' | 'cave' | 'corridor';
export type FloorMaterial = 'wood' | 'tile' | 'stone' | 'metal' | 'brick' | 'dirt' | 'grass';
export type AmbienceType = 'house' | 'basement' | 'outdoor';

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
  // FOV vertical en pantallas en vertical (móvil). El render vertical usa una
  // resolución más alta que ancha, así que un FOV mayor evita un encuadre
  // demasiado estrecho. Opcional (por defecto 95).
  fov_portrait?: number;
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
    // Aguante (M13): segundos de carrera con el aguante lleno, segundos para
    // recuperarlo entero, nivel al que se puede volver a correr tras agotarse
    // y factor de velocidad al caminar agotado. Opcionales.
    stamina_seconds?: number;
    stamina_recover_seconds?: number;
    stamina_resume?: number;
    exhausted_speed?: number;
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
    // Medidas a 2.05 m de altura: con otra altura se escalan solas.
    walk_clip_speed?: number;
    run_clip_speed?: number;
    // true: conserva la cabeza original del modelo en vez del cubo con la cara.
    model_head?: boolean;
    // GLB propio (por defecto el del stalker) y, si sus clips se llaman de otra
    // forma, qué clip del GLB hace de cada clip del animador.
    model?: string;
    clips?: Record<string, string>;
    spawn_room: string;
    patrol_rooms: string[];
    forbidden_rooms: string[];
    forbidden_seconds: number;
    // Cada afiche quemado acelera al stalker un paso (fracción de su velocidad
    // base) hasta un tope acumulado. Opcionales (0.05 por afiche, tope 1.35).
    poster_speed_step?: number;
    poster_speed_max?: number;
    // Percepción (M13): la linterna encendida alarga la vista, en salas oscuras
    // sin linterna se acorta, y el haz apuntado al stalker lo delata aunque
    // esté de espaldas. Jadear (agotado) se oye a pant_hearing metros.
    flashlight_sight_scale?: number;
    dark_sight_scale?: number;
    beam_notice_range?: number;
    beam_notice_deg?: number;
    pant_hearing?: number;
    // Escondites: usos de un mismo escondite a partir de los que lo revisa por
    // su cuenta, segundos que tarda en revisarlo y radio en que ve la linterna
    // encendida dentro de un escondite.
    hide_check_uses?: number;
    inspect_seconds?: number;
    hide_light_radius?: number;
    // Memoria: segundos que recuerda las salas donde te vio u oyó y
    // probabilidad de elegir una de ellas como siguiente destino de patrulla.
    memory_seconds?: number;
    memory_chance?: number;
    // Trampas: intervalo aleatorio entre señuelos (portazo o silbido lejos de
    // por donde viene).
    lure_min_seconds?: number;
    lure_max_seconds?: number;
    // Ruido de quemar un afiche: lo oye a esta distancia en salas.
    burn_noise_hops?: number;
    // Rastros (huellas y puertas entornadas): segundos que duran.
    trace_seconds?: number;
  };
  // Criatura del sótano: encerrada en `room` desde el inicio, espera en
  // `position` mirando hacia `yaw` (grados, como los spawns). Al entrar el
  // jugador lo mira `suspect_seconds` y lo persigue sin salir de la sala.
  // `enemy` sobrescribe los valores del stalker (velocidad, golpe, altura).
  lurker?: {
    room: string;
    position: [number, number];
    yaw: number;
    enemy?: Partial<PsxConfig['enemy']>;
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
