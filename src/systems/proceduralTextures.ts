import * as THREE from 'three';

export function createNoteTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('No se pudo crear el contexto 2D para la textura de nota');
  }

  ctx.fillStyle = '#cfc7ae';
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = '#b7ae94';
  ctx.fillRect(0, 0, size, 3);
  ctx.fillRect(0, size - 3, size, 3);
  ctx.fillRect(0, 0, 3, size);
  ctx.fillRect(size - 3, 0, 3, size);

  let seed = 7;
  const random = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  ctx.fillStyle = '#5c5341';
  for (let row = 0; row < 11; row += 1) {
    const y = 12 + row * 4;
    let x = 8 + Math.floor(random() * 3);
    const end = size - 8 - Math.floor(random() * 6);
    while (x < end) {
      const length = 2 + Math.floor(random() * 5);
      ctx.fillRect(x, y, Math.min(length, end - x), 1);
      x += length + 1 + Math.floor(random() * 2);
    }
  }

  ctx.fillStyle = '#8a8065';
  ctx.fillRect(Math.floor(size / 2), 0, 1, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}
