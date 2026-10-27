// Genera los JSON del mapa de la CALLE de Mondyi: el microcentro de Luque
// (Paraguay) recreado desde datos de OpenStreetMap — Av. Gral. Elizardo Aquino
// / Cerro Corá (eje joyero), Plaza Mariscal López, Santuario Virgen del
// Rosario, Municipalidad, Restaurante Real y la galería de comida del centro.
// Tramos a cielo abierto (open_sky) conectados por arcos (kind passage, se
// cruzan caminando) + interiores con techo (iglesia, Municipalidad, joyerías,
// Restaurante Real). Sin fachadas planas: el borde lo forman casas 3D
// continuas del City Kit (una por lugar, con colisión y suelo extendido) y
// solo quedan pórticos cortos alrededor de cada hueco jugable; los comercios
// entrañables conservan su rótulo `sign` real sobre el pórtico.
// Geometría girada -15° para alinear la avenida con el eje X de las salas.
// Uso: node tools/gen_luque.mjs   (escribe public/rooms/room_luque_*.json,
// room_joyeria_*.json y room_restaurante_real.json)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/rooms');
const STREET_WALL = 0.3;
const SHOP_WALL = 0.15;

const slug = (id) => id.replace(/^room_/, '');

const SIDES = {
  N: { start: (w, d) => [-w / 2, -d / 2], end: (w, d) => [w / 2, -d / 2], inwardYaw: 180 },
  E: { start: (w, d) => [w / 2, -d / 2], end: (w, d) => [w / 2, d / 2], inwardYaw: 90 },
  S: { start: (w, d) => [w / 2, d / 2], end: (w, d) => [-w / 2, d / 2], inwardYaw: 0 },
  W: { start: (w, d) => [-w / 2, d / 2], end: (w, d) => [-w / 2, -d / 2], inwardYaw: 270 },
};

// Yaw del rótulo/poster (plano orientable): la normal mira hacia el interior.
const INWARD_SIGN_YAW = { N: 0, S: 180, E: -90, W: 90 };

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

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function inwardOf(side) {
  // Normal unitaria hacia el interior de la sala.
  if (side === 'N') return { x: 0, z: 1 };
  if (side === 'S') return { x: 0, z: -1 };
  if (side === 'E') return { x: -1, z: 0 };
  return { x: 1, z: 0 };
}

// Fachada: reparte comercios a lo largo de un muro. Cada entrada ocupa un
// bloque (puerta + ventana + rótulo). Kinds:
//   locked            puerta cerrada "llaveado por dentro" + rótulo real
//   shop (to)         puerta jugable hacia un interior + rótulo
//   passage (to)      arco transitable sin hoja
//   ending            verja final de doble hoja (requires: afiches)
// Devuelve { openings, props, items } listos para mezclar en la sala.
function facade(room, side, entries, opts = {}) {
  const [w, , d] = room.size;
  const { length } = runGeometry(side, w, d);
  const margin = opts.margin ?? 1.0;
  const openings = [];
  const props = [];
  const items = [];
  let cursor = margin;
  for (const e of entries) {
    const width = e.width ?? (e.kind === 'passage' ? 7 : e.kind === 'ending' ? 4 : 1.4);
    const block =
      e.block ??
      (e.kind === 'passage' ? width + 2 : e.kind === 'ending' ? width + 2 : e.block ?? 5.0);
    if (cursor + block > length + 1e-9) {
      throw new Error(`${room.id}: fachada ${side} desborda (${cursor + block} > ${length})`);
    }
    if (e.kind === 'passage') {
      const offset = cursor + (block - width) / 2;
      openings.push({
        side,
        kind: 'passage',
        offset: round(offset),
        width: round(width),
        height: e.height ?? 4.6,
        to: e.to,
      });
    } else if (e.kind === 'ending') {
      const offset = cursor + (block - width) / 2;
      openings.push({
        side,
        kind: 'door',
        offset: round(offset),
        width: round(width),
        height: e.height ?? 3.4,
        door: 'closed',
        requires: e.requires,
        ending: true,
        double: true,
      });
    } else {
      const doorOffset = cursor + 0.6;
      const opening = {
        side,
        kind: 'door',
        offset: round(doorOffset),
        width: round(width),
        height: e.height ?? 2.3,
        door: 'closed',
      };
      if (e.kind === 'shop') {
        opening.to = e.to;
      } else {
        opening.locked = true;
      }
      openings.push(opening);
      if (e.window !== false) {
        const winWidth = Math.min(1.8, block - 3);
        if (winWidth > 0.6) {
          openings.push({
            side,
            kind: 'window',
            offset: round(cursor + block - winWidth - 0.6),
            width: round(winWidth),
            height: 1.3,
            sill: 1.5,
          });
        }
      }
      const center = openingCenter(side, w, d, opening.offset, opening.width);
      const inward = inwardOf(side);
      const yaw = INWARD_SIGN_YAW[side];
      props.push({
        kind: 'sign',
        position: [round(center.x + inward.x * 0.22), 3.15, round(center.z + inward.z * 0.22)],
        size: [2.8, 0.7, 0.02],
        text: e.name,
        yaw,
      });
      if (e.poster) {
        items.push({
          id: e.poster,
          position: [
            round(center.x + inward.x * 0.22),
            1.8,
            round(center.z + inward.z * 0.22),
          ],
          yaw,
        });
      }
    }
    cursor += block;
  }
  return { openings, props, items };
}

// openings: [{ side, kind: 'door'|'passage'|'window', offset, width, height?, sill?, to?, key?, action?, requires?, ending?, double?, locked? }]
// En salas con `open_edge` (calles exteriores sin fachadas planas) los muros
// N/S largos desaparecen: solo quedan pórticos cortos (stubs) alrededor de
// cada hueco jugable (tienda/pasaje/verja). El borde lo forman las casas 3D.
function buildWalls(room) {
  const [w, , d] = room.size;
  const runs = [];
  for (const side of ['N', 'E', 'S', 'W']) {
    const list = (room.openings ?? []).filter((o) => o.side === side);
    const wallOpenings = [];
    for (const o of list) {
      const opening = { kind: o.kind, offset: o.offset, width: o.width };
      if (o.kind !== 'window') {
        opening.height = o.height ?? 2.2;
        opening.door = 'closed';
      } else {
        opening.height = o.height ?? 1.4;
        opening.sill = o.sill ?? 1.6;
      }
      if (o.to) {
        opening.to = o.to;
        opening.spawn = `from_${slug(room.id)}`;
      }
      if (o.key) opening.key = o.key;
      if (o.action) opening.action = o.action;
      if (o.requires) opening.requires = o.requires;
      if (o.ending) opening.ending = true;
      if (o.double) opening.double = true;
      if (o.locked) opening.locked = true;
      wallOpenings.push(opening);
    }
    wallOpenings.sort((a, b) => a.offset - b.offset);
    const { sx, sz, dirX, dirZ, length } = runGeometry(side, w, d);
    if (room.open_edge && (side === 'N' || side === 'S')) {
      // Solo pórticos jugables: un stub por hueco con `to` o `ending`.
      for (const o of list) {
        if (!o.to && !o.ending) continue;
        const margin = o.kind === 'passage' ? STUB_MARGIN_PASSAGE : STUB_MARGIN_DOOR;
        const width = o.width ?? 1.6;
        const center = (o.offset ?? 0) + width / 2;
        const a = Math.max(0, center - width / 2 - margin);
        const b = Math.min(length, center + width / 2 + margin);
        const stubLen = b - a;
        if (stubLen < width + 0.2) continue;
        const startX = round(sx + dirX * a);
        const startZ = round(sz + dirZ * a);
        const endX = round(sx + dirX * b);
        const endZ = round(sz + dirZ * b);
        const opening = { kind: o.kind, offset: round(center - width / 2 - a), width };
        if (o.kind !== 'window') {
          opening.height = o.height ?? 2.2;
          opening.door = 'closed';
        } else {
          opening.height = o.height ?? 1.4;
          opening.sill = o.sill ?? 1.6;
        }
        if (o.to) {
          opening.to = o.to;
          opening.spawn = `from_${slug(room.id)}`;
        }
        if (o.key) opening.key = o.key;
        if (o.action) opening.action = o.action;
        if (o.requires) opening.requires = o.requires;
        if (o.ending) opening.ending = true;
        if (o.double) opening.double = true;
        runs.push({ start: [startX, startZ], end: [endX, endZ], openings: [opening] });
      }
      continue;
    }
    const end = SIDES[side].end(w, d);
    const run = { start: [round(sx), round(sz)], end: [round(end[0]), round(end[1])] };
    if (wallOpenings.length > 0) run.openings = wallOpenings;
    runs.push(run);
    const total = wallOpenings.reduce((max, o) => Math.max(max, o.offset + o.width), 0);
    if (total > length + 1e-9) {
      throw new Error(`${room.id}: huecos fuera del muro ${side} (${total} > ${length})`);
    }
    for (let i = 1; i < wallOpenings.length; i += 1) {
      if (wallOpenings[i].offset < wallOpenings[i - 1].offset + wallOpenings[i - 1].width - 1e-9) {
        throw new Error(`${room.id}: huecos solapados en el muro ${side}`);
      }
    }
  }
  return runs;
}

// Spawns from_<origen> desde el hueco recíproco (puertas y pasadizos).
function buildSpawns(rooms) {
  const byId = new Map(rooms.map((room) => [room.id, room]));
  const spawns = new Map(rooms.map((room) => [room.id, {}]));
  for (const origin of rooms) {
    for (const link of origin.openings ?? []) {
      if (!link.to) continue;
      const target = byId.get(link.to);
      if (!target) throw new Error(`${origin.id}: hueco a sala inexistente ${link.to}`);
      const back = (target.openings ?? []).find(
        (other) => other.to === origin.id && other.kind !== 'window',
      );
      if (!back) throw new Error(`${origin.id} -> ${link.to}: falta el hueco recíproco`);
      const [tw, , td] = target.size;
      const center = openingCenter(back.side, tw, td, back.offset, back.width ?? 1.6);
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
    if (!room.start) throw new Error(`${room.id}: falta el spawn start`);
    spawns.get(room.id).start = {
      position: [round(room.start.position[0]), round(room.start.position[1])],
      yaw: room.start.yaw,
    };
  }
  return spawns;
}

const POSTERS = [
  'poster_1', 'poster_2', 'poster_3', 'poster_4',
  'poster_5', 'poster_6', 'poster_7', 'poster_8',
];

// ---------------------------------------------------------------------------
// Salas de la avenida (E-W, fachadas N/S). size = [ancho, alto, fondo].
// ---------------------------------------------------------------------------
const AVENUE = {
  size: [55, 5, 18],
  texture_scale: 6,
  wall_thickness: STREET_WALL,
  open_edge: true,
  textures: {
    wall: 'Custom/street_brickwall.png',
    floor: 'Custom/asphalt.png',
    door: 'Custom/WoodenDoor2diffuse.png',
    sidewalk: 'Custom/street_sidewalk.png',
    wood: 'Floor/Horror_Floor_03-128x128.png',
    metal: 'Metal/Horror_Metal_01-128x128.png',
    stain: 'Stains/Horror_Stain_08-128x128.png',
    window: 'Custom/MetalCageWindow.png',
    stone: 'Custom/church_stone.png',
    tile: 'Custom/plaza_tile.png',
    marble: 'Custom/shop_marble.png',
  },
  audio: { reverb: 'hall', floor_material: 'stone', ambience: 'house' },
  door_fit: true,
  open_sky: true,
};

function avenueAtmosphere(lampX) {
  return {
    fog_start: 5,
    fog_end: 32,
    fog_color: [0.02, 0.02, 0.03],
    ambient: 0.17,
    direct: 0.22,
    lamp: {
      position: [lampX, 4.5, 0],
      color: [1, 0.8, 0.55],
      range: 13,
      intensity: 1.6,
    },
  };
}

// Acera + arcén + farola + mobiliario base de cada tramo de avenida.
function avenueProps(w) {
  return [
    {
      kind: 'box',
      position: [0, 0.06, -6.5],
      size: [w, 0.12, 2.6],
      texture: 'sidewalk',
      tint: 0.55,
      collide: false,
    },
    {
      kind: 'box',
      position: [0, 0.06, 6.5],
      size: [w, 0.12, 2.6],
      texture: 'sidewalk',
      tint: 0.55,
      collide: false,
    },
    // Senda peatonal: tramos discontinuos en el centro de la calzada.
    ...[-22, -12, -2, 8, 18].map((x) => ({
      kind: 'box',
      position: [x, 0.005, 0],
      size: [2.2, 0.01, 0.3],
      texture: 'sidewalk',
      tint: 0.95,
      collide: false,
      decal: true,
    })),
  ];
}

// 21 casas del Kenney City Kit Suburban: forman el borde construido de la
// calle (sin fachadas planas). Se colocan continuas a ambos lados, con el
// frente alineado a la línea de la antigua fachada, colisión propia y suelo
// extendido debajo para que no floten sobre el vacío.
const HOUSES = Array.from(
  { length: 21 },
  (_, i) => `street/house_type${String(i + 1).padStart(2, '0')}.glb`,
);

// Casas de bajo coste (≤460 tris) para el borde continuo: 11 tipos con
// variedad suficiente sin romper el presupuesto de 8000 tris por celda.
const LOW_HOUSES = [1, 4, 5, 7, 9, 14, 15, 16, 19, 20, 21];
const lowHouseFile = (n) => `street/house_type${String(n).padStart(2, '0')}.glb`;
// Ancho aproximado de cada casa escalada (m) para espaciarlas continuas.
const HOUSE_PITCH = 11.0;
// Margen lateral de cada pórtico jugable (puerta/tienda/pasaje) en N/S.
const STUB_MARGIN_DOOR = 2.2;
const STUB_MARGIN_PASSAGE = 2.5;

// Intervalos ocupados por los pórticos jugables en N/S (para no tapar las
// puertas con casas). Devuelve por lado { N: [[a,b]], S: [[a,b]] } en
// coordenadas a lo largo del muro.
function stubIntervals(room) {
  const [w, , d] = room.size;
  const result = { N: [], S: [] };
  for (const o of room.openings ?? []) {
    if (o.side !== 'N' && o.side !== 'S') continue;
    if (!o.to && !o.ending) continue;
    const length = o.side === 'N' || o.side === 'S' ? w : d;
    const margin = o.kind === 'passage' ? STUB_MARGIN_PASSAGE : STUB_MARGIN_DOOR;
    const center = (o.offset ?? 0) + (o.width ?? 1.6) / 2;
    result[o.side].push([center - (o.width ?? 1.6) / 2 - margin, center + (o.width ?? 1.6) / 2 + margin, length]);
  }
  return result;
}

function overlapsStub(x, halfWidth, intervals) {
  for (const [a, b] of intervals) {
    if (x + halfWidth > a && x - halfWidth < b) return true;
  }
  return false;
}

function skyline(w, depth, seed, per) {
  const list = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < per; i += 1) {
      const idx = (Math.abs(seed) * 6 + i * 5 + (side > 0 ? 9 : 0)) % HOUSES.length;
      const x =
        -w / 2 + (w / per) * (i + 0.5) +
        (((Math.abs(seed) * 17 + i * 23 + (side > 0 ? 31 : 0)) % 9) - 4) * 1.1;
      const yaw = side > 0 ? 0 : 180;
      const scale = 6 + ((Math.abs(seed) + i) % 3) * 0.4;
      // Frente de la casa cerca de la línea de calle; fondo fuera del suelo
      // base (se cubre con la losa extendida de `streetGroundSlabs`).
      const houseDepth = 5.6 * (scale / 6.4);
      list.push({
        file: HOUSES[idx],
        position: [round(x), 0, round(side * (depth / 2 + houseDepth / 2 - 0.6))],
        yaw,
        scale,
        tint: 0.62 + ((Math.abs(seed) * 3 + i) % 4) * 0.09,
        subdivision: 0,
        collide: true,
        size: [7.6, 4.5, houseDepth + 0.6],
      });
    }
  }
  return list;
}

// Casas continuas bordeando la calle, saltando los pórticos jugables para no
// bloquear puertas ni pasajes. `gaps` = intervalos ocupados por lado.
function continuousHouses(w, depth, seed, gaps) {
  const list = [];
  const count = Math.max(4, Math.round(w / HOUSE_PITCH));
  for (const side of [-1, 1]) {
    const key = side < 0 ? 'N' : 'S';
    const intervals = gaps[key] ?? [];
    // Convierte intervalos de muro (origen en start del run) a X de sala.
    const asX = intervals.map(([a, b]) => {
      if (key === 'N') return [a - w / 2, b - w / 2];
      return [w / 2 - b, w / 2 - a];
    });
    for (let i = 0; i < count; i += 1) {
      const x = -w / 2 + (w / count) * (i + 0.5);
      if (overlapsStub(x, HOUSE_PITCH / 2 - 0.3, asX)) continue;
      const pick = LOW_HOUSES[(Math.abs(seed) * 4 + i * 3 + (side > 0 ? 5 : 0)) % LOW_HOUSES.length];
      const yaw = side > 0 ? 0 : 180;
      const scale = 6 + ((Math.abs(seed) + i) % 3) * 0.4;
      const houseDepth = 5.6 * (scale / 6.4);
      list.push({
        file: lowHouseFile(pick),
        position: [round(x), 0, round(side * (depth / 2 + houseDepth / 2 - 0.6))],
        yaw,
        scale,
        tint: 0.62 + ((Math.abs(seed) * 3 + i) % 4) * 0.09,
        subdivision: 0,
        collide: true,
        size: [HOUSE_PITCH - 0.4, 4.5, houseDepth + 0.6],
      });
    }
  }
  return list;
}

// Losas de suelo extendidas bajo las casas (fuera del suelo base de la sala)
// para que no floten sobre el vacío.
function streetGroundSlabs(w, depth) {
  return [
    {
      kind: 'box',
      position: [0, -0.02, -(depth / 2 + 3)],
      size: [w + 4, 0.1, 7],
      texture: 'sidewalk',
      tint: 0.5,
      collide: false,
    },
    {
      kind: 'box',
      position: [0, -0.02, depth / 2 + 3],
      size: [w + 4, 0.1, 7],
      texture: 'sidewalk',
      tint: 0.5,
      collide: false,
    },
  ];
}

function streetModels(w, seedOffset = 0, depth = 18, housesPer = 2) {
  void housesPer;
  const list = [
    {
      file: 'street/streetlights_traffic.glb',
      position: [-(w / 2 - 8), 0, -6.2],
      yaw: 0,
      scale: 0.12,
      tint: 0.8,
      subdivision: 0,
    },
    {
      file: 'street/streetlights_traffic.glb',
      position: [w / 2 - 8, 0, 6.2],
      yaw: 180,
      scale: 0.12,
      tint: 0.8,
      subdivision: 0,
    },
    {
      file: 'street/manhole.glb',
      position: [seedOffset + 6, 0.02, 1],
      yaw: 0,
      scale: 0.3,
      tint: 0.6,
      subdivision: 0,
    },
    {
      file: 'street/trash_bag.glb',
      position: [seedOffset + 12, 0, 6.4],
      yaw: 40 + seedOffset,
      tint: 0.7,
      subdivision: 0,
    },
  ];
  return list;
}

const rooms = [];

// --- room_luque_aquino_oeste: Plaza Gral. Elizardo Aquino + Mausoleo + salida
rooms.push({
  id: 'room_luque_aquino_oeste',
  name: 'Av. Gral. Aquino — Plaza Aquino',
  ...AVENUE,
  atmosphere: avenueAtmosphere(-6),
  openings: [],
  props: [
    ...avenueProps(55),
    // Plaza Gral. José Elizardo Aquino (esquina con Comandante Peralta).
    {
      kind: 'box',
      position: [-18, 0.06, -7],
      size: [10, 0.12, 4.4],
      texture: 'tile',
      tint: 0.85,
      collide: false,
    },
    {
      kind: 'cylinder',
      position: [-18, 0.55, -7],
      size: [1.6, 1.1, 1.6],
      texture: 'stone',
      tint: 0.9,
    },
    {
      kind: 'box',
      position: [-18, 1.75, -7],
      size: [0.7, 1.3, 0.7],
      texture: 'stone',
      tint: 0.95,
    },
    {
      kind: 'box',
      position: [-18, 2.75, -7],
      size: [1.5, 0.7, 1.5],
      texture: 'stone',
      tint: 0.9,
    },
    // Mausoleo General Aquino (banco + lápida).
    {
      kind: 'box',
      position: [-9, 0.35, -7.2],
      size: [2.2, 0.7, 0.8],
      texture: 'stone',
      tint: 0.8,
      collide: true,
    },
    {
      kind: 'box',
      position: [-9, 1.15, -7.6],
      size: [1.4, 0.9, 0.35],
      texture: 'stone',
      tint: 0.85,
      collide: true,
    },
    {
      kind: 'sign',
      position: [-9, 2.15, -7.6],
      size: [2.4, 0.55, 0.02],
      text: 'MAUSOLEO GRAL. AQUINO',
      yaw: 0,
    },
    // Banco de plaza.
    {
      kind: 'box',
      position: [-24, 0.42, -6.8],
      size: [1.9, 0.09, 0.55],
      texture: 'wood',
      tint: 0.75,
    },
    {
      kind: 'box',
      position: [-24, 0.21, -6.8],
      size: [1.7, 0.42, 0.16],
      texture: 'metal',
      tint: 0.6,
    },
  ],
  models: streetModels(55, -4),
  items: [],
  start: { position: [-20, 4.5], yaw: 270 },
});

// --- room_luque_aquino_joyeros: la calle de las joyerías (Bambú…Victoria)
rooms.push({
  id: 'room_luque_aquino_joyeros',
  name: 'Av. Gral. Aquino — Las Joyerías',
  ...AVENUE,
  atmosphere: avenueAtmosphere(2),
  textures: { ...AVENUE.textures, wall: 'Brick/Horror_Brick_05-128x128.png' },
  openings: [],
  props: avenueProps(55),
  models: [
    {
      file: 'street/sedan.glb',
      position: [-8, 0, -3.2],
      yaw: 0,
      scale: 1.4,
      tint: 0.45,
      collide: true,
      size: [4.2, 1.8, 2.2],
      subdivision: 0,
    },
    ...streetModels(55, 1),
  ],
  items: [],
  start: { position: [0, 4], yaw: 90 },
});

// --- room_luque_aquino_centro: bloques de comercio central
rooms.push({
  id: 'room_luque_aquino_centro',
  name: 'Av. Gral. Aquino — Centro',
  ...AVENUE,
  atmosphere: avenueAtmosphere(-4),
  textures: { ...AVENUE.textures, wall: 'Wall/Horror_Wall_01-128x128.png' },
  openings: [],
  props: [
    ...avenueProps(55),
    // Hidrante y papeleras.
    {
      kind: 'box',
      position: [12, 0.45, -6.6],
      size: [0.7, 0.9, 0.7],
      texture: 'metal',
      tint: 0.55,
      collide: true,
    },
    {
      kind: 'box',
      position: [-14, 0.5, 6.6],
      size: [0.6, 1.0, 0.6],
      texture: 'metal',
      tint: 0.5,
      collide: true,
    },
  ],
  models: streetModels(55, -8),
  items: [],
  start: { position: [0, 4], yaw: 270 },
});

// --- room_luque_aquino_galeria: galería de comida (pizzerías, heladerías)
rooms.push({
  id: 'room_luque_aquino_galeria',
  name: 'Av. Gral. Aquino — Galería de Comida',
  ...AVENUE,
  atmosphere: avenueAtmosphere(6),
  textures: { ...AVENUE.textures, wall: 'Brick/Horror_Brick_02-128x128.png' },
  openings: [],
  props: [
    ...avenueProps(55),
    // Parada de ómnibus (sobre la acera sur).
    {
      kind: 'box',
      position: [-6, 2.45, 6.4],
      size: [3.2, 0.12, 1.3],
      texture: 'metal',
      tint: 0.65,
    },
    {
      kind: 'cylinder',
      position: [-7.4, 1.25, 6.4],
      size: [0.12, 2.5, 0.12],
      texture: 'metal',
      tint: 0.6,
    },
    {
      kind: 'cylinder',
      position: [-4.6, 1.25, 6.4],
      size: [0.12, 2.5, 0.12],
      texture: 'metal',
      tint: 0.6,
    },
    {
      kind: 'box',
      position: [-6, 0.45, 6.7],
      size: [2.2, 0.09, 0.45],
      texture: 'wood',
      tint: 0.75,
    },
    {
      kind: 'sign',
      position: [-6, 2.9, 6.4],
      size: [2.2, 0.5, 0.02],
      text: 'PARADA DE ÓMNIBUS',
      yaw: 180,
    },
  ],
  models: [
    {
      file: 'street/van.glb',
      position: [10, 0, 3],
      yaw: 180,
      scale: 1.4,
      tint: 0.5,
      collide: true,
      size: [4.6, 2, 2.2],
      subdivision: 0,
    },
    ...streetModels(55, 3),
  ],
  items: [],
  start: { position: [-18, -4], yaw: 270 },
});

// --- room_luque_aquino_municipal: Municipalidad + Salón Segunda Capital
rooms.push({
  id: 'room_luque_aquino_municipal',
  name: 'Av. Gral. Aquino — Municipalidad',
  ...AVENUE,
  atmosphere: avenueAtmosphere(0),
  textures: { ...AVENUE.textures, wall: 'Wall/Horror_Wall_12-128x128.png' },
  openings: [],
  props: [
    ...avenueProps(55),
    // Papelera y conos frente a la Municipalidad.
    {
      kind: 'box',
      position: [6, 0.5, -6.6],
      size: [0.6, 1.0, 0.6],
      texture: 'metal',
      tint: 0.5,
      collide: true,
    },
  ],
  models: [
    {
      file: 'street/taxi.glb',
      position: [-12, 0, -3.4],
      yaw: 0,
      scale: 1.4,
      tint: 0.55,
      collide: true,
      size: [4.2, 1.8, 2.2],
      subdivision: 0,
    },
    {
      file: 'street/traffic_cone.glb',
      position: [8, 0, -2],
      yaw: 0,
      scale: 0.25,
      tint: 0.9,
      subdivision: 0,
    },
    ...streetModels(55, -2),
  ],
  items: [],
  // Spawn del mapa: el pin de la zona (frente a la Municipalidad).
  start: { position: [-17, 3.5], yaw: 270 },
});

// --- room_luque_aquino_este: Bambú Joya + Joyería Diamante + confiterías
rooms.push({
  id: 'room_luque_aquino_este',
  name: 'Av. Gral. Aquino — Este',
  ...AVENUE,
  atmosphere: avenueAtmosphere(8),
  textures: { ...AVENUE.textures, wall: 'Brick/Horror_Brick_08-128x128.png' },
  openings: [],
  props: avenueProps(55),
  models: streetModels(55, 5),
  items: [],
  start: { position: [0, -4], yaw: 90 },
});

// --- room_luque_cerro_cora: entrada del Santuario + bancos
rooms.push({
  id: 'room_luque_cerro_cora',
  name: 'Cerro Corá',
  ...AVENUE,
  atmosphere: avenueAtmosphere(-2),
  textures: { ...AVENUE.textures, wall: 'Wall/Horror_Wall_03-128x128.png' },
  openings: [],
  props: [
    ...avenueProps(55),
    // Escalinata de acceso al Santuario (acera norte).
    {
      kind: 'box',
      position: [-20, 0.09, -7.2],
      size: [6, 0.18, 3],
      texture: 'stone',
      tint: 0.85,
      collide: false,
    },
    {
      kind: 'box',
      position: [-20, 0.24, -8],
      size: [6, 0.3, 1.6],
      texture: 'stone',
      tint: 0.85,
      collide: false,
    },
    {
      kind: 'sign',
      position: [-20, 3.6, -8.72],
      size: [3.2, 0.75, 0.02],
      text: 'SANTUARIO VIRGEN DEL ROSARIO',
      yaw: 0,
    },
  ],
  models: [
    {
      file: 'street/sedan.glb',
      position: [12, 0, 3.2],
      yaw: 180,
      scale: 1.4,
      tint: 0.5,
      collide: true,
      size: [4.2, 1.8, 2.2],
      subdivision: 0,
    },
    ...streetModels(55, 7),
  ],
  items: [],
  start: { position: [18, -4], yaw: 270 },
});

// --- room_luque_iturbe: calle peatonal con Restaurante Real (N-S, 52x16)
rooms.push({
  id: 'room_luque_iturbe',
  name: 'Vicente Ignacio Iturbe',
  size: [52, 5, 16],
  texture_scale: 6,
  wall_thickness: STREET_WALL,
  open_edge: true,
  textures: {
    wall: 'Custom/street_brickwall.png',
    floor: 'Custom/asphalt.png',
    door: 'Custom/WoodenDoor2diffuse.png',
    sidewalk: 'Custom/street_sidewalk.png',
    wood: 'Floor/Horror_Floor_03-128x128.png',
    metal: 'Metal/Horror_Metal_01-128x128.png',
    stain: 'Stains/Horror_Stain_03-128x128.png',
    window: 'Custom/MetalCageWindow.png',
    tile: 'Custom/plaza_tile.png',
  },
  audio: { reverb: 'hall', floor_material: 'stone', ambience: 'house' },
  door_fit: true,
  open_sky: true,
  atmosphere: {
    fog_start: 4,
    fog_end: 28,
    fog_color: [0.02, 0.02, 0.03],
    ambient: 0.17,
    direct: 0.22,
    lamp: {
      position: [0, 4.5, 0],
      color: [1, 0.8, 0.55],
      range: 12,
      intensity: 1.6,
    },
  },
  openings: [],
  props: [
    {
      kind: 'box',
      position: [0, 0.06, -5.6],
      size: [52, 0.12, 2.4],
      texture: 'sidewalk',
      tint: 0.55,
      collide: false,
    },
    {
      kind: 'box',
      position: [0, 0.06, 5.6],
      size: [52, 0.12, 2.4],
      texture: 'sidewalk',
      tint: 0.55,
      collide: false,
    },
    ...[-16, -4, 8, 16].map((x) => ({
      kind: 'box',
      position: [x, 0.005, 0],
      size: [1.4, 0.01, 3],
      texture: 'sidewalk',
      tint: 0.95,
      collide: false,
      decal: true,
    })),
  ],
  models: streetModels(52, -6, 16, 2),
  items: [],
  start: { position: [-20, 0], yaw: 270 },
});

// --- room_luque_plaza: Plaza Mariscal López (glorieta, fuente, arboleda)
rooms.push({
  id: 'room_luque_plaza',
  name: 'Plaza Mariscal López',
  size: [36, 5, 30],
  texture_scale: 6,
  wall_thickness: STREET_WALL,
  open_edge: true,
  textures: {
    wall: 'Custom/street_brickwall.png',
    floor: 'Custom/plaza_tile.png',
    door: 'Custom/WoodenDoor2diffuse.png',
    sidewalk: 'Custom/street_sidewalk.png',
    wood: 'Floor/Horror_Floor_03-128x128.png',
    metal: 'Metal/Horror_Metal_01-128x128.png',
    stain: 'Stains/Horror_Stain_08-128x128.png',
    window: 'Custom/MetalCageWindow.png',
    stone: 'Custom/church_stone.png',
  },
  audio: { reverb: 'hall', floor_material: 'stone', ambience: 'house' },
  door_fit: true,
  open_sky: true,
  atmosphere: {
    fog_start: 4,
    fog_end: 28,
    fog_color: [0.02, 0.02, 0.03],
    ambient: 0.17,
    direct: 0.22,
    lamp: {
      position: [0, 4.5, 0],
      color: [1, 0.82, 0.58],
      range: 16,
      intensity: 1.8,
    },
  },
  openings: [],
  props: [
    // Glorieta central.
    {
      kind: 'cylinder',
      position: [0, 0.18, 0],
      size: [7, 0.36, 7],
      texture: 'stone',
      tint: 0.85,
      collide: true,
      segments: 16,
    },
    {
      kind: 'cylinder',
      position: [0, 1.4, 0],
      size: [1, 2.2, 1],
      texture: 'stone',
      tint: 0.9,
      collide: true,
      segments: 10,
    },
    {
      kind: 'box',
      position: [0, 2.95, 0],
      size: [1.1, 0.9, 1.1],
      texture: 'stone',
      tint: 0.95,
      collide: true,
    },
    {
      kind: 'sign',
      position: [0, 3.6, -0.62],
      size: [2.6, 0.6, 0.02],
      text: 'PLZA. MARISCAL LÓPEZ',
      yaw: 0,
    },
    // Fuente.
    {
      kind: 'cylinder',
      position: [10, 0.3, 8],
      size: [3.2, 0.6, 3.2],
      texture: 'stone',
      tint: 0.8,
      collide: true,
      segments: 14,
    },
    {
      kind: 'cylinder',
      position: [10, 1.05, 8],
      size: [0.8, 1.5, 0.8],
      texture: 'stone',
      tint: 0.85,
      collide: true,
      segments: 10,
    },
    // Bancos alrededor de la glorieta.
    ...[
      [-6, -7],
      [6, -7],
      [-6, 7],
      [6, 7],
    ].map(([x, z]) => ({
      kind: 'box',
      position: [x, 0.42, z],
      size: [1.9, 0.09, 0.55],
      texture: 'wood',
      tint: 0.75,
    })),
    ...[
      [-6, -7],
      [6, -7],
      [-6, 7],
      [6, 7],
    ].map(([x, z]) => ({
      kind: 'box',
      position: [x, 0.21, z],
      size: [1.7, 0.42, 0.16],
      texture: 'metal',
      tint: 0.6,
    })),
    // Canteros de césped.
    ...[
      [-12, -10],
      [12, -10],
      [-12, 10],
      [12, 10],
    ].map(([x, z]) => ({
      kind: 'box',
      position: [x, 0.07, z],
      size: [5, 0.14, 4],
      texture: 'stain',
      tint: 0.35,
      collide: true,
    })),
  ],
  models: [
    ...[
      [-12, -10],
      [12, -10],
      [-12, 10],
      [12, 10],
      [-15, 0],
      [15, 0],
    ].map(([x, z], i) => ({
      file: i % 2 === 0 ? 'street/tree_small.glb' : 'street/tree_large.glb',
      position: [x, 0, z],
      yaw: x * 7 + z,
      scale: i % 2 === 0 ? 3 : 4,
      tint: 0.4,
      collide: true,
      size: [1.2, 2.5, 1.2],
      subdivision: 0,
    })),
    // Casas del City Kit alrededor de la plaza (skyline con variedad).
    ...skyline(36, 30, 11, 2),
    ...skyline(30, 36, 17, 1).map((m) => ({
      ...m,
      position: [m.position[2], m.position[1], m.position[0]],
      yaw: m.yaw + 90,
    })),
    // Vallas de cantero.
    ...[
      [-12, -10],
      [12, -10],
      [-12, 10],
      [12, 10],
    ].flatMap(([x, z], i) => [
      {
        file: 'street/fence_small.glb',
        position: [x - 1.25, 0, z - 2],
        yaw: 0,
        scale: 3,
        tint: 0.65,
        subdivision: 0,
      },
      {
        file: 'street/fence_small.glb',
        position: [x + 1.25, 0, z - 2],
        yaw: 0,
        scale: 3,
        tint: 0.65,
        subdivision: 0,
      },
      {
        file: 'street/fence_small.glb',
        position: [x - 1.25, 0, z + 2],
        yaw: 0,
        scale: 3,
        tint: 0.65,
        subdivision: 0,
      },
      {
        file: 'street/fence_small.glb',
        position: [x + 1.25, 0, z + 2],
        yaw: 0,
        scale: 3,
        tint: 0.65,
        subdivision: 0,
      },
    ]),
    {
      file: 'street/streetlights_traffic.glb',
      position: [-14, 0, -11],
      yaw: 0,
      scale: 0.12,
      tint: 0.8,
      subdivision: 0,
    },
    {
      file: 'street/streetlights_traffic.glb',
      position: [14, 0, 11],
      yaw: 180,
      scale: 0.12,
      tint: 0.8,
      subdivision: 0,
    },
    {
      file: 'street/trash_bag.glb',
      position: [-13, 0, 8],
      yaw: 50,
      tint: 0.65,
      subdivision: 0,
    },
  ],
  items: [],
  start: { position: [-12, 13], yaw: 0 },
});

// ---------------------------------------------------------------------------
// Interiores (con techo).
// ---------------------------------------------------------------------------
const SHOP_INTERIOR = {
  texture_scale: 2,
  wall_thickness: SHOP_WALL,
  textures: {
    wall: 'Wall/Horror_Wall_05-128x128.png',
    floor: 'Custom/shop_marble.png',
    ceiling: 'Misc/Horror_Misc_03-128x128.png',
    door: 'Custom/WoodenDoor1diffuse.png',
    window: 'Custom/TiledWindowdiffuse.png',
    marble: 'Custom/shop_marble.png',
    metal: 'Metal/Horror_Metal_01-128x128.png',
    wood: 'Floor/Horror_Floor_03-128x128.png',
    stain: 'Stains/Horror_Stain_02-128x128.png',
  },
  audio: { reverb: 'small', floor_material: 'tile', ambience: 'house' },
  door_fit: true,
};

function jewelryProps(name, flip = 1) {
  return [
    // Mostradores de mármol.
    {
      kind: 'box',
      position: [-3 * flip, 0.52, -2.5],
      size: [3.2, 1.05, 0.8],
      texture: 'marble',
      tint: 0.9,
      collide: true,
    },
    {
      kind: 'box',
      position: [3 * flip, 0.52, -2.5],
      size: [3.2, 1.05, 0.8],
      texture: 'marble',
      tint: 0.9,
      collide: true,
    },
    {
      kind: 'box',
      position: [0, 0.52, 3.2],
      size: [4.2, 1.05, 0.8],
      texture: 'marble',
      tint: 0.9,
      collide: true,
    },
    // Vitrinas altas.
    {
      kind: 'box',
      position: [-4.5 * flip, 1.15, 1],
      size: [0.6, 2.3, 2.6],
      texture: 'metal',
      tint: 0.75,
      collide: true,
    },
    {
      kind: 'box',
      position: [4.5 * flip, 1.15, 1],
      size: [0.6, 2.3, 2.6],
      texture: 'metal',
      tint: 0.75,
      collide: true,
    },
    // Joyas (pequeños cajoncillos dorados sobre los mostradores).
    ...[-3.8, -3, -2.2, 2.2, 3, 3.8, -1, 0, 1].map((x, i) => ({
      kind: 'box',
      position: [x * flip, 1.15, i < 6 ? -2.5 : 3.2],
      size: [0.28, 0.22, 0.28],
      texture: 'metal',
      tint: 1.25,
    })),
    {
      kind: 'sign',
      position: [0, 2.55, -4.82],
      size: [3.6, 0.8, 0.02],
      text: name,
      yaw: 0,
    },
  ];
}

for (const [id, name, flip] of [
  ['room_joyeria_manuel', 'MANUEL DELUXE', 1],
  ['room_joyeria_bambu', 'BAMBÚ JOYA', -1],
  ['room_joyeria_diamante', 'JOYERÍA DIAMANTE', 1],
]) {
  rooms.push({
    id,
    name,
    size: [12, 3.4, 10],
    ...SHOP_INTERIOR,
    atmosphere: {
      fog_start: 3,
      fog_end: 16,
      fog_color: [0.02, 0.02, 0.03],
      ambient: 0.2,
      direct: 0.12,
      lamp: {
        position: [0, 2.8, 0],
        color: [1, 0.95, 0.8],
        range: 7,
        intensity: 1.6,
      },
    },
    openings: [],
    props: jewelryProps(name, flip),
    models: [],
    items: [],
    // M13: el teléfono del mostrador del fondo suena con la tienda vacía.
    events: [
      { id: `${slug(id)}_telefono`, kind: 'sound', sound: 'phone_ring', position: [1.5, 1.1, 3.2], repeat: 5, interval: 3.0, when: { chance: 0.5 } },
    ],
    start: { position: [0, -3.5], yaw: 180 },
  });
}

// --- room_restaurante_real: comedor del Restaurante Real
rooms.push({
  id: 'room_restaurante_real',
  name: 'Restaurante Real',
  size: [16, 3.6, 12],
  texture_scale: 2.5,
  wall_thickness: SHOP_WALL,
  textures: {
    wall: 'Wall/Horror_Wall_02-128x128.png',
    floor: 'Floor/Horror_Floor_06-128x128.png',
    ceiling: 'Misc/Horror_Misc_04-128x128.png',
    door: 'Custom/WoodenDoor1diffuse.png',
    window: 'Custom/TiledWindowdiffuse.png',
    wood: 'Floor/Horror_Floor_03-128x128.png',
    metal: 'Metal/Horror_Metal_01-128x128.png',
    marble: 'Custom/shop_marble.png',
    stain: 'Stains/Horror_Stain_05-128x128.png',
  },
  audio: { reverb: 'small', floor_material: 'wood', ambience: 'house' },
  door_fit: true,
  atmosphere: {
    fog_start: 3,
    fog_end: 16,
    fog_color: [0.02, 0.02, 0.03],
    ambient: 0.13,
    direct: 0.1,
    lamp: {
      position: [0, 2.9, -1],
      color: [1, 0.85, 0.6],
      range: 8,
      intensity: 1.7,
    },
  },
  openings: [],
  props: [
    // Barra de mármol.
    {
      kind: 'box',
      position: [-4, 0.55, -4.2],
      size: [6, 1.1, 0.9],
      texture: 'marble',
      tint: 0.9,
      collide: true,
    },
    {
      kind: 'box',
      position: [-4, 1.25, -4.55],
      size: [6.2, 0.12, 0.5],
      texture: 'wood',
      tint: 0.8,
    },
    // Mesas (tablero + pata).
    ...[-5, -1.5, 2, 5.5].map((x) => ({
      kind: 'box',
      position: [x, 0.74, 1.5],
      size: [1.3, 0.09, 1.3],
      texture: 'wood',
      tint: 0.8,
    })),
    ...[-5, -1.5, 2, 5.5].map((x) => ({
      kind: 'cylinder',
      position: [x, 0.37, 1.5],
      size: [0.16, 0.74, 0.16],
      texture: 'metal',
      tint: 0.6,
      segments: 8,
    })),
    // Sillas.
    ...[
      [-5, 0.4],
      [-5, 2.6],
      [-1.5, 0.4],
      [-1.5, 2.6],
      [2, 0.4],
      [2, 2.6],
      [5.5, 0.4],
      [5.5, 2.6],
    ].map(([x, z]) => ({
      kind: 'box',
      position: [x, 0.45, z],
      size: [0.45, 0.08, 0.45],
      texture: 'wood',
      tint: 0.75,
      collide: true,
    })),
    ...[
      [-5, 0.4],
      [-5, 2.6],
      [-1.5, 0.4],
      [-1.5, 2.6],
      [2, 0.4],
      [2, 2.6],
      [5.5, 0.4],
      [5.5, 2.6],
    ].map(([x, z]) => ({
      kind: 'box',
      position: [x, 0.75, z + 0.2],
      size: [0.45, 0.55, 0.07],
      texture: 'wood',
      tint: 0.75,
    })),
    {
      kind: 'sign',
      position: [0, 2.7, -5.82],
      size: [4, 0.9, 0.02],
      text: 'RESTAURANTE REAL',
      yaw: 0,
    },
    {
      kind: 'sign',
      position: [0, 2.7, 5.82],
      size: [3, 0.7, 0.02],
      text: 'LA MEJOR PARRILLA',
      yaw: 180,
    },
  ],
  models: [],
  items: [],
  start: { position: [0, 3.5], yaw: 0 },
});

// --- room_luque_municipalidad: salón de la Municipalidad de Luque
rooms.push({
  id: 'room_luque_municipalidad',
  name: 'Municipalidad de Luque',
  size: [16, 4.2, 12],
  texture_scale: 2.5,
  wall_thickness: SHOP_WALL,
  textures: {
    wall: 'Wall/Horror_Wall_06-128x128.png',
    floor: 'Custom/shop_marble.png',
    ceiling: 'Misc/Horror_Misc_03-128x128.png',
    door: 'Custom/WoodenDoor1diffuse.png',
    window: 'Custom/TiledWindowdiffuse.png',
    marble: 'Custom/shop_marble.png',
    metal: 'Metal/Horror_Metal_01-128x128.png',
    wood: 'Floor/Horror_Floor_03-128x128.png',
    stain: 'Stains/Horror_Stain_02-128x128.png',
  },
  audio: { reverb: 'hall', floor_material: 'tile', ambience: 'house' },
  door_fit: true,
  atmosphere: {
    fog_start: 4,
    fog_end: 18,
    fog_color: [0.02, 0.02, 0.03],
    ambient: 0.13,
    direct: 0.1,
    lamp: {
      position: [0, 3.4, -2],
      color: [1, 0.92, 0.75],
      range: 9,
      intensity: 1.6,
    },
  },
  openings: [],
  props: [
    // Mostrador de atención.
    {
      kind: 'box',
      position: [0, 0.55, -3],
      size: [7, 1.1, 1],
      texture: 'marble',
      tint: 0.9,
      collide: true,
    },
    {
      kind: 'box',
      position: [0, 1.2, -3.3],
      size: [7.2, 0.12, 0.6],
      texture: 'wood',
      tint: 0.8,
    },
    // Bandera (asta + bandera como letrero).
    {
      kind: 'cylinder',
      position: [-5.5, 1.6, -5],
      size: [0.12, 3.2, 0.12],
      texture: 'metal',
      tint: 0.7,
      segments: 8,
    },
    {
      kind: 'sign',
      position: [-5.05, 2.75, -5],
      size: [1.4, 0.85, 0.02],
      text: 'PARAGUAY',
      yaw: 90,
    },
    {
      kind: 'sign',
      position: [0, 3.1, -5.82],
      size: [5, 1, 0.02],
      text: 'MUNICIPALIDAD DE LUQUE',
      yaw: 0,
    },
    // Bancas de espera.
    ...[-2, 0, 2].map((x) => ({
      kind: 'box',
      position: [x, 0.45, 3],
      size: [1.8, 0.1, 0.55],
      texture: 'wood',
      tint: 0.75,
    })),
    ...[-2, 0, 2].map((x) => ({
      kind: 'box',
      position: [x, 0.22, 3],
      size: [1.6, 0.44, 0.18],
      texture: 'metal',
      tint: 0.6,
    })),
  ],
  models: [],
  items: [],
  start: { position: [0, 3.8], yaw: 0 },
});

// --- room_luque_iglesia: nave del Santuario Virgen del Rosario
rooms.push({
  id: 'room_luque_iglesia',
  name: 'Santuario Virgen del Rosario',
  size: [20, 6, 28],
  texture_scale: 4,
  wall_thickness: 0.3,
  textures: {
    wall: 'Custom/church_stone.png',
    floor: 'Custom/plaza_tile.png',
    ceiling: 'Misc/Horror_Misc_03-128x128.png',
    door: 'Custom/WoodenDoor1diffuse.png',
    window: 'Custom/street_vitral.png',
    stone: 'Custom/church_stone.png',
    wood: 'Floor/Horror_Floor_03-128x128.png',
    metal: 'Metal/Horror_Metal_01-128x128.png',
    marble: 'Custom/shop_marble.png',
    stain: 'Stains/Horror_Stain_05-128x128.png',
  },
  audio: { reverb: 'hall', floor_material: 'stone', ambience: 'house' },
  door_fit: true,
  atmosphere: {
    fog_start: 6,
    fog_end: 30,
    fog_color: [0.02, 0.02, 0.03],
    ambient: 0.11,
    direct: 0.1,
    lamp: {
      position: [0, 3.5, 10],
      color: [1, 0.85, 0.55],
      range: 12,
      intensity: 1.9,
    },
  },
  openings: [],
  props: [
    // Columnatas.
    ...[-7, 7].flatMap((x) =>
      [-9, -3, 3, 9].map((z) => ({
        kind: 'cylinder',
        position: [x, 2.6, z],
        size: [0.7, 5.2, 0.7],
        texture: 'stone',
        tint: 0.85,
        collide: true,
        segments: 10,
      })),
    ),
    // Bancas (filas a ambos lados del pasillo central).
    ...[-8, -5.6, -3.2, -0.8, 1.6, 4].flatMap((z) =>
      [-3.8, 3.8].map((x) => ({
        kind: 'box',
        position: [x, 0.42, z],
        size: [5.2, 0.12, 0.6],
        texture: 'wood',
        tint: 0.7,
        collide: true,
      })),
    ),
    ...[-8, -5.6, -3.2, -0.8, 1.6, 4].flatMap((z) =>
      [-3.8, 3.8].map((x) => ({
        kind: 'box',
        position: [x, 0.21, z],
        size: [5, 0.42, 0.5],
        texture: 'wood',
        tint: 0.62,
      })),
    ),
    // Altar y cruz.
    {
      kind: 'box',
      position: [0, 0.6, 11],
      size: [3.2, 1.2, 1.4],
      texture: 'marble',
      tint: 0.9,
      collide: true,
    },
    {
      kind: 'box',
      position: [0, 1.32, 11],
      size: [3.4, 0.14, 1.6],
      texture: 'marble',
      tint: 0.95,
    },
    {
      kind: 'box',
      position: [0, 3.4, 13.2],
      size: [0.35, 3.4, 0.35],
      texture: 'wood',
      tint: 0.85,
    },
    {
      kind: 'box',
      position: [0, 4.1, 13.2],
      size: [2.1, 0.35, 0.35],
      texture: 'wood',
      tint: 0.85,
    },
    {
      kind: 'sign',
      position: [0, 4.9, -13.72],
      size: [6, 1.1, 0.02],
      text: 'SANTUARIO VIRGEN DEL ROSARIO',
      yaw: 0,
    },
    // Pilas de agua bendita.
    {
      kind: 'cylinder',
      position: [-7.5, 0.55, -11.5],
      size: [0.8, 1.1, 0.8],
      texture: 'stone',
      tint: 0.8,
      collide: true,
      segments: 10,
    },
    {
      kind: 'cylinder',
      position: [7.5, 0.55, -11.5],
      size: [0.8, 1.1, 0.8],
      texture: 'stone',
      tint: 0.8,
      collide: true,
      segments: 10,
    },
  ],
  models: [],
  items: [],
  start: { position: [0, -10], yaw: 180 },
});

// ---------------------------------------------------------------------------
// Fachadas: se aplican aquí para poder referenciar las salas ya definidas.
// ---------------------------------------------------------------------------
function applyFacade(roomId, side, entries, opts) {
  const room = rooms.find((r) => r.id === roomId);
  const built = facade(room, side, entries, opts);
  room.openings.push(...built.openings);
  room.props.push(...built.props);
  room.items.push(...built.items);
}

const locked = (name, extra = {}) => ({ name, kind: 'locked', ...extra });
const shop = (name, to, extra = {}) => ({ name, kind: 'shop', to, ...extra });
const passage = (to, extra = {}) => ({ name: to, kind: 'passage', to, ...extra });

// oeste: verja final + pasajes (sin fachadas planas: el borde lo forman casas 3D)
applyFacade('room_luque_aquino_oeste', 'W', [
  { name: 'Salida a Asunción', kind: 'ending', requires: POSTERS, width: 4, block: 10 },
]);
applyFacade('room_luque_aquino_oeste', 'E', [passage('room_luque_aquino_joyeros', { block: 10 })]);

// joyeros: entrada a Manuel Deluxe y arcos a plaza/avenida
applyFacade('room_luque_aquino_joyeros', 'W', [passage('room_luque_aquino_oeste', { block: 10 })]);
applyFacade('room_luque_aquino_joyeros', 'E', [passage('room_luque_aquino_centro', { block: 10 })]);
applyFacade('room_luque_aquino_joyeros', 'N', [
  passage('room_luque_plaza', { block: 10 }),
]);
applyFacade('room_luque_aquino_joyeros', 'S', [
  shop('MANUEL DELUXE', 'room_joyeria_manuel', { poster: 'poster_2' }),
]);

// centro: solo el arco a la plaza
applyFacade('room_luque_aquino_centro', 'W', [passage('room_luque_aquino_joyeros', { block: 10 })]);
applyFacade('room_luque_aquino_centro', 'E', [passage('room_luque_aquino_galeria', { block: 10 })]);
applyFacade('room_luque_aquino_centro', 'N', [
  passage('room_luque_plaza', { block: 10 }),
]);

// galeria: solo el paso a Iturbe
applyFacade('room_luque_aquino_galeria', 'W', [passage('room_luque_aquino_centro', { block: 10 })]);
applyFacade('room_luque_aquino_galeria', 'E', [passage('room_luque_aquino_municipal', { block: 10 })]);
applyFacade('room_luque_aquino_galeria', 'N', [
  passage('room_luque_iturbe', { block: 10 }),
]);

// municipal: Municipalidad + paso a Iturbe
applyFacade('room_luque_aquino_municipal', 'W', [passage('room_luque_aquino_galeria', { block: 10 })]);
applyFacade('room_luque_aquino_municipal', 'E', [passage('room_luque_aquino_este', { block: 10 })]);
applyFacade('room_luque_aquino_municipal', 'N', [
  passage('room_luque_iturbe', { block: 10 }),
  shop('MUNICIPALIDAD DE LUQUE', 'room_luque_municipalidad', {
    block: 7,
    width: 1.8,
    height: 2.5,
    poster: 'poster_5',
  }),
]);

// este: Bambú Joya y Joyería Diamante entrañables
applyFacade('room_luque_aquino_este', 'W', [passage('room_luque_aquino_municipal', { block: 10 })]);
applyFacade('room_luque_aquino_este', 'E', [passage('room_luque_cerro_cora', { block: 10 })]);
applyFacade('room_luque_aquino_este', 'S', [
  shop('BAMBÚ JOYA', 'room_joyeria_bambu'),
  shop('JOYERÍA DIAMANTE', 'room_joyeria_diamante', { poster: 'poster_6' }),
]);

// cerro_cora: Santuario
applyFacade('room_luque_cerro_cora', 'W', [passage('room_luque_aquino_este', { block: 10 })]);
applyFacade('room_luque_cerro_cora', 'N', [
  shop('SANTUARIO VIRGEN DEL ROSARIO', 'room_luque_iglesia', {
    block: 9,
    width: 2,
    height: 2.7,
    window: false,
    poster: 'poster_7',
  }),
]);

// iturbe: Restaurante Real + pasajes (sin fachadas planas)
applyFacade('room_luque_iturbe', 'N', [
  shop('RESTAURANTE REAL', 'room_restaurante_real', { block: 7, width: 1.8, height: 2.5 }),
]);
applyFacade('room_luque_iturbe', 'S', [
  passage('room_luque_aquino_galeria', { block: 10 }),
  passage('room_luque_aquino_municipal', { block: 10 }),
]);

// plaza: solo arcos hacia la avenida (sin fachadas planas)
applyFacade('room_luque_plaza', 'W', [passage('room_luque_aquino_joyeros', { block: 10 })]);
applyFacade('room_luque_plaza', 'E', [passage('room_luque_aquino_centro', { block: 10 })]);

// interiores: puerta de vuelta + ventanas
function interiorLinks(roomId, side, backTo, extraOpenings = []) {
  const room = rooms.find((r) => r.id === roomId);
  const [w, , d] = room.size;
  room.openings.push({
    side,
    kind: 'door',
    offset: round(w / 2 - 0.7),
    width: 1.4,
    height: 2.3,
    door: 'closed',
    to: backTo,
    ...(extraOpenings[0] ?? {}),
  });
  const winOffset = w / 2 + 1.2;
  if (winOffset + 1.8 < (side === 'N' || side === 'S' ? w : d) - 1) {
    room.openings.push({
      side,
      kind: 'window',
      offset: round(winOffset),
      width: 1.8,
      height: 1.3,
      sill: 1.2,
    });
    room.openings.push({
      side,
      kind: 'window',
      offset: round(winOffset + 2.6),
      width: 1.8,
      height: 1.3,
      sill: 1.2,
    });
  }
}

interiorLinks('room_joyeria_manuel', 'N', 'room_luque_aquino_joyeros');
interiorLinks('room_joyeria_bambu', 'N', 'room_luque_aquino_este');
interiorLinks('room_joyeria_diamante', 'N', 'room_luque_aquino_este');
interiorLinks('room_restaurante_real', 'N', 'room_luque_iturbe');
interiorLinks('room_luque_municipalidad', 'N', 'room_luque_aquino_municipal');

// Iglesia: puerta al sur (hacia Cerro Corá) + vidrieras al norte.
{
  const room = rooms.find((r) => r.id === 'room_luque_iglesia');
  room.openings.push({
    side: 'S',
    kind: 'door',
    offset: round(10 - 1),
    width: 2,
    height: 2.7,
    door: 'closed',
    to: 'room_luque_cerro_cora',
  });
  // M13: confesionario contra el muro oeste, entre columnas (escondite).
  room.hides = [{ id: 'iglesia_confesionario', kind: 'confessional', position: [-9.33, 7.0], yaw: 270 }];
  // Vidrieras (la textura `window` es el vitral). El tramo del medio del sur
  // está ocupado por la puerta principal.
  for (const x of [2.5, 7.5, 12.5, 17.5]) {
    room.openings.push({
      side: 'N',
      kind: 'window',
      offset: round(x),
      width: 2,
      height: 2.4,
      sill: 2.2,
    });
  }
  for (const x of [2.5, 5.5, 14.5, 17.5]) {
    room.openings.push({
      side: 'S',
      kind: 'window',
      offset: round(x),
      width: 2,
      height: 2.4,
      sill: 2.2,
    });
  }
  // Vidrieras laterales.
  for (const z of [4, 10, 16, 22]) {
    room.openings.push({
      side: 'E',
      kind: 'window',
      offset: round(z),
      width: 2,
      height: 2.4,
      sill: 2.2,
    });
    room.openings.push({
      side: 'W',
      kind: 'window',
      offset: round(z),
      width: 2,
      height: 2.4,
      sill: 2.2,
    });
  }
  // Afiche final en el muro norte del templo.
  room.items.push({ id: 'poster_8', position: [round(10 - 6), 1.8, round(-14 + 0.3)], yaw: 0 });
  // Linterna sobre la última banca.
  room.items.push({ id: 'flashlight', position: [3.8, 0.6, 4], yaw: 0 });
}

// ---------------------------------------------------------------------------
// Bordes abiertos: las salas exteriores pierden los muros N/S largos; el borde
// lo forman casas 3D continuas (una por lugar, según su modelo) con colisión,
// losas de suelo extendidas y vallas en los encuentros con los pórticos.
// Los afiches 1/3/4 (antes en fachadas locked) se reubican en frentes de casa.
// ---------------------------------------------------------------------------
function stripHouseModels(room) {
  room.models = (room.models ?? []).filter((m) => !m.file.includes('house_type'));
}

function addGapFences(room, gaps) {
  const [w, , d] = room.size;
  const halfD = d / 2;
  for (const side of [-1, 1]) {
    const key = side < 0 ? 'N' : 'S';
    const intervals = (gaps[key] ?? []).map(([a, b]) => {
      if (key === 'N') return [a - w / 2, b - w / 2];
      return [w / 2 - b, w / 2 - a];
    });
    // Añade las casas ya colocadas como intervalos cubiertos.
    const houses = (room.models ?? []).filter(
      (m) => m.file.includes('house_type') && Math.sign(m.position[2]) === side,
    );
    const covered = [
      ...intervals,
      ...houses.map((h) => [h.position[0] - 5.3, h.position[0] + 5.3]),
    ];
    covered.sort((x, y) => x[0] - y[0]);
    // Fusiona solapes.
    const merged = [];
    for (const [a, b] of covered) {
      const last = merged[merged.length - 1];
      if (last && a <= last[1] + 0.1) last[1] = Math.max(last[1], b);
      else merged.push([a, b]);
    }
    // Huecos libres -> vallas.
    let prev = -w / 2;
    const fenceZ = side * (halfD + 1.2);
    for (const [a, b] of [...merged, [w / 2, w / 2]]) {
      const gapA = Math.max(prev, -w / 2);
      const gapB = Math.min(a, w / 2);
      if (gapB - gapA > 0.7) {
        const n = Math.max(1, Math.round((gapB - gapA) / 2.2));
        for (let i = 0; i < n; i += 1) {
          const x = gapA + ((gapB - gapA) / n) * (i + 0.5);
          (room.models ??= []).push({
            file: 'street/fence_small.glb',
            position: [round(x), 0, round(fenceZ)],
            yaw: 0,
            scale: 3,
            tint: 0.65,
            collide: true,
            size: [2.2, 1.2, 0.5],
            subdivision: 0,
          });
        }
      }
      prev = Math.max(prev, b);
    }
  }
}

{
  const seedOf = { room_luque_aquino_oeste: 1, room_luque_aquino_joyeros: 2, room_luque_aquino_centro: 3, room_luque_aquino_galeria: 4, room_luque_aquino_municipal: 5, room_luque_aquino_este: 6, room_luque_cerro_cora: 7, room_luque_iturbe: 8, room_luque_plaza: 9 };
  for (const room of rooms) {
    if (!room.open_edge) continue;
    const [w, , d] = room.size;
    const gaps = stubIntervals(room);
    stripHouseModels(room);
    const seed = seedOf[room.id] ?? 3;
    room.models = [...(room.models ?? []), ...continuousHouses(w, d, seed, gaps)];
    room.props = [...(room.props ?? []), ...streetGroundSlabs(w, d)];
    addGapFences(room, gaps);
  }
  // Afiches huérfanos (antes en comercios locked): frentes de casa, dentro de
  // la sala y mirando a la calle.
  const place = (id, poster, x, z, yaw) => {
    const room = rooms.find((r) => r.id === id);
    room.items.push({ id: poster, position: [x, 1.8, z], yaw });
  };
  place('room_luque_aquino_oeste', 'poster_1', 10, 8.15, 180);
  place('room_luque_aquino_centro', 'poster_3', -10, 8.15, 180);
  place('room_luque_aquino_galeria', 'poster_4', 5, -8.15, 0);
  // La plaza pierde sus casas laterales al limpiar: repone skyline tras los
  // muros E/O (que se conservan con sus pasajes).
  {
    const plaza = rooms.find((r) => r.id === 'room_luque_plaza');
    plaza.models.push(
      ...skyline(30, 36, 20, 1).map((m) => ({
        ...m,
        position: [m.position[2], m.position[1], m.position[0]],
        yaw: m.yaw + 90,
        collide: false,
      })),
    );
  }
}

// ---------------------------------------------------------------------------
// Salida
// ---------------------------------------------------------------------------
const spawnsByRoom = buildSpawns(rooms);
const outputs = rooms.map((room) => {
  const data = {
    id: room.id,
    name: room.name,
    size: room.size.map(round),
    texture_scale: room.texture_scale,
    wall_thickness: room.wall_thickness,
    ...(room.open_sky ? { open_sky: true } : {}),
    ...(room.door_fit ? { door_fit: true } : {}),
    ...(room.atmosphere ? { atmosphere: room.atmosphere } : {}),
    textures: room.textures,
    ...(room.audio ? { audio: room.audio } : {}),
    walls: buildWalls(room),
    props: room.props,
    ...(room.models && room.models.length > 0 ? { models: room.models } : {}),
    ...(room.items && room.items.length > 0 ? { items: room.items } : {}),
    ...(room.hides && room.hides.length > 0 ? { hides: room.hides } : {}),
    ...(room.events && room.events.length > 0 ? { events: room.events } : {}),
    spawns: spawnsByRoom.get(room.id),
  };
  return data;
});

for (const data of outputs) {
  writeFileSync(`${OUT}/${data.id}.json`, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`${data.id}.json`);
}
console.log(`\n${outputs.length} salas escritas en ${OUT}`);
