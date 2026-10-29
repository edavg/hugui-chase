// Adapta el barrido izquierdo de Genex al GLB aprobado, conservando sus mallas.
// Uso: node tools/replace_stalker_attack.mjs <clip.glb> <modelo.glb> <respaldo.glb>
import fs from 'node:fs';
import * as THREE from 'three';

const [sourcePath, targetPath, backupPath] = process.argv.slice(2);
if (!sourcePath || !targetPath || !backupPath) throw new Error('Faltan clip, modelo o respaldo');
function read(path) {
  const bytes = fs.readFileSync(path);
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error(`GLB inválido: ${path}`);
  const size = bytes.readUInt32LE(12);
  return { json: JSON.parse(bytes.subarray(20, 20 + size)), bin: bytes.subarray(28 + size), bytes };
}
const source = read(sourcePath);
const target = read(targetPath);
const widths = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 };
function values(glb, index) {
  const a = glb.json.accessors[index], view = glb.json.bufferViews[a.bufferView];
  if (a.componentType !== 5126 || a.sparse) throw new Error('Se requiere un accessor FLOAT sin sparse');
  const width = widths[a.type], result = new Float32Array(a.count * width);
  const offset = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const stride = view.byteStride ?? width * 4;
  for (let i = 0; i < a.count; i++) for (let c = 0; c < width; c++) result[i * width + c] = glb.bin.readFloatLE(offset + i * stride + c * 4);
  return result;
}
const sourceClip = source.json.animations?.[0];
const baselineClip = target.json.animations?.find((a) => a.name === 'Idle_Watchful');
if (!sourceClip || !baselineClip) throw new Error('Falta la animación fuente o el reposo');
const targetNodes = new Map(target.json.nodes.map((node, i) => [node.name, i]));
const baseline = new Map();
for (const channel of baselineClip.channels) {
  const name = target.json.nodes[channel.target.node].name;
  const sampler = baselineClip.samplers[channel.sampler];
  baseline.set(`${name}:${channel.target.path}`, values(target, sampler.output));
}

// La mano más adelantada respecto a la pelvis marca el contacto del barrido.
const objects = source.json.nodes.map((node, i) => {
  const object = new THREE.Object3D();
  object.name = node.name ?? `node_${i}`;
  if (node.matrix) new THREE.Matrix4().fromArray(node.matrix).decompose(object.position, object.quaternion, object.scale);
  else {
    if (node.translation) object.position.fromArray(node.translation);
    if (node.rotation) object.quaternion.fromArray(node.rotation);
    if (node.scale) object.scale.fromArray(node.scale);
  }
  return object;
});
const children = new Set();
source.json.nodes.forEach((node, i) => (node.children ?? []).forEach((child) => { objects[i].add(objects[child]); children.add(child); }));
const root = new THREE.Group();
objects.forEach((object, i) => { if (!children.has(i)) root.add(object); });
const tracks = sourceClip.channels.map((channel) => {
  const sampler = sourceClip.samplers[channel.sampler];
  if (sampler.interpolation === 'CUBICSPLINE') throw new Error('El clip requiere interpolación cúbica');
  const property = { rotation: 'quaternion', translation: 'position', scale: 'scale' }[channel.target.path];
  const Track = channel.target.path === 'rotation' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
  return new Track(`${objects[channel.target.node].uuid}.${property}`, values(source, sampler.input), values(source, sampler.output));
});
const sampleClip = new THREE.AnimationClip('measure', -1, tracks);
const mixer = new THREE.AnimationMixer(root);
const action = mixer.clipAction(sampleClip).setLoop(THREE.LoopOnce, 1).play();
action.clampWhenFinished = true;
const hand = objects.find((object) => object.name === 'LeftHand');
const hips = objects.find((object) => object.name === 'Hips');
if (!hand || !hips) throw new Error('El clip no contiene mano izquierda y pelvis');
const handPosition = new THREE.Vector3(), hipsPosition = new THREE.Vector3();
const head = objects.find((object) => object.name === 'Head');
const front = objects.find((object) => object.name === 'headfront');
let correctionAngle = 0;
if (head && front) {
  mixer.setTime(sampleClip.duration * 0.45);
  root.updateMatrixWorld(true);
  const forward = front.getWorldPosition(new THREE.Vector3()).sub(head.getWorldPosition(new THREE.Vector3()));
  correctionAngle = -Math.atan2(forward.x, forward.z);
  root.rotation.y = correctionAngle;
}
const correction = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), correctionAngle);
let sourceImpact = sampleClip.duration * 0.45, bestReach = -Infinity;
for (let time = sampleClip.duration * 0.15; time <= sampleClip.duration * 0.8; time += 1 / 120) {
  mixer.setTime(time);
  root.updateMatrixWorld(true);
  hand.getWorldPosition(handPosition);
  hips.getWorldPosition(hipsPosition);
  const relative = handPosition.sub(hipsPosition);
  const reach = relative.z - Math.abs(relative.x) * 0.12;
  if (reach > bestReach) { bestReach = reach; sourceImpact = time; }
}
const impactSeconds = 1.2, duration = 2.6;
function retime(time) {
  const preparation = sourceImpact * 0.55;
  if (time <= preparation) return 0.65 + time / preparation * 0.4;
  if (time <= sourceImpact) return 1.05 + (time - preparation) / (sourceImpact - preparation) * 0.15;
  return impactSeconds + (time - sourceImpact) / (sampleClip.duration - sourceImpact) * 0.95;
}

const out = structuredClone(target.json);
const chunks = [target.bin];
let offset = target.bin.length;
const pad4 = (n) => (n + 3) & ~3;
function accessor(array, type, isTime = false) {
  const padding = pad4(offset) - offset;
  if (padding) { chunks.push(Buffer.alloc(padding)); offset += padding; }
  const bytes = Buffer.alloc(array.length * 4);
  array.forEach((value, i) => bytes.writeFloatLE(value, i * 4));
  const view = out.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length }) - 1;
  chunks.push(bytes);
  offset += bytes.length;
  const entry = { bufferView: view, componentType: 5126, count: array.length / widths[type], type };
  if (isTime) { entry.min = [array[0]]; entry.max = [array.at(-1)]; }
  return out.accessors.push(entry) - 1;
}
const attack = {
  name: 'Attack_Lunge', channels: [], samplers: [],
  extras: { action: 'heavy_left_swipe', sourceActionId: 193, impactSeconds, durationSeconds: duration, rootMotion: 'in-place', headingCorrectionRadians: correctionAngle },
};
const q = new THREE.Quaternion(), neutral = new THREE.Quaternion();
for (const channel of sourceClip.channels) {
  const name = source.json.nodes[channel.target.node].name;
  const node = targetNodes.get(name);
  if (node === undefined) throw new Error(`Falta el hueso ${name} en el modelo aprobado`);
  const sampler = sourceClip.samplers[channel.sampler];
  const input = values(source, sampler.input), output = values(source, sampler.output);
  const type = source.json.accessors[sampler.output].type, width = widths[type];
  const base = Array.from((baseline.get(`${name}:${channel.target.path}`) ?? output).subarray(0, width));
  if (name === 'Hips' && channel.target.path === 'rotation') base.splice(0, 4, ...(target.json.nodes[node].rotation ?? [0, 0, 0, 1]));
  const times = [0, ...Array.from(input, retime), duration];
  const result = [...base];
  for (let i = 0; i < input.length; i++) {
    const sample = Array.from(output.subarray(i * width, (i + 1) * width));
    if (/^Right(Shoulder|Arm|ForeArm|Hand)$/.test(name) && channel.target.path === 'rotation') {
      neutral.fromArray(base);
      q.fromArray(sample);
      neutral.slerp(q, 0.16).toArray(sample);
    }
    if (name === 'Hips' && channel.target.path === 'translation') {
      sample[0] = base[0];
      sample[2] = base[2];
      sample[1] = base[1] + (sample[1] - output[1]) * 0.45;
    }
    if (name === 'Hips' && channel.target.path === 'rotation') q.fromArray(sample).premultiply(correction).toArray(sample);
    result.push(...sample);
  }
  result.push(...base);
  const samplerIndex = attack.samplers.push({ input: accessor(times, 'SCALAR', true), output: accessor(result, type), interpolation: 'LINEAR' }) - 1;
  attack.channels.push({ sampler: samplerIndex, target: { node, path: channel.target.path } });
}
const previousIndex = out.animations.findIndex((clip) => clip.name === 'Attack_Lunge');
if (previousIndex < 0) throw new Error('Falta el ataque anterior');
out.animations[previousIndex] = attack;
out.buffers = [{ byteLength: pad4(offset) }];
if (pad4(offset) > offset) chunks.push(Buffer.alloc(pad4(offset) - offset));
const bin = Buffer.concat(chunks);
const json = Buffer.from(JSON.stringify(out));
const paddedJson = Buffer.concat([json, Buffer.alloc(pad4(json.length) - json.length, 0x20)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(28 + paddedJson.length + bin.length, 8);
const chunkHeader = (size, type) => { const data = Buffer.alloc(8); data.writeUInt32LE(size); data.writeUInt32LE(type, 4); return data; };
if (!fs.existsSync(backupPath)) fs.writeFileSync(backupPath, target.bytes, { flag: 'wx' });
const final = Buffer.concat([header, chunkHeader(paddedJson.length, 0x4e4f534a), paddedJson, chunkHeader(bin.length, 0x004e4942), bin]);
fs.writeFileSync(targetPath, final);
console.log(JSON.stringify({ target: targetPath, sourceImpactSeconds: sourceImpact, impactSeconds, duration, correctionAngle, channels: attack.channels.length, bytes: final.length }));
