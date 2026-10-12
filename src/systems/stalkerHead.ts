import * as THREE from 'three';
import { atlasTileOrigin, type HeadAtlas, type HeadFace } from './stalkerFace';

/**
 * Cabeza esculpida del stalker (sustituye al cubo).
 *
 * La malla es una superficie de revolución deformada (cráneo, mofletes,
 * mandíbula, barbilla adelantada, nariz y cuello que entra en el torso). La
 * textura NO se reparte por caras: se HORNEA en una UV cilíndrica proyectando
 * el despiece del usuario como lo haría un artista: frente desde -Z, perfiles
 * desde ±X, pelo desde arriba/atrás y cuello desde abajo, con mezcla suave
 * según la normal. El fondo gris del despiece se recorta para que no salga en
 * la piel. Resultado: la cara "abraza" la cabeza en vez de ser una pegatina.
 *
 * Unidades locales: la cabeza (coronilla→barbilla) mide HEAD_UNITS; el frente
 * mira a -Z (igual que el cubo anterior).
 */

export const HEAD_UNITS = 1.0;
const Y_TOP = 0.5;
const Y_CHIN = -0.5;
const Y_NECK_BOTTOM = -0.92;

const RINGS = 44;
const SEGMENTS = 48;
const BAKE_W = 512;
const BAKE_H = 512;

// Ancho de la proyección frontal en unidades (la baldosa del frente mide
// aspecto·alto) y fondo de la proyección lateral.
const SIDE_DEPTH = 1.02;

interface Section {
  y: number;
  rx: number;
  rzFront: number;
  rzBack: number;
  cz: number;
}

// Perfil de la cabeza de arriba abajo (radios en X, Z delante/detrás y
// desplazamiento del centro en Z; -Z es la cara).
const PROFILE: Section[] = [
  { y: 0.5, rx: 0.0, rzFront: 0.0, rzBack: 0.0, cz: 0.04 },
  { y: 0.47, rx: 0.2, rzFront: 0.2, rzBack: 0.22, cz: 0.04 },
  { y: 0.4, rx: 0.33, rzFront: 0.32, rzBack: 0.36, cz: 0.04 },
  { y: 0.28, rx: 0.42, rzFront: 0.4, rzBack: 0.44, cz: 0.03 },
  { y: 0.12, rx: 0.46, rzFront: 0.44, rzBack: 0.46, cz: 0.02 },
  { y: -0.02, rx: 0.47, rzFront: 0.46, rzBack: 0.44, cz: 0.01 },
  { y: -0.16, rx: 0.47, rzFront: 0.47, rzBack: 0.4, cz: 0.0 },
  { y: -0.28, rx: 0.44, rzFront: 0.46, rzBack: 0.34, cz: 0.0 },
  { y: -0.38, rx: 0.38, rzFront: 0.43, rzBack: 0.28, cz: 0.01 },
  { y: -0.46, rx: 0.3, rzFront: 0.38, rzBack: 0.24, cz: 0.03 },
  { y: -0.52, rx: 0.3, rzFront: 0.28, rzBack: 0.28, cz: 0.07 },
  { y: -0.6, rx: 0.31, rzFront: 0.25, rzBack: 0.29, cz: 0.08 },
  { y: -0.75, rx: 0.34, rzFront: 0.27, rzBack: 0.3, cz: 0.08 },
  { y: -0.92, rx: 0.5, rzFront: 0.38, rzBack: 0.38, cz: 0.08 },
];

function section(y: number): Section {
  if (y >= PROFILE[0].y) return PROFILE[0];
  for (let i = 0; i < PROFILE.length - 1; i += 1) {
    const a = PROFILE[i];
    const b = PROFILE[i + 1];
    if (y <= a.y && y >= b.y) {
      const raw = (a.y - y) / (a.y - b.y);
      const t = raw * raw * (3 - 2 * raw);
      // El casquete superior es elíptico (no lineal) para que la coronilla sea redonda.
      const cap = i === 0 ? Math.sqrt(Math.max(0, raw)) : t;
      return {
        y,
        rx: a.rx + (b.rx - a.rx) * cap,
        rzFront: a.rzFront + (b.rzFront - a.rzFront) * cap,
        rzBack: a.rzBack + (b.rzBack - a.rzBack) * cap,
        cz: a.cz + (b.cz - a.cz) * t,
      };
    }
  }
  return PROFILE[PROFILE.length - 1];
}

const gauss = (x: number, s: number): number => Math.exp(-(x * x) / (s * s));

// Punto de la superficie para un ángulo phi (0 = frente, +π/2 = +X) y altura y.
function surfacePoint(phi: number, y: number, out: THREE.Vector3): THREE.Vector3 {
  const sec = section(y);
  const front = Math.cos(phi);
  const rz = front >= 0 ? sec.rzFront : sec.rzBack;
  let x = Math.sin(phi) * sec.rx;
  let z = sec.cz - front * rz;
  // Nariz, pómulos y barbilla (relieve suave sobre el frente).
  const faceMask = Math.max(0, front) ** 2;
  const nose = 0.07 * gauss(phi, 0.16) * gauss(y + 0.1, 0.11);
  const brow = 0.025 * gauss(y - 0.04, 0.06) * gauss(phi, 0.7);
  const cheeks = 0.03 * gauss(y + 0.2, 0.1) * (gauss(phi - 0.75, 0.3) + gauss(phi + 0.75, 0.3));
  const chin = 0.03 * gauss(phi, 0.35) * gauss(y + 0.44, 0.06);
  const eyeSocket = -0.02 * gauss(y + 0.0, 0.05) * (gauss(phi - 0.32, 0.14) + gauss(phi + 0.32, 0.14));
  z -= faceMask * (nose + brow + cheeks + chin + eyeSocket);
  // Orejas: bulto lateral a la altura de los ojos.
  const ear = 0.035 * gauss(y + 0.06, 0.1) * (gauss(phi - 1.62, 0.12) + gauss(phi + 1.62, 0.12));
  x += Math.sign(Math.sin(phi)) * ear;
  return out.set(x, y, z);
}

interface TileSampler {
  sample: (face: HeadFace, u: number, v: number, out: Float32Array) => number;
}

function createSampler(atlas: HeadAtlas): TileSampler {
  const ctx = atlas.canvas.getContext('2d', { willReadFrequently: true });
  const width = atlas.canvas.width;
  const height = atlas.canvas.height;
  const data = ctx ? ctx.getImageData(0, 0, width, height).data : new Uint8ClampedArray(width * height * 4);
  const tile = atlas.tile;

  // Fondo del despiece: el color de las esquinas superiores del frente.
  const [fx, fy] = atlasTileOrigin('front', tile);
  const bg = [0, 0, 0];
  let count = 0;
  for (const [cx, cy] of [
    [fx + 2, fy + 2],
    [fx + tile - 8, fy + 2],
  ]) {
    for (let y = cy; y < cy + 6; y += 1) {
      for (let x = cx; x < cx + 6; x += 1) {
        const i = (y * width + x) * 4;
        bg[0] += data[i];
        bg[1] += data[i + 1];
        bg[2] += data[i + 2];
        count += 1;
      }
    }
  }
  bg[0] /= count;
  bg[1] /= count;
  bg[2] /= count;
  const bgChroma = Math.max(...bg) - Math.min(...bg);

  const texel = (x: number, y: number, c: number): number => data[(y * width + x) * 4 + c];

  return {
    sample(face, u, v, out) {
      const [ox, oy] = atlasTileOrigin(face, tile);
      const px = THREE.MathUtils.clamp(u, 0, 1) * (tile - 1);
      const py = (1 - THREE.MathUtils.clamp(v, 0, 1)) * (tile - 1);
      const x0 = Math.floor(px);
      const y0 = Math.floor(py);
      const x1 = Math.min(tile - 1, x0 + 1);
      const y1 = Math.min(tile - 1, y0 + 1);
      const tx = px - x0;
      const ty = py - y0;
      for (let c = 0; c < 3; c += 1) {
        const a = texel(ox + x0, oy + y0, c) * (1 - tx) + texel(ox + x1, oy + y0, c) * tx;
        const b = texel(ox + x0, oy + y1, c) * (1 - tx) + texel(ox + x1, oy + y1, c) * tx;
        out[c] = (a * (1 - ty) + b * ty) / 255;
      }
      if (face === 'top' || face === 'back' || face === 'bottom') {
        return 1;
      }
      // Recorte del fondo gris (no del pelo oscuro ni de la piel saturada).
      const dr = out[0] * 255 - bg[0];
      const dg = out[1] * 255 - bg[1];
      const db = out[2] * 255 - bg[2];
      const distance = Math.sqrt(dr * dr + dg * dg + db * db);
      const chroma = (Math.max(out[0], out[1], out[2]) - Math.min(out[0], out[1], out[2])) * 255;
      if (chroma > bgChroma + 30) {
        return 1;
      }
      return THREE.MathUtils.smoothstep(distance, 14, 34);
    },
  };
}

function bakeHeadTexture(atlas: HeadAtlas): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = BAKE_W;
  canvas.height = BAKE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('No se pudo crear el lienzo de la cabeza del stalker');
  }
  const image = ctx.createImageData(BAKE_W, BAKE_H);
  const sampler = createSampler(atlas);
  const frontWidth = (Y_TOP - Y_CHIN) * Math.min(1.35, Math.max(0.85, atlas.aspect.front));

  // Color medio del pelo como último recurso (zonas sin ninguna proyección válida).
  const hair = new Float32Array(3);
  const tmp = new Float32Array(3);
  let n = 0;
  for (let i = 0; i < 16; i += 1) {
    sampler.sample('top', (i % 4) / 4 + 0.12, Math.floor(i / 4) / 4 + 0.12, tmp);
    hair[0] += tmp[0];
    hair[1] += tmp[1];
    hair[2] += tmp[2];
    n += 1;
  }
  hair[0] /= n;
  hair[1] /= n;
  hair[2] /= n;

  const p = new THREE.Vector3();
  const pu = new THREE.Vector3();
  const pv = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const acc = new Float32Array(3);
  const color = new Float32Array(3);

  for (let row = 0; row < BAKE_H; row += 1) {
    const v = 1 - (row + 0.5) / BAKE_H;
    const y = Y_NECK_BOTTOM + (Y_TOP - Y_NECK_BOTTOM) * v;
    for (let col = 0; col < BAKE_W; col += 1) {
      const u = (col + 0.5) / BAKE_W;
      const phi = (u - 0.5) * Math.PI * 2;
      surfacePoint(phi, y, p);
      surfacePoint(phi + 0.01, y, pu).sub(p);
      surfacePoint(phi, y + 0.01, pv).sub(p);
      normal.crossVectors(pv, pu).normalize();
      if (normal.lengthSq() < 0.5) {
        normal.set(0, 1, 0);
      }
      // La normal apunta hacia fuera: comprobar contra el radio.
      if (normal.x * p.x + normal.z * (p.z - 0.04) + normal.y * (p.y + 0.1) < 0) {
        normal.negate();
      }

      acc[0] = acc[1] = acc[2] = 0;
      let total = 0;
      const add = (face: HeadFace, su: number, sv: number, weight: number): void => {
        if (weight <= 1e-4 || su < 0 || su > 1 || sv < 0 || sv > 1) return;
        const alpha = sampler.sample(face, su, sv, color);
        const w = weight * alpha;
        acc[0] += color[0] * w;
        acc[1] += color[1] * w;
        acc[2] += color[2] * w;
        total += w;
      };

      const headV = (y - Y_CHIN) / (Y_TOP - Y_CHIN);
      const neckBlend = THREE.MathUtils.smoothstep(y, Y_CHIN - 0.03, Y_CHIN + 0.06);
      if (neckBlend > 0) {
        // El frente manda en la cara; los perfiles sólo cubren mejillas/orejas
        // (si no, sus bocas y ojos aparecen "fantasma" en los mofletes).
        const facing = Math.max(0, -normal.z);
        const sideSuppress = 1 - 0.9 * THREE.MathUtils.smoothstep(facing, 0.35, 0.75);
        const crown = THREE.MathUtils.smoothstep(y, 0.24, 0.42);
        const frontFade = 1 - THREE.MathUtils.smoothstep(headV, 0.86, 0.97);
        add('front', 0.5 - p.x / frontWidth, headV, facing ** 2.5 * 2.2 * frontFade * neckBlend);
        add('right', 0.5 - p.z / SIDE_DEPTH, headV, Math.max(0, normal.x) ** 6 * sideSuppress * (1 - crown * 0.7) * neckBlend);
        add('left', 0.5 + p.z / SIDE_DEPTH, headV, Math.max(0, -normal.x) ** 6 * sideSuppress * (1 - crown * 0.7) * neckBlend);
        add('top', 0.5 + p.x / frontWidth, 0.5 - p.z / SIDE_DEPTH, (Math.max(0, normal.y) ** 1.5 * 0.8 + crown * 2.5) * neckBlend);
        add('back', 0.5 + p.x / frontWidth, 0.25 + headV * 0.75, Math.max(0, normal.z) ** 2 * 1.2 * neckBlend);
      }
      if (neckBlend < 1) {
        // Cuello: la baldosa inferior envuelve el cuello en espejo (sin vetas
        // estiradas en la nuca) y se oscurece hacia el torso.
        const nv = THREE.MathUtils.clamp((y - Y_NECK_BOTTOM) / (Y_CHIN - Y_NECK_BOTTOM), 0, 1);
        const around = 0.5 - 0.44 * Math.sin(phi);
        add('bottom', around, 0.2 + nv * 0.75, (1 - neckBlend) * 2);
      }

      let r: number;
      let g: number;
      let b: number;
      if (total < 0.02) {
        const keep = total / 0.02;
        r = acc[0] / Math.max(total, 1e-6) * keep + hair[0] * (1 - keep);
        g = acc[1] / Math.max(total, 1e-6) * keep + hair[1] * (1 - keep);
        b = acc[2] / Math.max(total, 1e-6) * keep + hair[2] * (1 - keep);
      } else {
        r = acc[0] / total;
        g = acc[1] / total;
        b = acc[2] / total;
      }
      // El cuello se oscurece hacia el torso para fundirse con el cuerpo.
      const shade = 0.55 + 0.45 * THREE.MathUtils.smoothstep(y, Y_NECK_BOTTOM + 0.05, Y_CHIN - 0.05);
      const i = (row * BAKE_W + col) * 4;
      image.data[i] = Math.round(THREE.MathUtils.clamp(r * shade, 0, 1) * 255);
      image.data[i + 1] = Math.round(THREE.MathUtils.clamp(g * shade, 0, 1) * 255);
      image.data[i + 2] = Math.round(THREE.MathUtils.clamp(b * shade, 0, 1) * 255);
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function buildHeadGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const p = new THREE.Vector3();
  for (let ring = 0; ring <= RINGS; ring += 1) {
    const v = 1 - ring / RINGS;
    // Más anillos en la cara: distribución con algo de densidad central.
    const y = Y_NECK_BOTTOM + (Y_TOP - Y_NECK_BOTTOM) * v;
    for (let seg = 0; seg <= SEGMENTS; seg += 1) {
      const u = seg / SEGMENTS;
      const phi = (u - 0.5) * Math.PI * 2;
      surfacePoint(phi, y, p);
      positions.push(p.x, p.y, p.z);
      uvs.push(u, v);
    }
  }
  const stride = SEGMENTS + 1;
  for (let ring = 0; ring < RINGS; ring += 1) {
    for (let seg = 0; seg < SEGMENTS; seg += 1) {
      const a = ring * stride + seg;
      const b = a + stride;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Las normales del borde de costura (u=0 / u=1, en la nuca) se promedian.
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
  for (let ring = 0; ring <= RINGS; ring += 1) {
    const a = ring * stride;
    const b = a + SEGMENTS;
    const nx = (normal.getX(a) + normal.getX(b)) / 2;
    const ny = (normal.getY(a) + normal.getY(b)) / 2;
    const nz = (normal.getZ(a) + normal.getZ(b)) / 2;
    const len = Math.hypot(nx, ny, nz) || 1;
    normal.setXYZ(a, nx / len, ny / len, nz / len);
    normal.setXYZ(b, nx / len, ny / len, nz / len);
  }
  // Coronilla: todos los vértices del primer anillo comparten la normal +Y.
  for (let seg = 0; seg <= SEGMENTS; seg += 1) {
    normal.setXYZ(seg, 0, 1, 0);
  }
  normal.needsUpdate = true;
  geometry.computeBoundingSphere();
  return geometry;
}

export interface HeadMesh {
  geometry: THREE.BufferGeometry;
  texture: THREE.Texture;
}

const cache = new WeakMap<HeadAtlas, HeadMesh>();

export function buildHeadMesh(atlas: HeadAtlas): HeadMesh {
  const cached = cache.get(atlas);
  if (cached) {
    return cached;
  }
  const mesh = { geometry: buildHeadGeometry(), texture: bakeHeadTexture(atlas) };
  cache.set(atlas, mesh);
  return mesh;
}

// Vista plana del horneado (para el laboratorio / depuración).
export function headBakeCanvas(atlas: HeadAtlas): HTMLCanvasElement | null {
  const texture = buildHeadMesh(atlas).texture as THREE.CanvasTexture;
  return texture.image as HTMLCanvasElement;
}
