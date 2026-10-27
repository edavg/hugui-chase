import * as THREE from 'three';
import type { AudioSystem } from './audio';
import type { Flags } from './flags';
import type { BuiltRoom } from './roomBuilder';
import { setFireLight } from './sceneLights';

// Sustos con guion por sala (M13). Se declaran en el JSON de la sala
// (`events`) y se disparan al entrar según los afiches quemados y las visitas.
// Cada evento ocurre una vez por partida (flag `event:<id>`).

export interface EventCondition {
  // Afiches quemados mínimos.
  posters?: number;
  // Visita a la sala a partir de la cual puede ocurrir (1 = la primera).
  visits?: number;
  // Probabilidad por visita (0–1).
  chance?: number;
}

interface BaseEvent {
  id: string;
  when?: EventCondition;
}

// Silueta al fondo de la sala que se esfuma al iluminarla, al acercarse o
// tras mirarla un momento.
export interface ApparitionEvent extends BaseEvent {
  kind: 'apparition';
  position: [number, number];
}

export type EventSound = 'radio' | 'phone_ring' | 'tv_static';

// Aparato que se enciende solo: suena `repeat` veces cada `interval` s tras
// `delay` s; `light` añade un parpadeo de pantalla de ese color.
export interface SoundEvent extends BaseEvent {
  kind: 'sound';
  sound: EventSound;
  position: [number, number, number];
  repeat?: number;
  interval?: number;
  delay?: number;
  light?: [number, number, number];
}

// Un mueble GLB de la sala (índice en `models`) aparece girado al volver.
// Girar sobre su centro conserva la huella de colisión (múltiplos de 180°, o
// de 90° si la base es cuadrada).
export interface MovedEvent extends BaseEvent {
  kind: 'moved';
  model: number;
  yaw: number;
}

// Un cuadro de la sala aparece con los ojos rayados. `position`/`size` son
// los del decal del cuadro y `eyes` las UV (0–1, v desde arriba) de los ojos.
export interface DefacedEvent extends BaseEvent {
  kind: 'defaced';
  texture: string;
  position: [number, number, number];
  size: [number, number, number];
  eyes: Array<[number, number]>;
}

export type RoomEventDef = ApparitionEvent | SoundEvent | MovedEvent | DefacedEvent;

export interface RoomEventHandle {
  def: RoomEventDef;
  object: THREE.Object3D | null;
}

const APPARITION_SHADE = 0.025;
const APPARITION_STARE_SECONDS = 2.5;
const APPARITION_NEAR = 3.5;
const APPARITION_VIEW_RANGE = 18;
const BEAM_HALF_ANGLE = THREE.MathUtils.degToRad(12);
const SOUND_DELAY = 1.5;
const SOUND_INTERVAL = 3;
const LIGHT_RANGE = 3.5;

// Figura alta y delgada, casi negra: sólo se distingue su contorno.
export function buildApparition(material: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const parts: Array<[number, number, number, number, number, number]> = [
    [0.13, 0.95, 0.15, -0.1, 0.475, 0],
    [0.13, 0.95, 0.15, 0.1, 0.475, 0],
    [0.4, 0.72, 0.22, 0, 1.31, 0],
    [0.09, 0.85, 0.1, -0.27, 1.2, 0],
    [0.09, 0.85, 0.1, 0.27, 1.2, 0],
    [0.09, 0.08, 0.09, 0, 1.7, 0],
    [0.22, 0.28, 0.24, 0.02, 1.86, 0],
  ];
  for (const [w, h, d, x, y, z] of parts) {
    const geometry = new THREE.BoxGeometry(w, h, d);
    geometry.translate(x, y, z);
    geometry.setAttribute(
      'a_color',
      new THREE.BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 3).fill(APPARITION_SHADE), 3),
    );
    group.add(new THREE.Mesh(geometry, material));
  }
  // La cabeza ladeada.
  group.children[group.children.length - 1].rotation.z = 0.25;
  group.visible = false;
  return group;
}

// Gira un modelo sobre el centro de su caja (el loader lo centró en XZ).
export function rotateModelInPlace(object: THREE.Object3D, yawDegrees: number): void {
  object.updateMatrixWorld(true);
  const before = new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());
  object.rotation.y = THREE.MathUtils.degToRad(yawDegrees);
  object.updateMatrixWorld(true);
  const after = new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());
  object.position.x += before.x - after.x;
  object.position.z += before.z - after.z;
  object.updateMatrixWorld(true);
}

export interface ScareContext {
  room: BuiltRoom;
  flags: Flags;
  posters: number;
  visits: number;
  camera: THREE.PerspectiveCamera;
  flashlightOn: boolean;
  flashlightRange: number;
  audio: AudioSystem;
}

interface ActiveApparition {
  handle: RoomEventHandle;
  stare: number;
}

interface ActiveSound {
  def: SoundEvent;
  timer: number;
  remaining: number;
  lightLeft: number;
}

export class ScareDirector {
  private apparitions: ActiveApparition[] = [];
  private sounds: ActiveSound[] = [];
  private readonly frustum = new THREE.Frustum();
  private readonly projection = new THREE.Matrix4();
  private readonly point = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private lightOn = false;
  private time = 0;

  constructor(private readonly random: () => number = Math.random) {}

  // Al entrar en una sala (ya construida y con el jugador dentro). Los
  // cambios persistentes (mueble girado, cuadro rayado) se aplican aquí,
  // antes de que acabe el fundido.
  enterRoom(context: ScareContext): void {
    this.leaveRoom();
    for (const handle of context.room.events) {
      const { def } = handle;
      const done = context.flags.has(`event:${def.id}`);
      if (def.kind === 'moved' || def.kind === 'defaced') {
        if (!done && this.ready(def, context)) {
          context.flags.set(`event:${def.id}`);
          this.applyPersistent(handle);
        } else if (done) {
          this.applyPersistent(handle);
        }
        continue;
      }
      if (done || !this.ready(def, context)) {
        continue;
      }
      if (def.kind === 'apparition' && handle.object) {
        handle.object.visible = true;
        this.apparitions.push({ handle, stare: 0 });
      } else if (def.kind === 'sound') {
        context.flags.set(`event:${def.id}`);
        this.sounds.push({ def, timer: def.delay ?? SOUND_DELAY, remaining: Math.max(1, def.repeat ?? 1), lightLeft: 0 });
      }
    }
  }

  // Al salir: las apariciones que no llegaste a ver vuelven a quedar armadas.
  leaveRoom(): void {
    for (const active of this.apparitions) {
      if (active.handle.object) {
        active.handle.object.visible = false;
      }
    }
    this.apparitions = [];
    this.sounds = [];
    this.setLight(null);
  }

  reset(): void {
    this.leaveRoom();
  }

  update(dt: number, context: ScareContext): void {
    this.time += dt;
    this.updateApparitions(dt, context);
    this.updateSounds(dt, context);
  }

  private ready(def: RoomEventDef, context: ScareContext): boolean {
    const when = def.when ?? {};
    if (context.posters < (when.posters ?? 0) || context.visits < (when.visits ?? 1)) {
      return false;
    }
    return this.random() < (when.chance ?? 1);
  }

  private applyPersistent(handle: RoomEventHandle): void {
    const { def, object } = handle;
    if (!object) {
      return;
    }
    if (def.kind === 'moved') {
      rotateModelInPlace(object, def.yaw);
    } else {
      object.visible = true;
    }
  }

  private updateApparitions(dt: number, context: ScareContext): void {
    if (this.apparitions.length === 0) {
      return;
    }
    const camera = context.camera;
    camera.updateMatrixWorld();
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projection);
    camera.getWorldDirection(this.forward);
    this.apparitions = this.apparitions.filter((active) => {
      const object = active.handle.object;
      if (!object) {
        return false;
      }
      this.point.set(object.position.x, 1.4, object.position.z);
      const toFigure = this.point.clone().sub(camera.position);
      const distance = Math.hypot(toFigure.x, toFigure.z);
      const inView = distance < APPARITION_VIEW_RANGE && this.frustum.containsPoint(this.point);
      if (inView) {
        active.stare += dt;
      }
      const lit =
        context.flashlightOn &&
        distance < context.flashlightRange &&
        toFigure.normalize().angleTo(this.forward) < BEAM_HALF_ANGLE;
      if (!lit && distance > APPARITION_NEAR && active.stare < APPARITION_STARE_SECONDS) {
        return true;
      }
      object.visible = false;
      context.flags.set(`event:${active.handle.def.id}`);
      context.audio.playAt(
        'whisper',
        object.position.x,
        object.position.z,
        camera.position.x,
        camera.position.z,
        camera.rotation.y,
        0.6,
      );
      return false;
    });
  }

  private updateSounds(dt: number, context: ScareContext): void {
    let light: SoundEvent | null = null;
    this.sounds = this.sounds.filter((active) => {
      active.timer -= dt;
      active.lightLeft -= dt;
      if (active.timer <= 0) {
        const [x, , z] = active.def.position;
        const camera = context.camera;
        context.audio.playAt(active.def.sound, x, z, camera.position.x, camera.position.z, camera.rotation.y, 1);
        active.remaining -= 1;
        active.timer = active.def.interval ?? SOUND_INTERVAL;
        active.lightLeft = (active.def.interval ?? SOUND_INTERVAL) * 0.85;
      }
      if (active.def.light && active.lightLeft > 0) {
        light = active.def;
      }
      return active.remaining > 0 || active.lightLeft > 0;
    });
    this.setLight(light);
  }

  // Parpadeo de pantalla: usa el hueco de luz pasajera de la sala.
  private setLight(def: SoundEvent | null): void {
    if (!def?.light) {
      if (this.lightOn) {
        setFireLight(null);
        this.lightOn = false;
      }
      return;
    }
    const flicker = 0.55 + 0.45 * Math.abs(Math.sin(this.time * 31) * Math.sin(this.time * 7.7));
    setFireLight(new THREE.Vector3(...def.position), def.light, flicker * 1.4, LIGHT_RANGE);
    this.lightOn = true;
  }
}
