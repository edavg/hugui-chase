// Pasa una textura generada (Genex) al set PS2: la reduce, iguala su brillo
// medio al de la textura que sustituye y le saca un normal map del relieve.
// Uso: node tools/import_texture.mjs <origen> <nombre> <referencia> [px] [fuerzaNormal]
// Salida: public/assets/textures/ps2/<nombre>.png y <nombre>_n.png.
import sharp from 'sharp';

const [source, name, reference, sizeArg = '256', strengthArg = '4'] = process.argv.slice(2);
if (!source || !name || !reference) {
  console.error('Uso: node tools/import_texture.mjs <origen> <nombre> <referencia> [px] [fuerzaNormal]');
  process.exit(1);
}
const size = Number(sizeArg);
const strength = Number(strengthArg);
const OUT = 'public/assets/textures/ps2';
const luma = (stats) => {
  const [r, g, b] = stats.channels;
  return 0.299 * r.mean + 0.587 * g.mean + 0.114 * b.mean;
};

const resized = sharp(source).removeAlpha().resize(size, size, { kernel: 'lanczos3' });
const gain = luma(await sharp(`${OUT}/${reference}.png`).stats()) / luma(await resized.clone().stats());
const albedo = await resized.clone().linear(gain, 0).raw().toBuffer();
await sharp(albedo, { raw: { width: size, height: size, channels: 3 } }).png().toFile(`${OUT}/${name}.png`);

// Relieve = luminancia (las juntas oscuras quedan hundidas); diferencias centrales con envoltura,
// como normal_from_height de gen_textures.py.
const height = await sharp(source).resize(size, size).greyscale().blur(0.6).raw().toBuffer();
const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)] / 255;
const normal = Buffer.alloc(size * size * 3);
for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * 0.5;
    const dy = (at(x, y + 1) - at(x, y - 1)) * 0.5;
    const nx = -dx * strength;
    const ny = dy * strength;
    const length = Math.hypot(nx, ny, 1);
    const i = (y * size + x) * 3;
    normal[i] = Math.round(((nx / length) * 0.5 + 0.5) * 255);
    normal[i + 1] = Math.round(((ny / length) * 0.5 + 0.5) * 255);
    normal[i + 2] = Math.round(((1 / length) * 0.5 + 0.5) * 255);
  }
}
await sharp(normal, { raw: { width: size, height: size, channels: 3 } }).png().toFile(`${OUT}/${name}_n.png`);
console.log(`${OUT}/${name}.png (+_n) · brillo ×${gain.toFixed(2)}`);
