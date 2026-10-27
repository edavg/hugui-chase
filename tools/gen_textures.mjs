// Genera texturas PNG nuevas para la zona de Luque (sin dependencias: encoder
// PNG mínimo con zlib). Salida en public/assets/textures/horror_pack/Custom/.
// Uso: node tools/gen_textures.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../public/assets/textures/horror_pack/Custom',
);
mkdirSync(OUT, { recursive: true });

const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c;
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

// pixels: Uint8Array RGB (size*size*3)
function writePng(name, size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 3 + 1)] = 0; // filtro None
    pixels.copy
      ? pixels.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3)
      : raw.set(pixels.subarray(y * size * 3, (y + 1) * size * 3), y * (size * 3 + 1) + 1);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(`${OUT}/${name}`, png);
  console.log(`${name}: ${png.length} bytes`);
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

// --- street_vitral.png: vitral de iglesia (vidrieras con plomo) ---
function vitral() {
  const size = 128;
  const pixels = Buffer.alloc(size * size * 3);
  const rand = rng(7);
  const colors = [
    [40, 70, 160],
    [150, 40, 60],
    [190, 150, 50],
    [40, 120, 110],
    [110, 60, 150],
    [200, 170, 80],
  ];
  const cell = 16;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      const base = colors[(cx * 3 + cy * 5) % colors.length];
      const lead = x % cell < 2 || y % cell < 2;
      const edge = x % cell < 3 || y % cell < 3;
      const noise = 0.75 + rand() * 0.5;
      const i = (y * size + x) * 3;
      const k = lead ? 0.12 : edge ? 0.55 : noise;
      pixels[i] = Math.min(255, base[0] * k);
      pixels[i + 1] = Math.min(255, base[1] * k);
      pixels[i + 2] = Math.min(255, base[2] * k);
    }
  }
  writePng('street_vitral.png', size, pixels);
}

// --- plaza_tile.png: losa/baldosa de plaza con juntas oscuras ---
function plazaTile() {
  const size = 128;
  const pixels = Buffer.alloc(size * size * 3);
  const rand = rng(21);
  const cell = 32;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 3;
      const joint = x % cell < 3 || y % cell < 3;
      const checker = (Math.floor(x / cell) + Math.floor(y / cell)) % 2;
      const noise = 0.85 + rand() * 0.3;
      const base = joint ? 60 : checker ? 120 : 138;
      pixels[i] = Math.min(255, base * noise);
      pixels[i + 1] = Math.min(255, (base - 6) * noise);
      pixels[i + 2] = Math.min(255, (base - 16) * noise);
    }
  }
  writePng('plaza_tile.png', size, pixels);
}

// --- church_stone.png: sillería de iglesia (piedra clara con juntas) ---
function churchStone() {
  const size = 128;
  const pixels = Buffer.alloc(size * size * 3);
  const rand = rng(33);
  const rows = 8;
  const rowH = size / rows;
  for (let y = 0; y < size; y += 1) {
    const row = Math.floor(y / rowH);
    const offset = (row % 2) * 16;
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 3;
      const bx = (x + offset) % 32;
      const joint = bx < 2 || y % rowH < 2;
      const noise = 0.85 + rand() * 0.3;
      const base = joint ? 96 : 168;
      pixels[i] = Math.min(255, base * noise);
      pixels[i + 1] = Math.min(255, (base - 4) * noise);
      pixels[i + 2] = Math.min(255, (base - 14) * noise);
    }
  }
  writePng('church_stone.png', size, pixels);
}

// --- shop_marble.png: mármol de mostrador de joyería ---
function shopMarble() {
  const size = 128;
  const pixels = Buffer.alloc(size * size * 3);
  const rand = rng(55);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 3;
      const vein =
        Math.sin(x * 0.11 + Math.sin(y * 0.07) * 3) * 0.5 + 0.5;
      const noise = 0.9 + rand() * 0.15;
      const base = 170 + vein * 40;
      pixels[i] = Math.min(255, base * noise);
      pixels[i + 1] = Math.min(255, (base + 2) * noise);
      pixels[i + 2] = Math.min(255, (base + 6) * noise);
    }
  }
  writePng('shop_marble.png', size, pixels);
}

vitral();
plazaTile();
churchStone();
shopMarble();

// --- asphalt.png: asfalto oscuro de calzada (grano fino, sin tono gris claro)
function asphaltDark() {
  const size = 128;
  const pixels = Buffer.alloc(size * size * 3);
  const rand = rng(91);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 3;
      const grain = rand();
      const patch = Math.sin(x * 0.09) * Math.sin(y * 0.11) * 6;
      const base = 34 + grain * 16 + patch;
      pixels[i] = Math.min(255, base);
      pixels[i + 1] = Math.min(255, base * 0.99);
      pixels[i + 2] = Math.min(255, base * 1.08);
    }
  }
  writePng('asphalt.png', size, pixels);
}

asphaltDark();
