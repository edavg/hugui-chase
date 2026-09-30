// Inspecciona un GLB: nombres de nodos, bbox en mundo (m), materiales e imagenes.
// Uso: node tools/inspect_glb.mjs <archivo.glb>
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('Uso: node tools/inspect_glb.mjs <archivo.glb>');
  process.exit(1);
}

const buffer = readFileSync(path);
if (buffer.readUInt32LE(0) !== 0x46546c67) {
  console.error('No es un GLB');
  process.exit(1);
}
const jsonLength = buffer.readUInt32LE(12);
const gltf = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      for (let k = 0; k < 4; k += 1) {
        out[row * 4 + col] += a[k * 4 + col] * b[row * 4 + k];
      }
    }
  }
  return out;
}

function trsToMatrix(node) {
  if (node.matrix) {
    return node.matrix;
  }
  const t = node.translation ?? [0, 0, 0];
  const r = node.rotation ?? [0, 0, 0, 1];
  const s = node.scale ?? [1, 1, 1];
  const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

function transformPoint(matrix, point) {
  const [x, y, z] = point;
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}

function meshBounds(meshIndex) {
  const mesh = gltf.meshes[meshIndex];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const primitive of mesh.primitives) {
    const accessor = gltf.accessors[primitive.attributes.POSITION];
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], accessor.min[axis]);
      max[axis] = Math.max(max[axis], accessor.max[axis]);
    }
  }
  return { min, max };
}

function walk(index, parentMatrix, depth) {
  const node = gltf.nodes[index];
  const matrix = multiply(parentMatrix, trsToMatrix(node));
  if (node.mesh !== undefined) {
    const { min, max } = meshBounds(node.mesh);
    const corners = [];
    for (const cx of [min[0], max[0]]) {
      for (const cy of [min[1], max[1]]) {
        for (const cz of [min[2], max[2]]) {
          corners.push(transformPoint(matrix, [cx, cy, cz]));
        }
      }
    }
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const corner of corners) {
      for (let axis = 0; axis < 3; axis += 1) {
        lo[axis] = Math.min(lo[axis], corner[axis]);
        hi[axis] = Math.max(hi[axis], corner[axis]);
      }
    }
    const size = hi.map((value, axis) => (value - lo[axis]).toFixed(3)).join(' x ');
    const name = node.name ?? `node_${index}`;
    const indent = '  '.repeat(depth);
    console.log(
      `${indent}${name}: bbox min [${lo.map((v) => v.toFixed(3)).join(', ')}] size ${size} m`,
    );
  }
  for (const child of node.children ?? []) {
    walk(child, matrix, depth + 1);
  }
}

console.log(`Archivo: ${path}`);
console.log('Escena(s):', (gltf.scenes ?? []).map((scene) => (scene.nodes ?? []).join(',')).join(' | '));
console.log('Imagenes:', gltf.images?.length ?? 0, '(embedded:', (gltf.images ?? []).filter((image) => image.bufferView !== undefined).length, ')');
console.log('Materiales con baseColorTexture:');
for (const material of gltf.materials ?? []) {
  const has = Boolean(material.pbrMetallicRoughness?.baseColorTexture);
  console.log(`  ${material.name ?? '?'}: ${has ? 'textura' : 'sin textura'}`);
}
console.log('Nodos:');
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
for (const root of gltf.scenes?.[0]?.nodes ?? []) {
  walk(root, identity, 1);
}
