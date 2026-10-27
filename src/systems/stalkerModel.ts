import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { PsxConfig } from './config';
import { createPsxMaterial, type PsxMaterialHandle } from './psxMaterial';
import type { HeadAtlas } from './stalkerFace';
import { buildHeadMesh, HEAD_UNITS } from './stalkerHead';
import { addVertexColors } from './vertexColors';
import { applyFiltering } from './textures';

export const STALKER_MODEL_URL = 'assets/models/stalker/monster.glb';
export const MODEL_HEAD_SIZE = 0.5;

const HEAD_BONE_HINTS = ['head'];
const HEAD_CUT_WEIGHT = 0.1;
const HEAD_MEASURE_WEIGHT = 0.95;
const HEAD_OVERSIZE = 1.12;
const HEAD_SIZE_RATIO = 0.16;
const MODEL_ROTATION_Y = Math.PI;
// Las texturas ya no se decodifican como sRGB: el cuerpo sale más claro que
// antes, así que el sombreado de vértice baja (piel oscura, enfermiza).
const MODEL_SHADE = 0.46;

export interface StalkerRig {
  root: THREE.Group;
  mesh: THREE.SkinnedMesh;
  headBone: THREE.Bone;
  headCube: THREE.Group;
  material: PsxMaterialHandle;
  headMaterial: PsxMaterialHandle;
  mixer: THREE.AnimationMixer;
  clips: Map<string, THREE.AnimationClip>;
  scale: number;
  meshHeight: number;
  removedTriangles: number;
}

export async function loadStalkerRig(
  config: PsxConfig,
  atlas: HeadAtlas,
): Promise<StalkerRig> {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}${STALKER_MODEL_URL}`);
  const root = gltf.scene as THREE.Group;
  const mesh = findSkinnedMesh(root);
  if (!mesh) {
    throw new Error('El GLB del stalker no tiene ninguna malla con esqueleto');
  }
  const headBone = findBone(root, HEAD_BONE_HINTS);
  if (!headBone) {
    throw new Error('El GLB del stalker no tiene un hueso de cabeza reconocible');
  }

  const source = mesh.material as THREE.MeshStandardMaterial;
  if (!source.map) {
    throw new Error('El GLB del stalker no trae textura');
  }
  const texture = source.map;
  applyFiltering(texture, { repeat: false });
  texture.colorSpace = THREE.NoColorSpace;

  const material = createPsxMaterial(config, texture, null, { spec: 0.35, gloss: 26 });
  mesh.material = material.material;
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  addVertexColors(mesh.geometry, MODEL_SHADE);
  source.dispose();

  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const meshHeight = Math.max(0.1, bounds.max.y - bounds.min.y);
  const scale = config.enemy.height / meshHeight;

  // Medir el modelo ya escalado: el anclaje y la geometría quedan en mundo.
  root.rotation.y = MODEL_ROTATION_Y;
  root.position.y = -bounds.min.y * scale;
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);

  const head = measureHead(mesh, headBone, config.enemy.height);
  const removedTriangles = stripHeadGeometry(mesh, headBone);
  const desired = new THREE.Matrix4().compose(
    head.center,
    new THREE.Quaternion(),
    new THREE.Vector3().setScalar(head.size / HEAD_UNITS),
  );
  const neckBone = findBone(root, ['neck']) ?? headBone;
  const chestBone = findBone(root, ['chest']) ?? neckBone;
  const { group: headCube, material: headMaterial } = buildHead(
    config, atlas, [headBone, neckBone, chestBone], desired,
  );
  // Conservar la matriz exacta del FBX (puede contener shear). El cráneo sigue
  // al hueso de cabeza; el cuello mezcla cabeza/cuello/pecho y queda unido al
  // torso incluso cuando la animación echa la cabeza hacia atrás.
  headCube.matrixAutoUpdate = false;
  headCube.matrix.copy(new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(desired));
  headCube.matrix.decompose(headCube.position, headCube.quaternion, headCube.scale);
  root.add(headCube);
  root.updateMatrixWorld(true);

  const clips = new Map<string, THREE.AnimationClip>();
  for (const clip of gltf.animations) {
    const name = clip.name.split('|').pop() ?? clip.name;
    clips.set(name, clip);
  }

  const mixer = new THREE.AnimationMixer(root);
  console.info(
    `[M5] Modelo del stalker: ${meshHeight.toFixed(2)} m → escala ${scale.toFixed(3)} | cabeza ${head.size.toFixed(2)} m (${head.vertices} vértices) | ${removedTriangles} triángulos sustituidos | clips: ${[...clips.keys()].join(', ')}`,
  );

  return { root, mesh, headBone, headCube, material, headMaterial, mixer, clips, scale, meshHeight, removedTriangles };
}

function findSkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh | null {
  if ((root as THREE.SkinnedMesh).isSkinnedMesh) {
    return root as THREE.SkinnedMesh;
  }
  for (const child of root.children) {
    const found = findSkinnedMesh(child);
    if (found) {
      return found;
    }
  }
  return null;
}

function findBone(root: THREE.Object3D, hints: string[]): THREE.Bone | null {
  for (const child of root.children) {
    if ((child as THREE.Bone).isBone && hints.includes(child.name.toLowerCase())) {
      return child as THREE.Bone;
    }
    const found = findBone(child, hints);
    if (found) {
      return found;
    }
  }
  return null;
}

interface HeadMeasure {
  center: THREE.Vector3;
  size: number;
  vertices: number;
}

function measureHead(mesh: THREE.SkinnedMesh, headBone: THREE.Bone, modelHeight: number): HeadMeasure {
  const anchor = new THREE.Vector3().setFromMatrixPosition(headBone.matrixWorld);
  const bounds = new THREE.Box3();
  const boneIndex = mesh.skeleton.bones.indexOf(headBone);
  const skinIndex = mesh.geometry.getAttribute('skinIndex') as IndexAttribute | undefined;
  const skinWeight = mesh.geometry.getAttribute('skinWeight') as IndexAttribute | undefined;
  const point = new THREE.Vector3();
  let vertices = 0;
  if (boneIndex >= 0 && skinIndex && skinWeight) {
    mesh.skeleton.update();
    for (let vertex = 0; vertex < skinIndex.count; vertex += 1) {
      // El cráneo tiene pesos casi completos; los pesos menores son del cuello.
      if (headWeight(skinIndex, skinWeight, vertex, boneIndex) < HEAD_MEASURE_WEIGHT) continue;
      mesh.getVertexPosition(vertex, point).applyMatrix4(mesh.matrixWorld);
      bounds.expandByPoint(point);
      vertices += 1;
    }
  }
  if (!bounds.isEmpty()) {
    const extent = bounds.getSize(new THREE.Vector3());
    const size = Math.max(extent.x, extent.y, extent.z) * HEAD_OVERSIZE;
    const center = bounds.getCenter(new THREE.Vector3());
    // Mantener la coronilla original y centrar sobre el cráneo, no sobre el
    // pivote del hueso, que está detrás, en la unión con el cuello.
    center.y = bounds.max.y - size * 0.5;
    return { center, size, vertices };
  }
  const size = Math.max(0.12, modelHeight * HEAD_SIZE_RATIO);
  return {
    center: new THREE.Vector3(anchor.x, anchor.y + size * 0.3, anchor.z),
    size,
    vertices: 0,
  };
}

type IndexAttribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

function headWeight(
  skinIndex: IndexAttribute,
  skinWeight: IndexAttribute,
  vertex: number,
  boneIndex: number,
): number {
  let total = 0;
  for (let slot = 0; slot < 4; slot += 1) {
    if (skinIndex.getComponent(vertex, slot) === boneIndex) {
      total += skinWeight.getComponent(vertex, slot);
    }
  }
  return total;
}

function stripHeadGeometry(mesh: THREE.SkinnedMesh, headBone: THREE.Bone): number {
  const geometry = mesh.geometry;
  const boneIndex = mesh.skeleton.bones.indexOf(headBone);
  const index = geometry.getIndex();
  const skinIndex = geometry.getAttribute('skinIndex') as IndexAttribute | undefined;
  const skinWeight = geometry.getAttribute('skinWeight') as IndexAttribute | undefined;
  if (boneIndex < 0 || !index || !skinIndex || !skinWeight) {
    return 0;
  }

  const source = index.array;
  const kept = new Uint32Array(source.length);
  let written = 0;
  for (let i = 0; i < source.length; i += 3) {
    const a = source[i];
    const b = source[i + 1];
    const c = source[i + 2];
    // Quitar también la transición del cuello: sus vértices mezclan pesos de
    // cabeza/cuello y de lo contrario atraviesan la mandíbula al animarse.
    if (
      headWeight(skinIndex, skinWeight, a, boneIndex) >= HEAD_CUT_WEIGHT ||
      headWeight(skinIndex, skinWeight, b, boneIndex) >= HEAD_CUT_WEIGHT ||
      headWeight(skinIndex, skinWeight, c, boneIndex) >= HEAD_CUT_WEIGHT
    ) {
      continue;
    }
    kept[written] = a;
    kept[written + 1] = b;
    kept[written + 2] = c;
    written += 3;
  }
  const removed = (source.length - written) / 3;
  geometry.setIndex(new THREE.BufferAttribute(kept.subarray(0, written), 1));
  return removed;
}

function buildHead(
  config: PsxConfig,
  atlas: HeadAtlas,
  bones: THREE.Bone[],
  bindMatrix: THREE.Matrix4,
): { group: THREE.Group; material: PsxMaterialHandle } {
  const group = new THREE.Group();
  group.name = 'stalker_head';
  const head = buildHeadMesh(atlas);
  const geometry = head.geometry.clone();
  const position = geometry.getAttribute('position');
  const skinIndex = new Uint16Array(position.count * 4);
  const skinWeight = new Float32Array(position.count * 4);
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const y = position.getY(vertex) / HEAD_UNITS;
    const headWeight = THREE.MathUtils.smoothstep(y, -0.78, -0.48);
    const chestWeight = 1 - THREE.MathUtils.smoothstep(y, -0.92, -0.7);
    const i = vertex * 4;
    skinIndex.set([0, 1, 2, 0], i);
    skinWeight.set([headWeight, 1 - headWeight - chestWeight, chestWeight, 0], i);
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  addVertexColors(geometry, 0.95);
  const material = createPsxMaterial(config, head.texture, null, { spec: 0.28, gloss: 22 });
  const mesh = new THREE.SkinnedMesh(geometry, material.material);
  mesh.bind(new THREE.Skeleton(bones), bindMatrix);
  mesh.frustumCulled = false;
  group.add(mesh);
  return { group, material };
}
