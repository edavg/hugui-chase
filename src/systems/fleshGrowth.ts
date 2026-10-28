import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PsxConfig } from './config';
import { curseFleshTexture } from './demonicEye';
import { createPsxMaterial, type Atmosphere, type PsxMaterialHandle } from './psxMaterial';
import type { Collider, RoomWallRun } from './roomBuilder';

// Contaminación de la maldición: la misma carne del ojo de la salida brota de
// muros, suelo y techo. Las coordenadas van sobre la superficie: [x, z] en
// suelo y techo; [x o z a lo largo del muro, altura] en los muros N/S y E/W.

export type FleshSurface = 'floor' | 'ceiling' | 'N' | 'E' | 'S' | 'W';

export interface RoomFleshGrowth {
  kind: 'growth';
  on: FleshSurface;
  at: [number, number];
  // Semiejes sobre la superficie (mismo orden que `at`).
  radius: [number, number];
  // Cuánto sobresale en el centro (m). Desde FLESH_COLLIDE_BULGE colisiona sola.
  bulge?: number;
  // Raíces que se extienden desde el borde (por defecto según el tamaño).
  roots?: number;
  collide?: boolean;
}

export interface RoomFleshVein {
  kind: 'vein';
  on: FleshSurface;
  points: Array<[number, number]>;
  radius?: number;
}

export type RoomFleshDef = RoomFleshGrowth | RoomFleshVein;

const TILE = 0.9;
const LIFT = 0.004;
export const FLESH_COLLIDE_BULGE = 0.22;
// Una masa en el muro sólo estorba si baja hasta la altura del cuerpo.
const BODY_HEIGHT = 1.7;
const COLLIDER_SPAN = 0.8;
// Las masas grandes respiran: una malla por superficie, escalada contra su plano.
const BREATH_BULGE = 0.15;
const OPENING_MARGIN = 0.1;
const EDGE_COLOR = new THREE.Color(0.5, 0.36, 0.37);
const CORE_COLOR = new THREE.Color(0.88, 0.82, 0.8);

// Lo que la sala sabe de sus superficies: medidas, huecos y molduras.
export interface FleshRoomShape {
  size: [number, number, number];
  thickness: number;
  walls: RoomWallRun[];
  // Fondo de las molduras del muro a una altura (zócalo, friso, cornisa).
  relief: (y: number) => number;
}

interface RoomBounds {
  innerX: number;
  innerZ: number;
  height: number;
  relief: (y: number) => number;
}

const FLAT = (_y: number): number => 0;
const UNIT: RoomBounds = { innerX: 0, innerZ: 0, height: 0, relief: FLAT };

function roomBounds(size: [number, number, number], thickness: number, relief = FLAT): RoomBounds {
  return { innerX: size[0] / 2 - thickness / 2, innerZ: size[2] / 2 - thickness / 2, height: size[1], relief };
}

function surfacePoint(on: FleshSurface, p: number, q: number, h: number, bounds: RoomBounds): THREE.Vector3 {
  if (on !== 'floor' && on !== 'ceiling') h += bounds.relief(q);
  switch (on) {
    case 'floor': return new THREE.Vector3(p, h, q);
    case 'ceiling': return new THREE.Vector3(p, bounds.height - h, q);
    case 'N': return new THREE.Vector3(p, q, -bounds.innerZ + h);
    case 'S': return new THREE.Vector3(p, q, bounds.innerZ - h);
    case 'W': return new THREE.Vector3(-bounds.innerX + h, q, p);
    case 'E': return new THREE.Vector3(bounds.innerX - h, q, p);
  }
}

function surfaceNormal(on: FleshSurface): THREE.Vector3 {
  return surfacePoint(on, 0, 0, 1, UNIT).sub(surfacePoint(on, 0, 0, 0, UNIT));
}

// Sentido del parámetro (p, q) respecto a la normal: decide el orden de los triángulos.
function windingSign(on: FleshSurface): number {
  const origin = surfacePoint(on, 0, 0, 0, UNIT);
  const du = surfacePoint(on, 1, 0, 0, UNIT).sub(origin);
  const dv = surfacePoint(on, 0, 1, 0, UNIT).sub(origin);
  return Math.sign(du.cross(dv).dot(surfaceNormal(on)));
}

function surfaceLimits(on: FleshSurface, bounds: RoomBounds): { p: number; q: [number, number] } {
  if (on === 'floor' || on === 'ceiling') return { p: bounds.innerX, q: [-bounds.innerZ, bounds.innerZ] };
  return { p: on === 'N' || on === 'S' ? bounds.innerX : bounds.innerZ, q: [0.02, bounds.height - 0.02] };
}

// Huecos de puertas y ventanas de cada muro, en coordenadas de superficie.
type Hole = { p0: number; p1: number; q0: number; q1: number };

function wallHoles(walls: RoomWallRun[], bounds: RoomBounds): Map<FleshSurface, Hole[]> {
  const holes = new Map<FleshSurface, Hole[]>();
  for (const run of walls) {
    const [sx, sz] = run.start;
    const [ex, ez] = run.end;
    const alongX = Math.abs(ez - sz) < 1e-6;
    const side: FleshSurface = alongX ? (sz < 0 ? 'N' : 'S') : (sx < 0 ? 'W' : 'E');
    const length = Math.hypot(ex - sx, ez - sz);
    const dir = alongX ? (ex - sx) / length : (ez - sz) / length;
    const origin = alongX ? sx : sz;
    for (const opening of run.openings ?? []) {
      const a = origin + dir * opening.offset;
      const b = origin + dir * (opening.offset + opening.width);
      const sill = opening.sill ?? 0;
      const list = holes.get(side) ?? [];
      list.push({
        p0: Math.min(a, b) - OPENING_MARGIN,
        p1: Math.max(a, b) + OPENING_MARGIN,
        q0: sill - OPENING_MARGIN,
        q1: Math.min(bounds.height, sill + opening.height + OPENING_MARGIN),
      });
      holes.set(side, list);
    }
  }
  return holes;
}

function seeded(seed: number): () => number {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

function shouldCollide(def: RoomFleshGrowth): boolean {
  if (def.collide !== undefined) return def.collide;
  if (def.on === 'ceiling' || (def.bulge ?? 0) < FLESH_COLLIDE_BULGE) return false;
  return def.on === 'floor' || def.at[1] - def.radius[1] < BODY_HEIGHT;
}

// Colisión de las masas que sobresalen (síncrona: la usa el pathfinding del stalker).
export function fleshColliders(defs: RoomFleshDef[], size: [number, number, number], thickness: number): Collider[] {
  const bounds = roomBounds(size, thickness);
  const colliders: Collider[] = [];
  for (const def of defs) {
    if (def.kind !== 'growth' || !shouldCollide(def)) continue;
    const [p, q] = def.at;
    const [ra, rb] = def.radius;
    const depth = (def.bulge ?? 0) * COLLIDER_SPAN;
    const along = { min: p - ra * COLLIDER_SPAN, max: p + ra * COLLIDER_SPAN };
    switch (def.on) {
      case 'floor':
        colliders.push({ minX: along.min, maxX: along.max, minZ: q - rb * COLLIDER_SPAN, maxZ: q + rb * COLLIDER_SPAN });
        break;
      case 'N':
        colliders.push({ minX: along.min, maxX: along.max, minZ: -bounds.innerZ, maxZ: -bounds.innerZ + depth });
        break;
      case 'S':
        colliders.push({ minX: along.min, maxX: along.max, minZ: bounds.innerZ - depth, maxZ: bounds.innerZ });
        break;
      case 'W':
        colliders.push({ minX: -bounds.innerX, maxX: -bounds.innerX + depth, minZ: along.min, maxZ: along.max });
        break;
      case 'E':
        colliders.push({ minX: bounds.innerX - depth, maxX: bounds.innerX, minZ: along.min, maxZ: along.max });
        break;
      case 'ceiling':
        break;
    }
  }
  return colliders;
}

function paint(geometry: THREE.BufferGeometry, shade: (index: number) => THREE.Color): void {
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) shade(i).toArray(colors, i * 3);
  geometry.setAttribute('a_color', new THREE.BufferAttribute(colors, 3));
}

// Cúpula de contorno lobulado con bultos; UV por longitud de arco radial para
// que la textura no se estire en los flancos de las masas altas.
function growthGeometry(def: RoomFleshGrowth, index: number, bounds: RoomBounds): THREE.BufferGeometry {
  const random = seeded(7919 + index * 104729);
  const [p, q] = def.at;
  const [ra, rb] = def.radius;
  const bulge = def.bulge ?? 0.06;
  const wall = def.on !== 'floor' && def.on !== 'ceiling';
  const rings = THREE.MathUtils.clamp(Math.round(Math.max(ra, rb) / 0.1), 5, 12);
  const segments = THREE.MathUtils.clamp(Math.round((Math.PI * (ra + rb)) / 0.12), 14, 36);
  const phase = Array.from({ length: 6 }, () => random() * Math.PI * 2);
  const lift = LIFT + (index % 5) * 0.0015;
  const uvOffset = [random() * 4, random() * 4];

  const positions: number[] = [];
  const uvs: number[] = [];
  const shades: number[] = [];
  const push = (point: THREE.Vector3, u: number, v: number, shade: number): void => {
    positions.push(point.x, point.y, point.z);
    uvs.push(u, v);
    shades.push(shade);
  };
  push(surfacePoint(def.on, p, q, lift + bulge * (1 + Math.sin(phase[4]) * 0.12), bounds), uvOffset[0], uvOffset[1], 1);
  const arc = new Float32Array(segments);
  const previous: THREE.Vector3[] = Array.from({ length: segments }, () => new THREE.Vector3(0, 0, lift + bulge));
  for (let r = 1; r <= rings; r += 1) {
    const t = r / rings;
    for (let s = 0; s < segments; s += 1) {
      const angle = (s / segments) * Math.PI * 2;
      const edge = 1 + 0.16 * Math.sin(angle * 3 + phase[0]) + 0.1 * Math.sin(angle * 5 + phase[1])
        + 0.05 * Math.sin(angle * 8 + phase[2]);
      const lump = 1 + 0.3 * t * Math.sin(angle * 4 + phase[3] + t * 5) + 0.16 * Math.sin(angle * 7 - t * 3 + phase[5]);
      const dome = (1 - t * t) ** 1.4;
      const h = lift + Math.max(0, bulge * dome * lump);
      let a = Math.cos(angle) * ra * t * edge;
      let b = Math.sin(angle) * rb * t * edge;
      // En los muros la carne cede hacia abajo, como si pesara.
      if (wall) b -= (h - lift) * 0.35;
      const local = new THREE.Vector3(a, b, h);
      arc[s] += local.distanceTo(previous[s]);
      previous[s].copy(local);
      a += p;
      b += q;
      push(surfacePoint(def.on, a, b, h, bounds),
        uvOffset[0] + (Math.cos(angle) * arc[s]) / TILE, uvOffset[1] + (Math.sin(angle) * arc[s]) / TILE,
        THREE.MathUtils.clamp(0.25 + 0.75 * (1 - t) + 0.25 * (lump - 1), 0, 1));
    }
  }

  const indices: number[] = [];
  const flip = windingSign(def.on) < 0;
  const tri = (i: number, j: number, k: number): void => {
    if (flip) indices.push(i, k, j);
    else indices.push(i, j, k);
  };
  const vertex = (r: number, s: number): number => 1 + (r - 1) * segments + (s % segments);
  for (let s = 0; s < segments; s += 1) tri(0, vertex(1, s), vertex(1, s + 1));
  for (let r = 1; r < rings; r += 1) {
    for (let s = 0; s < segments; s += 1) {
      tri(vertex(r, s), vertex(r + 1, s), vertex(r + 1, s + 1));
      tri(vertex(r, s), vertex(r + 1, s + 1), vertex(r, s + 1));
    }
  }

  let geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const color = new THREE.Color();
  paint(geometry, (i) => color.copy(EDGE_COLOR).lerp(CORE_COLOR, shades[i]));

  // Tumores medio hundidos en las masas grandes.
  if (bulge >= BREATH_BULGE) {
    const parts = [geometry];
    const count = 2 + Math.floor(random() * 3);
    for (let i = 0; i < count; i += 1) {
      const angle = random() * Math.PI * 2;
      const t = 0.2 + random() * 0.4;
      const size = Math.min(ra, rb) * (0.22 + random() * 0.2);
      const height = lift + bulge * (1 - t * t) ** 1.4 * 0.75;
      const nodule = new THREE.SphereGeometry(size, 9, 7);
      const noise = seeded(31 + index * 17 + i);
      const shift = Array.from({ length: 3 }, () => noise() * Math.PI * 2);
      const position = nodule.getAttribute('position');
      for (let v = 0; v < position.count; v += 1) {
        const x = position.getX(v);
        const y = position.getY(v);
        const z = position.getZ(v);
        const k = 1 + 0.16 * Math.sin(x * 23 + shift[0]) * Math.sin(y * 19 + shift[1]) + 0.1 * Math.sin(z * 29 + shift[2]);
        position.setXYZ(v, x * k, y * k * 0.85, z * k);
      }
      nodule.computeVertexNormals();
      const center = surfacePoint(def.on, p + Math.cos(angle) * ra * t, q + Math.sin(angle) * rb * t, height, bounds);
      nodule.translate(center.x, center.y, center.z);
      const shade = new THREE.Color().copy(EDGE_COLOR).lerp(CORE_COLOR, 0.65 + random() * 0.25);
      paint(nodule, () => shade);
      parts.push(nodule);
    }
    geometry = mergeGeometries(parts, false) ?? geometry;
  }
  return geometry;
}

// Tubo aplastado contra la superficie que se afina hacia la punta.
function veinGeometry(on: FleshSurface, points: Array<[number, number]>, radius: number,
  bounds: RoomBounds, holes: Hole[]): THREE.BufferGeometry | null {
  const limits = surfaceLimits(on, bounds);
  const path: THREE.Vector3[] = [];
  for (const [p, q] of points) {
    const cp = THREE.MathUtils.clamp(p, -limits.p, limits.p);
    const cq = THREE.MathUtils.clamp(q, limits.q[0], limits.q[1]);
    if (holes.some((hole) => cp > hole.p0 && cp < hole.p1 && cq > hole.q0 && cq < hole.q1)) break;
    path.push(surfacePoint(on, cp, cq, radius * 0.35, bounds));
  }
  if (path.length < 2) return null;
  const curve = new THREE.CatmullRomCurve3(path);
  const length = curve.getLength();
  const tubular = Math.max(4, Math.round(length / 0.12));
  const radial = 4;
  const geometry = new THREE.TubeGeometry(curve, tubular, radius, radial, false);
  const normal = surfaceNormal(on);
  const position = geometry.getAttribute('position');
  const offset = new THREE.Vector3();
  for (let i = 0; i <= tubular; i += 1) {
    const center = curve.getPointAt(i / tubular);
    const taper = 1 - 0.55 * (i / tubular) ** 2;
    for (let j = 0; j <= radial; j += 1) {
      const v = i * (radial + 1) + j;
      offset.fromBufferAttribute(position, v).sub(center).multiplyScalar(taper);
      offset.addScaledVector(normal, -offset.dot(normal) * 0.45);
      position.setXYZ(v, center.x + offset.x, center.y + offset.y, center.z + offset.z);
    }
  }
  geometry.computeVertexNormals();
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i += 1) uv.setXY(i, (uv.getX(i) * length) / TILE, uv.getY(i) * 0.3);
  const color = new THREE.Color().copy(EDGE_COLOR).multiplyScalar(0.8);
  paint(geometry, () => color);
  return geometry;
}

// Raíces que salen por debajo del borde de cada crecimiento y se ramifican.
function rootVeins(def: RoomFleshGrowth, index: number): RoomFleshVein[] {
  const random = seeded(4099 + index * 7727);
  const [p, q] = def.at;
  const [ra, rb] = def.radius;
  const bulge = def.bulge ?? 0.06;
  const count = def.roots ?? Math.round(3 + 4 * Math.max(ra, rb));
  const radius = THREE.MathUtils.clamp(0.012 + bulge * 0.07, 0.014, 0.04);
  const veins: RoomFleshVein[] = [];
  const grow = (startP: number, startQ: number, angle: number, length: number, width: number): Array<[number, number]> => {
    const points: Array<[number, number]> = [[startP, startQ]];
    let heading = angle;
    let [cp, cq] = [startP, startQ];
    const steps = Math.max(3, Math.round(length / 0.18));
    for (let i = 0; i < steps; i += 1) {
      heading += (random() - 0.5) * 0.9;
      cp += Math.cos(heading) * (length / steps);
      cq += Math.sin(heading) * (length / steps);
      points.push([cp, cq]);
    }
    veins.push({ kind: 'vein', on: def.on, points, radius: width });
    return points;
  };
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 + (random() - 0.5) * 0.6;
    const start: [number, number] = [p + Math.cos(angle) * ra * 0.7, q + Math.sin(angle) * rb * 0.7];
    const length = 0.35 + Math.max(ra, rb) * (0.5 + random() * 0.8);
    const points = grow(start[0], start[1], angle, length, radius * (0.75 + random() * 0.5));
    if (random() < 0.5) {
      const fork = points[Math.floor(points.length / 2)];
      grow(fork[0], fork[1], angle + (random() < 0.5 ? -0.9 : 0.9), length * 0.5, radius * 0.6);
    }
  }
  return veins;
}

export class FleshGrowth {
  readonly group = new THREE.Group();
  private readonly material: PsxMaterialHandle;
  private readonly breathing: Array<{ mesh: THREE.Mesh; axis: 'x' | 'y' | 'z'; phase: number }> = [];

  constructor(config: PsxConfig, private readonly atmosphere: Atmosphere | null, defs: RoomFleshDef[],
    shape: FleshRoomShape) {
    this.material = createPsxMaterial(config, curseFleshTexture(), atmosphere, { spec: 0.12, gloss: 36 });
    this.group.name = 'curse_flesh';
    const bounds = roomBounds(shape.size, shape.thickness, shape.relief);
    const holes = wallHoles(shape.walls, bounds);
    const flat: THREE.BufferGeometry[] = [];
    const veins: RoomFleshVein[] = [];
    const masses = new Map<FleshSurface, THREE.BufferGeometry[]>();
    defs.forEach((def, index) => {
      if (def.kind === 'vein') {
        veins.push(def);
        return;
      }
      veins.push(...rootVeins(def, index));
      const geometry = growthGeometry(def, index, bounds);
      if ((def.bulge ?? 0) < BREATH_BULGE) {
        flat.push(geometry);
        return;
      }
      masses.set(def.on, [...(masses.get(def.on) ?? []), geometry]);
    });
    [...masses].forEach(([on, parts], index) => {
      const merged = mergeGeometries(parts, false);
      if (!merged) throw new Error('No se pudieron fusionar las masas de carne');
      // Pivota en el plano de la superficie para hincharse hacia la sala.
      const base = surfacePoint(on, 0, 0, 0, { ...bounds, relief: FLAT });
      merged.translate(-base.x, -base.y, -base.z);
      const mesh = this.mesh(merged, `curse_flesh_mass_${on}`);
      mesh.position.copy(base);
      const normal = surfaceNormal(on);
      const axis = Math.abs(normal.x) > 0.5 ? 'x' : Math.abs(normal.y) > 0.5 ? 'y' : 'z';
      this.breathing.push({ mesh, axis, phase: index * 1.7 });
    });
    for (const vein of veins) {
      const geometry = veinGeometry(vein.on, vein.points, vein.radius ?? 0.025, bounds, holes.get(vein.on) ?? []);
      if (geometry) flat.push(geometry);
    }
    if (flat.length > 0) {
      const merged = mergeGeometries(flat, false);
      if (!merged) throw new Error('No se pudo fusionar la carne de la maldición');
      this.mesh(merged, 'curse_flesh_static');
    }
  }

  private mesh(geometry: THREE.BufferGeometry, name: string): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, this.material.material);
    mesh.name = name;
    // Como el ojo: no tapa la línea de visión de las interacciones.
    mesh.raycast = () => {};
    this.group.add(mesh);
    return mesh;
  }

  update(clock: number): void {
    for (const { mesh, axis, phase } of this.breathing) {
      const breath = Math.sin(clock * 0.9 + phase) * 0.5 + Math.sin(clock * 1.6 + phase * 2) * 0.5;
      mesh.scale[axis] = 1 + breath * 0.05;
    }
  }

  sync(config: PsxConfig): void {
    this.material.sync(config, this.atmosphere);
  }
}
