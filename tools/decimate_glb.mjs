// Reduce triángulos de un GLB (para que el mobiliario quepa en el presupuesto PSX).
// Reescribe el BIN con la geometría simplificada; materiales/texturas quedan igual.
// Uso: node tools/decimate_glb.mjs <modelo.glb> <trisObjetivo> [--write]
// Sin --write solo informa (dry run).
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { SimplifyModifier } from 'three/examples/jsm/modifiers/SimplifyModifier.js';

const [glbPath, targetArg, writeFlag] = process.argv.slice(2);
const targetTris = Number(targetArg);
if (!glbPath || !Number.isFinite(targetTris)) {
  console.error('Uso: node tools/decimate_glb.mjs <modelo.glb> <trisObjetivo> [--write]');
  process.exit(1);
}
const write = writeFlag === '--write';

const buffer = readFileSync(glbPath);
if (buffer.readUInt32LE(0) !== 0x46546c67) {
  console.error('No es un GLB');
  process.exit(1);
}
const jsonLength = buffer.readUInt32LE(12);
const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
const binOffset = 20 + jsonLength;
const hasBin = binOffset + 8 <= buffer.length && buffer.readUInt32LE(binOffset + 4) === 0x004e4942;
const bin = hasBin
  ? buffer.subarray(binOffset + 8, binOffset + 8 + buffer.readUInt32LE(binOffset))
  : Buffer.alloc(0);

if ((json.skins ?? []).length > 0 || (json.animations ?? []).length > 0) {
  console.error('El GLB tiene skin/animaciones: este decimador no lo soporta');
  process.exit(1);
}

const COMPONENTS = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
};
const NUM_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

function readAccessor(index) {
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor.bufferView];
  const Type = COMPONENTS[accessor.componentType];
  const components = NUM_COMPONENTS[accessor.type];
  const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride ?? BYTES[accessor.componentType] * components;
  const count = accessor.count;
  const bytes = new Uint8Array(count * components * BYTES[accessor.componentType]);
  for (let i = 0; i < count; i += 1) {
    for (let c = 0; c < components; c += 1) {
      const from = offset + i * stride + c * BYTES[accessor.componentType];
      const to = (i * components + c) * BYTES[accessor.componentType];
      for (let b = 0; b < BYTES[accessor.componentType]; b += 1) {
        bytes[to + b] = bin[from + b];
      }
    }
  }
  return new Type(bytes.buffer);
}

const chunks = [];
let byteCursor = 0;

function addBufferView(typedArray) {
  const bytes = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
  const padding = (4 - (byteCursor % 4)) % 4;
  if (padding > 0) {
    chunks.push(Buffer.alloc(padding, 0));
    byteCursor += padding;
  }
  const viewIndex = json.bufferViews.push({ buffer: 0, byteOffset: byteCursor, byteLength: bytes.length }) - 1;
  chunks.push(bytes);
  byteCursor += bytes.length;
  return viewIndex;
}

function addAccessor(typedArray, type, componentType, minMax = false) {
  const view = addBufferView(typedArray);
  const components = NUM_COMPONENTS[type];
  const accessor = {
    bufferView: view,
    componentType,
    count: typedArray.length / components,
    type,
  };
  if (minMax) {
    const min = new Array(components).fill(Infinity);
    const max = new Array(components).fill(-Infinity);
    for (let i = 0; i < typedArray.length; i += components) {
      for (let c = 0; c < components; c += 1) {
        min[c] = Math.min(min[c], typedArray[i + c]);
        max[c] = Math.max(max[c], typedArray[i + c]);
      }
    }
    accessor.min = min;
    accessor.max = max;
  }
  return json.accessors.push(accessor) - 1;
}

const jobs = [];
for (const mesh of json.meshes ?? []) {
  for (const primitive of mesh.primitives) {
    jobs.push({
      mesh,
      primitive,
      position: readAccessor(primitive.attributes.POSITION),
      normal:
        primitive.attributes.NORMAL !== undefined ? readAccessor(primitive.attributes.NORMAL) : null,
      uv:
        primitive.attributes.TEXCOORD_0 !== undefined
          ? readAccessor(primitive.attributes.TEXCOORD_0)
          : null,
      indices: primitive.indices !== undefined ? readAccessor(primitive.indices) : null,
    });
  }
}

json.accessors = [];
json.bufferViews = [];
json.buffers = [{ byteLength: 0 }];

const totalTris = jobs.reduce((total, job) => {
  const count = job.indices ? job.indices.length : job.position.length / 3;
  return total + count / 3;
}, 0);
const report = [];
for (const { mesh, primitive, position, normal, uv, indices } of jobs) {
  {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    if (normal) {
      geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    }
    if (uv) {
      geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    if (indices) {
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    }

    const before = geometry.index
      ? geometry.index.count / 3
      : geometry.attributes.position.count / 3;
    const primitiveTarget = Math.max(3, Math.floor((targetTris * before) / totalTris));
    let simplified = geometry;
    let removes = Math.max(
      0,
      Math.ceil(geometry.attributes.position.count * (1 - (primitiveTarget / before) * 1.15)),
    );
    for (let attempt = 0; attempt < 3 && removes > 0; attempt += 1) {
      simplified = await new SimplifyModifier().modify(geometry, removes);
      const tris = simplified.index.count / 3;
      if (tris <= primitiveTarget * 1.35) {
        break;
      }
      removes = Math.round(removes * 1.35);
    }
    simplified.computeVertexNormals();

    const outPosition = new Float32Array(simplified.attributes.position.array);
    const outNormal = new Float32Array(simplified.attributes.normal.array);
    primitive.attributes = { POSITION: addAccessor(outPosition, 'VEC3', 5126, true) };
    primitive.attributes.NORMAL = addAccessor(outNormal, 'VEC3', 5126);
    if (uv) {
      const outUv = new Float32Array(simplified.attributes.uv.array);
      primitive.attributes.TEXCOORD_0 = addAccessor(outUv, 'VEC2', 5126);
    } else if (simplified.attributes.uv) {
      const outUv = new Float32Array(simplified.attributes.uv.array);
      primitive.attributes.TEXCOORD_0 = addAccessor(outUv, 'VEC2', 5126);
    }
    const outIndices = new Uint32Array(simplified.index.array);
    primitive.indices = addAccessor(outIndices, 'SCALAR', 5125);
    report.push(
      `${mesh.name ?? 'mesh'}: ${Math.round(before)} → ${Math.round(simplified.index.count / 3)} tris`,
    );
  }
}

const binFinal = Buffer.concat(chunks);
json.buffers[0].byteLength = binFinal.length;

console.log(report.join('\n'));
console.log(`BIN: ${bin.length} → ${binFinal.length} bytes`);

if (!write) {
  console.log('(dry run; añade --write para guardar)');
  process.exit(0);
}

const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
const jsonPad = (4 - (jsonBuffer.length % 4)) % 4;
const jsonChunk = Buffer.concat([jsonBuffer, Buffer.alloc(jsonPad, 0x20)]);
const binPad = (4 - (binFinal.length % 4)) % 4;
const binPadded = Buffer.concat([binFinal, Buffer.alloc(binPad, 0)]);
const total = 12 + 8 + jsonChunk.length + 8 + binPadded.length;
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(total, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(jsonChunk.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(binPadded.length, 0);
binHeader.writeUInt32LE(0x004e4942, 4);
writeFileSync(glbPath, Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binPadded]));
console.log(`OK ${glbPath}: ${total} bytes`);
