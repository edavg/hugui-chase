import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { PsxConfig } from './config';
import { createPsxMaterial, type PsxMaterialHandle } from './psxMaterial';
import type { HeadAtlas } from './stalkerFace';
import { buildHeadMesh } from './stalkerHead';
import { addVertexColors } from './vertexColors';
import { applyFiltering } from './textures';

export const STALKER_MODEL_URL = 'assets/models/stalker/monster.glb';
export const MODEL_HEAD_SIZE = 0.5;

const HEAD_BONE_HINTS = ['head'];
const HEAD_CUT_WEIGHT = 0.5;
const HEAD_OVERSIZE = 1.15;
const HEAD_SIZE_RATIO = 0.16;
const HEAD_CENTER_RATIO = 0.42;
const MODEL_ROTATION_Y = Math.PI;
// Las texturas ya no se decodifican como sRGB: el cuerpo sale más claro que
// antes, así que el sombreado de vértice baja (piel oscura, enfermiza).
const MODEL_SHADE = 0.46;
// La cabeza esculpida mide 1 unidad (coronilla→barbilla); el cubo medía 0.5.
const HEAD_GEOMETRY_SCALE = 0.6;
const HEAD_DROP = -0.04;

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

  // La escala del rig se aplica ANTES de medir la cabeza: así la medida, la
  // posición y el tamaño del cubo están todos en el mismo espacio (mundo).
  root.rotation.y = MODEL_ROTATION_Y;
  root.position.y = -bounds.min.y * scale;
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);

  const head = measureHead(headBone, bounds.max.y * scale, config.enemy.height);
  const removedTriangles = stripHeadGeometry(mesh, headBone);
  const { group: headCube, material: headMaterial } = buildHead(config, atlas);
  // La cadena de huesos del FBX trae una escala espuria con shear, así que en vez
  // de descomponerla se compone la matriz local exacta: hueso⁻¹ · mundo deseado.
  const desired = new THREE.Matrix4().compose(
    head.center,
    new THREE.Quaternion(),
    new THREE.Vector3().setScalar(head.size * HEAD_OVERSIZE),
  );
  headCube.matrixAutoUpdate = false;
  headCube.matrix.copy(new THREE.Matrix4().copy(headBone.matrixWorld).invert().multiply(desired));
  headCube.matrix.decompose(headCube.position, headCube.quaternion, headCube.scale);
  headBone.add(headCube);
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

function measureHead(headBone: THREE.Bone, modelTop: number, modelHeight: number): HeadMeasure {
  const anchor = new THREE.Vector3().setFromMatrixPosition(headBone.matrixWorld);
  const size = Math.max(0.12, modelHeight * HEAD_SIZE_RATIO);
  return {
    center: new THREE.Vector3(anchor.x, modelTop - size * HEAD_CENTER_RATIO, anchor.z),
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
    // Basta con que UN vértice sea de la cabeza: así no quedan picos del
    // muñón del cuello atravesando la cabeza esculpida (mejillas, papada).
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

function buildHead(config: PsxConfig, atlas: HeadAtlas): { group: THREE.Group; material: PsxMaterialHandle } {
  const group = new THREE.Group();
  group.name = 'stalker_head';
  const head = buildHeadMesh(atlas);
  const geometry = head.geometry.clone();
  geometry.scale(HEAD_GEOMETRY_SCALE, HEAD_GEOMETRY_SCALE, HEAD_GEOMETRY_SCALE);
  geometry.translate(0, -HEAD_DROP, 0);
  addVertexColors(geometry, 0.95);
  const material = createPsxMaterial(config, head.texture, null, { spec: 0.28, gloss: 22 });
  const mesh = new THREE.Mesh(geometry, material.material);
  mesh.frustumCulled = false;
  group.add(mesh);
  return { group, material };
}
