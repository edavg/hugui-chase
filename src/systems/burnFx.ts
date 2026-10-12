import * as THREE from 'three';
import { setFireLight } from './sceneLights';

/**
 * Quema del afiche (M12c).
 *
 * - El papel arde desde la llama del mechero (abajo): un frente irregular
 *   (ruido fbm) avanza, tuesta el papel antes de llegar, deja un borde de
 *   brasa que parpadea, carboniza y abre agujeros con restos de ceniza.
 * - La hoja se curva y se despega de la pared por donde ya ha ardido.
 * - Llamas (sprites animados que suben y se apagan), humo, chispas con
 *   turbulencia y copos de ceniza que caen bailando.
 * - Luz de fuego REAL en la sala (ocupa un hueco de las luces por píxel) y
 *   una marca chamuscada que queda en la pared al terminar.
 *
 * Todo lo emitido va en la capa 1: el pase de sombra de la linterna no lo ve.
 */

export const BURN_SECONDS = 2.4;
export const POSTER_WIDTH = 0.55;
export const POSTER_HEIGHT = 0.85;

const FX_LAYER = 1;

const burnVert = /* glsl */ `
  uniform float u_progress;
  uniform vec2 u_origin;
  varying vec2 vUv;
  varying float vEdge;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) { return vnoise(p) * 0.55 + vnoise(p * 2.1) * 0.3 + vnoise(p * 4.3) * 0.15; }

  void main() {
    vUv = uv;
    vec2 q = vec2((uv.x - u_origin.x) * 0.65, uv.y - u_origin.y);
    float field = length(q) + (fbm(uv * vec2(4.0, 6.0)) - 0.5) * 0.35;
    float edge = u_progress * 1.45 - field;
    vEdge = edge;
    // La zona quemada se arruga y se despega de la pared hacia la sala.
    float lift = smoothstep(-0.05, 0.12, edge);
    vec3 p = position;
    p.z += lift * (0.025 + 0.05 * fbm(uv * 9.0)) ;
    p.y += lift * 0.015;
    // Los bordes del papel se enrollan al acercarse el fuego.
    float rim = max(0.0, max(abs(uv.x - 0.5) * 2.0, abs(uv.y - 0.5) * 2.0) - 0.7) / 0.3;
    p.z += rim * smoothstep(-0.2, 0.0, edge) * 0.04;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const burnFrag = /* glsl */ `
  uniform sampler2D u_map;
  uniform float u_progress;
  uniform float u_time;
  uniform float u_light;
  varying vec2 vUv;
  varying float vEdge;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }

  void main() {
    vec4 tex = texture2D(u_map, vUv);
    float edge = vEdge;
    float grain = vnoise(vUv * 60.0);
    // Agujero: lo que ya ardió desaparece, salvo jirones de ceniza gris.
    if (edge > 0.13) {
      if (edge > 0.26 || grain < 0.62) discard;
      gl_FragColor = vec4(vec3(0.16, 0.15, 0.14) * (0.6 + grain * 0.6), 0.85);
      return;
    }
    vec3 color = tex.rgb * u_light;
    // Papel que se tuesta antes de que llegue la llama.
    float toast = smoothstep(-0.12, 0.0, edge);
    color = mix(color, color * vec3(0.75, 0.55, 0.3), toast * 0.8);
    // Carbonizado.
    float charred = smoothstep(0.0, 0.06, edge);
    color = mix(color, vec3(0.05, 0.035, 0.025) * (0.7 + grain * 0.6), charred);
    // Borde de brasa que respira.
    float flicker = 0.75 + 0.25 * sin(u_time * 23.0 + vUv.x * 40.0) * sin(u_time * 7.0 + vUv.y * 25.0);
    float ember = smoothstep(0.035, 0.0, abs(edge - 0.012));
    vec3 hot = mix(vec3(1.0, 0.35, 0.05), vec3(1.0, 0.85, 0.45), smoothstep(0.4, 1.0, ember));
    color += hot * ember * 1.6 * flicker;
    // Brasas sueltas sobre lo carbonizado.
    float sparks = step(0.93, vnoise(vUv * 45.0 + u_time * 0.6)) * charred * (1.0 - smoothstep(0.05, 0.13, edge));
    color += vec3(1.0, 0.4, 0.08) * sparks * flicker;
    // El resplandor de la llama ilumina el papel que aún no arde.
    color += tex.rgb * vec3(1.0, 0.5, 0.15) * smoothstep(-0.25, 0.0, edge) * (1.0 - charred) * 0.28 * flicker;
    gl_FragColor = vec4(color, tex.a);
  }
`;

function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    draw(ctx);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

let flameTexture: THREE.CanvasTexture | null = null;
let smokeTexture: THREE.CanvasTexture | null = null;
let sparkTexture: THREE.CanvasTexture | null = null;
let scorchTexture: THREE.CanvasTexture | null = null;

// Lengua de fuego: gota alargada, núcleo blanco-amarillo y borde rojo.
function getFlameTexture(): THREE.CanvasTexture {
  flameTexture ??= canvasTexture(64, 128, (ctx) => {
    const image = ctx.createImageData(64, 128);
    for (let y = 0; y < 128; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        const v = y / 127;
        const u = (x - 31.5) / 32;
        const width = 0.9 * Math.pow(Math.sin(Math.PI * Math.min(1, (1 - v) * 1.15)), 0.8) * (0.35 + 0.65 * v);
        const d = Math.abs(u) / Math.max(0.01, width);
        const a = Math.max(0, 1 - d) * Math.min(1, (1 - v) * 6) * Math.min(1, v * 2.5 + 0.2);
        const core = Math.max(0, 1 - d * 1.8) * v;
        const i = (y * 64 + x) * 4;
        image.data[i] = 255;
        image.data[i + 1] = Math.round(90 + 165 * Math.min(1, core * 1.4));
        image.data[i + 2] = Math.round(25 + 180 * Math.pow(core, 2));
        image.data[i + 3] = Math.round(255 * Math.min(1, a * 1.3));
      }
    }
    ctx.putImageData(image, 0, 0);
  });
  return flameTexture;
}

function getSmokeTexture(): THREE.CanvasTexture {
  smokeTexture ??= canvasTexture(64, 64, (ctx) => {
    for (let k = 0; k < 7; k += 1) {
      const x = 20 + Math.random() * 24;
      const y = 20 + Math.random() * 24;
      const r = 12 + Math.random() * 16;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(60,56,52,0.35)');
      g.addColorStop(1, 'rgba(60,56,52,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
    }
  });
  return smokeTexture;
}

function getSparkTexture(): THREE.CanvasTexture {
  sparkTexture ??= canvasTexture(16, 16, (ctx) => {
    const g = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    g.addColorStop(0, 'rgba(255,240,190,1)');
    g.addColorStop(0.35, 'rgba(255,150,40,0.9)');
    g.addColorStop(1, 'rgba(255,60,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 16, 16);
  });
  return sparkTexture;
}

// Marca de quemado que queda en la pared: hollín más denso arriba (el humo sube).
function getScorchTexture(): THREE.CanvasTexture {
  scorchTexture ??= canvasTexture(128, 192, (ctx) => {
    const image = ctx.createImageData(128, 192);
    for (let y = 0; y < 192; y += 1) {
      for (let x = 0; x < 128; x += 1) {
        const u = (x - 63.5) / 64;
        const v = (y - 110) / 96;
        const n = Math.sin(x * 0.11 + y * 0.05) * Math.sin(x * 0.07 - y * 0.09) * 0.12 + Math.sin(x * 0.31 + 1.7) * Math.sin(y * 0.23) * 0.05;
        const d = Math.sqrt(u * u * 1.2 + v * v * (v < 0 ? 0.55 : 1.4)) + n;
        const a = Math.max(0, Math.min(1, (1 - d) * 2.2));
        const i = (y * 128 + x) * 4;
        image.data[i] = 16;
        image.data[i + 1] = 12;
        image.data[i + 2] = 9;
        image.data[i + 3] = Math.round(220 * a);
      }
    }
    // Suavizar el borde del hollín (sin patrón de tramado).
    const temp = document.createElement('canvas');
    temp.width = 128;
    temp.height = 192;
    temp.getContext('2d')?.putImageData(image, 0, 0);
    ctx.filter = 'blur(3px)';
    ctx.drawImage(temp, 0, 0);
    ctx.filter = 'none';
  });
  return scorchTexture;
}

interface Particle {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  kind: 'flame' | 'smoke' | 'spark' | 'ash';
  phase: number;
}

export class PosterBurn {
  private readonly material: THREE.ShaderMaterial;
  private readonly group = new THREE.Group();
  private readonly particles: Particle[] = [];
  private readonly matrix: THREE.Matrix4;
  private readonly normal: THREE.Vector3;
  private readonly lightPos = new THREE.Vector3();
  private readonly origin = new THREE.Vector2(0.5, 0.03);
  private time = 0;
  private emitFlame = 0;
  private emitSmoke = 0;
  private emitSpark = 0;
  private emitAsh = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly mesh: THREE.Mesh,
    texture: THREE.Texture,
    brightness: number,
  ) {
    this.origin.x = 0.42 + Math.random() * 0.16;
    this.material = new THREE.ShaderMaterial({
      vertexShader: burnVert,
      fragmentShader: burnFrag,
      uniforms: {
        u_map: { value: texture },
        u_progress: { value: 0 },
        u_time: { value: 0 },
        u_origin: { value: this.origin },
        u_light: { value: brightness },
      },
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: true,
    });
    // Más vértices para que la hoja se pueda curvar.
    mesh.geometry = new THREE.PlaneGeometry(POSTER_WIDTH, POSTER_HEIGHT, 14, 22);
    mesh.material = this.material;
    mesh.updateWorldMatrix(true, false);
    this.matrix = mesh.matrixWorld.clone();
    this.normal = new THREE.Vector3(0, 0, 1).transformDirection(this.matrix);
    this.group.layers.set(FX_LAYER);
    scene.add(this.group);
  }

  // Punto del frente de fuego en coordenadas de mundo (sobre el papel).
  private frontPoint(progress: number, out: THREE.Vector3, lift = 0.02): boolean {
    const radius = progress * 1.45 - 0.02;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const angle = Math.random() * Math.PI;
      const u = this.origin.x + (Math.cos(angle) * radius) / 0.65;
      const v = this.origin.y + Math.sin(angle) * radius;
      if (u > 0.02 && u < 0.98 && v > 0.0 && v < 1.0) {
        out.set((u - 0.5) * POSTER_WIDTH, (v - 0.5) * POSTER_HEIGHT, lift).applyMatrix4(this.matrix);
        return true;
      }
    }
    return false;
  }

  private spawn(kind: Particle['kind'], position: THREE.Vector3): void {
    const texture = kind === 'flame' ? getFlameTexture() : kind === 'spark' ? getSparkTexture() : getSmokeTexture();
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      blending: kind === 'flame' || kind === 'spark' ? THREE.AdditiveBlending : THREE.NormalBlending,
      color: kind === 'ash' ? 0x1a1714 : 0xffffff,
      fog: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.layers.set(FX_LAYER);
    sprite.position.copy(position);
    const out = this.normal;
    let velocity: THREE.Vector3;
    let life: number;
    let size: number;
    switch (kind) {
      case 'flame':
        velocity = new THREE.Vector3((Math.random() - 0.5) * 0.08, 0.35 + Math.random() * 0.35, 0).addScaledVector(out, 0.05);
        life = 0.35 + Math.random() * 0.3;
        size = 0.08 + Math.random() * 0.1;
        sprite.center.set(0.5, 0.15);
        break;
      case 'smoke':
        velocity = new THREE.Vector3((Math.random() - 0.5) * 0.06, 0.22 + Math.random() * 0.18, 0).addScaledVector(out, 0.12);
        life = 1.4 + Math.random() * 0.9;
        size = 0.12 + Math.random() * 0.1;
        break;
      case 'spark':
        velocity = new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.5 + Math.random() * 0.9, 0).addScaledVector(out, 0.2 + Math.random() * 0.3);
        life = 0.5 + Math.random() * 0.7;
        size = 0.012 + Math.random() * 0.012;
        break;
      default:
        velocity = new THREE.Vector3((Math.random() - 0.5) * 0.1, 0.05, 0).addScaledVector(out, 0.15 + Math.random() * 0.1);
        life = 1.8 + Math.random() * 1.2;
        size = 0.015 + Math.random() * 0.02;
    }
    sprite.scale.set(size, kind === 'flame' ? size * 1.8 : size, 1);
    this.group.add(sprite);
    this.particles.push({ sprite, velocity, life, maxLife: life, size, kind, phase: Math.random() * 10 });
  }

  // progress 0–1 de la quema; devuelve false cuando ya no queda nada vivo.
  update(dt: number, progress: number, lightVisible = true): boolean {
    this.time += dt;
    const burning = progress < 1;
    this.material.uniforms.u_progress.value = Math.min(1, progress);
    this.material.uniforms.u_time.value = this.time;

    if (burning) {
      const strength = Math.sin(Math.PI * Math.min(1, progress * 1.15)) + 0.25;
      this.emitFlame += dt * 95 * strength;
      this.emitSmoke += dt * 14 * strength;
      this.emitSpark += dt * 22 * strength;
      this.emitAsh += progress > 0.25 ? dt * 10 : 0;
      const point = new THREE.Vector3();
      while (this.emitFlame >= 1) {
        this.emitFlame -= 1;
        if (this.frontPoint(Math.max(0.03, progress), point)) this.spawn('flame', point);
      }
      while (this.emitSmoke >= 1) {
        this.emitSmoke -= 1;
        if (this.frontPoint(Math.max(0.03, progress), point, 0.05)) this.spawn('smoke', point.addScaledVector(new THREE.Vector3(0, 1, 0), 0.08));
      }
      while (this.emitSpark >= 1) {
        this.emitSpark -= 1;
        if (this.frontPoint(Math.max(0.03, progress), point)) this.spawn('spark', point);
      }
      while (this.emitAsh >= 1) {
        this.emitAsh -= 1;
        if (this.frontPoint(Math.max(0.05, progress - 0.1), point, 0.03)) this.spawn('ash', point);
      }
      // Luz de fuego: sigue al frente, parpadea y crece con la llama.
      this.lightPos.set((this.origin.x - 0.5) * POSTER_WIDTH, (Math.min(1, progress * 0.9) - 0.4) * POSTER_HEIGHT, 0.35).applyMatrix4(this.matrix);
      const flicker = 0.75 + 0.25 * Math.sin(this.time * 31) * Math.sin(this.time * 13.7) + (Math.random() - 0.5) * 0.15;
      if (lightVisible) {
        setFireLight(this.lightPos, [1, 0.5, 0.17], (0.6 + 1.6 * strength) * flicker, 4.5);
      }
    } else {
      if (lightVisible) setFireLight(null);
      this.mesh.visible = false;
    }

    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.sprite.removeFromParent();
        p.sprite.material.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      const age = 1 - p.life / p.maxLife;
      const sway = Math.sin(this.time * 6 + p.phase);
      switch (p.kind) {
        case 'flame': {
          p.velocity.x += sway * dt * 0.4;
          const grow = Math.sin(Math.PI * Math.min(1, age * 1.3));
          p.sprite.scale.set(p.size * (0.6 + 0.5 * grow), p.size * 1.8 * (0.5 + 0.9 * grow), 1);
          p.sprite.material.color.setRGB(1, 0.65 + 0.35 * (1 - age), 0.5 * (1 - age));
          p.sprite.material.opacity = Math.min(1, (1 - age) * 1.6);
          break;
        }
        case 'smoke':
          p.velocity.x += sway * dt * 0.08;
          p.sprite.scale.setScalar(p.size * (1 + age * 2.2));
          p.sprite.material.opacity = Math.sin(Math.PI * age) * 0.32;
          p.sprite.material.rotation += dt * 0.4 * (p.phase > 5 ? 1 : -1);
          break;
        case 'spark':
          p.velocity.y -= dt * 0.9;
          p.velocity.x += sway * dt * 0.6;
          p.sprite.material.opacity = (1 - age) * (0.6 + 0.4 * Math.sin(this.time * 50 + p.phase));
          break;
        default:
          // Copos de ceniza: caen despacio balanceándose.
          p.velocity.y = Math.max(-0.22, p.velocity.y - dt * 0.35);
          p.velocity.x = sway * 0.12;
          p.velocity.multiplyScalar(0.995);
          p.sprite.material.rotation += dt * 2;
          p.sprite.material.opacity = Math.min(1, p.life * 1.5);
      }
      p.sprite.position.addScaledVector(p.velocity, dt);
    }
    return burning || this.particles.length > 0;
  }

  // Marca chamuscada permanente en la pared detrás del afiche.
  leaveScorch(): void {
    const material = new THREE.MeshBasicMaterial({
      map: getScorchTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      fog: false,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(POSTER_WIDTH * 1.5, POSTER_HEIGHT * 1.45), material);
    plane.applyMatrix4(this.matrix);
    plane.position.addScaledVector(this.normal, -0.017);
    plane.position.y += 0.12;
    plane.layers.set(FX_LAYER);
    plane.name = 'poster_scorch';
    this.scene.add(plane);
  }

  dispose(): void {
    for (const p of this.particles) {
      p.sprite.removeFromParent();
      p.sprite.material.dispose();
    }
    this.particles.length = 0;
    this.group.removeFromParent();
    this.material.dispose();
  }
}
