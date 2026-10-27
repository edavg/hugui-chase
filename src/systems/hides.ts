import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Collider } from './roomBuilder';

// Escondites: roperos, taquillas y confesionarios donde el jugador se mete con
// E y espía por la rejilla de la puerta. El mueble tiene colisión normal; el
// jugador queda "dentro" del collider mientras está escondido (no se mueve).

export type HideKind = 'wardrobe' | 'locker' | 'confessional';

export interface RoomHide {
  id: string;
  kind: HideKind;
  // Centro del mueble en XZ (apoyado contra un muro).
  position: [number, number];
  // Hacia dónde mira el frente (convención de los spawns: 0 = hacia -Z,
  // 90 = hacia -X, 180 = hacia +Z, 270 = hacia +X). Múltiplos de 90.
  yaw: number;
}

export interface HideSpot {
  id: string;
  kind: HideKind;
  x: number;
  z: number;
  // Yaw de cámara (radianes) al mirar hacia fuera por la rejilla.
  yaw: number;
  width: number;
  height: number;
  depth: number;
  // Ojo del jugador escondido y punto libre delante de las puertas (por donde
  // sale el jugador y donde se planta el stalker a revisar).
  eyeX: number;
  eyeZ: number;
  frontX: number;
  frontZ: number;
  collider: Collider;
}

export interface HideHandle {
  spot: HideSpot;
  group: THREE.Group;
  leaves: Array<{ pivot: THREE.Group; sign: number }>;
}

const SIZES: Record<HideKind, [width: number, height: number, depth: number]> = {
  wardrobe: [1.0, 2.0, 0.6],
  locker: [0.8, 1.95, 0.55],
  confessional: [1.0, 2.3, 1.0],
};

const FRONT_CLEARANCE = 0.55;
const PANEL = 0.03;
// Banda de lamas a la altura de los ojos (1.6 m): se ve el exterior entre ellas.
const VENT_BOTTOM = 1.42;
const VENT_TOP = 1.8;
const SLAT_HEIGHT = 0.02;
const SLAT_GAP = 0.04;
const OPEN_ANGLE = 1.9;

export function computeHideSpot(def: RoomHide): HideSpot {
  const [width, height, depth] = SIZES[def.kind] ?? SIZES.wardrobe;
  const yaw = THREE.MathUtils.degToRad(def.yaw);
  const forwardX = -Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);
  const [x, z] = def.position;
  const cos = Math.abs(Math.cos(yaw));
  const sin = Math.abs(Math.sin(yaw));
  const halfX = (width / 2) * cos + (depth / 2) * sin;
  const halfZ = (width / 2) * sin + (depth / 2) * cos;
  return {
    id: def.id,
    kind: def.kind,
    x,
    z,
    yaw,
    width,
    height,
    depth,
    // Ojo en el centro del mueble: la rejilla queda a media distancia y se ve
    // la sala entre las lamas en vez de una pared de madera pegada a la cara.
    eyeX: x,
    eyeZ: z,
    frontX: x + forwardX * (depth / 2 + FRONT_CLEARANCE),
    frontZ: z + forwardZ * (depth / 2 + FRONT_CLEARANCE),
    collider: { minX: x - halfX, maxX: x + halfX, minZ: z - halfZ, maxZ: z + halfZ },
  };
}

// Mueble en coordenadas locales: frente hacia -Z (igual que la cámara con yaw
// 0), así `group.rotation.y = spot.yaw` lo orienta como el jugador escondido.
export function buildHideFurniture(spot: HideSpot, material: THREE.Material): HideHandle {
  const { width: w, height: h, depth: d } = spot;
  const shade = spot.kind === 'locker' ? 0.6 : 0.7;
  const body = merged([
    part(w, h, PANEL, 0, h / 2, d / 2 - PANEL / 2, shade * 0.8),
    part(PANEL, h, d, -w / 2 + PANEL / 2, h / 2, 0, shade),
    part(PANEL, h, d, w / 2 - PANEL / 2, h / 2, 0, shade),
    part(w, 0.04, d, 0, h - 0.02, 0, shade),
    part(w, 0.08, d, 0, 0.04, 0, shade * 0.7),
    ...(spot.kind === 'locker' ? [] : [part(w + 0.06, 0.06, d + 0.04, 0, h + 0.03, 0, shade * 0.9)]),
    // Barra interior: de dentro se ve algo más que el fondo liso.
    ...(spot.kind === 'wardrobe' ? [part(w - 0.08, 0.025, 0.025, 0, h - 0.3, 0, 0.5)] : []),
  ]);
  const group = new THREE.Group();
  group.name = `hide_${spot.id}`;
  group.position.set(spot.x, 0, spot.z);
  group.rotation.y = spot.yaw;
  group.add(new THREE.Mesh(body, material));

  const leaves: HideHandle['leaves'] = [];
  const leafWidth = w / 2 - PANEL;
  for (const sign of [-1, 1]) {
    // Cada hoja gira sobre el canto exterior; la geometría se extiende hacia el centro.
    const pivot = new THREE.Group();
    pivot.position.set(sign * (w / 2 - PANEL), 0, -d / 2 + PANEL / 2);
    const dir = -sign;
    const leafParts = [
      part(leafWidth, VENT_BOTTOM - 0.08, PANEL, dir * leafWidth / 2, 0.08 + (VENT_BOTTOM - 0.08) / 2, 0, shade),
      part(leafWidth, h - 0.04 - VENT_TOP, PANEL, dir * leafWidth / 2, VENT_TOP + (h - 0.04 - VENT_TOP) / 2, 0, shade),
      // Montantes laterales de la rejilla.
      part(0.05, VENT_TOP - VENT_BOTTOM, PANEL, dir * 0.025, (VENT_BOTTOM + VENT_TOP) / 2, 0, shade),
      part(0.02, VENT_TOP - VENT_BOTTOM, PANEL, dir * (leafWidth - 0.01), (VENT_BOTTOM + VENT_TOP) / 2, 0, shade),
      // Pomo.
      part(0.03, 0.08, 0.04, dir * (leafWidth - 0.06), 1.1, -PANEL, 0.9),
    ];
    for (let y = VENT_BOTTOM + SLAT_GAP; y + SLAT_HEIGHT <= VENT_TOP - SLAT_GAP / 2; y += SLAT_HEIGHT + SLAT_GAP) {
      leafParts.push(part(leafWidth - 0.07, SLAT_HEIGHT, PANEL * 0.6, dir * leafWidth / 2, y + SLAT_HEIGHT / 2, 0, shade * 0.85));
    }
    pivot.add(new THREE.Mesh(merged(leafParts), material));
    group.add(pivot);
    leaves.push({ pivot, sign: -sign });
  }
  return { spot, group, leaves };
}

// 0 cerrado, 1 abierto (las hojas se abren hacia fuera, al frente).
export function setHideOpen(handle: HideHandle, amount: number): void {
  for (const leaf of handle.leaves) {
    leaf.pivot.rotation.y = leaf.sign * OPEN_ANGLE * THREE.MathUtils.clamp(amount, 0, 1);
  }
}

function part(width: number, height: number, depth: number, x: number, y: number, z: number, shade: number): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  // Textura a escala real (1 repetición por metro) en vez de estirada por cara.
  const uv = geometry.getAttribute('uv');
  const faceScale: Array<[number, number]> = [
    [depth, height], [depth, height], [width, depth], [width, depth], [width, height], [width, height],
  ];
  for (let i = 0; i < uv.count; i += 1) {
    const [su, sv] = faceScale[Math.floor(i / 4)];
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }
  geometry.translate(x, y, z);
  const colors = new Float32Array(geometry.getAttribute('position').count * 3);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i += 1) {
    // Sombra de contacto en la base, como el resto de muebles.
    const value = shade * (0.7 + 0.3 * THREE.MathUtils.clamp(position.getY(i) / 0.45, 0, 1));
    colors[i * 3] = value;
    colors[i * 3 + 1] = value;
    colors[i * 3 + 2] = value;
  }
  geometry.setAttribute('a_color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const geometry = mergeGeometries(parts, false);
  if (!geometry) {
    throw new Error('No se pudo construir el escondite');
  }
  return geometry;
}
