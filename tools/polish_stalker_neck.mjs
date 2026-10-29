// Separa las islas de piel y tela del cuello sin modificar la camisa original.
import fs from 'node:fs';
import sharp from 'sharp';

const path = process.argv[2];
const backup = process.argv[3];
if (!path || !backup) throw new Error('Uso: polish_stalker_neck.mjs <modelo.glb> <respaldo.glb>');
const bytes = fs.readFileSync(path);
const jsonLength = bytes.readUInt32LE(12);
const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength));
const bin = bytes.subarray(28 + jsonLength);
const widthOf = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function readAccessor(index) {
  const a = gltf.accessors[index], view = gltf.bufferViews[a.bufferView];
  const size = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
  const method = { 5121: 'readUInt8', 5123: 'readUInt16LE', 5125: 'readUInt32LE', 5126: 'readFloatLE' }[a.componentType];
  const width = widthOf[a.type];
  return Array.from({ length: a.count * width }, (_, i) => bin[method]((view.byteOffset ?? 0) + (a.byteOffset ?? 0) + Math.floor(i / width) * (view.byteStride ?? width * size) + i % width * size));
}
function imageBuffer(textureIndex) {
  const image = gltf.images[gltf.textures[textureIndex].source];
  const view = gltf.bufferViews[image.bufferView];
  return bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
}
const bodyNode = gltf.nodes.find((node) => node.name === 'char1');
const neckNode = gltf.nodes.find((node) => node.name === 'stalker_neck_and_clavicle');
if (!bodyNode || !neckNode) throw new Error('Faltan las mallas de cuerpo y cuello');
const body = gltf.meshes[bodyNode.mesh].primitives[0];
const neck = gltf.meshes[neckNode.mesh].primitives[0];
for (const attribute of ['POSITION', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0']) {
  if (JSON.stringify(readAccessor(body.attributes[attribute])) !== JSON.stringify(readAccessor(neck.attributes[attribute]))) throw new Error(`El cuello y el cuerpo no comparten ${attribute}`);
}
const bodyMaterial = gltf.materials[body.material];
const neckMaterial = gltf.materials[neck.material];
const bodyTexture = bodyMaterial.pbrMetallicRoughness.baseColorTexture.index;
const decoded = await sharp(imageBuffer(bodyTexture)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height } = decoded.info;
const original = decoded.data;
const data = Buffer.from(original);
const skinStats = await sharp(imageBuffer(neckMaterial.pbrMetallicRoughness.baseColorTexture.index)).stats();
const skin = neckMaterial.extras?.skinToneRGB ?? skinStats.channels.slice(0, 3).map((channel) => channel.mean);
const uv = readAccessor(neck.attributes.TEXCOORD_0);
const indices = readAccessor(neck.indices);
const bodyIndices = readAccessor(body.indices);
const skinIndices = [];
const mask = new Uint8Array(width * height);
const texel = (u, v) => {
  const x = Math.max(0, Math.min(width - 1, Math.round(u * (width - 1))));
  const y = Math.max(0, Math.min(height - 1, Math.round(v * (height - 1))));
  const p = (y * width + x) * 4;
  return [original[p], original[p + 1], original[p + 2]];
};
const isSkin = (rgb) => Math.max(...rgb) - Math.min(...rgb) <= 7 && rgb.reduce((a, b) => a + b) / 3 >= 85 && rgb.reduce((a, b) => a + b) / 3 <= 155;
const probes = [[1/3,1/3,1/3], [.6,.2,.2], [.2,.6,.2], [.2,.2,.6], [.45,.45,.1], [.45,.1,.45], [.1,.45,.45]];
let movedTriangles = 0;
for (let i = 0; i < indices.length; i += 3) {
  const tri = indices.slice(i, i + 3);
  const points = tri.map((index) => [uv[index * 2], uv[index * 2 + 1]]);
  const neutral = probes.filter((weights) => isSkin(texel(
    points.reduce((sum, point, j) => sum + point[0] * weights[j], 0),
    points.reduce((sum, point, j) => sum + point[1] * weights[j], 0),
  ))).length;
  if (neutral < 5) { bodyIndices.push(...tri); movedTriangles++; continue; }
  skinIndices.push(...tri);
  const p = points.map(([u, v]) => [u * (width - 1), v * (height - 1)]);
  const minX = Math.max(0, Math.floor(Math.min(...p.map((point) => point[0]))));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(...p.map((point) => point[0]))));
  const minY = Math.max(0, Math.floor(Math.min(...p.map((point) => point[1]))));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(...p.map((point) => point[1]))));
  const [a, b, c] = p;
  const denom = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(denom) < 1e-8) continue;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const wa = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / denom;
    const wb = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / denom;
    if (wa >= -0.01 && wb >= -0.01 && wa + wb <= 1.01) mask[y * width + x] = 1;
  }
}
if (!skinIndices.length) throw new Error('La máscara no encontró piel del cuello');
let paintedPixels = 0;
for (let i = 0; i < mask.length; i++) {
  if (!mask[i]) continue;
  const rgb = Array.from(original.subarray(i * 4, i * 4 + 3));
  if (!isSkin(rgb)) continue;
  const shade = rgb.reduce((a, b) => a + b) / (3 * 128);
  for (let channel = 0; channel < 3; channel++) data[i * 4 + channel] = Math.min(255, skin[channel] * shade);
  paintedPixels++;
}
const png = await sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
const chunks = [bin];
let offset = bin.length;
const pad4 = (n) => (n + 3) & ~3;
function pushView(buffer) {
  if (pad4(offset) !== offset) { chunks.push(Buffer.alloc(pad4(offset) - offset)); offset = pad4(offset); }
  const index = gltf.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buffer.length }) - 1;
  chunks.push(buffer);
  offset += buffer.length;
  return index;
}
function pushIndices(array) {
  const buffer = Buffer.alloc(array.length * 4);
  array.forEach((value, i) => buffer.writeUInt32LE(value, i * 4));
  return gltf.accessors.push({ bufferView: pushView(buffer), componentType: 5125, count: array.length, type: 'SCALAR', min: [Math.min(...array)], max: [Math.max(...array)] }) - 1;
}
body.indices = pushIndices(bodyIndices);
neck.indices = pushIndices(skinIndices);
const imageIndex = gltf.images.push({ bufferView: pushView(png), mimeType: 'image/png', name: 'NeckSkinWithOriginalClothing' }) - 1;
const textureIndex = gltf.textures.push({ source: imageIndex, sampler: gltf.textures[bodyTexture].sampler }) - 1;
neckMaterial.pbrMetallicRoughness.baseColorTexture.index = textureIndex;
neckMaterial.extras = { ...neckMaterial.extras, skinToneRGB: skin, clothingIslandsRestored: true };
if (pad4(offset) !== offset) chunks.push(Buffer.alloc(pad4(offset) - offset));
const finalBin = Buffer.concat(chunks);
gltf.buffers = [{ byteLength: finalBin.length }];
const json = Buffer.from(JSON.stringify(gltf));
const paddedJson = Buffer.concat([json, Buffer.alloc(pad4(json.length) - json.length, 0x20)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + paddedJson.length + finalBin.length, 8);
const chunkHeader = (n, type) => { const buffer = Buffer.alloc(8); buffer.writeUInt32LE(n); buffer.writeUInt32LE(type, 4); return buffer; };
if (!fs.existsSync(backup)) fs.writeFileSync(backup, bytes, { flag: 'wx' });
fs.writeFileSync(path, Buffer.concat([header, chunkHeader(paddedJson.length, 0x4e4f534a), paddedJson, chunkHeader(finalBin.length, 0x004e4942), finalBin]));
console.log(JSON.stringify({ path, clothingTrianglesRestored: movedTriangles, neckSkinTriangles: skinIndices.length / 3, paintedPixels, bodyTextureUnchanged: true }));
