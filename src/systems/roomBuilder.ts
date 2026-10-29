import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { TessellateModifier } from 'three/examples/jsm/modifiers/TessellateModifier.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AmbienceType, FloorMaterial, ReverbType } from './config';
import type { PsxConfig } from './config';
import { fetchJson } from './fetchJson';
import type { ItemDef, ItemKind } from './items';
import {
  atmosphereLights,
  createPsxMaterial,
  type Atmosphere,
  type PsxMaterialHandle,
  type SurfaceOptions,
} from './psxMaterial';
import { loadDefacedTexture, loadPosterTexture } from './proceduralTextures';
import type { SceneLightDef } from './sceneLights';
import { applyFiltering, loadNormalMap, loadPixelTexture } from './textures';
import { addVertexColors } from './vertexColors';
import { createEndingDoorDecoration, type EndingDoorDecoration } from './endingDoor';
import type { DemonicEye } from './demonicEye';
import { FleshGrowth, fleshColliders, type RoomFleshDef } from './fleshGrowth';
import { buildHideFurniture, computeHideSpot, type HideHandle, type RoomHide } from './hides';
import { buildApparition, type RoomEventDef, type RoomEventHandle } from './roomEvents';

export interface Collider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface RoomOpening {
  kind: 'door' | 'passage' | 'window';
  offset: number;
  width: number;
  height: number;
  sill?: number;
  door?: 'closed' | 'open';
  blocked?: boolean;
  to?: string | null;
  spawn?: string;
  key?: string | null;
  action?: 'open' | 'up' | 'down';
  requires?: string[];
  ending?: boolean;
  // Puerta de dos hojas: cada hoja gira sobre su jamba y se abre por el centro.
  double?: boolean;
}

export interface RoomWallRun {
  start: [number, number];
  end: [number, number];
  openings?: RoomOpening[];
  // Clave de textura propia para este muro (p. ej. fachada de ladrillo).
  texture?: string;
}

export interface RoomProp {
  kind: 'box';
  // Forma: caja (por defecto) o cilindro vertical (barriles, columnas, pantallas).
  shape?: 'box' | 'cylinder';
  position: [number, number, number];
  size: [number, number, number];
  texture?: string;
  tint?: number;
  collide?: boolean;
  // Decal plano apoyado en el suelo o pegado a un muro (manchas, cuadros,
  // paneles): se dibuja como una sola cara separada de la superficie para que
  // no pelee en el z-buffer con el muro o el suelo (parpadeo al moverse).
  decal?: boolean;
  // Mapear la textura 1:1 en cada cara (cuadros, ventanas de fachada, libros).
  fit?: boolean;
  // Sólo colisión (sin geometría visible).
  hidden?: boolean;
  // Giro en grados [X, Y, Z] (se aplica Z, luego X y por último el rumbo Y): troncos tumbados,
  // ramas, leños. La colisión sigue usando el AABB sin girar.
  rot?: [number, number, number];
}

// Modelo GLB opcional (mobiliario). La `position` es el punto donde apoyar el
// modelo: centro en XZ y altura del suelo en Y (se ajusta solo con el bbox).
// `node` extrae un nodo concreto si el GLB trae varios (nombre saneado por three,
// los espacios pasan a `_`). `size` es el AABB en XZ que usa el pathfinding del
// stalker: sin `size` el modelo no colisiona aunque `collide` sea true.
export interface RoomModelDef {
  file: string;
  // Nodo(s) a extraer si el GLB trae una escena compuesta. Acepta nombre exacto
  // saneado por three (espacios → `_`) o prefijo terminado en `*`.
  node?: string | string[];
  position: [number, number, number];
  yaw?: number;
  scale?: number;
  tint?: number;
  // Arista máxima en metros para subdividir la malla al cargar (mitiga el affine
  // warping del shader PSX en caras grandes). 0 desactiva la subdivisión.
  subdivision?: number;
  collide?: boolean;
  size?: [number, number, number];
}

export interface RoomItem {
  id: string;
  position: [number, number, number];
  yaw?: number;
}

// Luz de sala con su luminaria visible (colgante, bombilla desnuda, aplique).
export interface RoomLightDef extends SceneLightDef {
  fixture?: 'pendant' | 'bulb' | 'sconce' | 'none';
}

export interface RoomSpawn {
  position: [number, number];
  yaw: number;
}

export interface RoomDoorway {
  room: string;
  to: string;
  centerX: number;
  centerZ: number;
  heading: number;
  width: number;
  spawn: string;
  action: 'open' | 'up' | 'down';
  ending: boolean;
}

export interface RoomAudio {
  reverb: ReverbType;
  floor_material: FloorMaterial;
  ambience: AmbienceType;
}

export interface RoomData {
  id: string;
  name: string;
  size: [number, number, number];
  texture_scale: number;
  wall_thickness: number;
  textures: Record<string, string>;
  walls: RoomWallRun[];
  props?: RoomProp[];
  models?: RoomModelDef[];
  // Mapea la hoja de la puerta 1:1 (texturas de puerta fotografiadas, no tileables).
  door_fit?: boolean;
  items?: RoomItem[];
  spawns: Record<string, RoomSpawn>;
  audio?: Partial<RoomAudio>;
  // Override de niebla/ambiente por sala (sótano denso, M9).
  atmosphere?: Atmosphere;
  // Luces puntuales de la sala (PS2): bombillas y lámparas con luminaria.
  lights?: RoomLightDef[];
  // Exterior: sin techo ni molduras, con cielo nocturno.
  outdoor?: boolean;
  // Molduras (zócalo y cornisa). Por defecto sí en interiores.
  trim?: boolean;
  // Friso de madera en la parte baja del muro (clave de textura + altura).
  wainscot?: { texture: string; height?: number };
  // Escondites (M13): roperos/taquillas/confesionarios con colisión.
  hides?: RoomHide[];
  // Sustos con guion (M13), ver roomEvents.ts.
  events?: RoomEventDef[];
  // Carne de la maldición sobre muros, suelo y techo, ver fleshGrowth.ts.
  flesh?: RoomFleshDef[];
}

export interface DoorLeaf {
  group: THREE.Group;
  baseRotation: number;
  openAngle: number;
}

export interface DoorHandle {
  heading: number;
  halfWidth: number;
  name: string;
  group: THREE.Group | null;
  leaves: DoorLeaf[];
  to: string | null;
  spawn: string | null;
  key: string | null;
  action: 'open' | 'up' | 'down';
  requires: string[];
  ending: boolean;
  center: THREE.Vector3;
  // Punto al que apuntar para interactuar (el centro de la hoja en puertas
  // dobles, para que la mirada no se cuele por la junta de las dos hojas).
  aimPoint: THREE.Vector3;
  height: number;
  collider: Collider | null;
  // Candado de las puertas con llave: se quita con la llave antes de abrir.
  lock: DoorLock | null;
  // Ojo de la maldición: desaparece al quemar todos los afiches requeridos.
  endingEye: DemonicEye | null;
  // Identificador estable de la cerradura (sala→destino) para los flags.
  lockId: string;
}

export interface DoorLock {
  group: THREE.Group;
  // Candado colgante (cae al suelo al abrirlo) y su grillete (salta).
  body: THREE.Group;
  shackle: THREE.Object3D;
}

export interface ItemHandle {
  id: string;
  kind: ItemKind;
  object: THREE.Object3D;
  position: THREE.Vector3;
  taken: boolean;
}

export interface BuiltRoom {
  id: string;
  name: string;
  mapSize: readonly [width: number, depth: number];
  scene: THREE.Scene;
  colliders: Collider[];
  doors: DoorHandle[];
  items: ItemHandle[];
  spawns: Record<string, RoomSpawn>;
  audio: RoomAudio;
  atmosphere: Atmosphere | null;
  lights: SceneLightDef[];
  outdoor: boolean;
  hides: HideHandle[];
  events: RoomEventHandle[];
  // Raíces de los GLB por índice de `models` (null si no cargó).
  models: Array<THREE.Object3D | null>;
  flesh: FleshGrowth | null;
  sync: (config: PsxConfig) => void;
  triangleCount: number;
}

const TEXTURES_BASE = `${import.meta.env.BASE_URL}assets/textures/horror_pack/`;
const TEXTURES_ROOT = `${import.meta.env.BASE_URL}assets/textures/`;
const DEFAULT_TRIM = 'ps2/wood_dark.png';

// Las texturas "ps2/..." (set propio de 256 px con normal map) viven en
// assets/textures/ps2; el resto son rutas del Horror Pack heredado.
function textureUrl(path: string): string {
  return path.startsWith('ps2/') ? TEXTURES_ROOT + path : TEXTURES_BASE + path;
}

// Respuesta especular por tipo de superficie (según el nombre del archivo).
function surfaceFor(path: string): SurfaceOptions {
  const name = path.toLowerCase();
  if (name.includes('window')) return { spec: 0.7, gloss: 70, emissive: 0.28 };
  if (name.includes('embers')) return { spec: 0.0, gloss: 4, emissive: 1.6 };
  if (name.includes('water')) return { spec: 0.9, gloss: 90 };
  if (name.includes('tile')) return { spec: 0.55, gloss: 48 };
  if (name.includes('metal') || name.includes('corrugated')) return { spec: 0.45, gloss: 30 };
  if (name.includes('floor_') || name.includes('door_') || name.includes('wainscot')) return { spec: 0.25, gloss: 22 };
  if (name.includes('wood')) return { spec: 0.16, gloss: 18 };
  if (name.includes('carpet') || name.includes('grass') || name.includes('hedge')) return { spec: 0.0, gloss: 4, normalStrength: 1.2 };
  return { spec: 0.05, gloss: 10 };
}
const MODELS_BASE = `${import.meta.env.BASE_URL}assets/models/furniture/`;
const REQUIRED_TEXTURES = ['wall', 'floor', 'ceiling', 'door'];
const DOOR_SWING = 1.66;
const DOOR_THICKNESS = 0.07;

// Molduras pegadas a la cara interior del muro: alto y fondo (m).
const TRIM = {
  base: { height: 0.14, depth: 0.028 },
  wainscot: { depth: 0.018 },
  rail: { drop: 0.015, height: 0.05, depth: 0.034 },
  crown: { height: 0.11, depth: 0.05 },
  crownStep: { height: 0.05, depth: 0.025 },
};

// Cuánto sobresalen las molduras a una altura dada (la carne trepa por encima).
function wallRelief(data: RoomData, outdoor: boolean): (y: number) => number {
  if (!(data.trim ?? !outdoor)) return () => 0;
  const height = data.size[1];
  const wainscotTop = data.wainscot && (data.wainscot.height ?? 1.0) > 0.25 ? (data.wainscot.height ?? 1.0) : 0;
  return (y) => {
    if (y >= height - TRIM.crown.height) return TRIM.crown.depth;
    if (y >= height - TRIM.crown.height - TRIM.crownStep.height) return TRIM.crownStep.depth;
    if (y < TRIM.base.height) return TRIM.base.depth;
    if (y >= wainscotTop - TRIM.rail.drop && y < wainscotTop - TRIM.rail.drop + TRIM.rail.height) return TRIM.rail.depth;
    return y < wainscotTop ? TRIM.wainscot.depth : 0;
  };
}

const FALLBACK_ROOM_AUDIO: RoomAudio = { reverb: 'small', floor_material: 'wood', ambience: 'house' };

const ROOM_AUDIO_DEFAULTS: Record<string, RoomAudio> = {
  room_vestibulo: { reverb: 'hall', floor_material: 'wood', ambience: 'house' },
  room_salon: { reverb: 'hall', floor_material: 'wood', ambience: 'house' },
  room_comedor: { reverb: 'hall', floor_material: 'wood', ambience: 'house' },
  room_cocina: { reverb: 'small', floor_material: 'tile', ambience: 'house' },
  room_pasillo: { reverb: 'corridor', floor_material: 'wood', ambience: 'house' },
  room_bano: { reverb: 'small', floor_material: 'tile', ambience: 'house' },
  room_despacho: { reverb: 'small', floor_material: 'wood', ambience: 'house' },
  room_escalera: { reverb: 'corridor', floor_material: 'wood', ambience: 'house' },
  room_pasillo_alto: { reverb: 'corridor', floor_material: 'wood', ambience: 'house' },
  room_dormitorio: { reverb: 'small', floor_material: 'wood', ambience: 'house' },
  room_cuarto: { reverb: 'small', floor_material: 'wood', ambience: 'house' },
  room_bano_alto: { reverb: 'small', floor_material: 'tile', ambience: 'house' },
  room_invitados: { reverb: 'small', floor_material: 'wood', ambience: 'house' },
  room_trastero: { reverb: 'small', floor_material: 'wood', ambience: 'house' },
  room_sotano: { reverb: 'corridor', floor_material: 'stone', ambience: 'basement' },
  room_lavanderia: { reverb: 'cave', floor_material: 'stone', ambience: 'basement' },
  room_calderas: { reverb: 'cave', floor_material: 'metal', ambience: 'basement' },
  room_bodega: { reverb: 'cave', floor_material: 'stone', ambience: 'basement' },
};

export async function loadRoomData(id: string): Promise<RoomData> {
  const url = `${import.meta.env.BASE_URL}rooms/${id}.json`;
  return fetchJson<RoomData>(url);
}

export function computeColliders(data: RoomData): Collider[] {
  const thickness = data.wall_thickness;
  const colliders: Collider[] = [];

  for (const run of data.walls) {
    const [startX, startZ] = run.start;
    const [endX, endZ] = run.end;
    const dx = endX - startX;
    const dz = endZ - startZ;
    const length = Math.hypot(dx, dz);
    const dirX = dx / length;
    const dirZ = dz / length;
    const heading = Math.atan2(-dirZ, dirX);

    let cursor = 0;
    for (const opening of sortedOpenings(run)) {
      if (opening.offset > cursor) {
        const center = (cursor + opening.offset) / 2;
        colliders.push(
          colliderForBox(
            startX + dirX * center,
            startZ + dirZ * center,
            heading,
            opening.offset - cursor,
            thickness,
          ),
        );
      }
      cursor = opening.offset + opening.width;
    }
    if (cursor < length) {
      const center = (cursor + length) / 2;
      colliders.push(
        colliderForBox(
          startX + dirX * center,
          startZ + dirZ * center,
          heading,
          length - cursor,
          thickness,
        ),
      );
    }

    for (const opening of sortedOpenings(run)) {
      const centerX = startX + dirX * (opening.offset + opening.width / 2);
      const centerZ = startZ + dirZ * (opening.offset + opening.width / 2);
      if ((opening.sill ?? 0) > 0) {
        colliders.push(colliderForBox(centerX, centerZ, heading, opening.width, thickness));
      }
      if (opening.kind === 'door') {
        colliders.push(colliderForBox(centerX, centerZ, heading, opening.width, DOOR_THICKNESS));
      } else if (opening.kind === 'passage' && opening.blocked) {
        colliders.push(colliderForBox(centerX, centerZ, heading, opening.width, thickness));
      }
    }
  }

  for (const prop of data.props ?? []) {
    if (!prop.collide) {
      continue;
    }
    const [px, , pz] = prop.position;
    const [sx, , sz] = prop.size;
    colliders.push({ minX: px - sx / 2, maxX: px + sx / 2, minZ: pz - sz / 2, maxZ: pz + sz / 2 });
  }

  for (const model of data.models ?? []) {
    if (!model.collide || !model.size) {
      continue;
    }
    const [px, , pz] = model.position;
    const [sx, , sz] = model.size;
    colliders.push({ minX: px - sx / 2, maxX: px + sx / 2, minZ: pz - sz / 2, maxZ: pz + sz / 2 });
  }

  for (const hide of data.hides ?? []) {
    colliders.push({ ...computeHideSpot(hide).collider });
  }

  colliders.push(...fleshColliders(data.flesh ?? [], data.size, thickness));

  return colliders;
}

export function computeDoorways(data: RoomData): RoomDoorway[] {
  const doorways: RoomDoorway[] = [];

  for (const run of data.walls) {
    const [startX, startZ] = run.start;
    const [endX, endZ] = run.end;
    const dx = endX - startX;
    const dz = endZ - startZ;
    const length = Math.hypot(dx, dz);
    const dirX = dx / length;
    const dirZ = dz / length;
    const heading = Math.atan2(-dirZ, dirX);

    for (const opening of sortedOpenings(run)) {
      if (!opening.to || opening.kind === 'window') {
        continue;
      }
      doorways.push({
        room: data.id,
        to: opening.to,
        centerX: startX + dirX * (opening.offset + opening.width / 2),
        centerZ: startZ + dirZ * (opening.offset + opening.width / 2),
        heading,
        width: opening.width,
        spawn: opening.spawn ?? 'start',
        action: opening.action ?? 'open',
        ending: opening.ending ?? false,
      });
    }
  }

  return doorways;
}

function sortedOpenings(run: RoomWallRun): RoomOpening[] {
  return [...(run.openings ?? [])].sort((a, b) => a.offset - b.offset);
}

function findCollider(
  colliders: Collider[],
  centerX: number,
  centerZ: number,
  heading: number,
  length: number,
  thickness: number,
): Collider | null {
  const wanted = colliderForBox(centerX, centerZ, heading, length, thickness);
  return (
    colliders.find(
      (collider) =>
        Math.abs(collider.minX - wanted.minX) < 1e-6 &&
        Math.abs(collider.maxX - wanted.maxX) < 1e-6 &&
        Math.abs(collider.minZ - wanted.minZ) < 1e-6 &&
        Math.abs(collider.maxZ - wanted.maxZ) < 1e-6,
    ) ?? null
  );
}

export async function buildRoom(
  data: RoomData,
  config: PsxConfig,
  catalog: Map<string, ItemDef>,
): Promise<BuiltRoom> {
  for (const key of REQUIRED_TEXTURES) {
    if (!data.textures[key]) {
      throw new Error(`La sala ${data.id} no define la textura "${key}"`);
    }
  }
  const textureMap: Record<string, string> = { ...data.textures };
  textureMap.trim ??= DEFAULT_TRIM;
  textureMap.fixture ??= 'ps2/metal_clean.png';
  const textureKeys = Object.keys(textureMap);
  const loader = new THREE.TextureLoader();
  const [textures, normals] = await Promise.all([
    Promise.all(textureKeys.map((key) => loadPixelTexture(loader, textureUrl(textureMap[key])))),
    Promise.all(
      textureKeys.map((key) =>
        textureMap[key].startsWith('ps2/')
          ? loadNormalMap(loader, textureUrl(textureMap[key]))
          : Promise.resolve(null),
      ),
    ),
  ]);

  const outdoor = data.outdoor ?? data.atmosphere?.outdoor ?? false;
  const atmosphere = data.atmosphere ?? null;
  const materials = Object.fromEntries(
    textureKeys.map((key, index) => [
      key,
      createPsxMaterial(config, textures[index], atmosphere, {
        ...surfaceFor(textureMap[key]),
        normalMap: normals[index],
      }),
    ]),
  ) as Record<string, PsxMaterialHandle>;

  // El afiche es el objetivo: en la casa y el jardín el papel blanco se
  // distingue siempre en la penumbra (leve auto-iluminación + ambiente de la
  // sala); en el sótano a oscuras apenas se ve y hay que usar la linterna.
  const darkRoom = (atmosphere?.ambient ?? 0.3) < 0.1;
  const posterAtmosphere: Atmosphere = atmosphere
    ? { ...atmosphere, ambient: darkRoom ? atmosphere.ambient : Math.max(atmosphere.ambient ?? 0.3, 0.3), direct: 0 }
    : { direct: 0 };
  const posterMaterial = createPsxMaterial(config, loadPosterTexture(), posterAtmosphere, {
    spec: 0.18,
    gloss: 30,
    noDirect: true,
    emissive: darkRoom ? 0.05 : 0.3,
  });

  const scene = new THREE.Scene();
  const colliders = computeColliders(data);
  const doors: DoorHandle[] = [];
  const items: ItemHandle[] = [];
  const buckets: Record<string, THREE.BufferGeometry[]> = Object.fromEntries(
    textureKeys.map((key) => [key, [] as THREE.BufferGeometry[]]),
  );
  const extraMaterials: PsxMaterialHandle[] = [];
  const endingDecorations: EndingDoorDecoration[] = [];

  const [width, height, depth] = data.size;
  const thickness = data.wall_thickness;
  const texScale = data.texture_scale;
  const halfW = width / 2 - thickness / 2;
  const halfD = depth / 2 - thickness / 2;

  // Oclusión ambiental horneada en vértices: rincones, encuentro con el suelo
  // y con el techo más oscuros (el truco de iluminación de la época).
  const wallAO = (x: number, y: number, z: number): number => {
    const dx = Math.max(0, halfW - Math.abs(x));
    const dz = Math.max(0, halfD - Math.abs(z));
    const corner = Math.max(dx, dz);
    const bottom = 1 - 0.42 * Math.exp(-Math.max(0, y) / 0.4);
    const top = outdoor ? 1 : 1 - 0.28 * Math.exp(-Math.max(0, height - y) / 0.35);
    const side = 1 - 0.32 * Math.exp(-corner / 0.45);
    return 0.98 * bottom * top * side;
  };
  const floorAO = (x: number, z: number): number => {
    const dx = Math.max(0, halfW - Math.abs(x));
    const dz = Math.max(0, halfD - Math.abs(z));
    const edge = Math.min(dx, dz);
    const corner = Math.hypot(Math.max(0, 0.9 - dx), Math.max(0, 0.9 - dz));
    return (1 - 0.4 * Math.exp(-edge / 0.4)) * (1 - 0.2 * THREE.MathUtils.clamp(corner, 0, 1));
  };

  const floor = planeGeometry(width, depth, texScale);
  floor.rotateX(-Math.PI / 2);
  scaleUVs(floor, width / texScale, depth / texScale);
  paintVertexColors(floor, (x, _y, z) => floorAO(x, z));
  buckets.floor.push(floor);

  if (!outdoor) {
    const ceiling = planeGeometry(width, depth, texScale);
    ceiling.rotateX(Math.PI / 2);
    ceiling.translate(0, height, 0);
    scaleUVs(ceiling, width / texScale, depth / texScale);
    paintVertexColors(ceiling, (x, _y, z) => 0.8 * floorAO(x, z));
    buckets.ceiling.push(ceiling);
  } else {
    scene.add(buildSky(Math.max(width, depth)));
  }

  function addBox(
    bucket: string,
    params: {
      originX: number;
      originZ: number;
      dirX: number;
      dirZ: number;
      heading: number;
      center: number;
      length: number;
      y0: number;
      height: number;
      thickness: number;
      shade?: number;
    },
  ): void {
    const geometry = boxGeometry(params.length, params.height, params.thickness, texScale);
    scaleBoxUVs(geometry, params.length, params.height, params.thickness, texScale);
    geometry.rotateY(params.heading);
    const centerX = params.originX + params.dirX * params.center;
    const centerZ = params.originZ + params.dirZ * params.center;
    geometry.translate(centerX, params.y0 + params.height / 2, centerZ);
    paintVertexColors(geometry, (x, y, z) => wallAO(x, y, z) * (params.shade ?? 1));
    (buckets[bucket] ?? buckets.wall).push(geometry);
  }

  // Tira pegada a la cara INTERIOR del muro (zócalo, cornisa, friso, alféizar).
  function addInnerStrip(
    bucket: string,
    run: { startX: number; startZ: number; dirX: number; dirZ: number; heading: number; inX: number; inZ: number },
    from: number,
    to: number,
    y0: number,
    stripHeight: number,
    stripDepth: number,
    shade = 1,
  ): void {
    const length = to - from;
    if (length <= 0.01 || stripHeight <= 0.001) {
      return;
    }
    const geometry = boxGeometry(length, stripHeight, stripDepth, texScale);
    scaleBoxUVs(geometry, length, stripHeight, stripDepth, texScale);
    geometry.rotateY(run.heading);
    const center = (from + to) / 2;
    const offset = thickness / 2 + stripDepth / 2 - 0.002;
    geometry.translate(
      run.startX + run.dirX * center + run.inX * offset,
      y0 + stripHeight / 2,
      run.startZ + run.dirZ * center + run.inZ * offset,
    );
    paintVertexColors(geometry, (x, y, z) => wallAO(x, y, z) * shade);
    (buckets[bucket] ?? buckets.wall).push(geometry);
  }

  function buildDoorLeaf(
    originX: number,
    originZ: number,
    dirX: number,
    dirZ: number,
    heading: number,
    opening: RoomOpening,
    leafWidth: number,
    hingeAtEnd: boolean,
    faceSign: number,
    doorIndex: number,
  ): THREE.Group {
    // La hoja es tan ancha como el hueco y se mete 1 cm en el cabecero: sin
    // rendijas negras entre hoja y marco (antes se veía el vacío detrás).
    const slabHeight = opening.height + 0.01;
    const slab = boxGeometry(leafWidth, slabHeight, 0.07, texScale);
    scaleBoxUVs(slab, leafWidth, opening.height, 0.07, texScale);
    if (data.door_fit) {
      scaleUVs(slab, texScale / leafWidth, texScale / opening.height);
    }
    paintVertexColors(slab, (_x, y) => 0.75 + 0.25 * THREE.MathUtils.clamp((y + opening.height / 2) / 0.6, 0, 1));
    const mesh = new THREE.Mesh(slab, materials.door.material);
    mesh.position.set(leafWidth / 2, slabHeight / 2, 0);

    // Picaporte de latón a ambos lados: roseta + pomo (cilindros de 10 lados).
    const knobParts: THREE.BufferGeometry[] = [];
    const handleX = opening.double ? leafWidth - 0.1 : leafWidth - 0.1;
    for (const face of [-1, 1]) {
      const rose = new THREE.CylinderGeometry(0.035, 0.035, 0.012, 12);
      rose.rotateX(Math.PI / 2);
      rose.translate(handleX - leafWidth / 2, -0.08, face * 0.041);
      const neck = new THREE.CylinderGeometry(0.012, 0.012, 0.05, 8);
      neck.rotateX(Math.PI / 2);
      neck.translate(handleX - leafWidth / 2, -0.08, face * 0.065);
      const knob = new THREE.SphereGeometry(0.03, 10, 8);
      knob.scale(1, 1, 0.8);
      knob.translate(handleX - leafWidth / 2, -0.08, face * 0.095);
      knobParts.push(rose, neck, knob);
    }
    const knobs = mergeGeometries(knobParts.map((g) => g.toNonIndexed()), false);
    if (!knobs) {
      throw new Error(`No se pudo construir la puerta ${doorIndex} de ${data.id}`);
    }
    paintVertexColors(knobs, () => [1.15, 0.92, 0.55]);
    const knobMesh = new THREE.Mesh(knobs, materials.fixture.material);
    knobMesh.position.copy(mesh.position);
    void hingeAtEnd;
    void faceSign;

    const group = new THREE.Group();
    group.name = `door_${data.id}_${doorIndex}${hingeAtEnd ? 'b' : ''}`;
    const hinge = hingeAtEnd ? opening.offset + opening.width : opening.offset;
    group.position.set(originX + dirX * hinge, 0, originZ + dirZ * hinge);
    group.rotation.y = hingeAtEnd ? heading + Math.PI : heading;
    group.add(mesh, knobMesh);
    if (opening.key) {
      // Cara de la hoja que mira a esta sala (el candado se ve desde aquí).
      const toCenterX = -(originX + dirX * (opening.offset + opening.width / 2));
      const toCenterZ = -(originZ + dirZ * (opening.offset + opening.width / 2));
      const side = Math.sin(group.rotation.y) * toCenterX + Math.cos(group.rotation.y) * toCenterZ >= 0 ? 1 : -1;
      const lock = buildPadlock(materials.fixture.material, side);
      // Candado grande y bien visible, en el canto libre (el pasador cruza al marco).
      lock.group.position.set(leafWidth - 0.08, mesh.position.y - 0.08 + 0.26, 0);
      lock.group.scale.setScalar(1.9);
      group.add(lock.group);
      group.userData.lock = lock;
    }
    scene.add(group);
    return group;
  }

  for (const run of data.walls) {
    const [startX, startZ] = run.start;
    const [endX, endZ] = run.end;
    const dx = endX - startX;
    const dz = endZ - startZ;
    const length = Math.hypot(dx, dz);
    const dirX = dx / length;
    const dirZ = dz / length;
    const heading = Math.atan2(-dirZ, dirX);
    const openings = [...(run.openings ?? [])].sort((a, b) => a.offset - b.offset);
    let inX = -dirZ;
    let inZ = dirX;
    const midX = startX + dirX * (length / 2);
    const midZ = startZ + dirZ * (length / 2);
    if (inX * -midX + inZ * -midZ < 0) {
      inX = -inX;
      inZ = -inZ;
    }
    const runInfo = { startX, startZ, dirX, dirZ, heading, inX, inZ };
    const wallKey = run.texture && buckets[run.texture] ? run.texture : 'wall';
    const trimEnabled = data.trim ?? !outdoor;

    const pieces: Array<{ from: number; to: number }> = [];
    let cursor = 0;
    for (const opening of openings) {
      if (opening.offset > cursor) {
        pieces.push({ from: cursor, to: opening.offset });
      }
      cursor = opening.offset + opening.width;
    }
    if (cursor < length) {
      pieces.push({ from: cursor, to: length });
    }

    for (const piece of pieces) {
      addBox(
        wallKey,
        {
          originX: startX,
          originZ: startZ,
          dirX,
          dirZ,
          heading,
          center: (piece.from + piece.to) / 2,
          length: piece.to - piece.from,
          y0: 0,
          height,
          thickness,
        },
      );
    }

    if (trimEnabled) {
      const spans = [
        ...pieces.map((piece) => ({ ...piece, cap: Infinity })),
        ...openings
          .filter((opening) => opening.kind === 'window')
          .map((opening) => ({ from: opening.offset, to: opening.offset + opening.width, cap: opening.sill ?? 0 })),
      ];
      const wainscotHeight = data.wainscot ? (data.wainscot.height ?? 1.0) : 0;
      for (const span of spans) {
        addInnerStrip('trim', runInfo, span.from, span.to, 0, TRIM.base.height, TRIM.base.depth, 0.8);
        if (data.wainscot && wainscotHeight > 0.2) {
          const top = Math.min(wainscotHeight, span.cap - 0.05);
          if (top > 0.25) {
            addInnerStrip(data.wainscot.texture, runInfo, span.from, span.to, TRIM.base.height, top - TRIM.base.height, TRIM.wainscot.depth);
            addInnerStrip('trim', runInfo, span.from, span.to, top - TRIM.rail.drop, TRIM.rail.height, TRIM.rail.depth, 0.95);
          }
        }
      }
      addInnerStrip('trim', runInfo, 0, length, height - TRIM.crown.height, TRIM.crown.height, TRIM.crown.depth, 0.85);
      addInnerStrip('trim', runInfo, 0, length, height - TRIM.crown.height - TRIM.crownStep.height, TRIM.crownStep.height, TRIM.crownStep.depth, 0.85);
    }

    for (const opening of openings) {
      const sill = opening.sill ?? 0;
      const top = sill + opening.height;
      const openingCenter = opening.offset + opening.width / 2;

      if (opening.kind === 'window' && trimEnabled) {
        const a = opening.offset;
        const b = opening.offset + opening.width;
        addInnerStrip('trim', runInfo, a - 0.08, b + 0.08, sill - 0.05, 0.05, 0.1, 0.9);
        addInnerStrip('trim', runInfo, a - 0.08, a, sill, opening.height, 0.03, 0.9);
        addInnerStrip('trim', runInfo, b, b + 0.08, sill, opening.height, 0.03, 0.9);
        addInnerStrip('trim', runInfo, a - 0.08, b + 0.08, top, 0.08, 0.03, 0.9);
      }

      if (top < height) {
        addBox(
          wallKey,
          {
            originX: startX,
            originZ: startZ,
            dirX,
            dirZ,
            heading,
            center: openingCenter,
            length: opening.width,
            y0: top,
            height: height - top,
            thickness,
          },
        );
      }

      if (sill > 0) {
        addBox(
          wallKey,
          {
            originX: startX,
            originZ: startZ,
            dirX,
            dirZ,
            heading,
            center: openingCenter,
            length: opening.width,
            y0: 0,
            height: sill,
            thickness,
          },
        );
      }

      if (opening.kind === 'door' || opening.kind === 'passage') {
        const frameDepth = thickness + 0.06;
        const frameOverlap = 0.005;
        for (const side of [-1, 1]) {
          const jamb = openingCenter + side * (opening.width / 2 + 0.04);
          addBox(
            'trim',
            {
              originX: startX,
              originZ: startZ,
              dirX,
              dirZ,
              heading,
              center: jamb - side * frameOverlap,
              length: 0.08,
              y0: 0,
              height: opening.height - frameOverlap,
              thickness: frameDepth,
            },
          );
        }
        addBox(
          'trim',
          {
            originX: startX,
            originZ: startZ,
            dirX,
            dirZ,
            heading,
            center: openingCenter,
            length: opening.width + 0.16,
            y0: opening.height - frameOverlap,
            height: 0.08,
            thickness: frameDepth,
          },
        );
      }

      const centerX = startX + dirX * openingCenter;
      const centerZ = startZ + dirZ * openingCenter;

      if (opening.kind === 'door') {
        const towardCenter = dirZ * centerX - dirX * centerZ;
        const faceSign = towardCenter >= 0 ? 1 : -1;
        const openAngle = towardCenter >= 0 ? DOOR_SWING : -DOOR_SWING;
        const doorIndex = doors.length + 1;
        const leaves: DoorLeaf[] = [];
        let aimX = centerX;
        let aimZ = centerZ;
        if (opening.double) {
          const leafWidth = opening.width / 2;
          const left = buildDoorLeaf(
            startX, startZ, dirX, dirZ, heading, opening, leafWidth, false, faceSign, doorIndex,
          );
          const right = buildDoorLeaf(
            startX, startZ, dirX, dirZ, heading, opening, leafWidth, true, faceSign, doorIndex,
          );
          leaves.push(
            { group: left, baseRotation: heading, openAngle },
            { group: right, baseRotation: heading + Math.PI, openAngle: -openAngle },
          );
          aimX = startX + dirX * (opening.offset + leafWidth / 2);
          aimZ = startZ + dirZ * (opening.offset + leafWidth / 2);
        } else {
          const group = buildDoorLeaf(
            startX, startZ, dirX, dirZ, heading, opening, opening.width, false, faceSign, doorIndex,
          );
          leaves.push({ group, baseRotation: heading, openAngle });
        }
        let endingEye: DemonicEye | null = null;
        if (opening.ending) {
          const decoration = createEndingDoorDecoration(
            config, atmosphere, opening.width, opening.height, thickness,
          );
          decoration.group.position.set(centerX, 0, centerZ);
          decoration.group.rotation.y = heading + (faceSign < 0 ? Math.PI : 0);
          scene.add(decoration.group);
          endingDecorations.push(decoration);
          endingEye = decoration.eye;
        }
        doors.push({
          heading,
          halfWidth: opening.width / 2,
          name: leaves[0].group.name,
          group: leaves[0].group,
          leaves,
          to: opening.to ?? null,
          spawn: opening.spawn ?? null,
          key: opening.key ?? null,
          action: opening.action ?? 'open',
          requires: opening.requires ?? [],
          ending: opening.ending ?? false,
          center: new THREE.Vector3(centerX, 0, centerZ),
          aimPoint: new THREE.Vector3(aimX, 0, aimZ),
          height: opening.height,
          collider: findCollider(colliders, centerX, centerZ, heading, opening.width, DOOR_THICKNESS),
          lock: (leaves[0].group.userData.lock as DoorLock | undefined) ?? null,
          endingEye,
          lockId: `${data.id}>${opening.to ?? 'exit'}`,
        });
      } else if (opening.kind === 'passage') {
        if (!opening.blocked && opening.to) {
          doors.push({
            heading,
            halfWidth: opening.width / 2,
            name: `passage_${data.id}_${doors.length + 1}`,
            group: null,
            leaves: [],
            to: opening.to,
            spawn: opening.spawn ?? null,
            key: opening.key ?? null,
            action: opening.action ?? 'open',
            requires: opening.requires ?? [],
            ending: opening.ending ?? false,
            center: new THREE.Vector3(centerX, 0, centerZ),
            aimPoint: new THREE.Vector3(centerX, 0, centerZ),
            height: opening.height,
            collider: null,
            lock: null,
            endingEye: null,
            lockId: `${data.id}>${opening.to}`,
          });
        }
      } else {
        const glass = planeGeometry(opening.width, opening.height, texScale);
        glass.rotateY(heading);
        const normal = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
        const toCenter = new THREE.Vector3(-centerX, 0, -centerZ).normalize();
        if (normal.dot(toCenter) < 0) {
          glass.rotateY(Math.PI);
        }
        glass.translate(centerX, sill + opening.height / 2, centerZ);
        if (buckets.window) {
          paintVertexColors(glass, () => [0.65, 0.7, 0.8]);
          buckets.window.push(glass);
        } else {
          paintVertexColors(glass, () => [0.1, 0.14, 0.22]);
          buckets.wall.push(glass);
        }
      }
    }
  }

  const decalBuckets: Record<string, THREE.BufferGeometry[]> = {};

  for (const prop of data.props ?? []) {
    if (prop.hidden) {
      continue;
    }
    if (prop.decal) {
      const key = prop.texture && buckets[prop.texture] ? prop.texture : 'wall';
      // Alfombras, caminos y azulejos se repiten; manchas y cuadros van 1:1.
      const tile = !prop.fit && !(textureMap[key] ?? '').includes('Stain');
      const geometry = decalGeometry(prop, width, height, depth, thickness, texScale, tile);
      const stain = (textureMap[key] ?? '').includes('Stain');
      const decalTint = stain ? 0.55 + 0.45 * (prop.tint ?? 1) : 0.35 + 0.65 * (prop.tint ?? 1);
      paintVertexColors(geometry, () => decalTint);
      (decalBuckets[key] ??= []).push(geometry);
      continue;
    }
    const [px, py, pz] = prop.position;
    const [sx, sy, sz] = prop.size;
    let geometry: THREE.BufferGeometry;
    if (prop.shape === 'cylinder') {
      const radius = Math.max(sx, sz) / 2;
      geometry = new THREE.CylinderGeometry(radius, radius, sy, 14, Math.max(1, Math.round(sy * 2)));
      // Lateral: perímetro × alto; tapas: diámetro (antes se estiraban).
      const uv = geometry.getAttribute('uv');
      const side = geometry.groups[0];
      const index = geometry.getIndex();
      const sideVertices = new Set<number>();
      if (side && index) {
        for (let k = side.start; k < side.start + side.count; k += 1) sideVertices.add(index.getX(k));
      }
      for (let v = 0; v < uv.count; v += 1) {
        if (sideVertices.has(v)) {
          uv.setXY(v, uv.getX(v) * ((Math.PI * 2 * radius) / texScale), uv.getY(v) * (sy / texScale));
        } else {
          uv.setXY(v, uv.getX(v) * ((radius * 2) / texScale), uv.getY(v) * ((radius * 2) / texScale));
        }
      }
      uv.needsUpdate = true;
    } else {
      geometry = boxGeometry(sx, sy, sz, texScale);
      if (!prop.fit) {
        scaleBoxUVs(geometry as THREE.BoxGeometry, sx, sy, sz, texScale);
      }
    }
    if (prop.rot) {
      // Orden: inclinación (Z, X) y luego rumbo (Y).
      geometry.rotateZ(THREE.MathUtils.degToRad(prop.rot[2]));
      geometry.rotateX(THREE.MathUtils.degToRad(prop.rot[0]));
      geometry.rotateY(THREE.MathUtils.degToRad(prop.rot[1]));
    }
    geometry.translate(px, py, pz);
    // Las tintas venían pensadas para la luz plana del PSX; con luz por píxel
    // se comprimen hacia arriba y se añade sombra de contacto en la base.
    const tint = 0.3 + 0.7 * (prop.tint ?? 1);
    const base = py - sy / 2;
    paintVertexColors(
      geometry,
      (_x, y) => tint * (0.7 + 0.3 * THREE.MathUtils.clamp((y - base) / 0.45, 0, 1)),
    );
    const bucket = buckets[prop.texture ?? 'wall'] ?? buckets.wall;
    bucket.push(geometry);
  }

  const models: Array<THREE.Object3D | null> = [];
  for (const model of data.models ?? []) {
    try {
      const object = await loadRoomModel(model, config, atmosphere, extraMaterials);
      scene.add(object);
      models.push(object);
    } catch (error) {
      console.warn(`[M10] No se pudo cargar el modelo ${model.file} de ${data.id}`, error);
      models.push(null);
    }
  }

  const hides = (data.hides ?? []).map((def) => {
    const spot = computeHideSpot(def);
    const handle = buildHideFurniture(spot, (def.kind === 'locker' ? materials.fixture : materials.trim).material);
    scene.add(handle.group);
    return handle;
  });

  const flesh = data.flesh?.length
    ? new FleshGrowth(config, atmosphere, data.flesh, {
      size: data.size, thickness, walls: data.walls, relief: wallRelief(data, outdoor),
    })
    : null;
  if (flesh) scene.add(flesh.group);

  const events: RoomEventHandle[] = [];
  let apparitionMaterial: PsxMaterialHandle | null = null;
  for (const def of data.events ?? []) {
    let object: THREE.Object3D | null = null;
    if (def.kind === 'apparition') {
      if (!apparitionMaterial) {
        apparitionMaterial = createPsxMaterial(config, whitePixelTexture(), atmosphere, { spec: 0, noDirect: true });
        extraMaterials.push(apparitionMaterial);
      }
      object = buildApparition(apparitionMaterial.material);
      object.position.set(def.position[0], 0, def.position[1]);
      object.name = `event_${def.id}`;
      scene.add(object);
    } else if (def.kind === 'moved') {
      object = models[def.model] ?? null;
    } else if (def.kind === 'defaced') {
      // Copia del cuadro con los ojos rayados, un pelo por delante del original.
      const geometry = decalGeometry(
        { kind: 'box', position: def.position, size: def.size, decal: true, fit: true },
        width, height, depth, thickness, texScale,
      );
      const normal = new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('normal'), 0);
      geometry.translate(normal.x * 0.004, normal.y * 0.004, normal.z * 0.004);
      paintVertexColors(geometry, () => 0.87);
      const handle = createPsxMaterial(config, loadDefacedTexture(textureUrl(def.texture), def.eyes), atmosphere, { spec: 0.12 });
      handle.material.side = THREE.FrontSide;
      handle.material.polygonOffset = true;
      handle.material.polygonOffsetFactor = -2;
      handle.material.polygonOffsetUnits = -2;
      extraMaterials.push(handle);
      object = new THREE.Mesh(geometry, handle.material);
      object.name = `event_${def.id}`;
      object.visible = false;
      scene.add(object);
    }
    events.push({ def, object });
  }

  let foodMaterials: { chipa: THREE.Material; plate: THREE.Material } | null = null;
  for (const item of data.items ?? []) {
    const def = catalog.get(item.id);
    if (!def) {
      throw new Error(`La sala ${data.id} referencia un ítem desconocido: ${item.id}`);
    }
    let object: THREE.Object3D;
    if (def.kind === 'food') {
      foodMaterials ??= await createFoodMaterials(config, loader, atmosphere, extraMaterials);
      object = buildChipaModel(foodMaterials.chipa, foodMaterials.plate);
    } else {
      const material = def.kind === 'poster' ? posterMaterial.material : materials.door.material;
      object = buildItemModel(def.kind, material);
    }
    // Los afiches no se recogen (se queman): sin aura.
    if (def.kind !== 'poster') {
      addPickupAura(object);
    }
    object.position.set(item.position[0], item.position[1], item.position[2]);
    object.rotation.y = THREE.MathUtils.degToRad(item.yaw ?? 0);
    object.name = `item_${item.id}`;
    scene.add(object);
    items.push({
      id: item.id,
      kind: def.kind,
      object,
      position: new THREE.Vector3(item.position[0], item.position[1], item.position[2]),
      taken: false,
    });
  }

  // Luminarias visibles de las luces de sala (la luz real va por uniforms).
  const lights: SceneLightDef[] = [...atmosphereLights(atmosphere), ...(data.lights ?? [])];
  const bulbParts: THREE.BufferGeometry[] = [];
  for (const light of data.lights ?? []) {
    const fixture = light.fixture ?? 'pendant';
    if (fixture === 'none') {
      continue;
    }
    const [lx, ly, lz] = light.position;
    const cordTop = outdoor ? ly + 0.3 : height;
    if (fixture === 'pendant' || fixture === 'bulb') {
      const cordLength = Math.max(0.02, cordTop - (ly + 0.08));
      const cord = new THREE.BoxGeometry(0.012, cordLength, 0.012);
      cord.translate(lx, ly + 0.08 + cordLength / 2, lz);
      paintVertexColors(cord, () => 0.25);
      buckets.fixture.push(cord);
      const socket = new THREE.CylinderGeometry(0.022, 0.026, 0.07, 10);
      socket.translate(lx, ly + 0.06, lz);
      paintVertexColors(socket, () => 0.45);
      buckets.fixture.push(socket);
      if (!outdoor) {
        const rose = new THREE.CylinderGeometry(0.06, 0.06, 0.03, 12);
        rose.translate(lx, height - 0.015, lz);
        paintVertexColors(rose, () => 0.7);
        buckets.fixture.push(rose);
      }
    }
    if (fixture === 'pendant') {
      const shade = new THREE.CylinderGeometry(0.06, 0.25, 0.22, 16, 1, true);
      shade.translate(lx, ly + 0.02, lz);
      scaleUVs(shade, 1.2, 0.2);
      paintVertexColors(shade, (_x, y) => 0.55 + 0.45 * THREE.MathUtils.clamp((ly + 0.13 - y) / 0.22, 0, 1));
      buckets.fixture.push(shade);
    }
    if (fixture === 'sconce') {
      const plate = new THREE.BoxGeometry(0.12, 0.2, 0.12);
      plate.translate(lx, ly - 0.05, lz);
      paintVertexColors(plate, () => 0.6);
      buckets.fixture.push(plate);
    }
    const bulb = new THREE.SphereGeometry(fixture === 'bulb' ? 0.045 : 0.055, 10, 8);
    bulb.scale(1, 1.25, 1);
    bulb.translate(lx, ly - 0.02, lz);
    const glow = light.color ?? [1, 0.85, 0.65];
    paintVertexColors(bulb, () => [glow[0], glow[1], glow[2]]);
    bulbParts.push(bulb);
  }
  if (bulbParts.length > 0) {
    const merged = mergeGeometries(bulbParts, false);
    if (merged) {
      const bulbMaterial = createPsxMaterial(config, whitePixelTexture(), atmosphere, {
        emissive: 1.7,
        spec: 0,
        noDirect: true,
      });
      extraMaterials.push(bulbMaterial);
      const mesh = new THREE.Mesh(merged, bulbMaterial.material);
      mesh.name = `${data.id}_bulbs`;
      scene.add(mesh);
    }
  }

  for (const key of textureKeys) {
    const list = buckets[key];
    if (list.length === 0) {
      continue;
    }
    const merged = mergeGeometries(list, false);
    if (!merged) {
      throw new Error(`No se pudieron fusionar las geometrías de ${key} en ${data.id}`);
    }
    const mesh = new THREE.Mesh(merged, materials[key].material);
    mesh.name = `${data.id}_${key}`;
    scene.add(mesh);
  }

  for (const [key, list] of Object.entries(decalBuckets)) {
    const index = textureKeys.indexOf(key);
    const stain = textureMap[key].includes('Stain');
    const handle = createPsxMaterial(config, textures[index], atmosphere, {
      ...surfaceFor(textureMap[key]),
      normalMap: normals[index],
      blend: stain,
      edgeFade: stain ? STAIN_EDGE_FADE : 0,
    });
    // Una sola cara + polygon offset: el decal gana siempre el test de profundidad
    // contra la superficie que lo soporta, sin z-fighting al caminar.
    handle.material.side = THREE.FrontSide;
    handle.material.polygonOffset = true;
    handle.material.polygonOffsetFactor = -1;
    handle.material.polygonOffsetUnits = -1;
    extraMaterials.push(handle);
    const merged = mergeGeometries(list, false);
    if (!merged) {
      throw new Error(`No se pudieron fusionar los decales ${key} de ${data.id}`);
    }
    const mesh = new THREE.Mesh(merged, handle.material);
    mesh.name = `${data.id}_decal_${key}`;
    scene.add(mesh);
  }

  return {
    id: data.id,
    name: data.name,
    mapSize: [data.size[0], data.size[2]],
    scene,
    colliders,
    doors,
    items,
    spawns: data.spawns,
    audio: { ...FALLBACK_ROOM_AUDIO, ...ROOM_AUDIO_DEFAULTS[data.id], ...data.audio },
    atmosphere,
    lights,
    outdoor,
    hides,
    events,
    models,
    flesh,
    sync: (next) => {
      textureKeys.forEach((key) => materials[key].sync(next, atmosphere));
      flesh?.sync(next);
      posterMaterial.sync(next, posterAtmosphere);
      extraMaterials.forEach((handle) => handle.sync(next, atmosphere));
      endingDecorations.forEach((decoration) => decoration.sync(next));
    },
    triangleCount: countTriangles(scene),
  };
}

// Candado de hierro con grillete: armella atornillada a la hoja + candado
// colgando. `side` indica la cara de la hoja (±Z local) que mira a la sala.
function buildPadlock(material: THREE.Material, side: number): DoorLock {
  const group = new THREE.Group();
  group.name = 'padlock';
  const z = side * 0.035;
  const parts: THREE.BufferGeometry[] = [];
  const steel = (geometry: THREE.BufferGeometry, shade: [number, number, number]): void => {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    paintVertexColors(flat, () => shade);
    parts.push(flat);
  };
  // Pletina del pasador sobre la hoja y armella.
  const plate = new THREE.BoxGeometry(0.16, 0.05, 0.008);
  plate.translate(-0.02, 0, z + side * 0.004);
  steel(plate, [0.55, 0.55, 0.58]);
  for (const x of [-0.085, 0.045]) {
    const bolt = new THREE.CylinderGeometry(0.006, 0.006, 0.006, 8);
    bolt.rotateX(Math.PI / 2);
    bolt.translate(x, 0, z + side * 0.01);
    steel(bolt, [0.75, 0.75, 0.78]);
  }
  const staple = new THREE.TorusGeometry(0.014, 0.004, 6, 10, Math.PI);
  staple.rotateY(Math.PI / 2);
  staple.translate(0.03, 0, z + side * 0.012);
  steel(staple, [0.6, 0.6, 0.62]);
  const base = mergeGeometries(parts, false);
  if (base) {
    group.add(new THREE.Mesh(base, material));
  }
  // Candado (cuerpo + grillete), colgando de la armella.
  const lockParts: THREE.BufferGeometry[] = [];
  const body = new THREE.BoxGeometry(0.06, 0.055, 0.026, 1, 1, 1);
  body.translate(0, -0.05, 0);
  const bodyFlat = body.toNonIndexed();
  paintVertexColors(bodyFlat, (_x, y) => (y < -0.06 ? [0.85, 0.66, 0.32] : [1.05, 0.82, 0.42]));
  lockParts.push(bodyFlat);
  const keyhole = new THREE.CylinderGeometry(0.005, 0.005, 0.004, 8);
  keyhole.rotateX(Math.PI / 2);
  keyhole.translate(0, -0.055, side * 0.014);
  const keyholeFlat = keyhole.toNonIndexed();
  paintVertexColors(keyholeFlat, () => [0.08, 0.08, 0.08]);
  lockParts.push(keyholeFlat);
  const lockBody = mergeGeometries(lockParts, false);
  const hanging = new THREE.Group();
  hanging.position.set(0.03, -0.004, z + side * 0.02);
  if (lockBody) {
    hanging.add(new THREE.Mesh(lockBody, material));
  }
  const shackleGeometry = new THREE.TorusGeometry(0.019, 0.0045, 6, 12, Math.PI).toNonIndexed();
  shackleGeometry.translate(0, -0.022, 0);
  paintVertexColors(shackleGeometry, () => [0.7, 0.7, 0.74]);
  const shackle = new THREE.Mesh(shackleGeometry, material);
  hanging.add(shackle);
  hanging.name = 'padlock_body';
  group.add(hanging);
  return { group, body: hanging, shackle };
}

// Cielo nocturno para salas exteriores: cúpula con degradado, luna y
// estrellas, sin niebla (queda detrás de la niebla densa del jardín).
function buildSky(size: number): THREE.Object3D {
  const group = new THREE.Group();
  group.name = 'sky';
  const radius = Math.min(26, Math.max(14, size * 1.4));
  const dome = new THREE.SphereGeometry(radius, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.62);
  const position = dome.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i += 1) {
    const t = THREE.MathUtils.clamp(position.getY(i) / radius, 0, 1);
    const horizon = [0.09, 0.1, 0.13];
    const zenith = [0.015, 0.02, 0.045];
    for (let c = 0; c < 3; c += 1) {
      colors[i * 3 + c] = horizon[c] + (zenith[c] - horizon[c]) * Math.pow(t, 0.6);
    }
  }
  dome.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const domeMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const domeMesh = new THREE.Mesh(dome, domeMaterial);
  domeMesh.renderOrder = -10;
  group.add(domeMesh);

  const moon = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 0.035, 20),
    new THREE.MeshBasicMaterial({ color: 0xc9cfd8, depthWrite: false, fog: false }),
  );
  moon.position.set(-radius * 0.45, radius * 0.55, -radius * 0.55);
  moon.lookAt(0, 0, 0);
  moon.renderOrder = -9;
  group.add(moon);

  const starCount = 260;
  const stars = new Float32Array(starCount * 3);
  let seed = 1337;
  const random = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < starCount; i += 1) {
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(0.15 + random() * 0.85);
    stars[i * 3] = Math.sin(phi) * Math.cos(theta) * radius * 0.97;
    stars[i * 3 + 1] = Math.cos(phi) * radius * 0.97;
    stars[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius * 0.97;
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.BufferAttribute(stars, 3));
  const starPoints = new THREE.Points(
    starGeometry,
    new THREE.PointsMaterial({ color: 0x8a92a8, size: 1.5, sizeAttenuation: false, depthWrite: false, fog: false }),
  );
  starPoints.renderOrder = -9;
  group.add(starPoints);
  return group;
}

let fallbackTexture: THREE.DataTexture | null = null;

function whitePixelTexture(): THREE.DataTexture {
  if (!fallbackTexture) {
    fallbackTexture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    fallbackTexture.magFilter = THREE.NearestFilter;
    fallbackTexture.minFilter = THREE.NearestFilter;
    fallbackTexture.generateMipmaps = false;
    fallbackTexture.needsUpdate = true;
  }
  return fallbackTexture;
}

async function loadRoomModel(
  model: RoomModelDef,
  config: PsxConfig,
  atmosphere: Atmosphere | null,
  materials: PsxMaterialHandle[],
): Promise<THREE.Object3D> {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(`${MODELS_BASE}${model.file}`);
  let root: THREE.Object3D = gltf.scene;
  const wanted = model.node ? (Array.isArray(model.node) ? model.node : [model.node]) : [];
  if (wanted.length > 0) {
    const selected: THREE.Object3D[] = [];
    for (const pattern of wanted) {
      for (const node of collectModelNodes(gltf.scene, pattern)) {
        if (!selected.includes(node)) {
          selected.push(node);
        }
      }
    }
    if (selected.length === 0) {
      throw new Error(`El GLB ${model.file} no tiene el nodo "${wanted.join(', ')}"`);
    }
    const wrapper = new THREE.Group();
    for (const found of selected) {
      found.updateWorldMatrix(true, false);
      const matrix = found.matrixWorld.clone();
      found.removeFromParent();
      found.matrixAutoUpdate = false;
      found.matrix.copy(matrix);
      wrapper.add(found);
    }
    root = wrapper;
  }
  // Las texturas de los GLB ya no se decodifican como sRGB (pipeline gamma):
  // salen más claras que antes, así que la tinta se compensa.
  const tint = Math.min(model.tint ?? 0.95, 1.15) * 0.72;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    const source = Array.isArray(object.material) ? object.material[0] : object.material;
    const texture = (source as THREE.MeshStandardMaterial).map ?? whitePixelTexture();
    if (texture !== fallbackTexture) {
      applyFiltering(texture, { repeat: false });
      // Pipeline en espacio gamma: sin decodificar sRGB (como el resto de texturas).
      texture.colorSpace = THREE.NoColorSpace;
    }
    const handle = createPsxMaterial(config, texture, atmosphere, { spec: 0.12, gloss: 18 });
    materials.push(handle);
    object.material = handle.material;
  });
  root.name = `model_${model.file.replace(/[^a-z0-9]+/gi, '_')}`;
  root.position.set(model.position[0], model.position[1], model.position[2]);
  root.rotation.y = THREE.MathUtils.degToRad(model.yaw ?? 0);
  root.scale.setScalar(model.scale ?? 1);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  root.position.x += model.position[0] - center.x;
  root.position.z += model.position[2] - center.z;
  root.position.y += model.position[1] - box.min.y;
  root.updateMatrixWorld(true);
  prepareModelGeometry(
    root,
    config.effects.affine_mapping ? (model.subdivision ?? MODEL_MAX_EDGE) : 0,
    tint,
  );
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  console.info(
    `[M10] ${model.file}${wanted.length > 0 ? ` (${wanted.join(', ')})` : ''} → ${size.x.toFixed(2)}x${size.y.toFixed(2)}x${size.z.toFixed(2)} m`,
  );
  return root;
}

// El shader PSX mapea las texturas de forma afín: en caras grandes la textura
// "nada" al girar la cámara. Las paredes de las salas van subdivididas ~1 m; aquí
// se hace lo mismo con la geometría de los GLB (que suele venir en caras enormes).
const MODEL_MAX_EDGE = 1.0;

function prepareModelGeometry(root: THREE.Object3D, maxEdge: number, tint: number): void {
  const scale = new THREE.Vector3();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    if (maxEdge > 0) {
      object.getWorldScale(scale);
      const factor = Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)) || 1;
      const localMaxEdge = maxEdge / factor;
      const geometry = object.geometry;
      geometry.computeBoundingSphere();
      const diameter = (geometry.boundingSphere?.radius ?? 0) * 2;
      if (diameter > localMaxEdge * 1.5) {
        object.geometry = new TessellateModifier(localMaxEdge, 4).modify(geometry);
      }
    }
    addVertexColors(object.geometry, tint);
  });
}

function collectModelNodes(scene: THREE.Object3D, pattern: string): THREE.Object3D[] {
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    const matches: THREE.Object3D[] = [];
    scene.traverse((object) => {
      if (object.name.startsWith(prefix)) {
        matches.push(object);
      }
    });
    return matches;
  }
  const direct =
    scene.getObjectByName(pattern) ?? scene.getObjectByName(pattern.replace(/\s+/g, '_'));
  return direct ? [direct] : [];
}

// Separación mínima de un decal respecto a la superficie que lo soporta.
const DECAL_LIFT = 0.004;
// Las manchas del Horror Pack que llenan toda la textura se funden en este
// margen (UV) para no verse como un rectángulo pegado.
const STAIN_EDGE_FADE = 0.22;

// Los decales se colocan pegados a la cara interior del muro (o del suelo) que
// les corresponde según su orientación y el signo de su posición, ignorando la
// profundidad exacta que traiga el JSON: así ningún cuadro/mancha queda a medias
// dentro del muro ni flotando dentro de un hueco de puerta.
function decalGeometry(
  prop: RoomProp,
  roomWidth: number,
  roomHeight: number,
  roomDepth: number,
  wallThickness: number,
  texScale: number,
  tile = false,
): THREE.PlaneGeometry {
  const plane = (a: number, b: number): THREE.PlaneGeometry => {
    const geometry = planeGeometry(a, b, texScale);
    if (tile) {
      scaleUVs(geometry, a / texScale, b / texScale);
    }
    return geometry;
  };
  const [px, py, pz] = prop.position;
  const [sx, sy, sz] = prop.size;
  const innerX = roomWidth / 2 - wallThickness / 2;
  const innerZ = roomDepth / 2 - wallThickness / 2;
  const minAxis = Math.min(sx, sy, sz);

  if (minAxis === sy) {
    const geometry = plane(sx, sz);
    const cx = THREE.MathUtils.clamp(px, -innerX + sx / 2, innerX - sx / 2);
    const cz = THREE.MathUtils.clamp(pz, -innerZ + sz / 2, innerZ - sz / 2);
    if (py < roomHeight / 2) {
      geometry.rotateX(-Math.PI / 2);
      const y = THREE.MathUtils.clamp(py + sy / 2, DECAL_LIFT, roomHeight - DECAL_LIFT);
      geometry.translate(cx, y, cz);
    } else {
      geometry.rotateX(Math.PI / 2);
      const y = THREE.MathUtils.clamp(py - sy / 2, DECAL_LIFT, roomHeight - DECAL_LIFT);
      geometry.translate(cx, y, cz);
    }
    return geometry;
  }

  const cy = THREE.MathUtils.clamp(py, sy / 2 + 0.01, roomHeight - sy / 2 - 0.01);
  if (minAxis === sx) {
    const geometry = plane(sz, sy);
    const cz = THREE.MathUtils.clamp(pz, -innerZ + sz / 2, innerZ - sz / 2);
    if (px >= 0) {
      geometry.rotateY(-Math.PI / 2);
      geometry.translate(innerX - DECAL_LIFT, cy, cz);
    } else {
      geometry.rotateY(Math.PI / 2);
      geometry.translate(-innerX + DECAL_LIFT, cy, cz);
    }
    return geometry;
  }

  const geometry = plane(sx, sy);
  const cx = THREE.MathUtils.clamp(px, -innerX + sx / 2, innerX - sx / 2);
  if (pz >= 0) {
    geometry.rotateY(Math.PI);
    geometry.translate(cx, cy, innerZ - DECAL_LIFT);
  } else {
    geometry.translate(cx, cy, -innerZ + DECAL_LIFT);
  }
  return geometry;
}

async function createFoodMaterials(
  config: PsxConfig,
  loader: THREE.TextureLoader,
  atmosphere: Atmosphere | null,
  handles: PsxMaterialHandle[],
): Promise<{ chipa: THREE.Material; plate: THREE.Material }> {
  const [chipaTex, chipaNormal, plateTex] = await Promise.all([
    loadPixelTexture(loader, textureUrl('ps2/chipa.png')),
    loadNormalMap(loader, textureUrl('ps2/chipa.png')),
    loadPixelTexture(loader, textureUrl('ps2/ceramic.png')),
  ]);
  const chipa = createPsxMaterial(config, chipaTex, atmosphere, { normalMap: chipaNormal, spec: 0.18, gloss: 16 });
  const plate = createPsxMaterial(config, plateTex, atmosphere, { spec: 0.6, gloss: 60 });
  handles.push(chipa, plate);
  return { chipa: chipa.material, plate: plate.material };
}

// Chipas en un platito: anillos de masa algo aplastados e irregulares.
function buildChipaModel(chipaMaterial: THREE.Material, plateMaterial: THREE.Material): THREE.Object3D {
  const group = new THREE.Group();
  const plate = new THREE.CylinderGeometry(0.12, 0.09, 0.014, 20);
  plate.translate(0, 0.007, 0);
  paintVertexColors(plate, () => 0.95);
  group.add(new THREE.Mesh(plate, plateMaterial));
  const rings: Array<[number, number, number, number, number]> = [
    [-0.035, 0.03, 0.01, 0.0, 0.1],
    [0.045, 0.03, -0.02, 0.4, -0.05],
    [0.0, 0.065, 0.025, 1.1, 0.35],
  ];
  const parts: THREE.BufferGeometry[] = [];
  rings.forEach(([x, y, z, yaw, tilt], index) => {
    const ring = new THREE.TorusGeometry(0.042, 0.021, 10, 18);
    ring.rotateX(Math.PI / 2 + tilt);
    ring.scale(1, 0.75, 1);
    const position = ring.getAttribute('position');
    for (let i = 0; i < position.count; i += 1) {
      const px = position.getX(i);
      const pz = position.getZ(i);
      const bump = 1 + 0.08 * Math.sin(px * 90 + index) * Math.cos(pz * 80 - index);
      position.setXYZ(i, px * bump, position.getY(i) * bump, pz * bump);
    }
    ring.computeVertexNormals();
    ring.rotateY(yaw);
    ring.translate(x, y, z);
    paintVertexColors(ring, (_px, py) => 0.85 + 0.25 * THREE.MathUtils.clamp((py - y + 0.02) / 0.04, 0, 1));
    parts.push(ring);
  });
  const merged = mergeGeometries(parts, false);
  if (merged) {
    group.add(new THREE.Mesh(merged, chipaMaterial));
  }
  group.scale.setScalar(1.35);
  return group;
}

// Aura azul claro tenue para distinguir lo recogible del entorno. Va en la capa 1
// (FX): la cámara la dibuja, pero ni los raycasts de apuntado ni el pase de
// sombra de la linterna la ven.
let pickupAuraMaterial: THREE.SpriteMaterial | null = null;

function addPickupAura(object: THREE.Object3D): void {
  if (!pickupAuraMaterial) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, 'rgba(90, 190, 255, 0.45)');
      gradient.addColorStop(0.6, 'rgba(50, 150, 255, 0.2)');
      gradient.addColorStop(1, 'rgba(30, 110, 240, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 64, 64);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.NoColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    pickupAuraMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
  }
  const bounds = new THREE.Box3().setFromObject(object);
  const size = bounds.getSize(new THREE.Vector3());
  const aura = new THREE.Sprite(pickupAuraMaterial);
  bounds.getCenter(aura.position);
  aura.scale.setScalar(Math.max(size.x, size.y, size.z) * 1.15 + 0.04);
  aura.layers.set(1);
  aura.renderOrder = 1;
  object.add(aura);
}

function buildItemModel(kind: ItemKind, material: THREE.Material): THREE.Object3D {
  const group = new THREE.Group();

  if (kind === 'poster') {
    const plane = new THREE.PlaneGeometry(0.55, 0.85);
    paintVertexColors(plane, () => 1.0);
    group.add(new THREE.Mesh(plane, material));
    return group;
  }

  if (kind === 'note') {
    const paper = new THREE.BoxGeometry(0.21, 0.006, 0.3);
    paintVertexColors(paper, () => 0.95);
    group.add(new THREE.Mesh(paper, material));
    return group;
  }

  if (kind === 'lore') {
    const plate = new THREE.BoxGeometry(0.45, 0.55, 0.02);
    paintVertexColors(plate, () => 1.0);
    group.add(new THREE.Mesh(plate, material));
    return group;
  }

  if (kind === 'tool') {
    const parts: THREE.BufferGeometry[] = [];
    const body = new THREE.CylinderGeometry(0.03, 0.034, 0.17, 8);
    body.rotateX(Math.PI / 2);
    paintVertexColors(body, () => 0.7);
    parts.push(body);
    const head = new THREE.CylinderGeometry(0.046, 0.036, 0.06, 8);
    head.rotateX(Math.PI / 2);
    head.translate(0, 0, 0.11);
    paintVertexColors(head, () => 0.85);
    parts.push(head);
    const lens = new THREE.CircleGeometry(0.038, 8);
    lens.translate(0, 0, 0.141);
    paintVertexColors(lens, () => [2.2, 2.0, 1.3]);
    parts.push(lens);
    const merged = mergeGeometries(parts, false);
    if (!merged) {
      throw new Error('No se pudo construir el modelo de la linterna');
    }
    group.add(new THREE.Mesh(merged, material));
    return group;
  }

  const parts: THREE.BufferGeometry[] = [];
  const addPart = (width: number, height: number, depth: number, x: number, z: number, rotY = 0): void => {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    if (rotY !== 0) {
      geometry.rotateY(rotY);
    }
    geometry.translate(x, 0, z);
    paintVertexColors(geometry, () => [1.0, 0.9, 0.55]);
    parts.push(geometry);
  };

  addPart(0.09, 0.008, 0.012, 0.02, 0);
  addPart(0.046, 0.008, 0.046, -0.048, 0);
  addPart(0.046, 0.008, 0.046, -0.048, 0, Math.PI / 4);
  addPart(0.012, 0.008, 0.02, 0.058, 0.016);
  addPart(0.012, 0.008, 0.014, 0.04, 0.013);

  const merged = mergeGeometries(parts, false);
  if (!merged) {
    throw new Error('No se pudo construir el modelo de la llave');
  }
  group.add(new THREE.Mesh(merged, material));
  return group;
}

export function colliderForBox(
  centerX: number,
  centerZ: number,
  heading: number,
  length: number,
  thickness: number,
): Collider {
  const cos = Math.abs(Math.cos(heading));
  const sin = Math.abs(Math.sin(heading));
  const halfX = (length / 2) * cos + (thickness / 2) * sin;
  const halfZ = (length / 2) * sin + (thickness / 2) * cos;
  return {
    minX: centerX - halfX,
    maxX: centerX + halfX,
    minZ: centerZ - halfZ,
    maxZ: centerZ + halfZ,
  };
}

function scaleUVs(geometry: THREE.BufferGeometry, scaleU: number, scaleV: number): void {
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i += 1) {
    uv.setXY(i, uv.getX(i) * scaleU, uv.getY(i) * scaleV);
  }
  uv.needsUpdate = true;
}

// Subdivisión de la geometría: con texScale 2 una arista por metro (el
// affine warping del PSX se nota y el presupuesto de triángulos no se dispara).
const SUB_QUADS = 4;

function segments(length: number, texScale: number): number {
  return Math.max(1, Math.round((length / texScale) * SUB_QUADS));
}

function boxGeometry(width: number, height: number, depth: number, texScale: number): THREE.BoxGeometry {
  return new THREE.BoxGeometry(
    width,
    height,
    depth,
    segments(width, texScale),
    segments(height, texScale),
    segments(depth, texScale),
  );
}

function planeGeometry(width: number, height: number, texScale: number): THREE.PlaneGeometry {
  return new THREE.PlaneGeometry(
    width,
    height,
    segments(width, texScale),
    segments(height, texScale),
  );
}

function scaleBoxUVs(
  geometry: THREE.BoxGeometry,
  width: number,
  height: number,
  depth: number,
  texScale: number,
): void {
  const uv = geometry.getAttribute('uv');
  const sx = segments(width, texScale);
  const sy = segments(height, texScale);
  const sz = segments(depth, texScale);
  const faces: Array<[number, number, number, number]> = [
    [sz, sy, depth / texScale, height / texScale],
    [sz, sy, depth / texScale, height / texScale],
    [sx, sz, width / texScale, depth / texScale],
    [sx, sz, width / texScale, depth / texScale],
    [sx, sy, width / texScale, height / texScale],
    [sx, sy, width / texScale, height / texScale],
  ];
  let offset = 0;
  for (const [gridX, gridY, scaleU, scaleV] of faces) {
    const end = offset + (gridX + 1) * (gridY + 1);
    for (let i = offset; i < end; i += 1) {
      uv.setXY(i, uv.getX(i) * scaleU, uv.getY(i) * scaleV);
    }
    offset = end;
  }
  uv.needsUpdate = true;
}

type Shade = number | [number, number, number];

function paintVertexColors(
  geometry: THREE.BufferGeometry,
  shade: (x: number, y: number, z: number) => Shade,
): void {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i += 1) {
    const value = shade(position.getX(i), position.getY(i), position.getZ(i));
    const [r, g, b] = typeof value === 'number' ? [value, value, value] : value;
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geometry.setAttribute('a_color', new THREE.BufferAttribute(colors, 3));
}

function countTriangles(scene: THREE.Scene): number {
  let triangles = 0;
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      const geometry = object.geometry;
      triangles += geometry.index ? geometry.index.count / 3 : geometry.getAttribute('position').count / 3;
    }
  });
  return Math.round(triangles);
}
