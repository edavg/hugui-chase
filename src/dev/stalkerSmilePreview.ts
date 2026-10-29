import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { atlasTileOrigin, loadStalkerHeadAtlas, type HeadAtlas } from '../systems/stalkerFace';
import { loadStalkerRig } from '../systems/stalkerModel';
import type { PsxConfig } from '../systems/config';

const elements = {
  stage: document.querySelector<HTMLElement>('#stage')!,
  canvas: document.querySelector<HTMLCanvasElement>('#view')!,
  status: document.querySelector<HTMLElement>('#status')!,
  clips: document.querySelector<HTMLElement>('#clips')!,
  paused: document.querySelector<HTMLInputElement>('#paused')!,
  rotate: document.querySelector<HTMLInputElement>('#rotate')!,
  retro: document.querySelector<HTMLInputElement>('#retro')!,
  speed: document.querySelector<HTMLInputElement>('#speed')!,
  pose: document.querySelector<HTMLInputElement>('#pose')!,
  export: document.querySelector<HTMLButtonElement>('#export')!,
};
const names: Record<string, string> = {
  Idle_Watchful: 'Reposo', Walk_Nervous: 'Caminar', Run_Frantic: 'Correr',
  Attack_Lunge: 'Ataque', WallSlam_Recover: 'Reacción', 'Scream.lol': 'Grito',
};
const scene = new THREE.Scene();
scene.background = new THREE.Color('#191d18');
const renderer = new THREE.WebGLRenderer({ canvas: elements.canvas, antialias: false });
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.NoToneMapping;
const camera = new THREE.PerspectiveCamera(39, 1, 0.08, 25);
camera.position.set(-0.25, 1.3, -3.65);
const controls = new OrbitControls(camera, elements.canvas);
controls.target.set(0, 1.05, 0);
controls.minDistance = 0.4;
controls.maxDistance = 6;
controls.enableDamping = true;
controls.autoRotateSpeed = 0.65;
scene.add(new THREE.HemisphereLight(0xe7eadb, 0x363a2c, 2.2));
const light = new THREE.DirectionalLight(0xffebd2, 2.5);
light.position.set(-2, 4, -3);
scene.add(light);
const floor = new THREE.Mesh(new THREE.CircleGeometry(2.5, 80), new THREE.MeshStandardMaterial({ color: 0x23291f, roughness: 1 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.012;
scene.add(floor);
const grid = new THREE.GridHelper(5, 20, 0x444f39, 0x2d3527);
grid.position.y = -0.009;
scene.add(grid);

let model: THREE.Group;
let mixer: THREE.AnimationMixer;
let clips: THREE.AnimationClip[] = [];
let action: THREE.AnimationAction | undefined;
let activeName = '';
let shaderMaterials: THREE.ShaderMaterial[] = [];
let frame = 0;
let lastTime = 0;
let config: PsxConfig;

function resize(): void {
  const { width, height } = elements.stage.getBoundingClientRect();
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
  const factor = elements.retro.checked ? Math.min(1, 800 / width) : Math.min(window.devicePixelRatio, 1.5);
  renderer.setSize(Math.round(width * factor), Math.round(height * factor), false);
  elements.canvas.style.imageRendering = elements.retro.checked ? 'pixelated' : 'auto';
}
const observer = new ResizeObserver(resize);
observer.observe(elements.stage);
elements.retro.addEventListener('change', () => {
  resize();
  for (const material of shaderMaterials) {
    material.uniforms.u_dither.value = elements.retro.checked ? 1 : 0;
    material.uniforms.u_snap.value = elements.retro.checked ? 1 : 0;
    material.uniforms.u_color_bits.value = elements.retro.checked ? 5 : 8;
  }
});
document.querySelector('#front')!.addEventListener('click', () => {
  camera.position.set(-0.25, 1.3, -3.65);
  controls.target.set(0, 1.05, 0);
});
document.querySelector('#face')!.addEventListener('click', () => {
  camera.position.set(0, 1.92, -0.85);
  controls.target.set(0, 1.84, 0);
});

function play(name: string): void {
  const clip = clips.find((candidate) => candidate.name === name);
  if (!clip || !mixer) return;
  action?.fadeOut(0.18);
  action = mixer.clipAction(clip).reset().fadeIn(0.18).play();
  elements.paused.checked = false;
  activeName = name;
  for (const button of elements.clips.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.clip === name));
  }
}

elements.pose.addEventListener('input', () => {
  if (!action || !mixer) return;
  const active = action;
  const time = Number(elements.pose.value) * active.getClip().duration;
  elements.paused.checked = true;
  mixer.stopAllAction();
  active.reset().setEffectiveWeight(1).play();
  active.time = time;
  mixer.update(0);
});

async function preserveNeck(mesh: THREE.SkinnedMesh, headBone: THREE.Bone, head: THREE.Group, atlas: HeadAtlas): Promise<THREE.ShaderMaterial | null> {
  const response = await fetch('/assets/models/stalker/genex-smile/stalker-body.glb');
  if (!response.ok) throw new Error('No se pudo recuperar la unión del cuello');
  const buffer = await response.arrayBuffer();
  const view = new DataView(buffer);
  const jsonLength = view.getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)));
  const primitive = gltf.meshes[0].primitives[0];
  const accessor = gltf.accessors[primitive.indices];
  const bufferView = gltf.bufferViews[accessor.bufferView];
  const offset = 28 + jsonLength + (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const source = accessor.componentType === 5125
    ? new Uint32Array(buffer, offset, accessor.count)
    : new Uint16Array(buffer, offset, accessor.count);
  const headBounds = new THREE.Box3().setFromObject(head);
  const skullSize = (headBounds.max.y - headBounds.min.y) / 1.42;
  const cutY = headBounds.max.y - skullSize * 0.91;
  const boneIndex = mesh.skeleton.bones.indexOf(headBone);
  const indices = mesh.geometry.getAttribute('skinIndex');
  const weights = mesh.geometry.getAttribute('skinWeight');
  const heights = new Float32Array(indices.count);
  const influence = new Float32Array(indices.count);
  const neckInfluence = new Float32Array(indices.count);
  const neckIndex = mesh.skeleton.bones.findIndex((bone) => bone.name.toLowerCase() === 'neck');
  const lateral = new Float32Array(indices.count);
  const headCenter = headBounds.getCenter(new THREE.Vector3());
  const point = new THREE.Vector3();
  mesh.skeleton.update();
  for (let i = 0; i < indices.count; i++) {
    mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
    heights[i] = point.y;
    lateral[i] = point.x - headCenter.x;
    for (let slot = 0; slot < 4; slot++) {
      if (indices.getComponent(i, slot) === boneIndex) influence[i] += weights.getComponent(i, slot);
      if (indices.getComponent(i, slot) === neckIndex) neckInfluence[i] += weights.getComponent(i, slot);
    }
  }
  const kept: number[] = [];
  const neckTriangles: number[] = [];
  for (let i = 0; i < source.length; i += 3) {
    const a = source[i], b = source[i + 1], c = source[i + 2];
    const cranium = (influence[a] + influence[b] + influence[c]) / 3 > 0.6;
    const aboveJaw = Math.min(heights[a], heights[b], heights[c]) > cutY;
    if (cranium && aboveJaw) continue;
    const centerY = (heights[a] + heights[b] + heights[c]) / 3;
    const centerX = (lateral[a] + lateral[b] + lateral[c]) / 3;
    const skin = (influence[a] + influence[b] + influence[c] + neckInfluence[a] + neckInfluence[b] + neckInfluence[c]) / 3;
    const exposedNeck = skin > 0.5 && centerY > cutY - skullSize * 0.95 && Math.abs(centerX) < skullSize * 0.62;
    (exposedNeck ? neckTriangles : kept).push(a, b, c);
  }
  mesh.geometry.setIndex(kept);
  if (!neckTriangles.length || !(mesh.material instanceof THREE.ShaderMaterial)) return null;
  const [fx, fy] = atlasTileOrigin('front', atlas.tile);
  const sample = atlas.canvas.getContext('2d')!.getImageData(Math.round(fx + atlas.tile * 0.48), Math.round(fy + atlas.tile * 0.23), 8, 8).data;
  const color = [0, 0, 0];
  for (let i = 0; i < sample.length; i += 4) for (let c = 0; c < 3; c++) color[c] += sample[i + c] / 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const pixels = ctx.createImageData(64, 64);
  for (let i = 0; i < 64 * 64; i++) {
    const shade = 0.88 + Math.sin(i * 12.9898) * 0.025 + Math.sin(i * 0.081) * 0.025;
    for (let c = 0; c < 3; c++) pixels.data[i * 4 + c] = Math.min(255, color[c] * shade);
    pixels.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.magFilter = THREE.NearestFilter;
  const material = mesh.material.clone();
  material.uniforms.u_tex.value = texture;
  material.uniforms.u_spec.value = 0.05;
  const neck = mesh.clone();
  neck.name = 'stalker_neck_and_clavicle';
  neck.geometry = mesh.geometry.clone();
  neck.geometry.setIndex(neckTriangles);
  const colors = new Float32Array(indices.count * 3).fill(0.95);
  neck.geometry.setAttribute('a_color', new THREE.Float32BufferAttribute(colors, 3));
  neck.material = material;
  mesh.parent!.add(neck);
  console.info('[stalker-smile] Cuello y tórax conservados', { cutY, neckTriangles: neckTriangles.length / 3 });
  return material;
}

async function load(): Promise<void> {
  const response = await fetch('/config/psx_config.json');
  if (!response.ok) throw new Error(`No se pudo cargar la configuración (${response.status})`);
  config = await response.json() as PsxConfig;
  config = structuredClone(config);
  config.enemy.model = 'assets/models/stalker/genex-smile/stalker-body.glb';
  config.enemy.height = 2.05;
  config.enemy.model_head = false;
  config.effects.fog.enabled = false;
  config.effects.affine_mapping = false;
  config.effects.vertex_snap = true;
  config.color_bits = 5;
  const params = new URLSearchParams(location.search);
  const file = params.get('source') === 'body' ? null : params.get('file') ?? 'stalker-smile.glb';
  if (file) {
    if (!/^[\w.-]+\.glb$/.test(file)) throw new Error('Nombre de archivo no válido');
    const gltf = await new GLTFLoader().loadAsync(`/assets/models/stalker/genex-smile/${file}`);
    model = gltf.scene;
    mixer = new THREE.AnimationMixer(model);
    clips = gltf.animations;
  } else {
    const atlas = await loadStalkerHeadAtlas(new THREE.TextureLoader());
    const rig = await loadStalkerRig(config, atlas);
    const neckMaterial = await preserveNeck(rig.mesh, rig.headBone, rig.headCube, atlas);
    model = rig.root;
    mixer = rig.mixer;
    clips = [...new Set(rig.clips.values())];
    shaderMaterials = [rig.material.material, rig.headMaterial.material];
    if (neckMaterial) shaderMaterials.push(neckMaterial);
    rig.mesh.geometry.getAttribute('a_color')?.array.fill(0.8);
    const colors = rig.mesh.geometry.getAttribute('a_color');
    if (colors) colors.needsUpdate = true;
    for (const material of shaderMaterials) {
      material.uniforms.u_ambient.value = 0.95;
      material.uniforms.u_ambient_color.value.set(1, 0.96, 0.9);
      material.uniforms.u_direct.value = 0.65;
      material.uniforms.u_light_dir.value.set(-0.4, 0.7, -0.8).normalize();
    }
  }
  scene.add(model);
  let triangles = 0;
  let skins = 0;
  model.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.frustumCulled = false;
    triangles += (node.geometry.index?.count ?? node.geometry.getAttribute('position').count) / 3;
    if (node instanceof THREE.SkinnedMesh) skins++;
  });
  for (const clip of clips) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.clip = clip.name;
    button.textContent = names[clip.name] ?? clip.name;
    button.addEventListener('click', () => play(clip.name));
    elements.clips.append(button);
  }
  play('Idle_Watchful');
  elements.export.disabled = false;
  elements.status.textContent = `Listo · 2,05 m · ${Math.round(triangles).toLocaleString('es')} triángulos · ${clips.length} movimientos · ${skins} mallas con esqueleto`;
  console.info('[stalker-smile] Ready', { triangles, skins, clips: clips.map((clip) => clip.name) });
}

elements.export.addEventListener('click', async () => {
  elements.export.disabled = true;
  const replacements: Array<{ mesh: THREE.Mesh; material: THREE.Material | THREE.Material[]; geometry: THREE.BufferGeometry }> = [];
  const previousName = activeName;
  try {
    mixer.stopAllAction();
    model.traverse((node) => { if (node instanceof THREE.SkinnedMesh) node.skeleton.pose(); });
    model.updateMatrixWorld(true);
    model.traverse((node) => {
      if (!(node instanceof THREE.Mesh) || !(node.material instanceof THREE.ShaderMaterial)) return;
      replacements.push({ mesh: node, material: node.material, geometry: node.geometry });
      node.geometry = node.geometry.clone();
      node.geometry.deleteAttribute('color');
      node.geometry.deleteAttribute('a_color');
      const map = node.material.uniforms.u_tex.value as THREE.Texture;
      node.material = new THREE.MeshStandardMaterial({ map, roughness: 0.98, metalness: 0, side: THREE.DoubleSide });
    });
    const result = await new GLTFExporter().parseAsync(model, { binary: true, animations: clips, onlyVisible: true });
    if (!(result instanceof ArrayBuffer)) throw new Error('La exportación no devolvió un GLB');
    const url = URL.createObjectURL(new Blob([result], { type: 'model/gltf-binary' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'stalker-smile.glb';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    elements.status.textContent = 'GLB completo exportado con la cara original y los seis movimientos.';
  } catch (error) {
    elements.status.textContent = `No se pudo exportar: ${error instanceof Error ? error.message : String(error)}`;
    console.error(error);
  } finally {
    for (const entry of replacements) {
      entry.mesh.geometry.dispose();
      (entry.mesh.material as THREE.Material).dispose();
      entry.mesh.material = entry.material;
      entry.mesh.geometry = entry.geometry;
    }
    play(previousName);
    elements.export.disabled = false;
  }
});

function render(time: number): void {
  frame = requestAnimationFrame(render);
  const dt = Math.min((time - lastTime) / 1000, 0.05);
  lastTime = time;
  if (mixer && !elements.paused.checked) {
    mixer.timeScale = Number(elements.speed.value);
    mixer.update(dt);
  }
  if (action && document.activeElement !== elements.pose) elements.pose.value = String(action.time / action.getClip().duration);
  controls.autoRotate = elements.rotate.checked;
  controls.update();
  renderer.render(scene, camera);
}
resize();
frame = requestAnimationFrame(render);
void load().catch((error) => {
  elements.status.textContent = `No se pudo cargar el stalker: ${error instanceof Error ? error.message : String(error)}`;
  console.error(error);
});
window.addEventListener('pagehide', () => {
  cancelAnimationFrame(frame);
  observer.disconnect();
  controls.dispose();
  mixer?.stopAllAction();
  renderer.dispose();
}, { once: true });
