import * as THREE from 'three';
import type { PsxConfig } from './config';
import type { Language } from './i18n';
import { createPsxMaterial, type Atmosphere } from './psxMaterial';
import { addVertexColors } from './vertexColors';
import { applyFiltering } from './textures';

type PaperKind = 'burn' | 'lock' | 'exit' | 'scrap';
type TextureKind = PaperKind | 'blood';

const textureCache = new Map<string, THREE.CanvasTexture>();
const normalCache = new Map<string, THREE.DataTexture>();
const WARNINGS: Record<Language, Record<PaperKind, string[]>> = {
  es: {
    burn: ['QUEMA', 'TODOS LOS', 'AFICHES'],
    lock: ['SIN AFICHES', 'EL CANDADO', 'DESAPARECE'],
    exit: ['NO HAY OTRA SALIDA'],
    scrap: ['TODOS', 'DEBEN ARDER'],
  },
  en: {
    burn: ['BURN', 'EVERY', 'POSTER'],
    lock: ['NO POSTERS', 'THE PADLOCK', 'DISAPPEARS'],
    exit: ['THERE IS NO OTHER WAY OUT'],
    scrap: ['ALL MUST', 'BURN'],
  },
};

// Semilla fija: las roturas y manchas no cambian al volver a una sala.
function randomSource(seed: number): () => number {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

function splatter(ctx: CanvasRenderingContext2D, random: () => number, x: number, y: number, radius: number): void {
  // Mancha irregular con cerco seco y gotas pequeñas alrededor.
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  for (let i = 0; i <= 36; i += 1) {
    const angle = i / 36 * Math.PI * 2;
    const r = radius * (0.24 + random() * 0.16);
    const px = Math.cos(angle) * r;
    const py = Math.sin(angle) * r * 0.6;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  const stain = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 0.48);
  stain.addColorStop(0, '#391111');
  stain.addColorStop(0.6, '#591915');
  stain.addColorStop(1, '#773025');
  ctx.fillStyle = stain;
  ctx.fill();
  ctx.restore();
  for (let i = 0; i < 65; i += 1) {
    const angle = random() * Math.PI * 2;
    const distance = random() * radius;
    const size = 0.4 + random() ** 2 * radius * 0.08;
    ctx.fillStyle = i % 3 === 0 ? '#80251f' : '#4f1514';
    ctx.beginPath();
    ctx.ellipse(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance * 0.65, size, size * 0.65, angle, 0, Math.PI * 2);
    ctx.fill();
  }
}

function surfaceNormal(blood: boolean): THREE.DataTexture {
  const key = blood ? 'blood' : 'paper';
  const cached = normalCache.get(key);
  if (cached) return cached;
  const size = 256;
  const pixels = new Uint8Array(size * size * 4);
  const random = randomSource(247);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const crease = Math.exp(-(((x - size * 0.5 - Math.sin(y * 0.018) * 5) / 2.2) ** 2));
      const grain = (random() - 0.5) * (blood ? 7 : 17);
      pixels[i] = 128 + grain + (blood ? 0 : crease * 38);
      pixels[i + 1] = 128 + grain * 0.5 + (blood ? 0 : Math.sin(y * 0.19) * 3);
      pixels[i + 2] = 254;
      pixels[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  applyFiltering(texture, { repeat: false });
  normalCache.set(key, texture);
  return texture;
}

function warningTexture(kind: TextureKind, language: Language): THREE.CanvasTexture {
  const key = kind === 'blood' ? kind : `${kind}:${language}`;
  const cached = textureCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = kind === 'exit' ? 128 : 384;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo dibujar la advertencia de la salida');
  const random = randomSource(71 + ['burn', 'lock', 'exit', 'scrap', 'blood'].indexOf(kind) * 17);
  // Dibujo a 512 px y filtrado como las texturas actuales de la casa.
  ctx.scale(2, 2);
  const w = canvas.width / 2;
  const h = canvas.height / 2;

  if (kind === 'blood') {
    splatter(ctx, random, 128, 106, 105);
    // Arrastres y gotas largas sobre el muro.
    for (let i = 0; i < 9; i += 1) {
      const x = 65 + random() * 120;
      const y = 80 + random() * 35;
      const length = 20 + random() * 60;
      ctx.strokeStyle = '#591918';
      ctx.lineWidth = 1 + random() * 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + 2, y + length * 0.4, x - 2, y + length * 0.75, x + 1, y + length);
      ctx.stroke();
    }
  } else {
    // Silueta dentada con esquinas arrancadas, sin rectángulo de fondo.
    ctx.beginPath();
    ctx.moveTo(17, 10);
    for (let x = 17; x <= w - 17; x += 9) ctx.lineTo(x, 5 + random() * 11);
    ctx.lineTo(w - 10, 22);
    for (let y = 22; y <= h - 19; y += 8) ctx.lineTo(w - 5 - random() * 13, y);
    ctx.lineTo(w - 25, h - 12);
    for (let x = w - 25; x >= 17; x -= 9) ctx.lineTo(x, h - 6 - random() * 15);
    ctx.lineTo(11, h - 24);
    for (let y = h - 24; y >= 16; y -= 8) ctx.lineTo(5 + random() * 12, y);
    ctx.closePath();
    ctx.clip();
    const paper = ctx.createLinearGradient(0, 0, w, h);
    paper.addColorStop(0, kind === 'scrap' ? '#998c70' : '#bdb08f');
    paper.addColorStop(0.45, '#d4c8a9');
    paper.addColorStop(1, '#a3987c');
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 4500; i += 1) {
      ctx.fillStyle = random() > 0.5 ? '#b3a47e' : '#dfcfa8';
      ctx.globalAlpha = 0.25;
      ctx.fillRect(random() * w, random() * h, 0.5 + random() * 2, 0.4 + random());
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#84775e';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w * 0.46, 0);
    ctx.lineTo(w * 0.54, h);
    ctx.stroke();
    splatter(ctx, random, 27, h - 17, 45);
    splatter(ctx, random, w - 18, 16, 33);
    ctx.fillStyle = '#641c18';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = WARNINGS[language][kind];
    const lineHeight = kind === 'exit' ? 36 : 43;
    for (let i = 0; i < lines.length; i += 1) {
      let size = kind === 'exit' ? 23 : i === 0 && kind === 'burn' ? 45 : 29;
      do {
        ctx.font = `bold ${size}px monospace`;
        size -= 1;
      } while (ctx.measureText(lines[i]).width > w - 38 && size > 10);
      ctx.save();
      ctx.translate(w / 2, h / 2 + (i - (lines.length - 1) / 2) * lineHeight);
      ctx.rotate(i % 2 === 0 ? -0.018 : 0.015);
      ctx.fillText(lines[i], 0, 0);
      ctx.restore();
    }
    if (kind === 'burn') {
      ctx.fillRect(41, h - 31, w - 82, 3);
      for (let i = 0; i < 6; i += 1) ctx.fillRect(49 + i * 27, h - 29, 2, 4 + random() * 12);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  applyFiltering(texture, { repeat: false });
  textureCache.set(key, texture);
  return texture;
}

export interface EndingDoorDecoration {
  group: THREE.Group;
  padlock: THREE.Group;
  sync: (config: PsxConfig) => void;
}

// Coordenadas locales: X a lo ancho del hueco y +Z hacia el interior de la sala.
export function createEndingDoorDecoration(
  config: PsxConfig,
  atmosphere: Atmosphere | null,
  width: number,
  height: number,
  wallThickness: number,
  padlock: THREE.Group,
): EndingDoorDecoration {
  const group = new THREE.Group();
  group.name = 'ending_door_warnings';
  const paperMaterials = (['burn', 'lock', 'exit', 'scrap', 'blood'] as const).map((kind) => ({
    kind,
    handle: createPsxMaterial(config, warningTexture(kind, config.language), atmosphere, {
      normalMap: surfaceNormal(kind === 'blood'),
      normalStrength: kind === 'blood' ? 0.25 : 0.55,
      spec: kind === 'blood' ? 0.28 : 0.035,
      gloss: kind === 'blood' ? 38 : 10,
      blend: kind === 'blood',
    }),
  }));

  function paper(kind: TextureKind, x: number, y: number, z: number, w: number, h: number, tilt = 0, floor = false): void {
    const geometry = new THREE.PlaneGeometry(w, h, kind === 'blood' ? 1 : 8, kind === 'blood' ? 1 : 6);
    if (kind !== 'blood') {
      const positions = geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i += 1) {
        const x = positions.getX(i) / w;
        const y = positions.getY(i) / h;
        const curl = (Math.abs(x) * 2) ** 8 * 0.008;
        positions.setZ(i, curl + Math.sin(x * 19 + y * 8) * 0.0015);
      }
      geometry.computeVertexNormals();
    }
    addVertexColors(geometry, 1);
    const material = paperMaterials.find((entry) => entry.kind === kind)!.handle.material;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `ending_${kind}`;
    mesh.position.set(x, y, z);
    mesh.rotation.set(floor ? -Math.PI / 2 : 0, 0, tilt);
    // El pase de profundidad no recorta alfa: excluir los decales evita
    // sombras rectangulares sobre el papel y la sangre con la linterna.
    mesh.layers.set(1);
    // Las superficies transparentes decorativas no interceptan la interacción.
    mesh.raycast = () => {};
    group.add(mesh);
  }

  const wallZ = wallThickness / 2 + 0.04;
  const sideX = width / 2 + 0.66;
  paper('blood', -sideX + 0.12, 1.22, wallZ, 1.35, 1.25);
  paper('blood', sideX - 0.07, 1.16, wallZ, 1.2, 1.45, 0.13);
  paper('burn', -sideX, 1.66, wallZ + 0.008, 1.05, 0.79, -0.09);
  paper('lock', sideX, 1.57, wallZ + 0.008, 1.05, 0.79, 0.12);
  paper('exit', 0, height + 0.24, wallZ, Math.min(1.7, width + 0.35), 0.37, -0.035);
  paper('scrap', -sideX - 0.13, 0.73, wallZ + 0.008, 0.44, 0.34, 0.29);
  paper('scrap', sideX + 0.15, 2.16, wallZ + 0.008, 0.38, 0.29, -0.32);
  paper('blood', 0.05, 0.008, 0.65, Math.min(2.3, width + 0.9), 1.2, 0.2, true);
  for (let i = 0; i < 7; i += 1) {
    const random = randomSource(113 + i * 53);
    paper('scrap', (random() - 0.5) * (width + 1), 0.012 + i * 0.001, 0.3 + random() * 1.1,
      0.2 + random() * 0.19, 0.15 + random() * 0.15, random() * Math.PI * 2, true);
  }

  padlock.name = 'ending_padlock';
  group.add(padlock);
  padlock.traverse((object) => {
    if (object instanceof THREE.Mesh) object.raycast = () => {};
  });

  return {
    group,
    padlock,
    sync: (next) => {
      for (const { kind, handle } of paperMaterials) {
        handle.material.uniforms.u_tex.value = warningTexture(kind, next.language);
        handle.sync(next, atmosphere);
      }
    },
  };
}
