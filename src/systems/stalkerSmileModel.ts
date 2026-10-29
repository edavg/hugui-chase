import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { PsxConfig } from './config';
import { createPsxMaterial, type PsxMaterialHandle } from './psxMaterial';
import type { StalkerRig } from './stalkerModel';
import { applyFiltering } from './textures';
import { addVertexColors } from './vertexColors';

export const STALKER_SMILE_MODEL_URL = 'assets/models/stalker/genex-smile/stalker-smile.glb';

// Este GLB ya incluye cabeza, cuello y clavículas. Las tres mallas conservan
// sus esqueletos y texturas; no necesita el recorte del modelo anterior.
export async function loadStalkerSmileRig(config: PsxConfig): Promise<StalkerRig> {
  const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}${STALKER_SMILE_MODEL_URL}`);
  const root = gltf.scene;
  const meshes: THREE.SkinnedMesh[] = [];
  root.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) meshes.push(node);
  });
  const mesh = meshes.find((node) => node.name === 'char1') ?? meshes[0];
  const headBone = meshes.flatMap((node) => node.skeleton.bones).find((bone) => bone.name.toLowerCase() === 'head');
  const headCube = root.getObjectByName('stalker_head') as THREE.Group | undefined;
  if (!mesh || !headBone || !headCube) {
    throw new Error('El stalker Genex no contiene el cuerpo y la cabeza esperados');
  }
  const headMesh = headCube.children.find((node) => node instanceof THREE.SkinnedMesh) as THREE.SkinnedMesh | undefined;
  if (!headMesh) throw new Error('Falta la malla de la cara del stalker Genex');

  const handles = new Map<THREE.SkinnedMesh, PsxMaterialHandle>();
  for (const part of meshes) {
    const source = part.material;
    if (!(source instanceof THREE.MeshStandardMaterial) || !source.map) {
      throw new Error(`Falta la textura de ${part.name || 'la cabeza'} del stalker Genex`);
    }
    const texture = source.map;
    applyFiltering(texture, { repeat: false });
    texture.colorSpace = THREE.NoColorSpace;
    const handle = createPsxMaterial(config, texture, null, { spec: 0.12, gloss: 22 });
    part.material = handle.material;
    part.castShadow = false;
    part.frustumCulled = false;
    addVertexColors(part.geometry, part === mesh ? 0.8 : 0.95);
    handles.set(part, handle);
    source.dispose();
  }
  // La exportación aprobada ya tiene altura y apoyo de pies definitivos.
  // Sus cajas GLTF conservan las unidades de la malla previa al skinning;
  // volver a escalarlas desde esas cajas agrandaría el personaje 20,5 veces.
  const meshHeight = 2.05;
  const scale = config.enemy.height / meshHeight;
  root.scale.multiplyScalar(scale);
  root.updateMatrixWorld(true);
  // Mantener los puntos de medida que usa el laboratorio del modelo anterior.
  for (const [alias, name] of [['footL', 'LeftFoot'], ['footR', 'RightFoot'], ['toeL', 'LeftToeBase'], ['toeR', 'RightToeBase']]) {
    const bone = root.getObjectByName(name);
    if (!bone || root.getObjectByName(alias)) continue;
    const marker = new THREE.Object3D();
    marker.name = alias;
    bone.add(marker);
  }

  const bodyMaterial = handles.get(mesh)!;
  const material: PsxMaterialHandle = {
    material: bodyMaterial.material,
    sync(next, atmosphere) {
      for (const handle of handles.values()) handle.sync(next, atmosphere);
    },
  };
  const headMaterial = handles.get(headMesh)!;
  const clips = new Map(gltf.animations.map((clip) => [clip.name, clip]));
  for (const [name, source] of Object.entries(config.enemy.clips ?? {})) {
    const clip = clips.get(source);
    if (clip) clips.set(name, clip);
  }
  const mixer = new THREE.AnimationMixer(root);
  const attackMetadata = gltf.parser.json.animations?.find((clip: { name?: string }) => clip.name === 'Attack_Lunge');
  const impact = attackMetadata?.extras?.impactSeconds;
  const attackImpactTime = typeof impact === 'number' && Number.isFinite(impact) && impact > 0
    && impact <= (clips.get('Attack_Lunge')?.duration ?? 0) ? impact : undefined;
  console.info(`[M5] Stalker Genex: ${meshes.length} mallas con cabeza y cuello · ${config.enemy.height.toFixed(2)} m · ${clips.size} clips`);
  return { root, mesh, headBone, headCube, material, headMaterial, mixer, clips, attackImpactTime, scale, meshHeight, removedTriangles: 0 };
}
