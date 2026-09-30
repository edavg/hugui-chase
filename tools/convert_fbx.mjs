// Convierte FBX a GLB con fbx2gltf (ya instalado en el proyecto).
// Uso: node tools/convert_fbx.mjs <entrada.fbx> <salida.glb> [--no-embed]
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const convert = require('fbx2gltf');

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Uso: node tools/convert_fbx.mjs <entrada.fbx> <salida.glb>');
  process.exit(1);
}
if (!existsSync(input)) {
  console.error(`No existe: ${input}`);
  process.exit(1);
}

convert(input, output, ['--binary'])
  .then((result) => console.log('OK', result))
  .catch((error) => {
    console.error('Fallo de conversión:', error.message ?? error);
    process.exit(1);
  });
