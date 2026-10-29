// Verificador de accesibilidad de Mondyi.
//
// 1. Por sala: rejilla de colisiones (como NavGrid del stalker) con el radio del
//    stalker (0.34 m) y del jugador (0.30 m). Comprueba que cada puerta tenga
//    paso libre delante, que todas las puertas de la sala estén conectadas entre
//    sí y que cada ítem (afiches, llaves, chipas, linterna) sea alcanzable a
//    distancia de interacción.
// 2. Partida simulada: desde el Vestíbulo, recorre el grafo de salas recogiendo
//    llaves y abriendo candados; al final deben estar los 12 afiches y la salida.
//
// Uso: node tools/check_access.mjs   (sale con código 1 si algo falla)
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOMS_DIR = `${ROOT}/public/rooms`;
const config = JSON.parse(readFileSync(`${ROOT}/public/config/psx_config.json`, 'utf8'));
const items = JSON.parse(readFileSync(`${ROOT}/public/config/items.json`, 'utf8')).items;
const itemKind = new Map(items.map((item) => [item.id, item.kind]));
itemKind.set('flashlight', 'tool');

const STALKER_R = config.enemy.body_radius;
const PLAYER_R = config.player.radius;
const INTERACT = config.player.interact_radius;
const CELL = 0.1;
const DOOR_T = 0.07;
const APPROACH = 1.1; // metros libres que necesita el stalker delante de la puerta

const errors = [];
const warns = [];

function box(cx, cz, heading, length, thickness) {
  const cos = Math.abs(Math.cos(heading));
  const sin = Math.abs(Math.sin(heading));
  const hx = (length / 2) * cos + (thickness / 2) * sin;
  const hz = (length / 2) * sin + (thickness / 2) * cos;
  return { minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz };
}

function analyse(room) {
  const t = room.wall_thickness;
  const walls = [];
  const furniture = [];
  const doorways = [];
  for (const run of room.walls) {
    const [sx, sz] = run.start;
    const [ex, ez] = run.end;
    const len = Math.hypot(ex - sx, ez - sz);
    const dx = (ex - sx) / len;
    const dz = (ez - sz) / len;
    const heading = Math.atan2(-dz, dx);
    let inX = -dz;
    let inZ = dx;
    const mx = sx + dx * len * 0.5;
    const mz = sz + dz * len * 0.5;
    if (inX * -mx + inZ * -mz < 0) {
      inX = -inX;
      inZ = -inZ;
    }
    const openings = [...(run.openings ?? [])].sort((a, b) => a.offset - b.offset);
    let cursor = 0;
    for (const o of openings) {
      if (o.offset > cursor) walls.push(box(sx + dx * (cursor + o.offset) / 2, sz + dz * (cursor + o.offset) / 2, heading, o.offset - cursor, t));
      cursor = o.offset + o.width;
      const cx = sx + dx * (o.offset + o.width / 2);
      const cz = sz + dz * (o.offset + o.width / 2);
      if ((o.sill ?? 0) > 0) walls.push(box(cx, cz, heading, o.width, t));
      if (o.kind !== 'window' && o.to !== undefined) {
        doorways.push({ to: o.to ?? null, key: o.key ?? null, action: o.action, ending: o.ending ?? false, requires: o.requires ?? [], x: cx, z: cz, inX, inZ, width: o.width });
      } else if (o.kind === 'door' && o.ending) {
        doorways.push({ to: null, key: null, ending: true, requires: o.requires ?? [], x: cx, z: cz, inX, inZ, width: o.width });
      }
      if (o.kind === 'door') walls.push(box(cx, cz, heading, o.width, DOOR_T));
    }
    if (cursor < len) walls.push(box(sx + dx * (cursor + len) / 2, sz + dz * (cursor + len) / 2, heading, len - cursor, t));
  }
  for (const p of room.props ?? []) {
    if (!p.collide) continue;
    const [px, , pz] = p.position;
    const [w, , d] = p.size;
    furniture.push({ minX: px - w / 2, maxX: px + w / 2, minZ: pz - d / 2, maxZ: pz + d / 2, what: `prop ${p.texture} @${px},${pz}` });
  }
  // Decorado sin colisión pero con volumen (el stalker lo atravesaría).
  for (const p of room.props ?? []) {
    if (p.collide || p.decal || p.hidden) continue;
    const [px, py, pz] = p.position;
    const [w, h, d] = p.size;
    if (py - h / 2 > 1.9 || h < 0.25) continue;
    furniture.push({ minX: px - w / 2, maxX: px + w / 2, minZ: pz - d / 2, maxZ: pz + d / 2, what: `decorado ${p.texture} @${px},${pz}`, soft: true });
  }
  for (const m of room.models ?? []) {
    if (m.collide || !m.size) continue;
    const [px, , pz] = m.position;
    const [w, , d] = m.size;
    furniture.push({ minX: px - w / 2, maxX: px + w / 2, minZ: pz - d / 2, maxZ: pz + d / 2, what: `modelo decorativo ${m.file} @${px},${pz}`, soft: true });
  }
  for (const m of room.models ?? []) {
    if (!m.collide || !m.size) continue;
    const [px, , pz] = m.position;
    const [w, , d] = m.size;
    furniture.push({ minX: px - w / 2, maxX: px + w / 2, minZ: pz - d / 2, maxZ: pz + d / 2, what: `modelo ${m.file} @${px},${pz}` });
  }
  // Escondites (M13): misma huella que computeHideSpot en src/systems/hides.ts.
  for (const h of room.hides ?? []) {
    const spot = hideSpot(h);
    furniture.push({ ...spot.collider, what: `escondite ${h.id}` });
  }
  return { walls, furniture, doorways };
}

const HIDE_SIZES = { wardrobe: [1.0, 0.6], locker: [0.8, 0.55], confessional: [1.0, 1.0] };

function hideSpot(h) {
  const [width, depth] = HIDE_SIZES[h.kind] ?? HIDE_SIZES.wardrobe;
  const yaw = (h.yaw * Math.PI) / 180;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const [x, z] = h.position;
  const hx = (width / 2) * Math.abs(Math.cos(yaw)) + (depth / 2) * Math.abs(Math.sin(yaw));
  const hz = (width / 2) * Math.abs(Math.sin(yaw)) + (depth / 2) * Math.abs(Math.cos(yaw));
  return {
    collider: { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz },
    frontX: x + fx * (depth / 2 + 0.55),
    frontZ: z + fz * (depth / 2 + 0.55),
  };
}

function grid(room, colliders, radius) {
  const hw = room.size[0] / 2;
  const hd = room.size[2] / 2;
  const nx = Math.ceil((hw * 2) / CELL);
  const nz = Math.ceil((hd * 2) / CELL);
  const free = new Uint8Array(nx * nz);
  for (let iz = 0; iz < nz; iz += 1) {
    for (let ix = 0; ix < nx; ix += 1) {
      const x = -hw + (ix + 0.5) * CELL;
      const z = -hd + (iz + 0.5) * CELL;
      const blocked = colliders.some((c) => x > c.minX - radius && x < c.maxX + radius && z > c.minZ - radius && z < c.maxZ + radius);
      free[iz * nx + ix] = blocked ? 0 : 1;
    }
  }
  const cell = (x, z) => {
    const ix = Math.floor((x + hw) / CELL);
    const iz = Math.floor((z + hd) / CELL);
    return ix >= 0 && iz >= 0 && ix < nx && iz < nz ? iz * nx + ix : -1;
  };
  const label = new Int32Array(nx * nz).fill(-1);
  let next = 0;
  for (let i = 0; i < free.length; i += 1) {
    if (!free[i] || label[i] >= 0) continue;
    const stack = [i];
    label[i] = next;
    while (stack.length) {
      const c = stack.pop();
      const cx = c % nx;
      const cz = (c / nx) | 0;
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = cx + ox;
        const z = cz + oz;
        if (x < 0 || z < 0 || x >= nx || z >= nz) continue;
        const n = z * nx + x;
        if (free[n] && label[n] < 0) {
          label[n] = next;
          stack.push(n);
        }
      }
    }
    next += 1;
  }
  return { free, label, cell, nx, nz, hw, hd };
}

// Componente libre más cercano a un punto (dentro de `reach`).
function componentNear(g, x, z, reach) {
  let best = -1;
  let bestD = Infinity;
  for (let iz = 0; iz < g.nz; iz += 1) {
    for (let ix = 0; ix < g.nx; ix += 1) {
      const i = iz * g.nx + ix;
      if (!g.free[i]) continue;
      const cx = -g.hw + (ix + 0.5) * CELL;
      const cz = -g.hd + (iz + 0.5) * CELL;
      const d = Math.hypot(cx - x, cz - z);
      if (d <= reach && d < bestD) {
        bestD = d;
        best = g.label[i];
      }
    }
  }
  return best;
}

const rooms = new Map();
for (const file of readdirSync(ROOMS_DIR).filter((f) => f.endsWith('.json'))) {
  const room = JSON.parse(readFileSync(`${ROOMS_DIR}/${file}`, 'utf8'));
  rooms.set(room.id, room);
}

const roomInfo = new Map();
for (const room of rooms.values()) {
  const { walls, furniture, doorways } = analyse(room);
  const all = [...walls, ...furniture.filter((f) => !f.soft)];
  const stalkerGrid = grid(room, all, STALKER_R);
  const playerGrid = grid(room, all, PLAYER_R);

  // Paso libre delante de cada puerta: rectángulo de (ancho+2r) × APPROACH.
  for (const door of doorways) {
    const halfW = door.width / 2;
    const tx = -door.inZ;
    const tz = door.inX;
    for (const f of furniture) {
      let hit = false;
      for (let a = 0.12; a <= APPROACH && !hit; a += 0.08) {
        for (let b = -halfW; b <= halfW && !hit; b += 0.08) {
          const x = door.x + door.inX * a + tx * b;
          const z = door.z + door.inZ * a + tz * b;
          if (x > f.minX - STALKER_R * 0.5 && x < f.maxX + STALKER_R * 0.5 && z > f.minZ - STALKER_R * 0.5 && z < f.maxZ + STALKER_R * 0.5) hit = true;
        }
      }
      if (hit) errors.push(`${room.id}: ${f.what} tapa la puerta hacia ${door.to ?? 'SALIDA'}`);
    }
  }

  // Conectividad: todas las puertas en el mismo componente (stalker y jugador).
  const doorComps = doorways.map((d) => ({ d, s: componentNear(stalkerGrid, d.x + d.inX * 0.75, d.z + d.inZ * 0.75, 0.5), p: componentNear(playerGrid, d.x + d.inX * 0.75, d.z + d.inZ * 0.75, 0.5) }));
  for (const { d, s, p } of doorComps) {
    if (s < 0) errors.push(`${room.id}: el stalker no cabe delante de la puerta hacia ${d.to ?? 'SALIDA'}`);
    if (p < 0) errors.push(`${room.id}: el jugador no cabe delante de la puerta hacia ${d.to ?? 'SALIDA'}`);
  }
  const sComps = new Set(doorComps.map((c) => c.s).filter((c) => c >= 0));
  const pComps = new Set(doorComps.map((c) => c.p).filter((c) => c >= 0));
  if (sComps.size > 1) errors.push(`${room.id}: el stalker no puede ir de una puerta a otra (muebles cortan la sala)`);
  if (pComps.size > 1) errors.push(`${room.id}: el jugador no puede ir de una puerta a otra (muebles cortan la sala)`);
  const mainPlayerComp = [...pComps][0] ?? componentNear(playerGrid, room.spawns.start.position[0], room.spawns.start.position[1], 1);

  // Escondites: el jugador sale y el stalker se planta delante (punto libre y conectado).
  for (const h of room.hides ?? []) {
    const { frontX, frontZ } = hideSpot(h);
    const s = componentNear(stalkerGrid, frontX, frontZ, 0.25);
    const p = componentNear(playerGrid, frontX, frontZ, 0.25);
    if (p < 0 || (pComps.size > 0 && !pComps.has(p))) errors.push(`${room.id}: el jugador no puede salir del escondite ${h.id}`);
    if (s < 0 || (sComps.size > 0 && !sComps.has(s))) errors.push(`${room.id}: el stalker no llega delante del escondite ${h.id}`);
  }

  // Afiches tapados: cualquier caja (con o sin colisión) que se interponga
  // delante de la cara del afiche, hasta 0.6 m hacia la sala.
  for (const item of room.items ?? []) {
    if (!item.id.startsWith('poster_')) continue;
    const yaw = ((item.yaw ?? 0) * Math.PI) / 180;
    const nx = Math.sin(yaw);
    const nz = Math.cos(yaw);
    const [ix, iy, iz] = item.position;
    for (const p of room.props ?? []) {
      if (p.hidden) continue;
      const [px, py, pz] = p.position;
      const [w, h, d] = p.size;
      let covered = false;
      for (let a = -0.03; a <= 0.6 && !covered; a += 0.03) {
        for (const [u, v] of [[0, 0], [-0.2, 0.3], [0.2, -0.3], [0.2, 0.3], [-0.2, -0.3]]) {
          const x = ix + nx * a + nz * u;
          const z = iz + nz * a - nx * u;
          const y = iy + v;
          if (x > px - w / 2 && x < px + w / 2 && y > py - h / 2 && y < py + h / 2 && z > pz - d / 2 && z < pz + d / 2 && !(p.decal && a > 0.01)) {
            covered = a >= 0 || !p.decal;
            if (covered) break;
          }
        }
      }
      if (covered && !p.decal) errors.push(`${room.id}: ${item.id} queda tapado por ${p.texture} @${px},${pz}`);
    }
  }

  const reachableItems = [];
  for (const item of room.items ?? []) {
    const comp = componentNear(playerGrid, item.position[0], item.position[2], INTERACT * 0.95);
    if (comp < 0 || comp !== mainPlayerComp) {
      errors.push(`${room.id}: el ítem ${item.id} no se puede alcanzar`);
    } else {
      reachableItems.push(item.id);
    }
  }
  roomInfo.set(room.id, { doorways, items: reachableItems });
}

// Partida simulada con llaves y candados.
const keys = new Set();
const burned = new Set();
const visited = new Set();
let exitOpen = false;
let progress = true;
while (progress) {
  progress = false;
  const queue = ['room_vestibulo'];
  const seen = new Set(queue);
  while (queue.length) {
    const id = queue.shift();
    visited.add(id);
    const info = roomInfo.get(id);
    if (!info) continue;
    for (const itemId of info.items) {
      const kind = itemKind.get(itemId);
      if (kind === 'poster' && !burned.has(itemId)) {
        burned.add(itemId);
        progress = true;
      }
      if (kind === 'key' && !keys.has(itemId)) {
        keys.add(itemId);
        progress = true;
      }
    }
    for (const door of info.doorways) {
      if (door.ending) {
        if (door.requires.every((p) => burned.has(p))) exitOpen = true;
        continue;
      }
      if (!door.to || (door.key && !keys.has(door.key)) || seen.has(door.to)) continue;
      seen.add(door.to);
      queue.push(door.to);
    }
  }
}

const allPosters = items.filter((item) => item.kind === 'poster').map((item) => item.id);
for (const poster of allPosters) {
  if (!burned.has(poster)) errors.push(`partida: el afiche ${poster} no se puede conseguir`);
}
for (const id of rooms.keys()) {
  if (!visited.has(id)) warns.push(`partida: la sala ${id} no es alcanzable`);
}
if (!exitOpen) errors.push('partida: la puerta de salida no se puede abrir');

console.log(`Salas: ${rooms.size} · afiches quemables: ${burned.size}/${allPosters.length} · llaves: ${[...keys].join(', ')} · salida: ${exitOpen ? 'sí' : 'NO'}`);
for (const w of warns) console.log(`  ⚠ ${w}`);
for (const e of errors) console.log(`  ✖ ${e}`);
console.log(errors.length ? `Errores: ${errors.length}` : 'Todo accesible.');
process.exit(errors.length ? 1 : 0);
