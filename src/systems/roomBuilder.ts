import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { TessellateModifier } from 'three/examples/jsm/modifiers/TessellateModifier.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AmbienceType, FloorMaterial, ReverbType } from './config';
import type { PsxConfig } from './config';
import { fetchJson } from './fetchJson';
import type { ItemDef, ItemKind } from './items';
import { createPsxMaterial, type Atmosphere, type PsxMaterialHandle } from './psxMaterial';
import { loadPosterTexture } from './proceduralTextures';
import { loadPixelTexture } from './textures';
import { addVertexColors } from './vertexColors';

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
}

export interface RoomProp {
  kind: 'box';
  position: [number, number, number];
  size: [number, number, number];
  texture?: string;
  tint?: number;
  collide?: boolean;
  // Decal plano apoyado en el suelo o pegado a un muro (manchas, cuadros,
  // paneles): se dibuja como una sola cara separada de la superficie para que
  // no pelee en el z-buffer con el muro o el suelo (parpadeo al moverse).
  decal?: boolean;
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
}

export interface DoorLeaf {
  group: THREE.Group;
  baseRotation: number;
  openAngle: number;
}

export interface DoorHandle {
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
  scene: THREE.Scene;
  colliders: Collider[];
  doors: DoorHandle[];
  items: ItemHandle[];
  spawns: Record<string, RoomSpawn>;
  audio: RoomAudio;
  sync: (config: PsxConfig) => void;
  triangleCount: number;
}

const TEXTURES_BASE = `${import.meta.env.BASE_URL}assets/textures/horror_pack/`;
const MODELS_BASE = `${import.meta.env.BASE_URL}assets/models/furniture/`;
const REQUIRED_TEXTURES = ['wall', 'floor', 'ceiling', 'door'];
const DOOR_SWING = 1.66;
const DOOR_THICKNESS = 0.07;

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
  const textureKeys = Object.keys(data.textures);
  const loader = new THREE.TextureLoader();
  const textures = await Promise.all(
    textureKeys.map((key) => loadPixelTexture(loader, TEXTURES_BASE + data.textures[key])),
  );

  const atmosphere = data.atmosphere ?? null;
  const materials = Object.fromEntries(
    textureKeys.map((key, index) => [key, createPsxMaterial(config, textures[index], atmosphere)]),
  ) as Record<string, PsxMaterialHandle>;

  const posterMaterial = createPsxMaterial(config, loadPosterTexture(), atmosphere);

  const scene = new THREE.Scene();
  const colliders = computeColliders(data);
  const doors: DoorHandle[] = [];
  const items: ItemHandle[] = [];
  const buckets: Record<string, THREE.BufferGeometry[]> = Object.fromEntries(
    textureKeys.map((key) => [key, [] as THREE.BufferGeometry[]]),
  );
  const extraMaterials: PsxMaterialHandle[] = [];

  const [width, height, depth] = data.size;
  const thickness = data.wall_thickness;
  const texScale = data.texture_scale;

  const floor = planeGeometry(width, depth, texScale);
  floor.rotateX(-Math.PI / 2);
  scaleUVs(floor, width / texScale, depth / texScale);
  paintVertexColors(floor, (x, _y, z) => {
    const edge = Math.min(width / 2 - Math.abs(x), depth / 2 - Math.abs(z));
    return 0.85 * (0.7 + 0.3 * THREE.MathUtils.clamp(edge, 0, 1));
  });
  buckets.floor.push(floor);

  const ceiling = planeGeometry(width, depth, texScale);
  ceiling.rotateX(Math.PI / 2);
  ceiling.translate(0, height, 0);
  scaleUVs(ceiling, width / texScale, depth / texScale);
  paintVertexColors(ceiling, () => 0.5);
  buckets.ceiling.push(ceiling);

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
    },
  ): void {
    const geometry = boxGeometry(params.length, params.height, params.thickness, texScale);
    scaleBoxUVs(geometry, params.length, params.height, params.thickness, texScale);
    geometry.rotateY(params.heading);
    const centerX = params.originX + params.dirX * params.center;
    const centerZ = params.originZ + params.dirZ * params.center;
    geometry.translate(centerX, params.y0 + params.height / 2, centerZ);
    paintVertexColors(geometry, (_x, y) => 0.85 * (0.72 + 0.28 * THREE.MathUtils.clamp(y / height, 0, 1)));
    buckets[bucket].push(geometry);
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
    const slab = boxGeometry(leafWidth, opening.height - 0.02, 0.07, texScale);
    scaleBoxUVs(slab, leafWidth, opening.height, 0.07, texScale);
    if (data.door_fit) {
      scaleUVs(slab, texScale / leafWidth, texScale / opening.height);
    }
    paintVertexColors(slab, () => 0.9);

    const handle = boxGeometry(0.05, 0.14, 0.08, texScale);
    scaleBoxUVs(handle, 0.05, 0.14, 0.08, texScale);
    // La hoja con gozne al final va girada 180°, así que su cara interior
    // también se invierte para que el picaporte quede del lado de la sala.
    const handleX = opening.double ? leafWidth - 0.12 : leafWidth / 2 - 0.12;
    handle.translate(handleX, 0, (hingeAtEnd ? -faceSign : faceSign) * 0.06);
    paintVertexColors(handle, () => 1);

    const merged = mergeGeometries([slab, handle], false);
    if (!merged) {
      throw new Error(`No se pudo construir la puerta ${doorIndex} de ${data.id}`);
    }
    const mesh = new THREE.Mesh(merged, materials.door.material);
    mesh.position.set(leafWidth / 2 + 0.01, (opening.height - 0.02) / 2 + 0.01, 0);

    const group = new THREE.Group();
    group.name = `door_${data.id}_${doorIndex}${hingeAtEnd ? 'b' : ''}`;
    const hinge = hingeAtEnd ? opening.offset + opening.width : opening.offset;
    group.position.set(originX + dirX * hinge, 0, originZ + dirZ * hinge);
    group.rotation.y = hingeAtEnd ? heading + Math.PI : heading;
    group.add(mesh);
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
        'wall',
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

    for (const opening of openings) {
      const sill = opening.sill ?? 0;
      const top = sill + opening.height;
      const openingCenter = opening.offset + opening.width / 2;

      if (top < height) {
        addBox(
          'wall',
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
          'wall',
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
            'door',
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
          'door',
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
          const leafWidth = opening.width / 2 - 0.02;
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
            startX, startZ, dirX, dirZ, heading, opening, opening.width - 0.02, false, faceSign, doorIndex,
          );
          leaves.push({ group, baseRotation: heading, openAngle });
        }
        doors.push({
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
        });
      } else if (opening.kind === 'passage') {
        if (!opening.blocked && opening.to) {
          doors.push({
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
    if (prop.decal) {
      const key = prop.texture && buckets[prop.texture] ? prop.texture : 'wall';
      const geometry = decalGeometry(prop, width, height, depth, thickness, texScale);
      paintVertexColors(geometry, () => prop.tint ?? 1);
      (decalBuckets[key] ??= []).push(geometry);
      continue;
    }
    const [px, py, pz] = prop.position;
    const [sx, sy, sz] = prop.size;
    const geometry = boxGeometry(sx, sy, sz, texScale);
    scaleBoxUVs(geometry, sx, sy, sz, texScale);
    geometry.translate(px, py, pz);
    const tint = prop.tint ?? 1;
    paintVertexColors(geometry, () => tint);
    const bucket = buckets[prop.texture ?? 'wall'] ?? buckets.wall;
    bucket.push(geometry);
  }

  for (const model of data.models ?? []) {
    try {
      const object = await loadRoomModel(model, config, atmosphere, extraMaterials);
      scene.add(object);
    } catch (error) {
      console.warn(`[M10] No se pudo cargar el modelo ${model.file} de ${data.id}`, error);
    }
  }

  for (const item of data.items ?? []) {
    const def = catalog.get(item.id);
    if (!def) {
      throw new Error(`La sala ${data.id} referencia un ítem desconocido: ${item.id}`);
    }
    const material = def.kind === 'poster' ? posterMaterial.material : materials.door.material;
    const object = buildItemModel(def.kind, material);
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
    const handle = createPsxMaterial(config, textures[textureKeys.indexOf(key)], atmosphere);
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
    scene,
    colliders,
    doors,
    items,
    spawns: data.spawns,
    audio: { ...FALLBACK_ROOM_AUDIO, ...ROOM_AUDIO_DEFAULTS[data.id], ...data.audio },
    sync: (next) => {
      textureKeys.forEach((key) => materials[key].sync(next, atmosphere));
      posterMaterial.sync(next, atmosphere);
      extraMaterials.forEach((handle) => handle.sync(next, atmosphere));
    },
    triangleCount: countTriangles(scene),
  };
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
  const tint = model.tint ?? 0.95;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    const source = Array.isArray(object.material) ? object.material[0] : object.material;
    const texture = (source as THREE.MeshStandardMaterial).map ?? whitePixelTexture();
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.anisotropy = 1;
    const handle = createPsxMaterial(config, texture, atmosphere);
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
  prepareModelGeometry(root, model.subdivision ?? MODEL_MAX_EDGE, tint);
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
): THREE.PlaneGeometry {
  const [px, py, pz] = prop.position;
  const [sx, sy, sz] = prop.size;
  const innerX = roomWidth / 2 - wallThickness / 2;
  const innerZ = roomDepth / 2 - wallThickness / 2;
  const minAxis = Math.min(sx, sy, sz);

  if (minAxis === sy) {
    const geometry = planeGeometry(sx, sz, texScale);
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
    const geometry = planeGeometry(sz, sy, texScale);
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

  const geometry = planeGeometry(sx, sy, texScale);
  const cx = THREE.MathUtils.clamp(px, -innerX + sx / 2, innerX - sx / 2);
  if (pz >= 0) {
    geometry.rotateY(Math.PI);
    geometry.translate(cx, cy, innerZ - DECAL_LIFT);
  } else {
    geometry.translate(cx, cy, -innerZ + DECAL_LIFT);
  }
  return geometry;
}

function buildItemModel(kind: ItemKind, material: THREE.Material): THREE.Object3D {
  const group = new THREE.Group();

  if (kind === 'poster') {
    const plane = new THREE.PlaneGeometry(0.55, 0.85);
    paintVertexColors(plane, () => 1.1);
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
const SUB_QUADS = 2;

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
