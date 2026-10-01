// Genera los JSON de sala de Mondyi v2 (salas más grandes + salas nuevas).
// Las paredes se calculan desde size + doors/windows (offsets sobre el muro) y
// los spawns from_<origen> se generan desde el hueco recíproco de la sala destino.
// Uso: node tools/gen_rooms.mjs   (sobrescribe public/rooms/*.json)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/rooms');
const WALL_THICKNESS = 0.15;

const slug = (id) => id.replace(/^room_/, '');

const SIDES = {
  N: { start: (w, d) => [-w / 2, -d / 2], end: (w, d) => [w / 2, -d / 2], inwardYaw: 180 },
  E: { start: (w, d) => [w / 2, -d / 2], end: (w, d) => [w / 2, d / 2], inwardYaw: 90 },
  S: { start: (w, d) => [w / 2, d / 2], end: (w, d) => [-w / 2, d / 2], inwardYaw: 0 },
  W: { start: (w, d) => [-w / 2, d / 2], end: (w, d) => [-w / 2, -d / 2], inwardYaw: 270 },
};

function runGeometry(side, w, d) {
  const [sx, sz] = SIDES[side].start(w, d);
  const [ex, ez] = SIDES[side].end(w, d);
  const dx = ex - sx;
  const dz = ez - sz;
  const length = Math.hypot(dx, dz);
  return { sx, sz, dirX: dx / length, dirZ: dz / length, length };
}

function openingCenter(side, w, d, offset, width) {
  const { sx, sz, dirX, dirZ } = runGeometry(side, w, d);
  return { x: sx + dirX * (offset + width / 2), z: sz + dirZ * (offset + width / 2) };
}

function buildWalls(room) {
  const [w, h, d] = room.size;
  const runs = [];
  for (const side of ['N', 'E', 'S', 'W']) {
    const openings = [];
    for (const door of room.doors ?? []) {
      if (door.side !== side) continue;
      const opening = {
        kind: 'door',
        offset: door.offset,
        width: door.width ?? 1.1,
        height: door.height ?? 2.1,
        door: 'closed',
      };
      if (door.to) {
        opening.to = door.to;
        opening.spawn = `from_${slug(room.id)}`;
      }
      if (door.key) opening.key = door.key;
      if (door.action) opening.action = door.action;
      if (door.requires) opening.requires = door.requires;
      if (door.ending) opening.ending = true;
      if (door.double) opening.double = true;
      openings.push(opening);
    }
    for (const win of room.windows ?? []) {
      if (win.side !== side) continue;
      openings.push({
        kind: 'window',
        offset: win.offset,
        width: win.width ?? 1.4,
        height: win.height ?? 1.1,
        sill: win.sill ?? 0.95,
      });
    }
    openings.sort((a, b) => a.offset - b.offset);
    const { sx, sz, length } = runGeometry(side, w, d);
    const run = { start: [round(sx), round(sz)], end: [0, 0], openings };
    const end = SIDES[side].end(w, d);
    run.end = [round(end[0]), round(end[1])];
    if (openings.length === 0) delete run.openings;
    runs.push(run);
    const total = openings.reduce((max, o) => Math.max(max, o.offset + o.width), 0);
    if (total > length + 1e-9) {
      throw new Error(`${room.id}: huecos fuera del muro ${side} (${total} > ${length})`);
    }
  }
  return runs;
}

function buildSpawns(rooms) {
  const byId = new Map(rooms.map((room) => [room.id, room]));
  const spawns = new Map(rooms.map((room) => [room.id, {}]));
  for (const origin of rooms) {
    for (const door of origin.doors ?? []) {
      if (!door.to) continue;
      const target = byId.get(door.to);
      if (!target) throw new Error(`${origin.id}: puerta a sala inexistente ${door.to}`);
      const back = (target.doors ?? []).find((other) => other.to === origin.id);
      if (!back) throw new Error(`${origin.id} -> ${door.to}: falta la puerta recíproca`);
      const [tw, , td] = target.size;
      const center = openingCenter(back.side, tw, td, back.offset, back.width ?? 1.1);
      const yaw = SIDES[back.side].inwardYaw;
      const rad = (yaw * Math.PI) / 180;
      const name = `from_${slug(origin.id)}`;
      spawns.get(target.id)[name] = {
        position: [round(center.x - Math.sin(rad) * 1.25), round(center.z - Math.cos(rad) * 1.25)],
        yaw,
      };
    }
  }
  for (const room of rooms) {
    const registry = spawns.get(room.id);
    if (!room.start) throw new Error(`${room.id}: falta el spawn start`);
    registry.start = { position: [round(room.start.position[0]), round(room.start.position[1])], yaw: room.start.yaw };
  }
  return spawns;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

const STEP = (x, width, zStart, count, pitchZ, heightStep, texture, tint) => {
  const steps = [];
  for (let i = 0; i < count; i += 1) {
    const height = heightStep * (i + 1);
    steps.push({
      kind: 'box',
      position: [x, round(height / 2), round(zStart - pitchZ * i)],
      size: [width, round(height), 0.3],
      texture,
      tint,
      collide: true,
    });
  }
  return steps;
};

const rooms = [
  {
    id: 'room_vestibulo',
    name: 'Vestíbulo',
    size: [8.0, 2.7, 6.5],
    texScale: 2.0,
    textures: {
      wall: 'Wall/Horror_Wall_06-128x128.png',
      floor: 'Floor/Horror_Floor_01-128x128.png',
      ceiling: 'Misc/Horror_Misc_03-128x128.png',
      door: 'Metal/Horror_Metal_01-128x128.png',
      metal: 'Metal/Horror_Metal_04-128x128.png',
    },
    audio: { reverb: 'hall', floor_material: 'wood', ambience: 'house' },
    doors: [
      { side: 'N', offset: 3.4, width: 1.2, requires: ['poster_1', 'poster_2', 'poster_3', 'poster_4', 'poster_5', 'poster_6', 'poster_7', 'poster_8'], ending: true, double: true },
      { side: 'E', offset: 2.6, width: 1.2, to: 'room_salon' },
    ],
    windows: [{ side: 'S', offset: 1.6, width: 1.6 }],
    start: { position: [0.0, 1.6], yaw: 0 },
    items: [{ id: 'poster_1', position: [-3.905, 1.5, -1.6], yaw: 90 }],
    props: [
      { position: [2.0, 0.3, -2.35], size: [1.4, 0.6, 0.5], texture: 'wall', tint: 0.6, collide: true },
      { position: [-3.2, 0.4, 0.2], size: [0.9, 0.8, 0.4], texture: 'wall', tint: 0.65, collide: true },
      { position: [-3.87, 1.5, 0.2], size: [0.04, 0.9, 0.7], texture: 'metal', tint: 0.35, collide: false, decal: true },
      { position: [-3.4, 0.9, -2.5], size: [0.16, 1.8, 0.16], texture: 'wall', tint: 0.5, collide: true },
      { position: [3.4, 0.25, -2.5], size: [0.5, 0.5, 0.5], texture: 'door', tint: 0.55, collide: true },
      { position: [0.2, 0.005, 0.4], size: [2.6, 0.01, 2.0], texture: 'wall', tint: 0.5, collide: false, decal: true },
      { position: [3.87, 1.55, 1.25], size: [0.04, 0.6, 0.9], texture: 'metal', tint: 0.3, collide: false, decal: true },
    ],
  },
  {
    id: 'room_salon',
    name: 'Salón',
    size: [9.5, 2.7, 7.0],
    texScale: 2.0,
    textures: {
      wall: 'Wall/Horror_Wall_02-128x128.png',
      floor: 'Floor/Horror_Floor_06-128x128.png',
      ceiling: 'Misc/Horror_Misc_03-128x128.png',
      door: 'Metal/Horror_Metal_01-128x128.png',
      wood: 'Floor/Horror_Floor_03-128x128.png',
      metal: 'Metal/Horror_Metal_10-128x128.png',
      stain: 'Stains/Horror_Stain_12-128x128.png',
    },
    audio: { reverb: 'hall', floor_material: 'wood', ambience: 'house' },
    doors: [
      { side: 'W', offset: 2.8, width: 1.2, to: 'room_vestibulo' },
      { side: 'E', offset: 2.7, width: 1.2, to: 'room_comedor' },
    ],
    windows: [
      { side: 'N', offset: 0.9, width: 1.6 },
      { side: 'N', offset: 6.0, width: 1.6 },
    ],
    start: { position: [-4.0, 0.1], yaw: 270 },
    items: [{ id: 'poster_2', position: [-2.8, 1.5, 3.405], yaw: 180 }],
    models: [
      { file: 'living_room/rug.glb', position: [0.6, 0.0, 0.4], yaw: 0, subdivision: 0 },
      { file: 'living_room/sofa.glb', position: [0.6, 0.0, 2.2], yaw: 180, collide: true, size: [1.8, 0.85, 0.95] },
      { file: 'living_room/coffe_table.glb', position: [0.6, 0.0, 0.2], yaw: 0, collide: true, size: [1.1, 0.45, 0.6] },
      { file: 'living_room/tv.glb', position: [-0.5, 0.68, -3.18], yaw: 270, subdivision: 0, collide: false },
      { file: 'living_room/rack.glb', position: [-0.5, 0.0, -3.18], yaw: 0, collide: true, size: [1.8, 0.7, 0.5] },
    ],
    props: [
      { position: [-2.7, 0.6, -3.05], size: [1.8, 1.2, 0.5], texture: 'wall', tint: 0.4, collide: true },
      { position: [-2.7, 1.85, -3.15], size: [1.0, 1.3, 0.35], texture: 'wall', tint: 0.35, collide: true },
      { position: [-2.7, 0.05, -2.45], size: [2.0, 0.1, 0.7], texture: 'wall', tint: 0.5, collide: false },
      { position: [-4.3, 1.6, -3.42], size: [0.5, 0.7, 0.03], texture: 'door', tint: 0.45, collide: false, decal: true },
      { position: [3.3, 1.6, -3.42], size: [0.5, 0.7, 0.03], texture: 'door', tint: 0.45, collide: false, decal: true },
    ],
  },
  {
    id: 'room_comedor',
    name: 'Comedor',
    size: [7.0, 2.7, 5.5],
    texScale: 2.0,
    textures: {
      wall: 'Wall/Horror_Wall_01-128x128.png',
      floor: 'Floor/Horror_Floor_10-128x128.png',
      ceiling: 'Misc/Horror_Misc_04-128x128.png',
      door: 'Metal/Horror_Metal_01-128x128.png',
      wood: 'Floor/Horror_Floor_03-128x128.png',
      stain: 'Stains/Horror_Stain_01-128x128.png',
    },
    audio: { reverb: 'hall', floor_material: 'wood', ambience: 'house' },
    doors: [
      { side: 'W', offset: 2.15, width: 1.2, to: 'room_salon' },
      { side: 'E', offset: 2.15, width: 1.2, to: 'room_cocina' },
    ],
    windows: [{ side: 'N', offset: 2.7, width: 1.6 }],
    start: { position: [-3.0, 0.0], yaw: 270 },
    items: [{ id: 'poster_3', position: [2.0, 1.5, 2.655], yaw: 180 }],
    models: [
      { file: 'living_room/book_brown_1.glb', position: [0.4, 0.76, 0.2], yaw: 25 },
    ],
    props: [
      { position: [0.0, 0.38, 0.2], size: [2.2, 0.75, 1.0], texture: 'wood', tint: 0.5, collide: true },
      { position: [-1.5, 0.225, -0.4], size: [0.45, 0.45, 0.45], texture: 'wall', tint: 0.45, collide: true },
      { position: [-1.5, 0.225, 0.8], size: [0.45, 0.45, 0.45], texture: 'wall', tint: 0.45, collide: true },
      { position: [0.0, 0.225, -0.5], size: [0.45, 0.45, 0.45], texture: 'wall', tint: 0.45, collide: true },
      { position: [0.0, 0.225, 0.9], size: [0.45, 0.45, 0.45], texture: 'wall', tint: 0.45, collide: true },
      { position: [1.5, 0.225, -0.4], size: [0.45, 0.45, 0.45], texture: 'wall', tint: 0.45, collide: true },
      { position: [1.5, 0.225, 0.8], size: [0.45, 0.45, 0.45], texture: 'wall', tint: 0.45, collide: true },
      { position: [-2.0, 0.45, 2.4], size: [1.8, 0.9, 0.45], texture: 'wall', tint: 0.5, collide: true },
      { position: [2.4, 0.5, 2.4], size: [0.9, 1.0, 0.45], texture: 'wood', tint: 0.5, collide: true },
      { position: [0.0, 0.005, 0.2], size: [3.0, 0.01, 2.0], texture: 'stain', tint: 0.45, collide: false, decal: true },
    ],

  },
  {
    id: 'room_cocina',
    name: 'Cocina',
    size: [7.5, 2.7, 5.0],
    texScale: 2.0,
    textures: {
      wall: 'Wall/Horror_Wall_07-128x128.png',
      floor: 'Floor/Horror_Floor_03-128x128.png',
      ceiling: 'Misc/Horror_Misc_03-128x128.png',
      door: 'Metal/Horror_Metal_01-128x128.png',
      metal: 'Metal/Horror_Metal_09-128x128.png',
      stain: 'Stains/Horror_Stain_03-128x128.png',
    },
    audio: { reverb: 'small', floor_material: 'tile', ambience: 'house' },
    doors: [
      { side: 'W', offset: 1.9, width: 1.2, to: 'room_comedor' },
      { side: 'E', offset: 1.9, width: 1.2, to: 'room_pasillo' },
    ],
    windows: [{ side: 'N', offset: 3.4, width: 1.4, height: 1.1, sill: 1.0 }],
    start: { position: [-2.5, 0.0], yaw: 270 },
    items: [
      { id: 'key_kids', position: [-0.9, 1.05, -1.95], yaw: 12 },
      { id: 'poster_4', position: [3.0, 1.5, 2.405], yaw: 180 },
    ],
    models: [
      { file: 'kitchen/kitchen_pack.glb', node: 'Cabinet', position: [-1.1, 0.0, -2.0], yaw: 0, collide: true, size: [2.0, 1.0, 1.05] },
      { file: 'kitchen/kitchen_pack.glb', node: 'Kitchen_Sink', position: [1.1, 0.0, -2.0], yaw: 0, collide: true, size: [2.0, 1.3, 1.1] },
      { file: 'kitchen/kitchen_pack.glb', node: 'Fridge', position: [3.25, 0.0, -2.0], yaw: 0, collide: true, size: [1.05, 1.95, 1.05] },
    ],
    props: [
      { position: [2.1, 1.8, -2.47], size: [1.1, 0.9, 0.03], texture: 'stain', tint: 0.3, collide: false, decal: true },
      { position: [1.0, 0.005, -0.6], size: [1.6, 0.01, 1.2], texture: 'stain', tint: 0.3, collide: false, decal: true },
      { position: [0.8, 0.45, 1.0], size: [2.0, 0.9, 1.0], texture: 'wall', tint: 0.45, collide: true },
      { position: [0.8, 0.93, 1.0], size: [2.1, 0.06, 1.1], texture: 'metal', tint: 0.5, collide: false },
    ],
  },
  {
    id: 'room_pasillo',
    name: 'Pasillo',
    size: [13.0, 2.7, 2.4],
    texScale: 2.0,
    textures: {
      wall: 'Wall/Horror_Wall_09-128x128.png',
      floor: 'Floor/Horror_Floor_09-128x128.png',
      ceiling: 'Misc/Horror_Misc_03-128x128.png',
      door: 'Metal/Horror_Metal_01-128x128.png',
      metal: 'Metal/Horror_Metal_05-128x128.png',
      stain: 'Stains/Horror_Stain_06-128x128.png',
    },
    audio: { reverb: 'corridor', floor_material: 'wood', ambience: 'house' },
    doors: [
      { side: 'N', offset: 1.0, width: 1.2, to: 'room_bano' },
      { side: 'N', offset: 4.2, width: 1.2, to: 'room_despacho' },
      { side: 'N', offset: 7.4, width: 1.2, to: 'room_sotano', key: 'key_basement' },
      { side: 'N', offset: 10.6, width: 1.2, to: 'room_escalera' },
      { side: 'S', offset: 3.0, width: 1.2, to: 'room_cocina' },
    ],
    windows: [{ side: 'W', offset: 0.5, width: 1.2, height: 1.0, sill: 1.0 }],
    start: { position: [-6.0, 0.0], yaw: 270 },
    props: [
      { position: [-5.9, 0.4, 0.85], size: [1.2, 0.8, 0.35], texture: 'wall', tint: 0.5, collide: true },
      { position: [-3.3, 1.6, -1.13], size: [0.5, 0.7, 0.03], texture: 'door', tint: 0.3, collide: false, decal: true },
      { position: [2.6, 1.65, -1.13], size: [0.55, 0.7, 0.03], texture: 'door', tint: 0.3, collide: false, decal: true },
      { position: [4.9, 1.6, 1.13], size: [0.5, 0.7, 0.03], texture: 'door', tint: 0.3, collide: false, decal: true },
      { position: [-6.0, 0.25, -0.7], size: [0.5, 0.5, 0.5], texture: 'wall', tint: 0.45, collide: true },
      { position: [3.9, 0.3, 0.8], size: [0.45, 0.6, 0.45], texture: 'wall', tint: 0.45, collide: true },
      { position: [-2.5, 0.005, 0.0], size: [7.0, 0.01, 0.8], texture: 'stain', tint: 0.4, collide: false, decal: true },
    ],
  },
  {
    id: 'room_bano',
    name: 'Baño',
    size: [4.2, 2.7, 3.4],
    texScale: 2.0,
    textures: {
      wall: 'Wall/Horror_Wall_10-128x128.png',
      floor: 'Floor/Horror_Floor_02-128x128.png',
      ceiling: 'Misc/Horror_Misc_03-128x128.png',
      door: 'Metal/Horror_Metal_01-128x128.png',
      metal: 'Metal/Horror_Metal_03-128x128.png',
      stain: 'Stains/Horror_Stain_05-128x128.png',
    },
    audio: { reverb: 'small', floor_material: 'tile', ambience: 'house' },
    doors: [{ side: 'S', offset: 1.55, width: 1.1, to: 'room_pasillo' }],
    start: { position: [-1.0, 0.6], yaw: 180 },
    props: [
      { position: [-1.55, 0.375, -1.15], size: [0.5, 0.75, 0.65], texture: 'wall', tint: 0.65, collide: true },
      { position: [-1.75, 0.9, -1.4], size: [0.25, 0.5, 0.5], texture: 'wall', tint: 0.6, collide: false },
      { position: [1.5, 0.35, -1.35], size: [0.18, 0.7, 0.18], texture: 'wall', tint: 0.6, collide: false },
      { position: [1.5, 0.82, -1.35], size: [0.65, 0.15, 0.5], texture: 'wall', tint: 0.7, collide: true },
      { position: [1.5, 1.5, -1.64], size: [0.55, 0.6, 0.04], texture: 'metal', tint: 0.35, collide: false, decal: true },
      { position: [1.2, 0.3, 0.65], size: [0.8, 0.6, 1.8], texture: 'wall', tint: 0.6, collide: true },
      { position: [1.2, 0.56, 0.65], size: [0.6, 0.1, 1.6], texture: 'metal', tint: 0.4, collide: false },
      { position: [-1.3, 1.0, 1.66], size: [0.9, 1.0, 0.04], texture: 'stain', tint: 0.25, collide: false, decal: true },
      { position: [-0.8, 0.005, 0.4], size: [0.8, 0.01, 0.6], texture: 'stain', tint: 0.25, collide: false, decal: true },
    ],
  },
  {
    id: 'room_despacho',
    name: 'Despacho',
    size: [5.5, 2.7, 4.5],
    texScale: 2.0,
    textures: {
      wall: 'Wall/Horror_Wall_05-128x128.png',
      floor: 'Floor/Horror_Floor_11-128x128.png',
      ceiling: 'Misc/Horror_Misc_06-128x128.png',
      door: 'Metal/Horror_Metal_01-128x128.png',
      wood: 'Floor/Horror_Floor_03-128x128.png',
      metal: 'Metal/Horror_Metal_11-128x128.png',
      stain: 'Stains/Horror_Stain_09-128x128.png',
    },
    audio: { reverb: 'small', floor_material: 'wood', ambience: 'house' },
    doors: [{ side: 'S', offset: 2.2, width: 1.1, to: 'room_pasillo' }],
    windows: [{ side: 'N', offset: 2.05, width: 1.4 }],
    start: { position: [0.0, 1.2], yaw: 0 },
    items: [{ id: 'poster_5', position: [2.655, 1.5, 0.0], yaw: -90 }],
    models: [
      { file: 'living_room/bookcase.glb', position: [-2.5, 0.0, 0.4], yaw: 90, tint: 1.1, collide: true, size: [0.25, 1.8, 0.8] },
      { file: 'living_room/armchair.glb', position: [1.6, 0.0, -2.0], yaw: 0, collide: true, size: [1.05, 0.9, 0.9] },
      { file: 'living_room/old_controller_tv.glb', position: [0.35, 0.76, -1.85], yaw: 15 },
    ],
    props: [
      { position: [0.0, 0.37, -1.9], size: [1.8, 0.74, 0.7], texture: 'wood', tint: 0.45, collide: true },
      { position: [0.0, 0.3, -1.0], size: [0.45, 0.6, 0.45], texture: 'wall', tint: 0.45, collide: true },
      { position: [0.0, 0.77, -1.9], size: [0.4, 0.25, 0.3], texture: 'metal', tint: 0.35, collide: false },
      { position: [0.0, 1.05, -2.15], size: [0.2, 0.3, 0.2], texture: 'metal', tint: 0.4, collide: false },
      { position: [2.55, 0.65, 0.8], size: [0.4, 1.3, 0.6], texture: 'metal', tint: 0.4, collide: true },
      { position: [-2.3, 0.3, -1.8], size: [0.6, 0.6, 0.6], texture: 'wall', tint: 0.5, collide: true },
      { position: [-1.7, 1.6, -2.22], size: [0.5, 0.65, 0.03], texture: 'door', tint: 0.4, collide: false, decal: true },
      { position: [0.3, 0.005, 0.8], size: [2.2, 0.01, 1.6], texture: 'stain', tint: 0.4, collide: false, decal: true },
    ],
  },
  {
    id: 'room_escalera',
    name: 'Escalera',
    size: [5.0, 2.7, 6.5],
    texScale: 2.0,
    textures: {
      wall: 'Wall/Horror_Wall_03-128x128.png',
      floor: 'Floor/Horror_Floor_07-128x128.png',
      ceiling: 'Misc/Horror_Misc_03-128x128.png',
      door: 'Metal/Horror_Metal_01-128x128.png',
      stone: 'Stone/Horror_Stone_05-128x128.png',
      stain: 'Stains/Horror_Stain_07-128x128.png',
    },
    audio: { reverb: 'corridor', floor_material: 'wood', ambience: 'house' },
    doors: [
      { side: 'W', offset: 1.2, width: 1.2, to: 'room_pasillo_alto', action: 'up' },
      { side: 'W', offset: 4.1, width: 1.2, to: 'room_pasillo', action: 'down' },
    ],
    windows: [{ side: 'E', offset: 2.2, width: 1.4, height: 1.4, sill: 0.6 }],
    start: { position: [-1.7, 2.4], yaw: 180 },
    props: [
      ...STEP(1.6, 1.2, 2.55, 13, 0.3, 0.2, 'stone', 0.55),
      { position: [0.95, 0.5, 1.7], size: [0.05, 1.0, 1.1], texture: 'wall', tint: 0.5, collide: true },
      { position: [0.95, 0.85, 0.6], size: [0.05, 1.7, 1.0], texture: 'wall', tint: 0.5, collide: true },
      { position: [0.95, 1.2, -0.5], size: [0.05, 2.4, 1.0], texture: 'wall', tint: 0.5, collide: true },
      { position: [-2.42, 1.5, 0.0], size: [0.03, 1.0, 1.2], texture: 'stain', tint: 0.3, collide: false, decal: true },
      { position: [-0.5, 0.25, 2.7], size: [0.5, 0.5, 0.5], texture: 'wall', tint: 0.45, collide: true },
    ],
  },
  {
    id: 'room_pasillo_alto',
    name: 'Pasillo Alto',
    size: [13.5, 2.7, 2.4],
    texScale: 2.0,
    textures: {
      wall: 'Wall/Horror_Wall_09-128x128.png',
      floor: 'Floor/Horror_Floor_04-128x128.png',
      ceiling: 'Misc/Horror_Misc_03-128x128.png',
      door: 'Metal/Horror_Metal_01-128x128.png',
      stain: 'Stains/Horror_Stain_04-128x128.png',
    },
    audio: { reverb: 'corridor', floor_material: 'wood', ambience: 'house' },
    doors: [
      { side: 'W', offset: 0.6, width: 1.2, to: 'room_escalera', action: 'down' },
      { side: 'N', offset: 1.2, width: 1.1, to: 'room_dormitorio' },
      { side: 'N', offset: 4.6, width: 1.1, to: 'room_cuarto' },
      { side: 'N', offset: 8.4, width: 1.1, to: 'room_invitados' },
      { side: 'S', offset: 1.4, width: 1.0, to: 'room_bano_alto' },
      { side: 'S', offset: 5.2, width: 1.0, to: 'room_trastero' },
    ],
    windows: [{ side: 'S', offset: 8.0, width: 1.6, height: 1.1, sill: 0.9 }],
    start: { position: [-6.2, 0.0], yaw: 270 },
    props: [
      { position: [-2.0, 0.005, 0.0], size: [7.5, 0.01, 0.8], texture: 'stain', tint: 0.4, collide: false, decal: true },
      { position: [-5.7, 0.3, 0.6], size: [0.7, 0.6, 0.4], texture: 'wall', tint: 0.5, collide: true },
      { position: [-5.7, 0.72, 0.6], size: [0.16, 0.24, 0.16], texture: 'door', tint: 0.55, collide: false },
      { position: [-3.2, 1.5, -1.13], size: [0.5, 0.7, 0.05], texture: 'door', tint: 0.5, collide: false, decal: true },
      { position: [1.4, 1.5, -1.13], size: [0.45, 0.6, 0.05], texture: 'door', tint: 0.45, collide: false, decal: true },
      { position: [3.4, 1.45, 1.13], size: [0.6, 0.5, 0.05], texture: 'door', tint: 0.4, collide: false, decal: true },
      { position: [0.6, 1.8, -1.13], size: [0.9, 0.6, 0.05], texture: 'stain', tint: 0.25, collide: false, decal: true },
      { position: [4.6, 0.22, 0.55], size: [0.9, 0.44, 0.35], texture: 'wall', tint: 0.45, collide: true },
      { position: [5.9, 0.2, 0.5], size: [0.3, 0.4, 0.3], texture: 'wall', tint: 0.4, collide: true },
    ],
  },
  {
    id: 'room_dormitorio',
    name: 'Dormitorio Principal',
    size: [7.5, 2.7, 6.0],
    texScale: 2.0,
    textures: {
      wall: 'Wall/Horror_Wall_12-128x128.png',
      floor: 'Floor/Horror_Floor_09-128x128.png',
      ceiling: 'Misc/Horror_Misc_03-128x128.png',
      door: 'Metal/Horror_Metal_01-128x128.png',
      metal: 'Metal/Horror_Metal_12-128x128.png',
      stain: 'Stains/Horror_Stain_08-128x128.png',
    },
    audio: { reverb: 'small', floor_material: 'wood', ambience: 'house' },
    doors: [{ side: 'S', offset: 3.4, width: 1.1, to: 'room_pasillo_alto' }],
    windows: [{ side: 'N', offset: 2.8, width: 1.6, height: 1.2, sill: 0.9 }],
    start: { position: [-0.2, 2.2], yaw: 0 },
    items: [
      { id: 'poster_6', position: [3.655, 1.5, 1.2], yaw: -90 },
      { id: 'key_basement', position: [-1.7, 0.6, -0.6], yaw: 40 },
    ],
    models: [
      { file: 'bedroom/room_furniture.glb', node: ['Base_Cama_01', 'Cabeceira_Cama_01', 'Colchao_Cama_01'], position: [-2.2, 0.0, -0.6], yaw: 0, tint: 0.7, collide: true, size: [2.0, 0.8, 1.4] },
      { file: 'bedroom/room_furniture.glb', node: 'Mesa_Cabeceira_*', position: [-3.4, 0.0, -1.8], yaw: 180, tint: 1.4, collide: true, size: [0.45, 0.45, 0.5] },
      { file: 'bedroom/room_furniture.glb', node: 'Guarda_Roupa_*', position: [2.7, 0.0, -1.9], yaw: 270, tint: 1.4, collide: true, size: [1.7, 2.0, 0.7] },
      { file: 'bedroom/room_furniture.glb', node: 'Abajur_*', position: [-3.3, 0.0, 2.3], yaw: 0, tint: 1.5, collide: true, size: [0.45, 1.6, 0.45] },
    ],
    props: [
      { position: [1.2, 0.3, 0.9], size: [0.45, 0.6, 0.45], texture: 'wall', tint: 0.5, collide: true },
      { position: [-1.6, 1.5, -2.92], size: [0.6, 0.8, 0.03], texture: 'door', tint: 0.45, collide: false, decal: true },
      { position: [0.3, 0.005, 0.2], size: [2.4, 0.01, 2.0], texture: 'stain', tint: 0.45, collide: false, decal: true },
    ],
  },
  {
    id: 'room_cuarto',
    name: 'Cuarto Infantil',
    size: [6.0, 2.7, 5.0],
    texScale: 2.0,
    textures: {
      wall: 'Wall/Horror_Wall_10-128x128.png',
      floor: 'Floor/Horror_Floor_05-128x128.png',
      ceiling: 'Misc/Horror_Misc_03-128x128.png',
      door: 'Metal/Horror_Metal_01-128x128.png',
      wood: 'Floor/Horror_Floor_03-128x128.png',
      stain: 'Stains/Horror_Stain_02-128x128.png',
    },
    audio: { reverb: 'small', floor_material: 'wood', ambience: 'house' },
    doors: [{ side: 'S', offset: 2.45, width: 1.1, to: 'room_pasillo_alto' }],
    windows: [{ side: 'N', offset: 2.2, width: 1.4 }],
    start: { position: [0.0, 1.6], yaw: 0 },
    items: [{ id: 'poster_7', position: [2.905, 1.5, 1.0], yaw: -90 }],
    models: [
      { file: 'bedroom/room_furniture.glb', node: 'Escrivaninha_*', position: [-0.9, 0.0, -2.05], yaw: 90, tint: 1.45, collide: true, size: [1.3, 0.8, 0.6] },
      { file: 'living_room/book_blue_1.glb', position: [-1.25, 0.75, -2.0], yaw: -15 },
    ],
    props: [
      { position: [-2.3, 0.25, -0.6], size: [1.0, 0.5, 2.0], texture: 'wall', tint: 0.55, collide: true },
      { position: [-2.9, 0.5, -0.6], size: [0.1, 1.0, 2.1], texture: 'wall', tint: 0.5, collide: false },
      { position: [1.7, 0.3, 0.6], size: [0.45, 0.6, 0.45], texture: 'wall', tint: 0.5, collide: true },
      { position: [-2.6, 0.9, 1.7], size: [0.5, 1.8, 1.0], texture: 'wall', tint: 0.5, collide: true },
      { position: [-1.5, 0.25, 1.7], size: [0.9, 0.5, 0.5], texture: 'wall', tint: 0.55, collide: true },
      { position: [0.0, 0.09, 0.4], size: [0.2, 0.18, 0.2], texture: 'wall', tint: 0.6, collide: false },
      { position: [-0.6, 0.08, 0.7], size: [0.16, 0.16, 0.16], texture: 'stain', tint: 0.5, collide: false },
      { position: [1.5, 1.5, -2.47], size: [0.4, 0.5, 0.03], texture: 'wall', tint: 0.75, collide: false, decal: true },
      { position: [2.2, 1.45, -2.47], size: [0.35, 0.45, 0.03], texture: 'wall', tint: 0.7, collide: false, decal: true },
      { position: [-2.97, 1.3, 0.8], size: [0.03, 0.5, 0.4], texture: 'wall', tint: 0.72, collide: false, decal: true },
      { position: [0.2, 0.005, 0.3], size: [1.8, 0.01, 1.6], texture: 'stain', tint: 0.5, collide: false, decal: true },
    ],
  },
  {
    id: 'room_bano_alto',
    name: 'Baño Alto',
    size: [4.2, 2.7, 3.4],
    texScale: 2.0,
    textures: {
      wall: 'Wall/Horror_Wall_04-128x128.png',
      floor: 'Floor/Horror_Floor_08-128x128.png',
      ceiling: 'Misc/Horror_Misc_03-128x128.png',
      door: 'Metal/Horror_Metal_01-128x128.png',
      metal: 'Metal/Horror_Metal_13-128x128.png',
      stain: 'Stains/Horror_Stain_05-128x128.png',
    },
    audio: { reverb: 'small', floor_material: 'tile', ambience: 'house' },
    doors: [{ side: 'N', offset: 1.6, width: 1.0, to: 'room_pasillo_alto' }],
    start: { position: [0.0, -0.7], yaw: 180 },
    props: [
      { position: [-1.5, 0.4, -0.9], size: [0.6, 0.8, 0.6], texture: 'wall', tint: 0.6, collide: true },
      { position: [-1.5, 0.9, -1.35], size: [0.5, 0.2, 0.3], texture: 'metal', tint: 0.35, collide: false },
      { position: [-1.5, 0.4, 0.6], size: [0.6, 0.8, 0.6], texture: 'wall', tint: 0.6, collide: true },
      { position: [1.3, 0.12, 0.2], size: [0.9, 0.24, 2.2], texture: 'wall', tint: 0.65, collide: true },
      { position: [0.85, 1.15, 0.2], size: [0.04, 1.9, 2.2], texture: 'metal', tint: 0.25, collide: false },
      { position: [-0.95, 1.7, -1.66], size: [0.7, 0.6, 0.03], texture: 'stain', tint: 0.25, collide: false, decal: true },
      { position: [-0.6, 1.05, 1.66], size: [0.9, 0.8, 0.03], texture: 'stain', tint: 0.25, collide: false, decal: true },
      { position: [0.4, 0.005, 0.2], size: [0.8, 0.01, 0.7], texture: 'stain', tint: 0.25, collide: false, decal: true },
    ],
  },
  {
    id: 'room_invitados',
    name: 'Dormitorio de Invitados',
    size: [6.5, 2.7, 5.5],
    texScale: 2.0,
    textures: {
      wall: 'Wall/Horror_Wall_13-128x128.png',
      floor: 'Floor/Horror_Floor_01-128x128.png',
      ceiling: 'Misc/Horror_Misc_07-128x128.png',
      door: 'Metal/Horror_Metal_01-128x128.png',
      wood: 'Floor/Horror_Floor_03-128x128.png',
      metal: 'Metal/Horror_Metal_06-128x128.png',
      stain: 'Stains/Horror_Stain_10-128x128.png',
    },
    audio: { reverb: 'small', floor_material: 'wood', ambience: 'house' },
    doors: [{ side: 'S', offset: 2.7, width: 1.1, to: 'room_pasillo_alto' }],
    windows: [{ side: 'N', offset: 2.45, width: 1.6, height: 1.2, sill: 0.9 }],
    start: { position: [0.0, 1.6], yaw: 0 },
    models: [
      { file: 'bedroom/room_furniture.glb', node: ['Base_Cama_01', 'Cabeceira_Cama_01', 'Colchao_Cama_01'], position: [-2.1, 0.0, -0.9], yaw: 0, tint: 0.75, collide: true, size: [2.0, 0.8, 1.4] },
      { file: 'bedroom/room_furniture.glb', node: 'Mesa_Cabeceira_*', position: [-3.1, 0.0, -2.0], yaw: 180, tint: 1.4, collide: true, size: [0.45, 0.45, 0.5] },
      { file: 'bedroom/room_furniture.glb', node: 'Guarda_Roupa_*', position: [2.2, 0.0, -1.7], yaw: 270, tint: 1.4, collide: true, size: [1.7, 2.0, 0.7] },
    ],
    props: [
      { position: [2.3, 0.36, 1.3], size: [0.55, 0.72, 1.1], texture: 'wood', tint: 0.5, collide: true },
      { position: [1.7, 0.3, 1.3], size: [0.45, 0.6, 0.45], texture: 'wall', tint: 0.5, collide: true },
      { position: [-1.2, 0.18, 2.1], size: [0.55, 0.35, 0.25], texture: 'metal', tint: 0.4, collide: true },
      { position: [-2.5, 0.25, 1.9], size: [0.5, 0.5, 0.5], texture: 'wall', tint: 0.5, collide: true },
      { position: [-2.7, 1.5, -0.5], size: [0.04, 0.7, 0.5], texture: 'door', tint: 0.45, collide: false, decal: true },
      { position: [-1.4, 1.6, -2.72], size: [0.8, 0.7, 0.03], texture: 'stain', tint: 0.3, collide: false, decal: true },
      { position: [0.2, 0.005, 0.2], size: [2.2, 0.01, 1.8], texture: 'stain', tint: 0.5, collide: false, decal: true },
    ],
  },
  {
    id: 'room_trastero',
    name: 'Trastero',
    size: [4.0, 2.7, 3.4],
    texScale: 2.0,
    textures: {
      wall: 'Wall/Horror_Wall_11-128x128.png',
      floor: 'Floor/Horror_Floor_07-128x128.png',
      ceiling: 'Misc/Horror_Misc_08-128x128.png',
      door: 'Metal/Horror_Metal_01-128x128.png',
      stain: 'Stains/Horror_Stain_11-128x128.png',
    },
    audio: { reverb: 'small', floor_material: 'wood', ambience: 'house' },
    doors: [{ side: 'N', offset: 1.45, width: 1.0, to: 'room_pasillo_alto' }],
    start: { position: [0.05, -0.7], yaw: 180 },
    props: [
      { position: [-1.2, 0.25, -0.9], size: [0.6, 0.5, 0.6], texture: 'wall', tint: 0.45, collide: true },
      { position: [-1.15, 0.7, -0.9], size: [0.5, 0.4, 0.5], texture: 'wall', tint: 0.4, collide: true },
      { position: [1.1, 0.3, 0.9], size: [0.7, 0.6, 0.7], texture: 'wall', tint: 0.45, collide: true },
      { position: [1.2, 0.75, 0.85], size: [0.45, 0.3, 0.45], texture: 'wall', tint: 0.4, collide: true },
      { position: [0.2, 0.3, 1.3], size: [0.45, 0.6, 0.45], texture: 'wall', tint: 0.5, collide: true },
      { position: [1.9, 0.8, 0.3], size: [0.06, 1.4, 0.6], texture: 'door', tint: 0.35, collide: false },
      { position: [1.25, 1.9, -1.66], size: [1.2, 0.7, 0.03], texture: 'stain', tint: 0.25, collide: false, decal: true },
      { position: [-1.96, 0.9, -0.2], size: [0.03, 1.2, 0.9], texture: 'stain', tint: 0.25, collide: false, decal: true },
    ],
  },
  {
    id: 'room_sotano',
    name: 'Escalera del Sótano',
    size: [4.5, 2.7, 7.0],
    texScale: 2.0,
    textures: {
      wall: 'Brick/Horror_Brick_12-128x128.png',
      floor: 'Floor/Horror_Floor_12-128x128.png',
      ceiling: 'Misc/Horror_Misc_02-128x128.png',
      door: 'Metal/Horror_Metal_01-128x128.png',
      stone: 'Stone/Horror_Stone_07-128x128.png',
      metal: 'Metal/Horror_Metal_02-128x128.png',
      wood: 'Floor/Horror_Floor_03-128x128.png',
    },
    audio: { reverb: 'corridor', floor_material: 'stone', ambience: 'basement' },
    atmosphere: { fog_start: 3.0, fog_end: 14.0, ambient: 0.2 },
    doors: [
      { side: 'N', offset: 1.7, width: 1.1, to: 'room_pasillo', action: 'up' },
      { side: 'S', offset: 1.7, width: 1.1, to: 'room_lavanderia' },
    ],
    start: { position: [0.0, 2.2], yaw: 0 },
    items: [{ id: 'flashlight', position: [1.5, 0.51, 0.9], yaw: 35 }],
    props: [
      ...STEP(-1.35, 1.1, 1.9, 12, 0.26, 0.22, 'stone', 0.46),
    ],
  },
  {
    id: 'room_lavanderia',
    name: 'Lavandería',
    size: [7.0, 2.7, 5.5],
    texScale: 2.0,
    textures: {
      wall: 'Brick/Horror_Brick_11-128x128.png',
      floor: 'Floor/Horror_Floor_14-128x128.png',
      ceiling: 'Misc/Horror_Misc_05-128x128.png',
      door: 'Metal/Horror_Metal_01-128x128.png',
      stone: 'Stone/Horror_Stone_07-128x128.png',
      metal: 'Metal/Horror_Metal_02-128x128.png',
      wood: 'Floor/Horror_Floor_03-128x128.png',
      stain: 'Stains/Horror_Stain_13-128x128.png',
    },
    audio: { reverb: 'cave', floor_material: 'stone', ambience: 'basement' },
    atmosphere: { fog_start: 2.5, fog_end: 12.0, ambient: 0.16 },
    doors: [
      { side: 'N', offset: 2.95, width: 1.1, to: 'room_sotano' },
      { side: 'S', offset: 2.95, width: 1.1, to: 'room_calderas' },
      { side: 'E', offset: 2.2, width: 1.1, to: 'room_bodega' },
    ],
    start: { position: [-1.5, 1.5], yaw: 0 },
    props: [
      { position: [-2.6, 0.48, 1.5], size: [0.8, 0.95, 0.7], texture: 'metal', tint: 0.4, collide: true },
      { position: [-2.6, 0.48, 0.55], size: [0.8, 0.95, 0.7], texture: 'metal', tint: 0.38, collide: true },
      { position: [2.5, 0.43, 1.6], size: [0.95, 0.85, 0.65], texture: 'stone', tint: 0.45, collide: true },
      { position: [2.5, 0.9, 1.6], size: [0.7, 0.12, 0.45], texture: 'metal', tint: 0.3, collide: false },
      { position: [-3.3, 1.3, 0.5], size: [0.35, 0.08, 3.0], texture: 'metal', tint: 0.4, collide: false },
      { position: [-3.3, 1.75, 0.5], size: [0.35, 0.08, 3.0], texture: 'metal', tint: 0.38, collide: false },
      { position: [0.9, 0.175, -2.0], size: [0.6, 0.35, 0.6], texture: 'metal', tint: 0.42, collide: true },
      { position: [-1.6, 0.005, -1.2], size: [1.6, 0.01, 1.4], texture: 'stain', tint: 0.3, collide: false, decal: true },
    ],
  },
  {
    id: 'room_calderas',
    name: 'Calderas',
    size: [8.0, 2.7, 6.5],
    texScale: 2.0,
    textures: {
      wall: 'Brick/Horror_Brick_13-128x128.png',
      floor: 'Floor/Horror_Floor_13-128x128.png',
      ceiling: 'Misc/Horror_Misc_13-128x128.png',
      door: 'Metal/Horror_Metal_01-128x128.png',
      stone: 'Stone/Horror_Stone_07-128x128.png',
      metal: 'Metal/Horror_Metal_02-128x128.png',
      rust: 'Metal/Horror_Metal_03-128x128.png',
      wood: 'Floor/Horror_Floor_03-128x128.png',
    },
    audio: { reverb: 'cave', floor_material: 'metal', ambience: 'basement' },
    atmosphere: { fog_start: 2.0, fog_end: 10.0, ambient: 0.13 },
    doors: [
      { side: 'N', offset: 3.45, width: 1.1, to: 'room_lavanderia' },
      { side: 'E', offset: 2.7, width: 1.1, to: 'room_bodega' },
    ],
    start: { position: [0.0, -2.4], yaw: 180 },
    items: [{ id: 'poster_8', position: [-3.905, 1.5, 0.0], yaw: 90 }],
    props: [
      { position: [0.0, 1.0, 0.2], size: [1.7, 2.0, 1.3], texture: 'metal', tint: 0.3, collide: true },
      { position: [0.0, 2.35, 0.2], size: [0.5, 0.6, 0.5], texture: 'metal', tint: 0.28, collide: false },
      { position: [2.7, 0.43, -1.9], size: [0.6, 0.86, 0.6], texture: 'rust', tint: 0.32, collide: true },
      { position: [2.0, 0.43, -2.4], size: [0.6, 0.86, 0.6], texture: 'rust', tint: 0.3, collide: true },
      { position: [-2.9, 0.25, -2.0], size: [0.85, 0.5, 0.5], texture: 'rust', tint: 0.3, collide: true },
      { position: [1.15, 0.3, 1.0], size: [0.7, 0.6, 0.7], texture: 'metal', tint: 0.34, collide: true },
      { position: [2.3, 0.125, 2.6], size: [0.5, 0.25, 0.4], texture: 'stone', tint: 0.3, collide: false },
      { position: [1.6, 0.08, 2.8], size: [0.35, 0.16, 0.3], texture: 'stone', tint: 0.28, collide: false },
      { position: [0.6, 0.005, -1.0], size: [1.5, 0.01, 1.0], texture: 'stone', tint: 0.25, collide: false, decal: true },
    ],
  },
  {
    id: 'room_bodega',
    name: 'Bodega',
    size: [6.0, 2.7, 5.0],
    texScale: 2.0,
    textures: {
      wall: 'Brick/Horror_Brick_14-128x128.png',
      floor: 'Floor/Horror_Floor_11-128x128.png',
      ceiling: 'Misc/Horror_Misc_09-128x128.png',
      door: 'Metal/Horror_Metal_01-128x128.png',
      stone: 'Stone/Horror_Stone_06-128x128.png',
      wood: 'Floor/Horror_Floor_03-128x128.png',
      rust: 'Metal/Horror_Metal_07-128x128.png',
      stain: 'Stains/Horror_Stain_14-128x128.png',
    },
    audio: { reverb: 'cave', floor_material: 'stone', ambience: 'basement' },
    atmosphere: { fog_start: 2.0, fog_end: 10.0, ambient: 0.14 },
    doors: [
      { side: 'W', offset: 1.95, width: 1.1, to: 'room_calderas' },
      { side: 'N', offset: 2.45, width: 1.1, to: 'room_lavanderia' },
    ],
    start: { position: [-2.6, 0.0], yaw: 270 },
    props: [
      { position: [-1.4, 1.0, -1.9], size: [0.5, 2.0, 0.9], texture: 'wood', tint: 0.4, collide: true },
      { position: [1.4, 1.0, -1.9], size: [0.5, 2.0, 0.9], texture: 'wood', tint: 0.4, collide: true },
      { position: [1.9, 0.43, -0.6], size: [0.6, 0.86, 0.6], texture: 'rust', tint: 0.32, collide: true },
      { position: [2.0, 0.43, 0.6], size: [0.6, 0.86, 0.6], texture: 'rust', tint: 0.3, collide: true },
      { position: [0.4, 1.5, 2.2], size: [2.2, 0.08, 0.4], texture: 'wood', tint: 0.4, collide: false },
      { position: [0.4, 1.0, 2.2], size: [2.2, 0.08, 0.4], texture: 'wood', tint: 0.38, collide: false },
      { position: [0.3, 0.005, -1.9], size: [1.4, 0.01, 1.0], texture: 'stain', tint: 0.25, collide: false, decal: true },
      { position: [-2.98, 2.1, 1.2], size: [0.06, 1.0, 0.8], texture: 'stain', tint: 0.22, collide: false, decal: true },
    ],
  },
];

// Texturas del PanelkaPack (CC0, 128 px) integradas en M10b: puertas fotografiadas
// (se mapean 1:1 en la hoja con door_fit), ventanas y azulejos.
const DOOR_TEX = {
  room_vestibulo: 'Custom/WoodenDoor1diffuse.png',
  room_salon: 'Custom/WoodenDoor1diffuse.png',
  room_comedor: 'Custom/WoodenDoor2diffuse.png',
  room_cocina: 'Custom/WoodenDoor2diffuse.png',
  room_pasillo: 'Custom/WoodenDoor3diffuse.png',
  room_bano: 'Custom/WoodenDoor3diffuse.png',
  room_despacho: 'Custom/WoodenDoor1diffuse.png',
  room_escalera: 'Custom/WoodenDoor2diffuse.png',
  room_pasillo_alto: 'Custom/WoodenDoor1diffuse.png',
  room_dormitorio: 'Custom/WoodenDoor2diffuse.png',
  room_cuarto: 'Custom/WoodenDoor3diffuse.png',
  room_bano_alto: 'Custom/WoodenDoor1diffuse.png',
  room_invitados: 'Custom/WoodenDoor2diffuse.png',
  room_trastero: 'Custom/WoodenDoor3diffuse.png',
  room_sotano: 'Custom/GreenMetalDoordiffuse.png',
  room_lavanderia: 'Custom/WoodenDoor3diffuse.png',
  room_calderas: 'Custom/BlueMetalDoordiffuse.png',
  room_bodega: 'Custom/GreenMetalDoordiffuse.png',
};
const WINDOW_TEX = {
  room_vestibulo: 'Custom/TiledWindowdiffuse.png',
  room_salon: 'Custom/TiledWindowdiffuse.png',
  room_comedor: 'Custom/TiledWindowdiffuse.png',
  room_cocina: 'Custom/TiledWindowdiffuse.png',
  room_pasillo: 'Custom/MetalCageWindow.png',
  room_escalera: 'Custom/MetalCageWindow.png',
  room_pasillo_alto: 'Custom/TiledWindowdiffuse.png',
  room_dormitorio: 'Custom/TiledWindowdiffuse.png',
  room_cuarto: 'Custom/TiledWindowdiffuse.png',
  room_invitados: 'Custom/TiledWindowdiffuse.png',
};
const WALL_TEX = {
  room_bano: 'Custom/WallTilesDiffuse.png',
  room_bano_alto: 'Custom/WallTilesDiffuse.png',
};

const spawnsByRoom = buildSpawns(rooms);
const outputs = rooms.map((room) => {
  const [w, h, d] = room.size;
  const data = {
    id: room.id,
    name: room.name,
    size: [w, h, d],
    texture_scale: room.texScale,
    wall_thickness: WALL_THICKNESS,
    textures: room.textures,
    audio: room.audio,
  };
  data.door_fit = true;
  if (DOOR_TEX[room.id]) data.textures.door = DOOR_TEX[room.id];
  if (WINDOW_TEX[room.id]) data.textures.window = WINDOW_TEX[room.id];
  if (WALL_TEX[room.id]) data.textures.wall = WALL_TEX[room.id];
  if (room.atmosphere) data.atmosphere = room.atmosphere;
  data.walls = buildWalls(room);
  if (room.props && room.props.length > 0) {
    data.props = room.props.map((prop) => {
      const entry = {
        kind: 'box',
        position: prop.position,
        size: prop.size,
        texture: prop.texture,
        tint: prop.tint,
        collide: prop.collide,
      };
      if (prop.decal) entry.decal = true;
      return entry;
    });
  }
  if (room.models && room.models.length > 0) {
    data.models = room.models;
  }
  if (room.items && room.items.length > 0) {
    data.items = room.items;
  }
  data.spawns = spawnsByRoom.get(room.id);
  return data;
});

for (const data of outputs) {
  writeFileSync(`${OUT}/${data.id}.json`, `${JSON.stringify(data, null, 2)}\n`);
}
console.log(`Escritas ${outputs.length} salas en ${OUT}`);
