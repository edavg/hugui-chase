import { applyFiltering } from './textures';
import * as THREE from 'three';

let posterTextureCache: THREE.Texture | null = null;
let fireParticleTextureCache: THREE.CanvasTexture | null = null;

export function loadPosterTexture(): THREE.Texture {
  if (!posterTextureCache) {
    const loader = new THREE.TextureLoader();
    posterTextureCache = loader.load(
      `${import.meta.env.BASE_URL}assets/textures/poster_hugui.jpeg`,
    );
    applyFiltering(posterTextureCache, { repeat: false });
    posterTextureCache.wrapS = THREE.ClampToEdgeWrapping;
    posterTextureCache.wrapT = THREE.ClampToEdgeWrapping;
  }
  return posterTextureCache;
}

export function createBurnMaterial(texture: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: texture },
      burnProgress: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform float burnProgress;
      varying vec2 vUv;

      void main() {
        vec4 texColor = texture2D(map, vUv);

        float edge = burnProgress * 1.3 - 0.15;
        float dist = vUv.y - edge;

        vec3 color = texColor.rgb;
        float alpha = texColor.a;

        if (dist < 0.0) {
          float charr = smoothstep(0.0, -0.08, dist);
          color = mix(color, vec3(0.06, 0.03, 0.01), charr);
          float fade = smoothstep(-0.02, -0.35, dist);
          alpha *= (1.0 - fade);
        }

        float glow = smoothstep(0.06, 0.0, abs(dist));
        vec3 fireColor = vec3(1.0, 0.45, 0.08);
        color = mix(color, fireColor, glow * 0.8);
        color += fireColor * glow * 0.5;

        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

export function createFireParticleTexture(): THREE.CanvasTexture {
  if (fireParticleTextureCache) {
    return fireParticleTextureCache;
  }
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('No se pudo crear el contexto 2D para la partícula de fuego');
  }

  const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, 'rgba(255, 255, 210, 1)');
  gradient.addColorStop(0.25, 'rgba(255, 170, 60, 0.85)');
  gradient.addColorStop(0.6, 'rgba(255, 60, 15, 0.3)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  fireParticleTextureCache = texture;
  return texture;
}

// Cuadro con los ojos rayados (M13): la imagen original con tajos de punta
// sobre cada ojo, como hechos con un clavo. `eyes` en UV (v desde arriba).
export function loadDefacedTexture(url: string, eyes: ReadonlyArray<readonly [number, number]>): THREE.Texture {
  const canvas = document.createElement('canvas');
  const texture = new THREE.CanvasTexture(canvas);
  applyFiltering(texture, { repeat: false });
  const image = new Image();
  image.onload = () => {
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.drawImage(image, 0, 0);
    const size = Math.min(image.width, image.height);
    let seed = 7;
    const random = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (const [u, v] of eyes) {
      const x = u * image.width;
      const y = v * image.height;
      const radius = size * 0.065;
      // Hueco oscuro raspado.
      ctx.fillStyle = 'rgba(8, 4, 3, 0.92)';
      ctx.beginPath();
      ctx.ellipse(x, y, radius, radius * 0.65, 0, 0, Math.PI * 2);
      ctx.fill();
      // Tajos que se salen del ojo, con borde claro de pintura levantada.
      for (let index = 0; index < 9; index += 1) {
        const angle = -0.9 + random() * 1.8 + (index % 2 === 0 ? 0 : Math.PI);
        const length = radius * (1.4 + random() * 2.2);
        const startX = x + Math.cos(angle) * radius * 0.3;
        const startY = y + Math.sin(angle) * radius * 0.3;
        const endX = x + Math.cos(angle) * length;
        const endY = y + Math.sin(angle) * length;
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(214, 196, 160, 0.55)';
        ctx.lineWidth = Math.max(1, size * 0.014);
        ctx.beginPath();
        ctx.moveTo(startX + 1, startY + 1);
        ctx.lineTo(endX + 1, endY + 1);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(30, 6, 4, 0.9)';
        ctx.lineWidth = Math.max(1, size * 0.01);
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }
      // Lágrima de óxido.
      ctx.fillStyle = 'rgba(70, 12, 8, 0.75)';
      ctx.fillRect(x - size * 0.004, y + radius * 0.5, size * 0.008, size * (0.08 + random() * 0.08));
    }
    texture.needsUpdate = true;
  };
  image.src = url;
  return texture;
}

let footprintTextureCache: THREE.CanvasTexture | null = null;

// Huella de pie descalzo con barro (rastro del stalker). Dedos arriba (+V).
export function createFootprintTexture(): THREE.CanvasTexture {
  if (footprintTextureCache) {
    return footprintTextureCache;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('No se pudo crear la textura de huella');
  }
  ctx.fillStyle = 'rgba(38, 26, 16, 0.85)';
  ctx.beginPath();
  ctx.ellipse(16, 34, 10, 15, 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(16, 54, 8, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const [x, y, r] of [[8, 13, 3.6], [13, 9, 3.2], [18, 8, 3], [23, 10, 2.7], [27, 14, 2.4]]) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Barro irregular: motas que rompen el contorno.
  const image = ctx.getImageData(0, 0, 32, 64);
  for (let i = 3; i < image.data.length; i += 4) {
    if (image.data[i] > 0) {
      image.data[i] = Math.max(0, image.data[i] - Math.floor(Math.random() * 120));
    }
  }
  ctx.putImageData(image, 0, 0);
  footprintTextureCache = new THREE.CanvasTexture(canvas);
  applyFiltering(footprintTextureCache, { repeat: false });
  footprintTextureCache.wrapS = THREE.ClampToEdgeWrapping;
  footprintTextureCache.wrapT = THREE.ClampToEdgeWrapping;
  return footprintTextureCache;
}
