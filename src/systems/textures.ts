import * as THREE from 'three';

// Filtrado "PS2": bilineal con mipmaps y algo de anisotropía (el PS1 iba en
// nearest sin mipmaps). El renderer fija la anisotropía máxima al arrancar.
let maxAnisotropy = 4;

export function setMaxAnisotropy(value: number): void {
  maxAnisotropy = Math.max(1, Math.min(8, Math.floor(value)));
}

export function applyFiltering(texture: THREE.Texture, options: { repeat?: boolean; srgb?: boolean } = {}): THREE.Texture {
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = maxAnisotropy;
  if (options.repeat !== false) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
  }
  texture.needsUpdate = true;
  return texture;
}

export function loadPixelTexture(
  loader: THREE.TextureLoader,
  url: string,
  repeat?: [number, number],
): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (texture) => {
        applyFiltering(texture);
        if (repeat) {
          texture.repeat.set(repeat[0], repeat[1]);
        }
        resolve(texture);
      },
      undefined,
      (error) => reject(new Error(`No se pudo cargar la textura ${url}: ${String(error)}`)),
    );
  });
}

// Normal map opcional junto a la textura (<nombre>_n.png). Si no existe se
// resuelve a null y el material queda con la normal geométrica.
const normalCache = new Map<string, Promise<THREE.Texture | null>>();

export function loadNormalMap(loader: THREE.TextureLoader, url: string): Promise<THREE.Texture | null> {
  const normalUrl = url.replace(/\.png$/i, '_n.png');
  if (normalUrl === url) {
    return Promise.resolve(null);
  }
  let pending = normalCache.get(normalUrl);
  if (!pending) {
    pending = new Promise((resolve) => {
      loader.load(
        normalUrl,
        (texture) => resolve(applyFiltering(texture)),
        undefined,
        () => resolve(null),
      );
    });
    normalCache.set(normalUrl, pending);
  }
  return pending;
}
