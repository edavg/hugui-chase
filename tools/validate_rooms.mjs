// Validador de salas de Mondyi.
// Comprueba puertas recíprocas, spawns, ítems, texturas y presupuesto de triángulos.
// Uso: node tools/validate_rooms.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOMS_DIR = `${ROOT}/public/rooms`;
const TEX_DIR = `${ROOT}/public/assets/textures/horror_pack`;
const MODELS_DIR = `${ROOT}/public/assets/models/furniture`;
const DOOR_THICKNESS = 0.07;

function modelInfo(file) {
  const path = `${MODELS_DIR}/${file}`;
  if (!existsSync(path)) {
    return null;
  }
  const buffer = readFileSync(path);
  const jsonLength = buffer.readUInt32LE(12);
  const gltf = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
  const meshTris = (gltf.meshes ?? []).map((mesh) => {
    let tris = 0;
    for (const primitive of mesh.primitives) {
      tris += primitive.indices !== undefined
        ? gltf.accessors[primitive.indices].count / 3
        : gltf.accessors[primitive.attributes.POSITION].count / 3;
    }
    return tris;
  });
  const tris = meshTris.reduce((total, value) => total + value, 0);
  const nodes = (gltf.nodes ?? []).map((node) => ({
    name: (node.name ?? '').replace(/\s+/g, '_'),
    mesh: node.mesh,
  }));
  return { tris, nodes, meshTris };
}

function patternMatches(name, pattern) {
  if (pattern.endsWith('*')) {
    return name.startsWith(pattern.slice(0, -1));
  }
  return name === pattern;
}

function modelTris(model) {
  const info = modelInfo(model.file);
  if (!info) {
    return 0;
  }
  if (!model.node) {
    return info.tris;
  }
  const patterns = Array.isArray(model.node) ? model.node : [model.node];
  let total = 0;
  const counted = new Set();
  for (const node of info.nodes) {
    if (node.mesh === undefined || counted.has(node.mesh)) {
      continue;
    }
    if (patterns.some((pattern) => patternMatches(node.name, pattern))) {
      total += info.meshTris[node.mesh];
      counted.add(node.mesh);
    }
  }
  return total;
}

const graphSource = readFileSync(`${ROOT}/src/systems/roomGraph.ts`, 'utf8');
const idsBlock = graphSource.match(/ROOM_IDS = \[([\s\S]*?)\] as const/);
const ROOM_IDS = [...idsBlock[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);

const catalog = new Set();
for (const file of ['items.json', 'items_extra.json']) {
  const data = JSON.parse(readFileSync(`${ROOT}/public/config/${file}`, 'utf8'));
  for (const item of data.items) catalog.add(item.id);
}

const errors = [];
const warnings = [];
const fail = (message) => errors.push(message);
const warn = (message) => warnings.push(message);

const SUB_QUADS = 2;

function segments(length, texScale) {
  return Math.max(1, Math.round((length / texScale) * SUB_QUADS));
}

function boxTris(width, height, depth, texScale) {
  const sw = segments(width, texScale);
  const sh = segments(height, texScale);
  const sd = segments(depth, texScale);
  const quads = 2 * sh * sd + 2 * sw * sd + 2 * sw * sh;
  return quads * 2;
}

function planeTris(width, height, texScale) {
  return 2 * segments(width, texScale) * segments(height, texScale);
}

function runGeometry(run) {
  const [sx, sz] = run.start;
  const [ex, ez] = run.end;
  const dx = ex - sx;
  const dz = ez - sz;
  const length = Math.hypot(dx, dz);
  return { sx, sz, dirX: dx / length, dirZ: dz / length, length, heading: Math.atan2(-dz, dx) };
}

function boxCollider(centerX, centerZ, heading, length, thickness) {
  const cos = Math.abs(Math.cos(heading));
  const sin = Math.abs(Math.sin(heading));
  const halfX = (length / 2) * cos + (thickness / 2) * sin;
  const halfZ = (length / 2) * sin + (thickness / 2) * cos;
  return { minX: centerX - halfX, maxX: centerX + halfX, minZ: centerZ - halfZ, maxZ: centerZ + halfZ };
}

function collidersOf(room) {
  const colliders = [];
  const thickness = room.wall_thickness;
  for (const run of room.walls) {
    const { sx, sz, dirX, dirZ, length, heading } = runGeometry(run);
    const openings = [...(run.openings ?? [])].sort((a, b) => a.offset - b.offset);
    let cursor = 0;
    for (const opening of openings) {
      if (opening.offset > cursor) {
        const center = (cursor + opening.offset) / 2;
        colliders.push(boxCollider(sx + dirX * center, sz + dirZ * center, heading, opening.offset - cursor, thickness));
      }
      cursor = opening.offset + opening.width;
    }
    if (cursor < length) {
      const center = (cursor + length) / 2;
      colliders.push(boxCollider(sx + dirX * center, sz + dirZ * center, heading, length - cursor, thickness));
    }
    for (const opening of openings) {
      const centerX = sx + dirX * (opening.offset + opening.width / 2);
      const centerZ = sz + dirZ * (opening.offset + opening.width / 2);
      if ((opening.sill ?? 0) > 0) {
        colliders.push(boxCollider(centerX, centerZ, heading, opening.width, thickness));
      }
      if (opening.kind === 'door') {
        colliders.push(boxCollider(centerX, centerZ, heading, opening.width, DOOR_THICKNESS));
      } else if (opening.kind === 'passage' && opening.blocked) {
        colliders.push(boxCollider(centerX, centerZ, heading, opening.width, thickness));
      }
    }
  }
  for (const prop of room.props ?? []) {
    if (!prop.collide) continue;
    const [px, , pz] = prop.position;
    const [sx, , sz] = prop.size;
    colliders.push({ minX: px - sx / 2, maxX: px + sx / 2, minZ: pz - sz / 2, maxZ: pz + sz / 2 });
  }
  return colliders;
}

function insideCollider(collider, x, z, margin) {
  return (
    x > collider.minX - margin &&
    x < collider.maxX + margin &&
    z > collider.minZ - margin &&
    z < collider.maxZ + margin
  );
}

function estimateTris(room) {
  const [w, h, d] = room.size;
  const texScale = room.texture_scale;
  let tris = planeTris(w, d, texScale) * 2; // suelo + techo
  for (const run of room.walls) {
    const { length } = runGeometry(run);
    const openings = [...(run.openings ?? [])].sort((a, b) => a.offset - b.offset);
    let cursor = 0;
    for (const opening of openings) {
      if (opening.offset > cursor) {
        tris += boxTris(opening.offset - cursor, h, room.wall_thickness, texScale);
      }
      cursor = opening.offset + opening.width;
    }
    if (cursor < length) tris += boxTris(length - cursor, h, room.wall_thickness, texScale);

    for (const opening of openings) {
      const sill = opening.sill ?? 0;
      const top = sill + opening.height;
      if (top < h) tris += boxTris(opening.width, h - top, room.wall_thickness, texScale);
      if (sill > 0) tris += boxTris(opening.width, sill, room.wall_thickness, texScale);
      if (opening.kind === 'door' || opening.kind === 'passage') {
        const frameDepth = room.wall_thickness + 0.06;
        tris += 2 * boxTris(0.08, opening.height - 0.005, frameDepth, texScale);
        tris += boxTris(opening.width + 0.16, 0.08, frameDepth, texScale);
      }
      if (opening.kind === 'door') {
        const slabWidth = opening.width - 0.02;
        tris += boxTris(slabWidth, opening.height - 0.02, 0.07, texScale);
        tris += 12; // picaporte
      }
      if (opening.kind === 'window') {
        tris += planeTris(opening.width, opening.height, texScale);
      }
    }
  }
  for (const prop of room.props ?? []) {
    tris += boxTris(prop.size[0], prop.size[1], prop.size[2], texScale);
  }
  for (const model of room.models ?? []) {
    tris += modelTris(model);
  }
  tris += (room.items?.length ?? 0) * 120;
  return tris;
}

const files = readdirSync(ROOMS_DIR).filter((file) => file.endsWith('.json')).sort();
const rooms = new Map();
for (const file of files) {
  const room = JSON.parse(readFileSync(`${ROOMS_DIR}/${file}`, 'utf8'));
  if (`${room.id}.json` !== file) fail(`${file}: el id "${room.id}" no coincide con el nombre de archivo`);
  rooms.set(room.id, room);
}

for (const id of ROOM_IDS) {
  if (!rooms.has(id)) fail(`ROOM_IDS incluye ${id} pero no existe su JSON`);
}
for (const id of rooms.keys()) {
  if (!ROOM_IDS.includes(id)) fail(`${id}: existe el JSON pero no está en ROOM_IDS`);
}

const incoming = new Map(ROOM_IDS.map((id) => [id, []]));

for (const room of rooms.values()) {
  const [w, h, d] = room.size;
  const halfW = w / 2;
  const halfD = d / 2;
  if (!room.spawns?.start) fail(`${room.id}: falta el spawn start`);
  if (!room.audio) warn(`${room.id}: sin bloque audio`);

  for (const [key, path] of Object.entries(room.textures)) {
    if (!existsSync(`${TEX_DIR}/${path}`)) fail(`${room.id}: textura ${key} no existe en disco (${path})`);
  }

  for (const run of room.walls) {
    const { length } = runGeometry(run);
    let cursor = 0;
    for (const opening of [...(run.openings ?? [])].sort((a, b) => a.offset - b.offset)) {
      if (opening.offset < cursor - 1e-9) fail(`${room.id}: huecos solapados en un muro`);
      if (opening.offset + opening.width > length + 1e-9) {
        fail(`${room.id}: hueco ${opening.kind} fuera del muro (${opening.offset}+${opening.width} > ${length})`);
      }
      cursor = opening.offset + opening.width;
      if (opening.kind === 'door' && opening.to) {
        incoming.get(opening.to)?.push({ from: room.id, spawn: opening.spawn, key: opening.key ?? null, action: opening.action ?? 'open' });
      }
    }
  }

  const colliders = collidersOf(room);
  for (const [name, spawn] of Object.entries(room.spawns ?? {})) {
    const [x, z] = spawn.position;
    if (Math.abs(x) > halfW - 0.35 || Math.abs(z) > halfD - 0.35) {
      fail(`${room.id}: spawn ${name} fuera de los límites (${x}, ${z}) sala ${w}x${d}`);
    }
    for (const collider of colliders) {
      if (insideCollider(collider, x, z, 0.32)) {
        fail(`${room.id}: spawn ${name} dentro de un collider (${x}, ${z})`);
        break;
      }
    }
  }

  for (const item of room.items ?? []) {
    if (!catalog.has(item.id)) fail(`${room.id}: ítem ${item.id} no está en el catálogo`);
    const [x, y, z] = item.position;
    if (Math.abs(x) > halfW - 0.25 || Math.abs(z) > halfD - 0.25) fail(`${room.id}: ítem ${item.id} fuera de la sala`);
    if (y <= 0.02 || y > h) fail(`${room.id}: ítem ${item.id} con altura sospechosa (${y})`);
  }

  // Los decales (manchas, cuadros, paneles) deben quedar dentro de la sala y no
  // pisar el hueco de una puerta o ventana del muro que los soporta.
  const innerXLimit = halfW - room.wall_thickness / 2;
  const innerZLimit = halfD - room.wall_thickness / 2;
  for (const prop of room.props ?? []) {
    if (!prop.decal) continue;
    const [px, py, pz] = prop.position;
    const [sx, sy, sz] = prop.size;
    const minAxis = Math.min(sx, sy, sz);
    const label = `decal (${px}, ${py}, ${pz})`;

    if (minAxis === sy) {
      if (Math.abs(px) + sx / 2 > innerXLimit + 1e-6 || Math.abs(pz) + sz / 2 > innerZLimit + 1e-6) {
        fail(`${room.id}: ${label} de suelo fuera de los límites de la sala`);
      }
      continue;
    }

    const onX = minAxis === sx;
    const side = onX ? (px >= 0 ? 'E' : 'W') : pz >= 0 ? 'S' : 'N';
    const lateralCenter = onX ? pz : px;
    const lateralSize = onX ? sz : sx;
    const lateralLimit = onX ? innerZLimit : innerXLimit;
    if (Math.abs(lateralCenter) + lateralSize / 2 > lateralLimit + 1e-6) {
      fail(`${room.id}: ${label} sobresale del muro ${side} por el lateral`);
    }
    if (py - sy / 2 < -1e-6 || py + sy / 2 > h + 1e-6) {
      fail(`${room.id}: ${label} se sale de la altura de la sala`);
    }

    const wallLine = onX ? (side === 'E' ? halfW : -halfW) : side === 'S' ? halfD : -halfD;
    for (const run of room.walls) {
      const { sx: runX, sz: runZ, dirX, dirZ } = runGeometry(run);
      if (Math.abs((onX ? runX : runZ) - wallLine) > 1e-6) continue;
      for (const opening of run.openings ?? []) {
        const ax = runX + dirX * opening.offset;
        const az = runZ + dirZ * opening.offset;
        const bx = runX + dirX * (opening.offset + opening.width);
        const bz = runZ + dirZ * (opening.offset + opening.width);
        const o0 = onX ? Math.min(az, bz) : Math.min(ax, bx);
        const o1 = onX ? Math.max(az, bz) : Math.max(ax, bx);
        const sill = opening.sill ?? 0;
        const yOverlap = py + sy / 2 > sill && py - sy / 2 < sill + opening.height;
        const lateralOverlap =
          lateralCenter + lateralSize / 2 > o0 && lateralCenter - lateralSize / 2 < o1;
        if (yOverlap && lateralOverlap) {
          fail(`${room.id}: ${label} pisa el hueco ${opening.kind} del muro ${side}`);
        }
      }
    }
  }

  for (const model of room.models ?? []) {
    const info = modelInfo(model.file);
    if (!info) {
      fail(`${room.id}: modelo ${model.file} no existe en public/assets/models/furniture/`);
      continue;
    }
    const patterns = model.node
      ? Array.isArray(model.node)
        ? model.node
        : [model.node]
      : [];
    for (const pattern of patterns) {
      if (!info.nodes.some((node) => patternMatches(node.name, pattern))) {
        fail(`${room.id}: ${model.file} no tiene el nodo "${pattern}"`);
      }
    }
    if (model.collide && !model.size) {
      fail(`${room.id}: el modelo ${model.file} tiene collide sin size (no colisiona en el pathfinding)`);
    }
  }

  const tris = estimateTris(room);
  if (tris > 4000) fail(`${room.id}: ${tris} tris estimados superan el presupuesto (4000)`);
  else if (tris > 3700) warn(`${room.id}: ${tris} tris estimados cerca del presupuesto`);
  console.log(
    `${room.id.padEnd(20)} ${w.toFixed(1)}x${d.toFixed(1)}  tex ${room.texture_scale}  tris ~${tris}  col ${colliders.length}  items ${room.items?.length ?? 0}`,
  );
}

for (const room of rooms.values()) {
  for (const run of room.walls) {
    for (const opening of run.openings ?? []) {
      if (opening.kind !== 'door' || !opening.to) continue;
      const target = rooms.get(opening.to);
      if (!target) {
        fail(`${room.id}: puerta a ${opening.to} inexistente`);
        continue;
      }
      const back = (target.walls ?? []).some((backRun) =>
        (backRun.openings ?? []).some((backOpening) => backOpening.kind === 'door' && backOpening.to === room.id),
      );
      if (!back) fail(`${room.id} -> ${opening.to}: falta la puerta recíproca`);
      if (opening.spawn && !target.spawns?.[opening.spawn]) {
        fail(`${room.id} -> ${opening.to}: el spawn "${opening.spawn}" no existe en la sala destino`);
      }
      if (opening.key && !catalog.has(opening.key)) fail(`${room.id}: key ${opening.key} no está en el catálogo`);
      for (const requirement of opening.requires ?? []) {
        if (!catalog.has(requirement)) fail(`${room.id}: requires ${requirement} no está en el catálogo`);
      }
    }
  }
}

for (const [id, list] of incoming) {
  const room = rooms.get(id);
  if (!room) continue;
  for (const entry of list) {
    const expected = `from_${entry.from.replace(/^room_/, '')}`;
    if (!room.spawns?.[expected]) fail(`${id}: falta el spawn ${expected} (viene de ${entry.from})`);
  }
}

console.log('\nÍtems del catálogo:', [...catalog].join(', '));
console.log(`\nErrores: ${errors.length}`);
for (const error of errors) console.log('  ✖', error);
console.log(`Avisos: ${warnings.length}`);
for (const warning of warnings) console.log('  ⚠', warning);
process.exit(errors.length > 0 ? 1 : 0);
