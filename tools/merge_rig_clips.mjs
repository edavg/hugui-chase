// Junta un GLB con esqueleto y los clips de otros GLB del mismo rig (mismos
// nodos en el mismo orden, como los que entrega Genex/Meshy por animación) y
// deja sólo la textura de color, reducida (JPEG: los atlas de Meshy son foto).
// Uso: node tools/merge_rig_clips.mjs <rig.glb> <salida.glb> <px> <Clip=anim.glb>...
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const [rigPath, outPath, sizeArg, ...clipArgs] = process.argv.slice(2);
const size = Number(sizeArg);
if (!rigPath || !outPath || !Number.isInteger(size) || clipArgs.length === 0) {
  console.error('Uso: node tools/merge_rig_clips.mjs <rig.glb> <salida.glb> <px> <Clip=anim.glb>...');
  process.exit(1);
}

function readGlb(path) {
  const data = readFileSync(path);
  if (data.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: no es un GLB`);
  const jsonLength = data.readUInt32LE(12);
  const json = JSON.parse(data.subarray(20, 20 + jsonLength).toString('utf8'));
  const binStart = 20 + jsonLength;
  const bin = binStart < data.length ? data.subarray(binStart + 8, binStart + 8 + data.readUInt32LE(binStart)) : Buffer.alloc(0);
  return { json, bin };
}

const pad4 = (n) => (n + 3) & ~3;
const chunks = [];
let offset = 0;
function pushView(bytes, extra = {}) {
  const view = { buffer: 0, byteOffset: offset, byteLength: bytes.length, ...extra };
  chunks.push(bytes, Buffer.alloc(pad4(bytes.length) - bytes.length));
  offset = pad4(offset + bytes.length);
  return view;
}
function viewBytes(glb, index) {
  const view = glb.json.bufferViews[index];
  return glb.bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
}

const rig = readGlb(rigPath);
const out = structuredClone(rig.json);
const material = out.materials[0];
const colorTexture = out.textures[material.pbrMetallicRoughness.baseColorTexture.index];
const colorImage = rig.json.images[colorTexture.source];
const colorJpeg = await sharp(viewBytes(rig, colorImage.bufferView)).resize(size, size).jpeg({ quality: 88 }).toBuffer();

// Vistas del rig sin las imágenes; la de color se sustituye por la reducida.
const imageViews = new Set(rig.json.images.map((image) => image.bufferView));
const viewMap = new Map();
out.bufferViews = [];
rig.json.bufferViews.forEach((view, index) => {
  if (imageViews.has(index)) return;
  const { buffer, byteOffset, byteLength, ...extra } = view;
  viewMap.set(index, out.bufferViews.push(pushView(viewBytes(rig, index), extra)) - 1);
});
for (const accessor of out.accessors) {
  if (accessor.bufferView !== undefined) accessor.bufferView = viewMap.get(accessor.bufferView);
}
out.images = [{ mimeType: 'image/jpeg', bufferView: out.bufferViews.push(pushView(colorJpeg)) - 1 }];
out.textures = [{ sampler: colorTexture.sampler, source: 0 }];
delete material.normalTexture;
delete material.pbrMetallicRoughness.metallicRoughnessTexture;
material.pbrMetallicRoughness.baseColorTexture = { index: 0 };

const nodeNames = rig.json.nodes.map((node) => node.name).join('|');
out.animations = [];
for (const arg of clipArgs) {
  const [name, path] = arg.split('=');
  const anim = readGlb(path);
  if (anim.json.nodes.map((node) => node.name).join('|') !== nodeNames) {
    throw new Error(`${path}: los nodos no coinciden con el rig`);
  }
  for (const clip of anim.json.animations) {
    const accessorMap = new Map();
    const copyAccessor = (index) => {
      if (!accessorMap.has(index)) {
        const accessor = { ...anim.json.accessors[index] };
        const { buffer, byteOffset, byteLength, ...extra } = anim.json.bufferViews[accessor.bufferView];
        accessor.bufferView = out.bufferViews.push(pushView(viewBytes(anim, accessor.bufferView), extra)) - 1;
        accessorMap.set(index, out.accessors.push(accessor) - 1);
      }
      return accessorMap.get(index);
    };
    out.animations.push({
      name: anim.json.animations.length > 1 ? `${name}_${clip.name}` : name,
      channels: clip.channels,
      samplers: clip.samplers.map((sampler) => ({
        ...sampler,
        input: copyAccessor(sampler.input),
        output: copyAccessor(sampler.output),
      })),
    });
  }
}

const bin = Buffer.concat(chunks);
out.buffers = [{ byteLength: bin.length }];
const json = Buffer.from(JSON.stringify(out));
const jsonPadded = Buffer.concat([json, Buffer.alloc(pad4(json.length) - json.length, 0x20)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + bin.length, 8);
const chunkHeader = (length, type) => {
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32LE(length, 0);
  buffer.writeUInt32LE(type, 4);
  return buffer;
};
writeFileSync(
  outPath,
  Buffer.concat([header, chunkHeader(jsonPadded.length, 0x4e4f534a), jsonPadded, chunkHeader(bin.length, 0x004e4942), bin]),
);
console.log(`${outPath}: ${(12 + 16 + jsonPadded.length + bin.length) / 1024 | 0} KB, clips ${out.animations.map((a) => a.name).join(', ')}`);
