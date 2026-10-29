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
    if (room.wallTextures?.[side]) run.texture = room.wallTextures[side];
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

// Chimenea completa contra un muro (x centrado; wallZ = cara interior del muro;
// dir = +1 si la sala queda hacia +Z, -1 si hacia -Z). Jambas y dintel de
// piedra, hogar ennegrecido con brasas y leños, repisa de madera, campana de
// piedra hasta el techo y un retrato sobre la repisa.
const FIREPLACE = (x, wallZ, dir, ceiling, painting = 'painting') => {
  const f = (dz) => Math.round((wallZ + dir * dz) * 1000) / 1000;
  // Las jambas acaban bajo el dintel: si lo atravesaran, sus caras coplanares
  // parpadearían (z-fighting) en el frente de piedra.
  return [
    { position: [x - 0.78, 0.43, f(0.27)], size: [0.34, 0.86, 0.54], texture: 'hearth', tint: 0.85, collide: false },
    { position: [x + 0.78, 0.43, f(0.27)], size: [0.34, 0.86, 0.54], texture: 'hearth', tint: 0.85, collide: false },
    { position: [x, 0.98, f(0.27)], size: [1.9, 0.24, 0.54], texture: 'hearth', tint: 0.85, collide: false },
    { position: [x, 0.45, f(0.03)], size: [1.24, 0.9, 0.06], texture: 'firebrick', tint: 0.35, collide: false },
    { position: [x, 0.04, f(0.27)], size: [1.22, 0.08, 0.5], texture: 'embers', tint: 0.85, collide: false },
    { position: [x, 0.025, f(0.78)], size: [2.1, 0.05, 0.5], texture: 'hearth', tint: 0.8, collide: false },
    { position: [x, 1.15, f(0.31)], size: [2.15, 0.1, 0.64], texture: 'mantel', tint: 0.85, collide: false },
    { position: [x, (1.2 + ceiling) / 2, f(0.17)], size: [1.55, ceiling - 1.2, 0.34], texture: 'hearth', tint: 0.75, collide: false },
    { position: [x, 1.85, f(0.355)], size: [0.75, 0.9, 0.02], texture: painting, tint: 0.95, collide: false, fit: true },
    // Leños (cilindros tumbados) sobre las brasas
    { position: [x - 0.08, 0.16, f(0.3)], size: [0.15, 0.85, 0.15], texture: 'logs', tint: 0.55, collide: false, shape: 'cylinder', rot: [0, 12, 90] },
    { position: [x + 0.1, 0.26, f(0.24)], size: [0.13, 0.75, 0.13], texture: 'logs', tint: 0.5, collide: false, shape: 'cylinder', rot: [0, -18, 90] },
    { position: [x, 0.6, f(0.4)], size: [2.0, 1.2, 0.8], texture: 'hearth', tint: 0, collide: true, hidden: true },
  ];
};
const FIREPLACE_TEXTURES = {
  hearth: 'ps2/stone_wall.png',
  firebrick: 'ps2/brick_dark.png',
  embers: 'ps2/embers.png',
  mantel: 'ps2/wood_dark.png',
  logs: 'ps2/bark.png',
};

// Árbol seco: tronco de corteza y ramas inclinadas en varias direcciones.
const TREE = (x, z, h, r) => {
  const branch = (yFrac, yaw, tilt, len, thick) => {
    const a = (yaw * Math.PI) / 180;
    const t = (tilt * Math.PI) / 180;
    const y = h * yFrac;
    const reach = (Math.sin(t) * len) / 2;
    return {
      position: [Math.round((x + Math.cos(a) * reach) * 1000) / 1000, Math.round((y + (Math.cos(t) * len) / 2) * 1000) / 1000, Math.round((z - Math.sin(a) * reach) * 1000) / 1000],
      size: [thick, len, thick],
      texture: 'bark',
      tint: 0.6,
      collide: false,
      shape: 'cylinder',
      rot: [0, yaw, -tilt],
    };
  };
  return [
    { position: [x, h / 2, z], size: [r, h, r], texture: 'bark', tint: 0.65, collide: true, shape: 'cylinder' },
    branch(0.55, 20, 50, 1.4, r * 0.4),
    branch(0.68, 150, 45, 1.2, r * 0.35),
    branch(0.8, 260, 38, 1.1, r * 0.3),
    branch(0.9, 80, 30, 0.9, r * 0.25),
  ];
};

// Silla de madera: asiento, patas, respaldo con travesaño y una caja oculta
// para la colisión. `yaw` es hacia dónde mira quien se sienta (convención de
// spawns: 0 = -Z, 90 = -X); las piezas giran con `rot` sobre su centro.
// `texture: 'wall'` toma el material de mueble de la sala.
const CHAIR = (x, z, yaw, { scale = 1, texture = 'wall', tint = 0.55 } = {}) => {
  const a = (yaw * Math.PI) / 180;
  const r = (v) => Math.round(v * 1000) / 1000;
  const part = (dx, y, dz, size) => ({
    position: [r(x + (dx * Math.cos(a) + dz * Math.sin(a)) * scale), r(y * scale), r(z + (-dx * Math.sin(a) + dz * Math.cos(a)) * scale)],
    size: size.map((v) => r(v * scale)),
    texture,
    tint,
    collide: false,
    ...(yaw % 360 === 0 ? {} : { rot: [0, yaw, 0] }),
  });
  const footprint = r(0.46 * scale * (Math.abs(Math.cos(a)) + Math.abs(Math.sin(a))));
  return [
    part(0, 0.46, 0, [0.44, 0.05, 0.42]),
    part(-0.19, 0.2175, -0.18, [0.04, 0.435, 0.04]),
    part(0.19, 0.2175, -0.18, [0.04, 0.435, 0.04]),
    // Las patas traseras siguen hasta arriba como postes del respaldo.
    part(-0.19, 0.47, 0.18, [0.04, 0.94, 0.04]),
    part(0.19, 0.47, 0.18, [0.04, 0.94, 0.04]),
    part(0, 0.8, 0.18, [0.34, 0.2, 0.025]),
    part(0, 0.6, 0.18, [0.34, 0.04, 0.025]),
    { position: [x, r(0.47 * scale), z], size: [footprint, r(0.94 * scale), footprint], texture, tint: 0, collide: true, hidden: true },
  ];
};

// Mesa: tablero, cuatro patas retranqueadas y faldón, con una caja oculta para
// la colisión (los objetos encima se apoyan en `h`).
const TABLE = (x, z, w, d, h = 0.75, { texture = 'wall', tint = 0.5 } = {}) => {
  const r = (v) => Math.round(v * 1000) / 1000;
  const top = 0.05;
  const leg = 0.07;
  const inset = 0.08;
  const lx = w / 2 - inset - leg / 2;
  const lz = d / 2 - inset - leg / 2;
  const legH = h - top;
  const apronY = h - top - 0.055;
  return [
    { position: [x, r(h - top / 2), z], size: [w, top, d], texture, tint: tint + 0.1, collide: false },
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => ({
      position: [r(x + sx * lx), r(legH / 2), r(z + sz * lz)], size: [leg, r(legH), leg], texture, tint, collide: false,
    })),
    { position: [x, r(apronY), r(z - lz)], size: [r(2 * lx), 0.1, 0.025], texture, tint, collide: false },
    { position: [x, r(apronY), r(z + lz)], size: [r(2 * lx), 0.1, 0.025], texture, tint, collide: false },
    { position: [r(x - lx), r(apronY), z], size: [0.025, 0.1, r(2 * lz)], texture, tint, collide: false },
    { position: [r(x + lx), r(apronY), z], size: [0.025, 0.1, r(2 * lz)], texture, tint, collide: false },
    { position: [x, r(h / 2), z], size: [w, h, d], texture, tint: 0, collide: true, hidden: true },
  ];
};

const POSTERS = Array.from({ length: 12 }, (_, i) => `poster_${i + 1}`);

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
      { side: 'N', offset: 3.4, width: 1.2, requires: POSTERS, ending: true, double: true },
      { side: 'E', offset: 2.6, width: 1.2, to: 'room_salon' },
      { side: 'W', offset: 0.45, width: 1.2, to: 'room_garaje' },
    ],
    windows: [{ side: 'S', offset: 1.6, width: 1.6 }],
    start: { position: [0.0, 1.6], yaw: 0 },
    items: [{ id: 'poster_1', position: [-3.905, 1.5, -1.6], yaw: 90 }],
    models: [
      { file: 'living_room/rug.glb', position: [0, 0, 2.25], yaw: 0, subdivision: 0 },
      { file: 'living_room/coffe_table.glb', position: [0, 0, 2.25], yaw: 0, collide: true, size: [1.1, 0.45, 0.6] },
      { file: 'living_room/armchair.glb', position: [-1.6, 0, 2.25], yaw: 90, collide: true, size: [0.9, 0.9, 1] },
      { file: 'living_room/armchair.glb', position: [1.6, 0, 2.25], yaw: 270, collide: true, size: [0.9, 0.9, 1] },
      { file: 'living_room/bookcase.glb', position: [-3.55, 0, 0.6], yaw: 90, collide: true, size: [0.5, 1.8, 1] },
      { file: 'living_room/book_brown_1.glb', position: [0.3, 0.37, 2.15], yaw: 25 },
    ],
    props: [
      { position: [-3.87, 1.5, 0.2], size: [0.04, 0.9, 0.7], texture: 'metal', tint: 0.35, collide: false, decal: true },
      { position: [3.87, 1.55, 1.25], size: [0.04, 0.6, 0.9], texture: 'door', tint: 0.6, collide: false, decal: true },
      { position: [2.6, 1.6, -3.17], size: [0.7, 0.9, 0.03], texture: 'door', tint: 0.6, collide: false, decal: true },
      { position: [3.3, 0.45, -2.85], size: [0.9, 0.9, 0.4], texture: 'wall', tint: 0.6, collide: true },
      // Galería de retratos en el muro sur
      { position: [-1.0, 1.65, 3.2], size: [0.56, 0.7, 0.03], texture: 'portrait_1', tint: 0.95, collide: false, decal: true, fit: true },
      { position: [-2.0, 1.65, 3.2], size: [0.56, 0.7, 0.03], texture: 'portrait_2', tint: 0.95, collide: false, decal: true, fit: true },
      { position: [-3.0, 1.65, 3.2], size: [0.56, 0.7, 0.03], texture: 'portrait_3', tint: 0.95, collide: false, decal: true, fit: true },
      { position: [3.3, 0.93, -2.85], size: [0.2, 0.06, 0.2], texture: 'metal', tint: 0.6, collide: false },
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
      { side: 'S', offset: 1.5, width: 1.2, to: 'room_biblioteca' },
    ],
    // La ventana izquierda del muro norte quedaba detrás de la chimenea: pasa
    // al muro este, junto al sofá.
    windows: [
      { side: 'N', offset: 6.0, width: 1.6 },
      { side: 'E', offset: 4.6, width: 1.4 },
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
      ...FIREPLACE(-2.7, -3.425, 1, 2.7, 'portrait_2'),
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
    items: [{ id: 'poster_3', position: [2.0, 1.5, 2.655], yaw: 180 }, { id: 'chipa_2', position: [-0.6, 0.76, 0.35], yaw: 0 }],
    models: [
      { file: 'living_room/book_brown_1.glb', position: [0.4, 0.76, 0.2], yaw: 25 },
    ],
    props: [
      // Mesa de comedor con tres sillas por lado y la de la cabecera; una,
      // apartada y torcida, como si alguien acabara de levantarse.
      ...TABLE(0.0, 0.2, 2.2, 1.0, 0.755, { texture: 'wood', tint: 0.45 }),
      ...CHAIR(-0.7, -0.5, 180),
      ...CHAIR(0.0, -0.5, 180),
      ...CHAIR(0.7, -0.5, 180),
      ...CHAIR(-0.7, 0.9, 0),
      ...CHAIR(0.05, 1.08, 18),
      ...CHAIR(0.7, 0.9, 0),
      ...CHAIR(-1.5, 0.2, 270),
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
      { side: 'S', offset: 4.8, width: 1.1, to: 'room_jardin' },
    ],
    windows: [{ side: 'N', offset: 3.4, width: 1.4, height: 1.1, sill: 1.0 }],
    start: { position: [-2.5, 0.0], yaw: 270 },
    items: [
      { id: 'key_kids', position: [-0.9, 1.05, -1.95], yaw: 12 },
      { id: 'poster_4', position: [3.0, 1.5, 2.405], yaw: 180 },
      { id: 'chipa_1', position: [1.3, 0.96, 1.15], yaw: 30 },
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
      ...CHAIR(3.9, 0.85, 0),
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
      stain: 'Stains/Horror_Stain_04-128x128.png',
    },
    audio: { reverb: 'small', floor_material: 'wood', ambience: 'house' },
    doors: [{ side: 'S', offset: 2.2, width: 1.1, to: 'room_pasillo' }],
    windows: [{ side: 'N', offset: 2.05, width: 1.4 }],
    start: { position: [0.0, 1.2], yaw: 0 },
    items: [{ id: 'poster_5', position: [2.655, 1.5, 0.0], yaw: -90 }],
    models: [
      { file: 'living_room/bookcase.glb', position: [-2.5, 0.0, 0.4], yaw: 90, tint: 1.1, collide: true, size: [0.25, 1.8, 0.8] },
      { file: 'living_room/armchair.glb', position: [1.6, 0.0, -2.0], yaw: 0, collide: true, size: [1.05, 0.9, 0.9] },
      { file: 'living_room/old_controller_tv.glb', position: [0.35, 0.74, -1.75], yaw: 15 },
    ],
    props: [
      { position: [0.0, 0.37, -1.9], size: [1.8, 0.74, 0.7], texture: 'wood', tint: 0.45, collide: true },
      ...CHAIR(0.0, -1.15, 0),
      // Radio sobre el escritorio y flexo de pie redondo.
      { position: [0.0, 0.865, -1.95], size: [0.4, 0.25, 0.3], texture: 'metal', tint: 0.35, collide: false },
      { position: [-0.55, 0.755, -2.1], size: [0.16, 0.03, 0.16], texture: 'metal', tint: 0.45, collide: false, shape: 'cylinder' },
      { position: [-0.55, 0.92, -2.1], size: [0.025, 0.3, 0.025], texture: 'metal', tint: 0.45, collide: false, shape: 'cylinder' },
      { position: [-0.55, 1.1, -2.1], size: [0.26, 0.15, 0.26], texture: 'metal', tint: 0.55, collide: false, shape: 'cylinder' },
      { position: [2.55, 0.65, 0.8], size: [0.4, 1.3, 0.6], texture: 'metal', tint: 0.4, collide: true },
      { position: [-2.3, 0.3, -1.8], size: [0.6, 0.6, 0.6], texture: 'wall', tint: 0.5, collide: true },
      { position: [-1.7, 1.6, -2.22], size: [0.52, 0.65, 0.03], texture: 'portrait_3', tint: 0.95, collide: false, decal: true, fit: true },
      { position: [0.3, 0.005, 0.8], size: [2.2, 0.01, 1.6], texture: 'stain', tint: 0.4, collide: false, decal: true },
    ],
  },
  {
    id: 'room_escalera',
    name: 'Rellano',
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
    models: [
      { file: 'living_room/rack.glb', position: [2.05, 0, 1.6], yaw: 270, collide: true, size: [0.5, 0.7, 1.8] },
    ],
    props: [
      { position: [-2.42, 1.5, 0.0], size: [0.03, 1.0, 1.2], texture: 'stain', tint: 0.3, collide: false, decal: true },
      { position: [-0.5, 0.25, 2.7], size: [0.5, 0.5, 0.5], texture: 'wall', tint: 0.45, collide: true },
      { position: [0.3, 0.25, 2.7], size: [0.5, 0.5, 0.5], texture: 'wall', tint: 0.5, collide: true },
      { position: [2.42, 1.6, -1.6], size: [0.03, 0.8, 0.65], texture: 'door', tint: 0.6, collide: false, decal: true },
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
      { side: 'N', offset: 4.6, width: 1.1, to: 'room_cuarto', key: 'key_kids' },
      { side: 'N', offset: 8.4, width: 1.1, to: 'room_invitados' },
      { side: 'S', offset: 1.4, width: 1.0, to: 'room_bano_alto' },
      { side: 'S', offset: 5.2, width: 1.0, to: 'room_trastero' },
      { side: 'E', offset: 0.6, width: 1.2, to: 'room_atico', action: 'up', key: 'key_attic' },
    ],
    windows: [{ side: 'S', offset: 8.0, width: 1.6, height: 1.1, sill: 0.9 }],
    start: { position: [-6.2, 0.0], yaw: 270 },
    props: [
      { position: [-2.0, 0.005, 0.0], size: [7.5, 0.01, 0.8], texture: 'stain', tint: 0.4, collide: false, decal: true },
      { position: [-3.0, 0.3, 0.85], size: [0.7, 0.6, 0.4], texture: 'wall', tint: 0.5, collide: true },
      { position: [-3.0, 0.72, 0.85], size: [0.16, 0.24, 0.16], texture: 'door', tint: 0.55, collide: false },
      { position: [-3.2, 1.5, -1.13], size: [0.5, 0.7, 0.05], texture: 'door', tint: 0.5, collide: false, decal: true },
      { position: [1.4, 1.5, -1.13], size: [0.45, 0.6, 0.05], texture: 'door', tint: 0.45, collide: false, decal: true },
      { position: [3.4, 1.45, 1.13], size: [0.6, 0.5, 0.05], texture: 'door', tint: 0.4, collide: false, decal: true },
      { position: [0.6, 1.8, -1.13], size: [0.9, 0.6, 0.05], texture: 'stain', tint: 0.25, collide: false, decal: true },
      { position: [-1.5, 0.22, 0.95], size: [0.9, 0.44, 0.35], texture: 'wall', tint: 0.45, collide: true },
      { position: [3.0, 0.2, 0.9], size: [0.3, 0.4, 0.3], texture: 'wall', tint: 0.4, collide: true },
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
      // Una silla sola en mitad del cuarto, vuelta hacia la cama.
      ...CHAIR(1.2, 0.9, 75),
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
      { file: 'living_room/book_blue_1.glb', position: [-1.25, 0.73, -2.0], yaw: -15 },
    ],
    props: [
      { position: [-2.3, 0.25, -0.6], size: [1.0, 0.5, 2.0], texture: 'wall', tint: 0.55, collide: true },
      { position: [-2.9, 0.5, -0.6], size: [0.1, 1.0, 2.1], texture: 'wall', tint: 0.5, collide: false },
      // Sillita infantil de cara a la pared.
      ...CHAIR(1.7, 0.6, 250, { scale: 0.8 }),
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
      // Mancha con bordes propios: va en la pared y en el suelo (el chorreo
      // de Stain_10 sólo tiene sentido en vertical).
      stain: 'Stains/Horror_Stain_05-128x128.png',
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
      ...CHAIR(1.68, 1.3, 270),
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
      // Humedades con bordes propios (el chorreo de Stain_11 quedaba como una franja).
      stain: 'Stains/Horror_Stain_05-128x128.png',
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
    atmosphere: {
      fog_start: 3.0,
      fog_end: 14.0,
      ambient: 0.05,
      direct: 0.06,
      // Bombilla sobre la mesa de la linterna: único punto iluminado del sótano.
      lamp: { position: [1.1, 1.55, 0.9], color: [1.0, 0.78, 0.5], range: 3.0, intensity: 1.7 },
    },
    doors: [
      { side: 'N', offset: 1.7, width: 1.1, to: 'room_pasillo', action: 'up' },
      { side: 'S', offset: 1.7, width: 1.1, to: 'room_lavanderia' },
    ],
    start: { position: [0.0, 2.2], yaw: 0 },
    models: [
      { file: 'bedroom/room_furniture.glb', node: 'Mesa_Cabeceira_*', position: [1.85, 0.0, 0.9], yaw: 180, tint: 1.2, collide: true, size: [0.5, 0.45, 0.5] },
    ],
    items: [{ id: 'flashlight', position: [1.85, 0.46, 0.9], yaw: 35 }],
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
    atmosphere: { fog_start: 2.5, fog_end: 12.0, ambient: 0.06, direct: 0.05 },
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
      { position: [2.4, 0.175, -2.2], size: [0.6, 0.35, 0.6], texture: 'metal', tint: 0.42, collide: true },
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
    atmosphere: { fog_start: 2.0, fog_end: 10.0, ambient: 0.055, direct: 0.05 },
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
    atmosphere: { fog_start: 2.0, fog_end: 10.0, ambient: 0.055, direct: 0.05 },
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
  {
    id: 'room_biblioteca',
    name: 'Biblioteca',
    size: [8.0, 3.2, 6.5],
    texScale: 2.0,
    textures: {
      wall: 'ps2/wp_damask_decay.png',
      floor: 'ps2/floor_walnut.png',
      ceiling: 'ps2/ceiling.png',
      door: 'ps2/door_wood.png',
      wood: 'ps2/wood_dark.png',
      books: 'ps2/books.png',
      stone: 'ps2/stone_wall.png',
      carpet: 'ps2/carpet_red.png',
      metal: 'ps2/metal_clean.png',
      soot: 'Stains/Horror_Stain_13-128x128.png',
    },
    audio: { reverb: 'hall', floor_material: 'wood', ambience: 'house' },
    doors: [{ side: 'N', offset: 3.4, width: 1.2, to: 'room_salon' }],
    windows: [
      { side: 'N', offset: 0.7, width: 1.2, height: 1.5, sill: 0.9 },
      { side: 'N', offset: 6.1, width: 1.2, height: 1.5, sill: 0.9 },
    ],
    start: { position: [0.0, -1.8], yaw: 180 },
    items: [{ id: 'poster_9', position: [1.7, 1.55, 3.155], yaw: 180 }, { id: 'chipa_3', position: [-0.2, 0.765, 0.75], yaw: 0 }],
    models: [
      { file: 'living_room/armchair.glb', position: [2.4, 0.0, 1.9], yaw: 200, collide: true, size: [0.95, 0.9, 0.95] },
      { file: 'living_room/book_black_1.glb', position: [-0.4, 0.76, 0.5], yaw: 30 },
      { file: 'living_room/book_blue_2.glb', position: [0.5, 0.76, 0.7], yaw: -50 },
    ],
    props: [
      // Estanterías de pared a pared (E y O)
      { position: [-3.72, 1.3, -1.6], size: [0.42, 2.6, 2.2], texture: 'books', tint: 0.9, collide: true, fit: true },
      { position: [-3.72, 1.3, 1.1], size: [0.42, 2.6, 2.2], texture: 'books', tint: 0.85, collide: true, fit: true },
      { position: [3.72, 1.3, -1.6], size: [0.42, 2.6, 2.2], texture: 'books', tint: 0.85, collide: true, fit: true },
      { position: [3.72, 1.3, 0.75], size: [0.42, 2.6, 1.5], texture: 'books', tint: 0.9, collide: true, fit: true },
      { position: [-3.72, 2.68, -0.25], size: [0.5, 0.12, 5.0], texture: 'wood', tint: 0.7, collide: false },
      { position: [3.72, 2.68, -0.4], size: [0.5, 0.12, 4.0], texture: 'wood', tint: 0.7, collide: false },
      // Mesa de lectura y sillas
      { position: [0.0, 0.73, 0.6], size: [2.2, 0.06, 1.1], texture: 'wood', tint: 0.85, collide: false },
      { position: [-0.95, 0.35, 0.15], size: [0.1, 0.7, 0.1], texture: 'wood', tint: 0.7, collide: false },
      { position: [0.95, 0.35, 0.15], size: [0.1, 0.7, 0.1], texture: 'wood', tint: 0.7, collide: false },
      { position: [-0.95, 0.35, 1.05], size: [0.1, 0.7, 0.1], texture: 'wood', tint: 0.7, collide: false },
      { position: [0.95, 0.35, 1.05], size: [0.1, 0.7, 0.1], texture: 'wood', tint: 0.7, collide: false },
      { position: [0.0, 0.37, 0.6], size: [2.2, 0.74, 1.1], texture: 'wood', tint: 0.0, collide: true, hidden: true },
      ...CHAIR(-0.5, -0.2, 180, { texture: 'wood', tint: 0.7 }),
      ...CHAIR(0.6, 1.45, 20, { texture: 'wood', tint: 0.7 }),
      // Lámpara de mesa
      { position: [0.7, 0.83, 0.45], size: [0.12, 0.14, 0.12], texture: 'metal', tint: 0.8, collide: false, shape: 'cylinder' },
      { position: [0.7, 1.02, 0.45], size: [0.32, 0.22, 0.32], texture: 'carpet', tint: 0.9, collide: false, shape: 'cylinder' },
      // Chimenea en el muro sur
      ...FIREPLACE(-1.7, 3.175, -1, 3.2, 'portrait_1'),
      // Alfombra y globo terráqueo
      { position: [0.0, 0.005, 0.5], size: [3.6, 0.01, 2.6], texture: 'carpet', tint: 0.85, collide: false, decal: true },
      { position: [2.6, 0.45, -2.3], size: [0.18, 0.9, 0.18], texture: 'wood', tint: 0.7, collide: true, shape: 'cylinder' },
      { position: [2.6, 1.05, -2.3], size: [0.5, 0.45, 0.5], texture: 'metal', tint: 0.7, collide: false, shape: 'cylinder' },
    ],
  },
  {
    id: 'room_jardin',
    name: 'Jardín',
    size: [14.0, 2.2, 11.0],
    texScale: 2.0,
    outdoor: true,
    wallTextures: { N: 'facade' },
    textures: {
      wall: 'ps2/fence.png',
      floor: 'ps2/grass.png',
      ceiling: 'ps2/ceiling_dark.png',
      door: 'ps2/door_wood.png',
      bark: 'ps2/bark.png',
      facade: 'ps2/brick_red.png',
      hedge: 'ps2/hedge.png',
      gravel: 'ps2/gravel.png',
      stone: 'ps2/stone_wall.png',
      wood: 'ps2/wood_dark.png',
      metal: 'ps2/metal_rust.png',
      window: 'ps2/window_night.png',
      water: 'ps2/water.png',
    },
    windows: [
      { side: 'N', offset: 2.2, width: 1.3, height: 1.0, sill: 0.95 },
      { side: 'N', offset: 10.5, width: 1.3, height: 1.0, sill: 0.95 },
    ],
    audio: { reverb: 'hall', floor_material: 'grass', ambience: 'outdoor' },
    doors: [
      { side: 'N', offset: 6.45, width: 1.1, to: 'room_cocina' },
      { side: 'E', offset: 4.95, width: 1.1, to: 'room_garaje' },
      { side: 'W', offset: 4.95, width: 1.1, to: 'room_invernadero' },
    ],
    start: { position: [0.0, -4.0], yaw: 180 },
    items: [{ id: 'poster_10', position: [2.2, 1.35, 5.405], yaw: 180 }],
    props: [
      // Fachada trasera: el muro norte es de ladrillo y sigue por encima de la valla.
      { position: [0.0, 3.35, -5.5], size: [14.0, 2.3, 0.15], texture: 'facade', tint: 0.85, collide: false },
      { position: [-4.4, 3.3, -5.414], size: [1.2, 1.0, 0.02], texture: 'window', tint: 0.9, collide: false, fit: true },
      { position: [4.4, 3.3, -5.414], size: [1.2, 1.0, 0.02], texture: 'window', tint: 0.9, collide: false, fit: true },
      { position: [0.1, 2.235, -5.42], size: [14.0, 0.08, 0.05], texture: 'wood', tint: 0.6, collide: false },
      // Camino de grava hasta la fuente y a las dos puertas
      { position: [0.0, 0.006, -2.8], size: [1.6, 0.01, 4.8], texture: 'gravel', tint: 0.85, collide: false, decal: true },
      { position: [0.0, 0.006, 0.05], size: [13.6, 0.01, 1.6], texture: 'gravel', tint: 0.85, collide: false, decal: true },
      // Fuente seca
      { position: [0.0, 0.25, 0.05], size: [2.6, 0.5, 2.6], texture: 'stone', tint: 0.8, collide: true, shape: 'cylinder' },
      { position: [0.0, 0.46, 0.05], size: [2.25, 0.04, 2.25], texture: 'water', tint: 0.9, collide: false, shape: 'cylinder' },
      { position: [0.0, 0.95, 0.05], size: [0.32, 1.0, 0.32], texture: 'stone', tint: 0.75, collide: false, shape: 'cylinder' },
      { position: [0.0, 1.5, 0.05], size: [0.9, 0.14, 0.9], texture: 'stone', tint: 0.75, collide: false, shape: 'cylinder' },
      // Setos bajos y árboles secos
      { position: [-5.2, 0.55, -3.0], size: [2.6, 1.1, 0.9], texture: 'hedge', tint: 0.9, collide: true },
      { position: [5.2, 0.55, -3.0], size: [2.6, 1.1, 0.9], texture: 'hedge', tint: 0.9, collide: true },
      { position: [-5.0, 0.55, 3.4], size: [3.0, 1.1, 0.9], texture: 'hedge', tint: 0.9, collide: true },
      { position: [5.0, 0.55, 3.4], size: [3.0, 1.1, 0.9], texture: 'hedge', tint: 0.9, collide: true },
...TREE(-3.5, 2.2, 3.4, 0.34),
      ...TREE(3.9, -1.9, 3.6, 0.4),
      ...TREE(-4.6, -1.4, 3.0, 0.26),
      // Banco y farola
      { position: [2.6, 0.42, 3.0], size: [1.6, 0.08, 0.45], texture: 'wood', tint: 0.75, collide: true },
      { position: [2.6, 0.2, 3.0], size: [1.4, 0.4, 0.3], texture: 'metal', tint: 0.5, collide: false },
      { position: [2.6, 0.72, 3.2], size: [1.6, 0.5, 0.06], texture: 'wood', tint: 0.7, collide: false },
      { position: [-1.8, 1.4, -2.3], size: [0.12, 2.8, 0.12], texture: 'metal', tint: 0.6, collide: true, shape: 'cylinder' },
    ],
  },
  {
    id: 'room_garaje',
    name: 'Garaje',
    size: [9.0, 3.0, 7.0],
    texScale: 2.0,
    textures: {
      wall: 'ps2/corrugated.png',
      floor: 'ps2/concrete_oil.png',
      ceiling: 'ps2/ceiling_dark.png',
      door: 'ps2/door_white.png',
      metal: 'ps2/metal_rust.png',
      car: 'ps2/metal_clean.png',
      tarp: 'ps2/canvas.png',
      tire: 'ps2/concrete_oil.png',
      wood: 'ps2/wood_light.png',
      boards: 'ps2/boards.png',
      glass: 'ps2/window_bars.png',
      stain: 'Stains/Horror_Stain_14-128x128.png',
    },
    audio: { reverb: 'hall', floor_material: 'stone', ambience: 'basement' },
    trim: false,
    doors: [
      { side: 'E', offset: 2.9, width: 1.2, to: 'room_vestibulo' },
      { side: 'W', offset: 2.9, width: 1.1, to: 'room_jardin' },
    ],
    windows: [{ side: 'N', offset: 6.0, width: 1.4, height: 0.7, sill: 1.8 }],
    start: { position: [3.0, 0.0], yaw: 90 },
    items: [{ id: 'poster_11', position: [-2.6, 1.55, -3.33], yaw: 0 }, { id: 'chipa_4', position: [-3.3, 0.91, -3.0], yaw: 0 }],
    props: [
      // Portón enrollable (muro sur)
      { position: [0.3, 1.25, 3.42], size: [3.6, 2.5, 0.06], texture: 'metal', tint: 0.75, collide: false },
      // Coche viejo bajo una lona polvorienta: carrocería, capó y maletero con
      // lunas inclinadas, ruedas de goma asomando y paragolpes cromados.
      { position: [0.3, 0.5, 0.6], size: [1.9, 0.62, 4.3], texture: 'tarp', tint: 0.6, collide: true },
      { position: [0.3, 1.08, 0.9], size: [1.7, 0.56, 2.3], texture: 'tarp', tint: 0.55, collide: false },
      { position: [0.3, 1.085, -0.5], size: [1.68, 0.04, 0.74], texture: 'tarp', tint: 0.55, collide: false, rot: [-47.7, 0, 0] },
      { position: [0.3, 1.085, 2.25], size: [1.68, 0.04, 0.68], texture: 'tarp', tint: 0.55, collide: false, rot: [54, 0, 0] },
      { position: [0.3, 0.36, -1.62], size: [1.95, 0.09, 0.1], texture: 'car', tint: 0.5, collide: false },
      { position: [0.3, 0.36, 2.82], size: [1.95, 0.09, 0.1], texture: 'car', tint: 0.45, collide: false },
      ...[[-0.9, -0.54], [-0.9, 1.14], [2.1, -0.54], [2.1, 1.14]].map(([z, x]) => (
        { position: [x, 0.3, z], size: [0.6, 0.2, 0.6], texture: 'tire', tint: 0.18, collide: false, shape: 'cylinder', rot: [0, 0, 90] }
      )),
      // Banco de trabajo y estantería abierta con cajas de campaña
      ...TABLE(-2.6, -3.09, 2.6, 0.65, 0.9, { texture: 'wood', tint: 0.65 }),
      { position: [-2.6, 1.6, -3.38], size: [2.4, 1.0, 0.04], texture: 'boards', tint: 0.6, collide: false },
      ...[[-4.4, 1.02], [-3.94, 1.02], [-4.4, 3.38], [-3.94, 3.38]].map(([x, z]) => (
        { position: [x, 1.1, z], size: [0.05, 2.2, 0.05], texture: 'metal', tint: 0.5, collide: false }
      )),
      ...[0.12, 0.8, 1.45, 2.1].map((y) => (
        { position: [-4.17, y, 2.2], size: [0.5, 0.03, 2.4], texture: 'wood', tint: 0.6, collide: false }
      )),
      { position: [-4.17, 1.1, 2.2], size: [0.5, 2.2, 2.4], texture: 'wood', tint: 0, collide: true, hidden: true },
      { position: [-4.15, 0.335, 1.6], size: [0.42, 0.4, 0.55], texture: 'wood', tint: 0.85, collide: false },
      { position: [-4.15, 0.235, 2.85], size: [0.2, 0.2, 0.2], texture: 'metal', tint: 0.55, collide: false, shape: 'cylinder' },
      { position: [-4.15, 1.015, 2.6], size: [0.42, 0.4, 0.6], texture: 'wood', tint: 0.8, collide: false },
      { position: [-4.15, 1.64, 1.9], size: [0.42, 0.35, 0.5], texture: 'wood', tint: 0.85, collide: false },
      // Bidones
      { position: [3.6, 0.45, -2.6], size: [0.6, 0.9, 0.6], texture: 'metal', tint: 0.7, collide: true, shape: 'cylinder' },
      { position: [3.0, 0.45, -2.9], size: [0.6, 0.9, 0.6], texture: 'metal', tint: 0.6, collide: true, shape: 'cylinder' },
      { position: [3.7, 0.45, 2.7], size: [0.6, 0.9, 0.6], texture: 'metal', tint: 0.65, collide: true, shape: 'cylinder' },
      { position: [0.8, 0.006, -1.4], size: [1.6, 0.01, 1.4], texture: 'stain', tint: 0.4, collide: false, decal: true },
    ],
  },
  {
    id: 'room_invernadero',
    name: 'Invernadero',
    size: [7.0, 3.0, 6.0],
    texScale: 2.0,
    textures: {
      wall: 'ps2/window_bars.png',
      floor: 'ps2/tile_terracotta.png',
      ceiling: 'ps2/window_night.png',
      door: 'ps2/door_white.png',
      wood: 'ps2/wood_light.png',
      pot: 'ps2/tile_terracotta.png',
      hedge: 'ps2/hedge.png',
      metal: 'ps2/metal_rust.png',
      // Barro y moho en el suelo (el chorreo de Stain_10 sólo encaja en paredes).
      stain: 'Stains/Horror_Stain_04-128x128.png',
    },
    audio: { reverb: 'small', floor_material: 'tile', ambience: 'outdoor' },
    trim: false,
    doors: [{ side: 'E', offset: 2.45, width: 1.1, to: 'room_jardin' }],
    start: { position: [2.0, 0.0], yaw: 90 },
    items: [{ id: 'key_attic', position: [-2.4, 0.93, -1.6], yaw: 20 }, { id: 'chipa_5', position: [0.6, 0.91, -2.35], yaw: 0 }],
    props: [
      // Mesas de cultivo
      ...TABLE(-2.4, -1.6, 1.6, 0.8, 0.9, { texture: 'wood', tint: 0.6 }),
      ...TABLE(-2.4, 1.6, 1.6, 0.8, 0.9, { texture: 'wood', tint: 0.6 }),
      ...TABLE(0.4, -2.4, 2.4, 0.7, 0.9, { texture: 'wood', tint: 0.6 }),
      // Macetas con plantas muertas
      { position: [-2.9, 1.05, -1.5], size: [0.32, 0.3, 0.32], texture: 'pot', tint: 0.9, collide: false, shape: 'cylinder' },
      { position: [-2.9, 1.35, -1.5], size: [0.4, 0.35, 0.4], texture: 'hedge', tint: 0.5, collide: false },
      { position: [-1.9, 1.05, 1.7], size: [0.32, 0.3, 0.32], texture: 'pot', tint: 0.9, collide: false, shape: 'cylinder' },
      { position: [-1.9, 1.4, 1.7], size: [0.45, 0.45, 0.45], texture: 'hedge', tint: 0.5, collide: false },
      { position: [-2.8, 1.05, 1.4], size: [0.26, 0.26, 0.26], texture: 'pot', tint: 0.85, collide: false, shape: 'cylinder' },
      { position: [0.0, 1.05, -2.4], size: [0.32, 0.3, 0.32], texture: 'pot', tint: 0.9, collide: false, shape: 'cylinder' },
      { position: [1.0, 1.05, -2.35], size: [0.32, 0.3, 0.32], texture: 'pot', tint: 0.85, collide: false, shape: 'cylinder' },
      { position: [1.0, 1.45, -2.35], size: [0.5, 0.5, 0.5], texture: 'hedge', tint: 0.45, collide: false },
      { position: [2.6, 0.45, 2.2], size: [0.9, 0.9, 0.9], texture: 'pot', tint: 0.8, collide: true, shape: 'cylinder' },
      { position: [2.6, 1.35, 2.2], size: [1.1, 1.0, 1.1], texture: 'hedge', tint: 0.55, collide: false },
      { position: [0.2, 0.006, 0.4], size: [2.0, 0.01, 1.8], texture: 'stain', tint: 0.4, collide: false, decal: true },
      // Estructura metálica del techo
      { position: [0.0, 2.92, 0.0], size: [6.9, 0.08, 0.1], texture: 'metal', tint: 0.5, collide: false },
      // Algo más fina que la transversal: en el cruce sus caras no coinciden.
      { position: [0.0, 2.92, 0.0], size: [0.1, 0.074, 5.9], texture: 'metal', tint: 0.5, collide: false },
    ],
  },
  {
    id: 'room_atico',
    name: 'Ático',
    size: [11.0, 2.4, 6.0],
    texScale: 2.0,
    textures: {
      wall: 'ps2/boards.png',
      floor: 'ps2/floor_pine.png',
      ceiling: 'ps2/boards.png',
      door: 'ps2/door_wood.png',
      wood: 'ps2/wood_dark.png',
      light: 'ps2/wood_light.png',
      cloth: 'ps2/plaster_white.png',
      metal: 'ps2/metal_rust.png',
      window: 'ps2/window_night.png',
      // Polvo y podredumbre en el suelo (el chorreo de Stain_11 es de pared).
      stain: 'Stains/Horror_Stain_13-128x128.png',
    },
    audio: { reverb: 'small', floor_material: 'wood', ambience: 'house' },
    trim: false,
    doors: [{ side: 'W', offset: 2.4, width: 1.2, to: 'room_pasillo_alto', action: 'down' }],
    windows: [{ side: 'E', offset: 2.5, width: 1.0, height: 1.0, sill: 0.9 }],
    start: { position: [-4.0, 0.0], yaw: 270 },
    items: [{ id: 'poster_12', position: [3.0, 1.45, -2.905], yaw: 0 }, { id: 'chipa_6', position: [2.9, 0.81, -2.05], yaw: 0 }],
    props: [
      // Vigas del tejado
      ...[-4.5, -3.0, -1.5, 0.0, 1.5, 3.0, 4.5].map((x) => ({ position: [x, 2.28, 0.0], size: [0.2, 0.22, 5.85], texture: 'wood', tint: 0.6, collide: false })),
      { position: [0.0, 2.16, 0.0], size: [10.85, 0.18, 0.22], texture: 'wood', tint: 0.55, collide: false },
      // Mesa de campaña con pilas de afiches atados
      ...TABLE(2.4, -1.9, 2.0, 0.9, 0.8, { texture: 'light', tint: 0.65 }),
      { position: [2.0, 0.92, -1.9], size: [0.6, 0.24, 0.85], texture: 'cloth', tint: 0.85, collide: false },
      { position: [2.8, 0.88, -1.8], size: [0.5, 0.16, 0.7], texture: 'cloth', tint: 0.8, collide: false },
      // Baúles y cajas
      { position: [-2.0, 0.35, -2.4], size: [1.1, 0.7, 0.65], texture: 'wood', tint: 0.75, collide: true },
      { position: [-0.6, 0.3, -2.45], size: [0.6, 0.6, 0.6], texture: 'light', tint: 0.7, collide: true },
      { position: [-0.6, 0.78, -2.45], size: [0.45, 0.36, 0.45], texture: 'light', tint: 0.65, collide: false },
      { position: [4.6, 0.4, 2.2], size: [0.8, 0.8, 0.8], texture: 'light', tint: 0.7, collide: true },
      { position: [3.7, 0.3, 2.4], size: [0.6, 0.6, 0.6], texture: 'light', tint: 0.65, collide: true },
      // Maniquíes cubiertos con sábanas
      { position: [0.6, 0.85, 2.0], size: [0.55, 1.7, 0.55], texture: 'cloth', tint: 0.8, collide: true, shape: 'cylinder' },
      { position: [0.6, 1.82, 2.0], size: [0.32, 0.3, 0.32], texture: 'cloth', tint: 0.8, collide: false, shape: 'cylinder' },
      { position: [-1.4, 0.82, 1.9], size: [0.5, 1.65, 0.5], texture: 'cloth', tint: 0.75, collide: true, shape: 'cylinder' },
      { position: [-1.4, 1.76, 1.9], size: [0.3, 0.28, 0.3], texture: 'cloth', tint: 0.75, collide: false, shape: 'cylinder' },
      { position: [-3.3, 0.005, 1.0], size: [1.8, 0.01, 1.4], texture: 'stain', tint: 0.4, collide: false, decal: true },
    ],
  },
];

// --- Aspecto PS2 -----------------------------------------------------------
// Cada sala heredada se re-viste con el set propio de 256 px (tools/
// gen_textures.py), recibe luces puntuales con luminaria visible y, en las
// salas nobles, friso de madera. Las salas nuevas ya vienen con texturas ps2.
const WARM = [1.0, 0.82, 0.58];
const DIM = [0.95, 0.72, 0.48];
const COLD = [0.78, 0.86, 1.0];
const HOUSE_ATMOS = { ambient: 0.22, ambient_color: [0.75, 0.78, 0.92], direct: 0.35, fog_start: 3.5, fog_end: 22.0 };
const L = (x, y, z, opts = {}) => ({
  position: [x, y, z],
  color: opts.color ?? WARM,
  range: opts.range ?? 6.5,
  intensity: opts.intensity ?? 1.0,
  ...(opts.flicker ? { flicker: opts.flicker } : {}),
  ...(opts.broken ? { broken: true } : {}),
  fixture: opts.fixture ?? 'pendant',
});

const SKINS = {
  room_vestibulo: {
    textures: { wall: 'ps2/wp_damask_green.png', floor: 'ps2/floor_oak.png', ceiling: 'ps2/ceiling.png', door: 'ps2/door_wood.png', metal: 'ps2/metal_clean.png', window: 'ps2/window_night.png', wainscot: 'ps2/wainscot.png' },
    wainscot: 'wainscot',
    lights: [L(0, 2.1, -0.4, { range: 7.5, intensity: 1.05, flicker: 0.08 }), L(3.3, 1.25, -2.85, { fixture: 'none', range: 2.6, intensity: 0.7, color: DIM })],
  },
  room_salon: {
    textures: { wall: 'ps2/wp_damask_decay.png', floor: 'ps2/floor_walnut.png', ceiling: 'ps2/ceiling.png', door: 'ps2/door_wood.png', wood: 'ps2/wood_dark.png', metal: 'ps2/metal_clean.png', window: 'ps2/window_night.png', wainscot: 'ps2/wainscot.png' },
    wainscot: 'wainscot',
    lights: [L(-0.8, 2.1, 0.0, { range: 7, intensity: 0.95 }), L(2.4, 2.1, 0.4, { range: 6, intensity: 0.85, broken: true }), L(-2.7, 0.45, -2.75, { fixture: 'none', range: 4.0, intensity: 1.3, color: [1.0, 0.45, 0.15], flicker: 0.6 })],
  },
  room_comedor: {
    textures: { wall: 'ps2/wp_stripes_decay.png', floor: 'ps2/floor_oak.png', ceiling: 'ps2/ceiling.png', door: 'ps2/door_wood.png', wood: 'ps2/wood_dark.png', window: 'ps2/window_night.png', wainscot: 'ps2/wainscot.png' },
    wainscot: 'wainscot',
    lights: [L(0, 1.85, 0.2, { range: 6.5, intensity: 1.1, flicker: 0.05 })],
  },
  room_cocina: {
    textures: { wall: 'ps2/plaster_green.png', floor: 'ps2/tile_checker.png', ceiling: 'ps2/ceiling.png', door: 'ps2/door_white.png', metal: 'ps2/metal_clean.png', window: 'ps2/window_night.png', wood: 'ps2/wood_light.png', tiles: 'ps2/tile_bath.png' },
    lights: [L(0.4, 2.15, -0.2, { fixture: 'bulb', range: 6.5, intensity: 1.0, color: [1.0, 0.92, 0.75], flicker: 0.2 })],
    extraProps: [
      { position: [-1.3, 1.22, -2.42], size: [1.6, 0.55, 0.03], texture: 'tiles', tint: 0.9, collide: false, decal: true },
      { position: [1.6, 1.22, -2.42], size: [0.9, 0.55, 0.03], texture: 'tiles', tint: 0.9, collide: false, decal: true },
    ],
  },
  room_pasillo: {
    textures: { wall: 'ps2/wp_floral.png', floor: 'ps2/floor_pine.png', ceiling: 'ps2/ceiling.png', door: 'ps2/door_wood.png', metal: 'ps2/metal_clean.png', window: 'ps2/window_bars.png', carpet: 'ps2/carpet_red.png', wainscot: 'ps2/wainscot.png' },
    wainscot: 'wainscot',
    lights: [L(-3.6, 2.15, 0, { fixture: 'bulb', range: 5.5, intensity: 0.9, flicker: 0.1 }), L(3.8, 2.15, 0, { fixture: 'bulb', range: 5.5, intensity: 0.85, broken: true })],
    extraProps: [{ position: [0.5, 0.006, 0.0], size: [11.0, 0.01, 1.0], texture: 'carpet', tint: 0.8, collide: false, decal: true }],
  },
  room_bano: {
    textures: { wall: 'ps2/tile_bath_grime.png', floor: 'ps2/tile_hex_grime.png', ceiling: 'ps2/ceiling.png', door: 'ps2/door_white.png', metal: 'ps2/metal_clean.png', ceramic: 'ps2/ceramic_stained.png' },
    furniture: 'ceramic',
    lights: [L(0, 2.2, 0, { fixture: 'bulb', range: 4.5, intensity: 0.9, color: [0.92, 0.95, 1.0], flicker: 0.25 })],
  },
  room_despacho: {
    textures: { wall: 'ps2/wp_stripes_blue.png', floor: 'ps2/floor_walnut.png', ceiling: 'ps2/ceiling.png', door: 'ps2/door_wood.png', wood: 'ps2/wood_dark.png', metal: 'ps2/metal_clean.png', window: 'ps2/window_night.png', wainscot: 'ps2/wainscot.png' },
    wainscot: 'wainscot',
    lights: [L(0, 2.1, 0, { range: 5, intensity: 0.6, color: DIM }), L(-0.55, 1.05, -2.0, { fixture: 'none', range: 2.8, intensity: 0.9, color: [1.0, 0.85, 0.55] })],
  },
  room_escalera: {
    textures: { wall: 'ps2/wp_damask_green.png', floor: 'ps2/floor_pine.png', ceiling: 'ps2/ceiling.png', door: 'ps2/door_wood.png', stone: 'ps2/stone_wall.png', window: 'ps2/window_bars.png', wainscot: 'ps2/wainscot.png' },
    wainscot: 'wainscot',
    lights: [L(0, 2.15, 0, { fixture: 'bulb', range: 6, intensity: 0.85, flicker: 0.15 })],
  },
  room_pasillo_alto: {
    textures: { wall: 'ps2/wp_floral.png', floor: 'ps2/floor_oak.png', ceiling: 'ps2/ceiling.png', door: 'ps2/door_wood.png', window: 'ps2/window_night.png', carpet: 'ps2/carpet_blue.png' },
    lights: [L(-3.8, 2.15, 0, { range: 5.5, intensity: 0.85 }), L(3.2, 2.15, 0, { range: 5.5, intensity: 0.8, flicker: 0.3 })],
    extraProps: [{ position: [0.2, 0.006, 0.0], size: [11.5, 0.01, 1.0], texture: 'carpet', tint: 0.8, collide: false, decal: true }],
  },
  room_dormitorio: {
    textures: { wall: 'ps2/wp_stripes_decay.png', floor: 'ps2/floor_walnut.png', ceiling: 'ps2/ceiling.png', door: 'ps2/door_wood.png', metal: 'ps2/metal_clean.png', window: 'ps2/window_night.png' },
    lights: [L(0, 2.15, 0, { range: 6, intensity: 0.55, color: DIM }), L(-3.3, 1.45, 2.3, { fixture: 'none', range: 3.5, intensity: 1.0, color: [1.0, 0.75, 0.45] })],
  },
  room_cuarto: {
    textures: { wall: 'ps2/wp_kids.png', floor: 'ps2/floor_pine.png', ceiling: 'ps2/ceiling.png', door: 'ps2/door_white.png', wood: 'ps2/wood_light.png', window: 'ps2/window_night.png' },
    lights: [L(0, 2.15, 0, { range: 6, intensity: 0.75, flicker: 0.12 })],
  },
  room_bano_alto: {
    textures: { wall: 'ps2/tile_bath_grime.png', floor: 'ps2/tile_checker.png', ceiling: 'ps2/ceiling.png', door: 'ps2/door_white.png', metal: 'ps2/metal_clean.png', ceramic: 'ps2/ceramic_stained.png' },
    furniture: 'ceramic',
    lights: [L(0, 2.2, 0, { fixture: 'bulb', range: 4.5, intensity: 0.85, color: [0.92, 0.95, 1.0], broken: true })],
  },
  room_invitados: {
    textures: { wall: 'ps2/wp_floral.png', floor: 'ps2/floor_oak.png', ceiling: 'ps2/ceiling.png', door: 'ps2/door_wood.png', wood: 'ps2/wood_dark.png', metal: 'ps2/metal_clean.png', window: 'ps2/window_night.png' },
    lights: [L(0, 2.15, 0, { range: 6, intensity: 0.7, flicker: 0.06 })],
  },
  room_trastero: {
    textures: { wall: 'ps2/boards.png', floor: 'ps2/floor_pine.png', ceiling: 'ps2/ceiling_dark.png', door: 'ps2/door_white.png' },
    furniture: 'wood',
    extraTextures: { wood: 'ps2/wood_light.png' },
    lights: [L(0, 2.2, 0, { fixture: 'bulb', range: 4, intensity: 0.7, broken: true })],
  },
  room_sotano: {
    textures: { wall: 'ps2/brick_dark.png', floor: 'ps2/concrete.png', ceiling: 'ps2/ceiling_dark.png', door: 'ps2/metal_rust.png', stone: 'ps2/stone_wall.png', metal: 'ps2/metal_rust.png', wood: 'ps2/wood_dark.png' },
    trim: false,
    lights: [L(1.4, 1.75, 0.9, { fixture: 'bulb', range: 3.6, intensity: 1.5, color: [1.0, 0.75, 0.45], flicker: 0.35 })],
    dropLamp: true,
  },
  room_lavanderia: {
    textures: { wall: 'ps2/brick_red.png', floor: 'ps2/concrete.png', ceiling: 'ps2/ceiling_dark.png', door: 'ps2/metal_rust.png', stone: 'ps2/concrete.png', metal: 'ps2/metal_clean.png', wood: 'ps2/wood_dark.png' },
    trim: false,
    lights: [L(-0.5, 2.2, 0.4, { fixture: 'bulb', range: 4.5, intensity: 0.55, color: [0.9, 0.9, 1.0], broken: true })],
  },
  room_calderas: {
    textures: { wall: 'ps2/brick_dark.png', floor: 'ps2/concrete_oil.png', ceiling: 'ps2/ceiling_dark.png', door: 'ps2/metal_rust.png', stone: 'ps2/concrete.png', metal: 'ps2/metal_rust.png', rust: 'ps2/metal_rust.png', wood: 'ps2/wood_dark.png' },
    trim: false,
    lights: [L(0.0, 0.45, 1.15, { fixture: 'none', range: 3.2, intensity: 1.2, color: [1.0, 0.45, 0.15], flicker: 0.6 })],
  },
  room_bodega: {
    textures: { wall: 'ps2/stone_wall.png', floor: 'ps2/concrete.png', ceiling: 'ps2/ceiling_dark.png', door: 'ps2/metal_rust.png', stone: 'ps2/stone_wall.png', wood: 'ps2/wood_dark.png', rust: 'ps2/metal_rust.png' },
    trim: false,
    // Bombilla moribunda: sin ella la bodega era negro puro fuera del haz.
    lights: [L(0.2, 2.2, 0.3, { fixture: 'bulb', range: 4.2, intensity: 0.5, color: [1.0, 0.78, 0.5], flicker: 0.45 })],
  },
  room_biblioteca: {
    wainscot: null,
    atmosphere: { ...HOUSE_ATMOS, ambient: 0.12 },
    lights: [L(0, 2.55, 0.6, { range: 6.5, intensity: 0.65, color: DIM }), L(0.7, 1.05, 0.45, { fixture: 'none', range: 3.0, intensity: 0.9, color: [1.0, 0.6, 0.35] }), L(-1.7, 0.45, 2.6, { fixture: 'none', range: 4.0, intensity: 1.4, color: [1.0, 0.45, 0.15], flicker: 0.6 })],
  },
  room_jardin: {
    atmosphere: { outdoor: true, ambient: 0.4, ambient_color: [0.55, 0.62, 0.8], direct: 1.0, fog_start: 1.0, fog_end: 16.0, fog_color: [0.11, 0.12, 0.145] },
    lights: [L(-1.8, 2.85, -2.3, { fixture: 'bulb', range: 6.5, intensity: 1.0, color: [1.0, 0.85, 0.6], flicker: 0.1 })],
  },
  room_garaje: {
    atmosphere: { ambient: 0.15, ambient_color: [0.7, 0.75, 0.9], direct: 0.2, fog_start: 3.0, fog_end: 16.0 },
    lights: [L(-2.4, 2.75, 0.0, { fixture: 'bulb', range: 7, intensity: 1.15, color: COLD, flicker: 0.4 }), L(2.6, 2.75, 0.0, { fixture: 'bulb', range: 6, intensity: 0.8, color: COLD, broken: true })],
  },
  room_invernadero: {
    atmosphere: { ambient: 0.2, ambient_color: [0.55, 0.65, 0.85], direct: 0.9, fog_start: 2.0, fog_end: 14.0, fog_color: [0.07, 0.08, 0.1] },
    lights: [L(0, 2.6, 0, { fixture: 'bulb', range: 5, intensity: 0.5, color: [0.9, 1.0, 0.85], broken: true })],
  },
  room_atico: {
    atmosphere: { ambient: 0.085, ambient_color: [0.75, 0.75, 0.85], direct: 0.15, fog_start: 2.0, fog_end: 13.0 },
    lights: [L(2.4, 1.85, -1.4, { fixture: 'bulb', range: 5.5, intensity: 0.9, flicker: 0.25 }), L(-3.0, 1.85, 0.6, { fixture: 'bulb', range: 4.5, intensity: 0.6, broken: true })],
  },
};

// ---------------------------------------------------------------------------
// M13 — Escondites y sustos con guion
// ---------------------------------------------------------------------------
// Escondites: centro [x, z] apoyado contra un muro y `yaw` hacia donde mira el
// frente (0 = -Z, 90 = -X, 180 = +Z, 270 = +X). Posiciones elegidas con paso
// libre delante y lejos de puertas, ventanas, afiches y cuadros
// (`node tools/check_access.mjs` lo verifica).
const HIDES = {
  room_salon: [{ id: 'salon_ropero', kind: 'wardrobe', position: [-1.3, 3.1], yaw: 0 }],
  room_comedor: [{ id: 'comedor_aparador', kind: 'wardrobe', position: [-2.3, -2.35], yaw: 180 }],
  room_pasillo: [{ id: 'pasillo_ropero', kind: 'wardrobe', position: [-1.5, 0.8], yaw: 0 }],
  room_pasillo_alto: [{ id: 'pasillo_alto_ropero', kind: 'wardrobe', position: [-4.3, 0.8], yaw: 0 }],
  room_dormitorio: [{ id: 'dormitorio_ropero', kind: 'wardrobe', position: [3.35, -0.6], yaw: 90 }],
  room_cuarto: [{ id: 'cuarto_ropero', kind: 'wardrobe', position: [2.6, -1.0], yaw: 90 }],
  room_invitados: [{ id: 'invitados_ropero', kind: 'wardrobe', position: [-2.85, 0.7], yaw: 270 }],
  room_garaje: [{ id: 'garaje_taquilla', kind: 'locker', position: [-2.0, 3.1], yaw: 0 }],
  room_sotano: [{ id: 'sotano_taquilla', kind: 'locker', position: [1.85, 2.2], yaw: 90 }],
  room_lavanderia: [{ id: 'lavanderia_taquilla', kind: 'locker', position: [-2.5, -2.35], yaw: 180 }],
  room_calderas: [{ id: 'calderas_taquilla', kind: 'locker', position: [0, 2.85], yaw: 0 }],
  room_bodega: [{ id: 'bodega_taquilla', kind: 'locker', position: [-1.8, 2.1], yaw: 0 }],
};

// Sustos (ver src/systems/roomEvents.ts). `when.posters` = afiches quemados,
// `when.visits` = a partir de qué visita a la sala, `when.chance` por visita.
const EVENTS = {
  room_pasillo: [
    { id: 'pasillo_silueta', kind: 'apparition', position: [-5.6, 0.1], when: { posters: 2, chance: 0.6 } },
  ],
  room_pasillo_alto: [
    { id: 'pasillo_alto_silueta', kind: 'apparition', position: [6.1, 0.0], when: { posters: 5, chance: 0.6 } },
  ],
  room_jardin: [
    { id: 'jardin_silueta', kind: 'apparition', position: [0.0, 4.6], when: { posters: 7, chance: 0.7 } },
  ],
  room_salon: [
    // El televisor del mueble se enciende solo: estática y parpadeo azul.
    { id: 'salon_tele', kind: 'sound', sound: 'tv_static', position: [-0.5, 0.95, -2.95], repeat: 3, interval: 3.2, light: [0.55, 0.7, 1.0], when: { posters: 1, visits: 2 } },
  ],
  room_despacho: [
    // La radio del escritorio.
    { id: 'despacho_radio', kind: 'sound', sound: 'radio', position: [0.0, 0.9, -1.9], repeat: 2, interval: 3.8, when: { posters: 4 } },
    // El sillón aparece mirando a la pared.
    { id: 'despacho_sillon', kind: 'moved', model: 1, yaw: 180, when: { posters: 2, visits: 2 } },
  ],
  room_vestibulo: [
    // El teléfono de la mesita.
    { id: 'vestibulo_telefono', kind: 'sound', sound: 'phone_ring', position: [3.3, 0.95, -2.85], repeat: 4, interval: 3.0, when: { posters: 6, visits: 2 } },
    // Un sillón girado hacia la puerta del Salón, como si alguien esperase.
    { id: 'vestibulo_sillon', kind: 'moved', model: 3, yaw: 90, when: { posters: 3, visits: 3 } },
    // El cuadro junto a la salida, con los ojos rayados (painting_b, ojos en UV).
    { id: 'vestibulo_cuadro', kind: 'defaced', texture: 'ps2/painting_b.png', position: [2.6, 1.6, -3.17], size: [0.7, 0.9, 0.03], eyes: [[0.441, 0.371], [0.559, 0.371]], when: { posters: 9 } },
  ],
};

// Carne de la maldición (ver src/systems/fleshGrowth.ts). Coordenadas de
// superficie: [x, z] en suelo/techo, [x, y] en muros N/S, [z, y] en muros E/W.
// Nace en la salida del Vestíbulo y en la Bodega, y deja rastros entre ambas.
const growth = (on, at, radius, bulge, extra = {}) => ({ kind: 'growth', on, at, radius, bulge, ...extra });
const vein = (on, points, radius = 0.025) => ({ kind: 'vein', on, points, radius });
const FLESH = {
  room_vestibulo: [
    // Nido junto a la puerta maldita: esquina NO tomada de suelo a techo.
    growth('N', [-3.2, 1.25], [0.75, 1.05], 0.3),
    growth('W', [-2.65, 1.0], [0.5, 0.9], 0.2),
    growth('floor', [-3.35, -2.6], [0.55, 0.5], 0.55),
    growth('W', [0.6, 2.35], [0.7, 0.32], 0.1),
    growth('ceiling', [0.0, -2.45], [2.6, 0.75], 0.12, { roots: 12 }),
    growth('ceiling', [-2.6, -1.8], [1.2, 1.1], 0.3),
    growth('ceiling', [1.6, -1.1], [0.85, 0.7], 0.22),
    growth('ceiling', [2.9, 2.4], [0.9, 0.7], 0.15),
    growth('E', [-1.7, 1.55], [0.65, 0.85], 0.12),
    growth('E', [2.6, 1.2], [0.5, 1.0], 0.3),
    growth('floor', [3.35, 2.65], [0.5, 0.45], 0.45),
    growth('S', [3.3, 1.6], [0.55, 0.9], 0.18),
    growth('S', [-2.2, 0.45], [1.1, 0.42], 0.08),
    vein('floor', [[-2.9, -2.2], [-2.4, -1.4], [-1.6, -0.6], [-0.9, 0.2]], 0.035),
    vein('floor', [[3.0, 2.3], [2.6, 1.5], [2.9, 0.9], [3.3, 0.7]], 0.03),
    vein('ceiling', [[-1.4, -2.2], [-0.6, -1.2], [-0.3, 0.4], [0.4, 1.6]], 0.04),
    vein('E', [[-1.1, 1.3], [-0.85, 0.7], [-0.8, 0.15]], 0.025),
  ],
  room_bodega: [
    // El origen: el muro este y el techo están vivos.
    growth('E', [0.0, 1.3], [1.9, 1.15], 0.4, { roots: 10 }),
    growth('E', [-1.9, 2.0], [0.5, 0.6], 0.15),
    growth('floor', [2.4, -1.9], [0.45, 0.45], 0.5),
    growth('floor', [2.25, 1.8], [0.6, 0.55], 0.65),
    growth('floor', [2.35, 0.0], [0.5, 1.4], 0.05),
    growth('ceiling', [0.6, 0.3], [2.2, 1.9], 0.1, { roots: 14 }),
    growth('ceiling', [1.8, -1.2], [0.5, 0.45], 0.4),
    growth('ceiling', [-1.2, 1.2], [0.45, 0.5], 0.35),
    growth('ceiling', [2.2, 1.4], [0.6, 0.6], 0.3),
    growth('S', [2.2, 1.3], [0.65, 1.0], 0.25),
    growth('S', [0.4, 2.2], [1.3, 0.4], 0.08),
    growth('N', [2.3, 1.2], [0.5, 1.1], 0.2),
    growth('N', [-2.3, 1.6], [0.5, 0.9], 0.1),
    growth('W', [-1.6, 1.5], [0.6, 0.8], 0.1),
    growth('W', [1.6, 2.1], [0.55, 0.45], 0.08),
    vein('floor', [[1.8, 1.4], [0.8, 1.0], [-0.4, 0.6], [-1.8, 0.3], [-2.75, 0.2]], 0.045),
    vein('floor', [[2.0, -1.6], [1.0, -1.3], [0.3, -1.9], [0.1, -2.3]], 0.04),
    vein('floor', [[1.9, 0.4], [1.2, 0.0], [0.6, -0.6]], 0.03),
  ],
  room_calderas: [
    growth('E', [1.4, 1.2], [0.6, 0.9], 0.12),
    growth('E', [-1.5, 1.9], [0.45, 0.5], 0.06),
    growth('ceiling', [3.0, 0.6], [0.8, 1.0], 0.1),
    growth('floor', [3.4, 1.6], [0.4, 0.5], 0.1),
    vein('floor', [[3.7, 0.6], [3.0, 0.9], [2.2, 0.8], [1.4, 1.4]], 0.03),
  ],
  room_lavanderia: [
    growth('E', [-1.3, 1.1], [0.5, 0.7], 0.1),
    growth('floor', [3.0, 0.9], [0.35, 0.3], 0.04),
    growth('ceiling', [2.7, 0.0], [0.6, 0.8], 0.08),
    vein('floor', [[3.3, 0.3], [2.6, 0.5], [1.8, 0.2], [1.0, 0.4]], 0.025),
  ],
  room_salon: [
    // Se cuela desde el Vestíbulo.
    growth('W', [-1.6, 1.8], [0.6, 0.55], 0.07),
    growth('W', [1.6, 0.5], [0.45, 0.4], 0.04),
    growth('ceiling', [-4.0, -0.9], [0.6, 0.5], 0.06),
    vein('W', [[-0.75, 0.1], [-1.0, 0.8], [-1.3, 1.5]], 0.025),
    vein('floor', [[-4.5, 0.9], [-4.0, 1.4], [-3.6, 2.2], [-3.1, 2.6]], 0.025),
  ],
  room_pasillo: [
    // Sube por la puerta del sótano.
    growth('N', [0.3, 0.55], [0.32, 0.45], 0.05),
    growth('ceiling', [1.5, -0.65], [0.55, 0.4], 0.05),
    vein('N', [[0.4, 1.0], [0.5, 1.6], [0.7, 2.2], [0.75, 2.6]], 0.022),
    vein('floor', [[1.3, -1.0], [0.9, -0.5], [0.2, -0.3]], 0.022),
  ],
  room_dormitorio: [
    growth('W', [-0.6, 1.75], [0.65, 0.45], 0.06),
    growth('ceiling', [-2.3, -0.6], [0.7, 0.5], 0.08),
    vein('W', [[-0.2, 1.6], [0.1, 1.2], [0.25, 0.7]], 0.022),
  ],
  room_bano: [
    growth('ceiling', [-1.4, -1.1], [0.45, 0.4], 0.06),
    growth('N', [-0.4, 2.2], [0.45, 0.35], 0.04),
    vein('N', [[-0.3, 1.9], [-0.2, 1.3], [-0.35, 0.8]], 0.02),
  ],
  room_pasillo_alto: [
    growth('ceiling', [1.05, 0.6], [0.5, 0.35], 0.05),
    growth('S', [-0.3, 1.6], [0.3, 0.4], 0.04),
    vein('ceiling', [[1.0, 0.4], [0.2, 0.0], [-0.7, -0.3]], 0.02),
  ],
};

const WALL_FURNITURE_DEFAULT = 'wood';
const props_use_fireplace = (room) => (room.props ?? []).some((prop) => prop.texture === 'embers');
let paintingFlip = 0;

const spawnsByRoom = buildSpawns(rooms);
const outputs = rooms.map((room) => {
  const [w, h, d] = room.size;
  const skin = SKINS[room.id] ?? {};
  const textures = { ...room.textures, ...(skin.textures ?? {}), ...(skin.extraTextures ?? {}) };
  const furniture = skin.furniture ?? WALL_FURNITURE_DEFAULT;
  if (!textures[furniture]) textures[furniture] = 'ps2/wood_dark.png';
  if (props_use_fireplace(room)) Object.assign(textures, FIREPLACE_TEXTURES);
  for (const prop of room.props ?? []) {
    if (typeof prop.texture === 'string' && prop.texture.startsWith('portrait_')) textures[prop.texture] = `ps2/${prop.texture}.png`;
  }
  textures.painting = 'ps2/painting.png';
  textures.painting_b = 'ps2/painting_b.png';
  const data = {
    id: room.id,
    name: room.name,
    size: [w, h, d],
    texture_scale: room.texScale,
    wall_thickness: WALL_THICKNESS,
    textures,
    audio: room.audio,
  };
  data.door_fit = true;
  if (room.outdoor) data.outdoor = true;
  const trim = skin.trim ?? room.trim;
  if (trim === false) data.trim = false;
  if (skin.wainscot) data.wainscot = { texture: skin.wainscot, height: 1.0 };
  let atmosphere = room.atmosphere ? { ...room.atmosphere } : null;
  if (atmosphere && skin.dropLamp) delete atmosphere.lamp;
  if (skin.atmosphere) atmosphere = { ...(atmosphere ?? {}), ...skin.atmosphere };
  if (!atmosphere && room.audio?.ambience !== 'basement') atmosphere = { ...HOUSE_ATMOS };
  if (atmosphere) data.atmosphere = atmosphere;
  if (skin.lights && skin.lights.length > 0) data.lights = skin.lights;
  data.walls = buildWalls(room);
  const props = [...(room.props ?? []), ...(skin.extraProps ?? [])];
  if (props.length > 0) {
    data.props = props.map((prop) => {
      let texture = prop.texture;
      if (!prop.decal && texture === 'wall') texture = furniture;
      // Los "cuadros" (decales con la textura de puerta) pasan a ser retratos.
      if (prop.decal && texture === 'door') {
        texture = paintingFlip % 2 === 0 ? 'painting' : 'painting_b';
        paintingFlip += 1;
      }
      const entry = {
        kind: 'box',
        position: prop.position,
        size: prop.size,
        texture,
        tint: prop.decal && (texture === 'painting' || texture === 'painting_b') ? Math.max(prop.tint ?? 1, 0.8) : prop.tint,
        collide: prop.collide,
      };
      if (prop.decal) entry.decal = true;
      if (prop.shape) entry.shape = prop.shape;
      if (prop.fit || texture === 'painting' || texture === 'painting_b') entry.fit = true;
      if (prop.hidden) entry.hidden = true;
      if (prop.rot) entry.rot = prop.rot;
      return entry;
    });
  }
  if (room.models && room.models.length > 0) {
    data.models = room.models;
  }
  if (room.items && room.items.length > 0) {
    data.items = room.items;
  }
  if (HIDES[room.id]) data.hides = HIDES[room.id];
  if (EVENTS[room.id]) data.events = EVENTS[room.id];
  if (FLESH[room.id]) data.flesh = FLESH[room.id];
  data.spawns = spawnsByRoom.get(room.id);
  return data;
});

for (const data of outputs) {
  writeFileSync(`${OUT}/${data.id}.json`, `${JSON.stringify(data, null, 2)}\n`);
}
console.log(`Escritas ${outputs.length} salas en ${OUT}`);
