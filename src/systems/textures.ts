import * as THREE from 'three';

export function loadPixelTexture(
  loader: THREE.TextureLoader,
  url: string,
  repeat?: [number, number],
): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (texture) => {
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;
        texture.anisotropy = 1;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
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
