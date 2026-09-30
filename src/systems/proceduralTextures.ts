import * as THREE from 'three';

let posterTextureCache: THREE.Texture | null = null;
let fireParticleTextureCache: THREE.CanvasTexture | null = null;

export function loadPosterTexture(): THREE.Texture {
  if (!posterTextureCache) {
    const loader = new THREE.TextureLoader();
    posterTextureCache = loader.load(
      `${import.meta.env.BASE_URL}assets/textures/poster_hugui.jpeg`,
    );
    posterTextureCache.magFilter = THREE.NearestFilter;
    posterTextureCache.minFilter = THREE.NearestFilter;
    posterTextureCache.generateMipmaps = false;
    posterTextureCache.wrapS = THREE.ClampToEdgeWrapping;
    posterTextureCache.wrapT = THREE.ClampToEdgeWrapping;
    posterTextureCache.colorSpace = THREE.SRGBColorSpace;
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
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  fireParticleTextureCache = texture;
  return texture;
}
