import * as THREE from 'three';

export function addVertexColors(geometry: THREE.BufferGeometry, shade: number): void {
  if (geometry.getAttribute('a_color')) {
    return;
  }
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3).fill(shade);
  geometry.setAttribute('a_color', new THREE.BufferAttribute(colors, 3));
}
