import * as THREE from 'three';
import type { PsxConfig } from './config';
import { createPsxMaterial, type Atmosphere, type PsxMaterialHandle } from './psxMaterial';
import { applyFiltering } from './textures';
import { addVertexColors } from './vertexColors';

let irisTexture: THREE.Texture | null = null;
let fleshTexture: THREE.Texture | null = null;

// Carne de la maldición: la comparten el ojo y la contaminación de las salas.
export function curseFleshTexture(): THREE.Texture {
  if (!fleshTexture) {
    fleshTexture = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/textures/demonic_eye_flesh.png`);
    applyFiltering(fleshTexture);
  }
  return fleshTexture;
}

function eyeTextures(): { iris: THREE.Texture; flesh: THREE.Texture } {
  if (!irisTexture) {
    irisTexture = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/textures/demonic_eye_iris.png`);
    applyFiltering(irisTexture, { repeat: false });
  }
  return { iris: irisTexture, flesh: curseFleshTexture() };
}

// El globo gira dentro de una cuenca fija: la puerta no se mueve al mirarnos.
export class DemonicEye {
  readonly group = new THREE.Group();
  private readonly stretch = new THREE.Group();
  private readonly gaze = new THREE.Group();
  private readonly localTarget = new THREE.Vector3();
  private readonly materials: PsxMaterialHandle[];
  private readonly iris: THREE.Mesh;
  private readonly rim: THREE.Mesh;

  constructor(config: PsxConfig, private readonly atmosphere: Atmosphere | null, width: number) {
    const textures = eyeTextures();
    const flesh = createPsxMaterial(config, textures.flesh, atmosphere, { spec: 0.065, gloss: 24 });
    const sclera = createPsxMaterial(config, textures.flesh, atmosphere, { spec: 0.14, gloss: 44, emissive: 0.035 });
    const iris = createPsxMaterial(config, textures.iris, atmosphere, { spec: 0.08, gloss: 48, emissive: 0.08 });
    this.materials = [flesh, sclera, iris];
    this.group.name = 'ending_demonic_eye';
    this.group.scale.setScalar(Math.min(1.12, width * 0.86) / 1.4);
    this.stretch.scale.set(1.4, 0.85, 0.82);
    this.group.add(this.stretch);
    this.stretch.add(this.gaze);
    this.gaze.name = 'ending_eye_gaze';

    const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, color: THREE.Color,
      parent: THREE.Object3D = this.group): THREE.Mesh => {
      const colors = new Float32Array(geometry.getAttribute('position').count * 3);
      for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
      geometry.setAttribute('a_color', new THREE.BufferAttribute(colors, 3));
      const object = new THREE.Mesh(geometry, material);
      object.raycast = () => {};
      parent.add(object);
      return object;
    };

    // Membrana irregular que crece sobre la madera, por detrás del párpado.
    const membraneGeometry = new THREE.RingGeometry(0.4, 0.78, 48, 6);
    const membranePositions = membraneGeometry.getAttribute('position');
    for (let i = 0; i < membranePositions.count; i += 1) {
      const x = membranePositions.getX(i);
      const y = membranePositions.getY(i);
      const angle = Math.atan2(y, x);
      const t = (Math.hypot(x, y) - 0.4) / 0.38;
      const edge = 1 + t * (Math.sin(angle * 7 + 1) * 0.09 + Math.sin(angle * 11) * 0.055);
      membranePositions.setXYZ(i, x * 1.2 * edge, y * 0.88 * edge,
        0.14 - t * 0.205 + Math.sin(angle * 5) * (1 - t) * 0.015);
    }
    membraneGeometry.computeVertexNormals();
    mesh(membraneGeometry, flesh.material, new THREE.Color(0.54, 0.5, 0.46));

    const rimCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.59, -0.015, 0.12),
      new THREE.Vector3(-0.38, 0.22, 0.17),
      new THREE.Vector3(-0.06, 0.27, 0.2),
      new THREE.Vector3(0.26, 0.23, 0.18),
      new THREE.Vector3(0.57, 0, 0.11),
      new THREE.Vector3(0.34, -0.21, 0.16),
      new THREE.Vector3(0.02, -0.265, 0.19),
      new THREE.Vector3(-0.32, -0.22, 0.17),
    ], true);
    this.rim = mesh(new THREE.TubeGeometry(rimCurve, 64, 0.055, 8, true), flesh.material,
      new THREE.Color(0.76, 0.75, 0.72));
    mesh(new THREE.SphereGeometry(0.38, 32, 18), sclera.material, new THREE.Color(0.92, 0.94, 0.9), this.gaze);

    // Párpado pesado y asimétrico, con la misma piel que la cuenca.
    const lid = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.58, 0.02, 0.16),
      new THREE.Vector3(-0.34, 0.3, 0.18),
      new THREE.Vector3(0.02, 0.34, 0.19),
      new THREE.Vector3(0.35, 0.27, 0.17),
      new THREE.Vector3(0.58, -0.01, 0.16),
    ]);
    mesh(new THREE.TubeGeometry(lid, 24, 0.035, 8, false), flesh.material, new THREE.Color(0.63, 0.6, 0.59));

    // Casquete curvo con UV circular: conserva el iris generado al girar.
    const irisGeometry = new THREE.RingGeometry(0, 0.255, 48, 6);
    const positions = irisGeometry.getAttribute('position');
    for (let i = 0; i < positions.count; i += 1) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      positions.setZ(i, Math.sqrt(0.38 ** 2 - x * x - y * y) + 0.006);
    }
    irisGeometry.computeVertexNormals();
    addVertexColors(irisGeometry, 1);
    this.iris = new THREE.Mesh(irisGeometry, iris.material);
    this.iris.name = 'ending_eye_iris';
    this.iris.raycast = () => {};
    this.gaze.add(this.iris);

    // Venas sobre el globo y raíces que adhieren la maldición a la madera.
    for (let i = 0; i < 10; i += 1) {
      const angle = i / 10 * Math.PI * 2 + Math.sin(i * 2.6) * 0.12;
      const vein: THREE.Vector3[] = [];
      const root: THREE.Vector3[] = [];
      for (let j = 0; j < 5; j += 1) {
        const t = j / 4;
        const a = angle + Math.sin(j * 2 + i) * 0.08;
        const r = 0.28 + t * 0.095;
        vein.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r,
          Math.sqrt(0.38 ** 2 - r * r) + 0.004));
        root.push(new THREE.Vector3(Math.cos(a) * (0.57 + t * (0.28 + Math.sin(i) * 0.08)),
          Math.sin(a) * (0.35 + t * (0.26 + Math.cos(i * 3) * 0.08)), 0.14 - t * 0.2));
      }
      mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(vein), 8, 0.005, 4, false),
        flesh.material, new THREE.Color(0.44, 0.22, 0.23), this.gaze);
      mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(root), 10, 0.022 + Math.sin(i) * 0.006, 6, false),
        flesh.material, new THREE.Color(0.52, 0.48, 0.43));
    }
  }

  update(dt: number, playerPosition: THREE.Vector3, clock: number): void {
    if (!this.group.visible) return;
    // worldToLocal incluye el giro del muro, la escala y el lado de la puerta.
    this.stretch.updateWorldMatrix(true, false);
    this.localTarget.copy(playerPosition);
    this.stretch.worldToLocal(this.localTarget);
    const z = Math.max(0.15, this.localTarget.z);
    const yaw = THREE.MathUtils.clamp(Math.atan2(this.localTarget.x, z), -0.68, 0.68);
    const pitch = THREE.MathUtils.clamp(-Math.atan2(this.localTarget.y,
      Math.hypot(this.localTarget.x, z)), -0.42, 0.42);
    const follow = 1 - Math.exp(-dt * 8);
    this.gaze.rotation.y = THREE.MathUtils.lerp(this.gaze.rotation.y, yaw, follow);
    this.gaze.rotation.x = THREE.MathUtils.lerp(this.gaze.rotation.x, pitch, follow);
    // Respiración leve del tejido, sin pulsaciones de luz ni de color.
    this.rim.scale.y = 1 + Math.sin(clock * 1.7) * 0.009;
  }

  sync(config: PsxConfig): void {
    this.materials.forEach((handle) => handle.sync(config, this.atmosphere));
  }
}
