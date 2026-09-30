// Sustituye texturas de un GLB (FBX2glTF no resuelve las rutas Windows de estos packs).
// Uso: node tools/patch_glb.mjs <modelo.glb> <spec.json>
//
// El spec admite:
//   "materials": { "NombreMaterial": "ruta/textura.png", ... }   // por nombre de material
//   "nodes": [ { "match": "PrefijoDelNodo", "texture": "ruta.png" }, ... ]  // por nodo (substring,
//              "*" como último comodín; gana la primera regla)
// Las rutas son relativas al directorio desde el que se ejecuta el comando.
import { readFileSync, writeFileSync } from 'node:fs';

const [glbPath, specPath] = process.argv.slice(2);
if (!glbPath || !specPath) {
  console.error('Uso: node tools/patch_glb.mjs <modelo.glb> <spec.json>');
  process.exit(1);
}

const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

function dataUri(file) {
  const extension = file.split('.').pop().toLowerCase();
  const mime = MIME[extension] ?? 'image/png';
  return `data:${mime};base64,${readFileSync(file).toString('base64')}`;
}

const buffer = readFileSync(glbPath);
if (buffer.readUInt32LE(0) !== 0x46546c67) {
  console.error('No es un GLB');
  process.exit(1);
}
const jsonLength = buffer.readUInt32LE(12);
const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
const binOffset = 20 + jsonLength;
const hasBin = binOffset + 8 <= buffer.length && buffer.readUInt32LE(binOffset + 4) === 0x004e4942;
const binChunk = hasBin
  ? buffer.subarray(binOffset + 8, binOffset + 8 + buffer.readUInt32LE(binOffset))
  : Buffer.alloc(0);

json.images ??= [];
json.textures ??= [];
json.materials ??= [];
const textureCache = new Map();

function textureFor(file) {
  if (textureCache.has(file)) {
    return textureCache.get(file);
  }
  const imageIndex = json.images.length;
  json.images.push({ uri: dataUri(file), name: file.split('/').pop() });
  const textureIndex = json.textures.length;
  json.textures.push({ source: imageIndex });
  textureCache.set(file, textureIndex);
  return textureIndex;
}

let patched = 0;
for (const material of json.materials) {
  const file = spec.materials?.[material.name];
  if (!file) continue;
  material.pbrMetallicRoughness ??= {};
  material.pbrMetallicRoughness.baseColorTexture = { index: textureFor(file) };
  patched += 1;
}

if (spec.nodes?.length) {
  const cloneCache = new Map();
  for (const node of json.nodes ?? []) {
    if (node.mesh === undefined) continue;
    const rule = spec.nodes.find((entry) => entry.match === '*' || (node.name ?? '').includes(entry.match));
    if (!rule) continue;
    for (const primitive of json.meshes[node.mesh].primitives) {
      const key = `${primitive.material}|${rule.texture}`;
      if (!cloneCache.has(key)) {
        const clone = primitive.material === undefined
          ? { name: `${node.name}_${patched}`, pbrMetallicRoughness: {} }
          : JSON.parse(JSON.stringify(json.materials[primitive.material]));
        clone.pbrMetallicRoughness ??= {};
        clone.pbrMetallicRoughness.baseColorTexture = { index: textureFor(rule.texture) };
        clone.name = `${clone.name ?? 'material'}_${patched}`;
        json.materials.push(clone);
        cloneCache.set(key, json.materials.length - 1);
        patched += 1;
      }
      primitive.material = cloneCache.get(key);
    }
  }
}

const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
const jsonPad = (4 - (jsonBuffer.length % 4)) % 4;
const jsonChunk = Buffer.concat([jsonBuffer, Buffer.alloc(jsonPad, 0x20)]);
const binPad = (4 - (binChunk.length % 4)) % 4;
const binFinal = Buffer.concat([binChunk, Buffer.alloc(binPad, 0)]);

const total = 12 + 8 + jsonChunk.length + (binFinal.length > 0 ? 8 + binFinal.length : 0);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(total, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(jsonChunk.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4);
const parts = [header, jsonHeader, jsonChunk];
if (binFinal.length > 0) {
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binFinal.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  parts.push(binHeader, binFinal);
}
writeFileSync(glbPath, Buffer.concat(parts));
console.log(`OK ${glbPath}: ${patched} texturas aplicadas, ${total} bytes`);
