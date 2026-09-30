import * as THREE from 'three';

export const STALKER_FACE_URL = 'assets/textures/stalker/face.png';

export type HeadFace = 'top' | 'front' | 'back' | 'left' | 'right' | 'bottom';

export interface HeadAtlas {
  texture: THREE.Texture;
  tile: number;
  remap: (geometry: THREE.BoxGeometry) => void;
}

const ATLAS_COLUMNS = 3;
const ATLAS_ROWS = 2;
const TILE = 64;
const FALLBACK_TILE = 32;

const TILE_ORDER: HeadFace[] = ['top', 'front', 'back', 'left', 'right', 'bottom'];

/**
 * La imagen del usuario es un despiece de cabeza en cruz, no una cara suelta:
 * franja superior = coronilla (que hace también de nuca), centro = frente,
 * laterales = perfiles, bajo la cara = mandíbula/cuello.
 *
 * El layout se DETECTA solo (componentes conexas sobre fondo claro) para que
 * cualquier despiece nuevo entre sin tocar código. Si la imagen va llena a
 * sangre, sin fondo ni separación, se cae a estos porcentajes medidos sobre el
 * despiece anterior de 1254x1254.
 */
const FALLBACK_REGIONS: Record<HeadFace, [number, number, number, number]> = {
  top: [0.266, 0.035, 0.734, 0.246],
  front: [0.266, 0.254, 0.734, 0.695],
  back: [0.266, 0.035, 0.734, 0.246],
  left: [0.027, 0.254, 0.25, 0.707],
  right: [0.75, 0.254, 0.973, 0.703],
  bottom: [0.371, 0.715, 0.633, 0.965],
};

const PROBE_SIZE = 256;

// Orden de grupos de BoxGeometry (+X, -X, +Y, -Y, +Z, -Z). El frente del modelo
// mira a su -Z local, así que la cara va en el último grupo y la nuca en el quinto.
const BOX_FACE_ORDER: HeadFace[] = ['right', 'left', 'top', 'bottom', 'back', 'front'];

export async function loadStalkerHeadAtlas(loader: THREE.TextureLoader): Promise<HeadAtlas> {
  const url = `${import.meta.env.BASE_URL}${STALKER_FACE_URL}`;
  try {
    const image = await loadImage(loader, url);
    const probe = probeImage(image);
    const detected = detectBlocks(probe.ink);
    const coarse = detected ?? FALLBACK_REGIONS;
    if (detected) {
      console.info(`[M5] Despiece detectado: ${describeBlocks(detected)}`);
    } else {
      console.info('[M5] No se pudo detectar el despiece, se usan las regiones por defecto');
    }
    const refined = refineToInk(image, coarse);
    const trimmed = trimCollars(probe.cloth, refined);
    console.info(`[M5] Cabeza recortada: ${describeBlocks(trimmed)}`);
    return buildAtlas(image, trimmed, TILE);
  } catch (error) {
    console.warn(`[M5] No se encontró ${STALKER_FACE_URL}, se usa la cabeza procedural`, error);
    return buildFallbackAtlas();
  }
}

interface Probe {
  ink: Uint8Array;
  cloth: Uint8Array;
}

// El despiece va sobre fondo casi blanco: todo lo que supera esto es fondo.
const INK_LUMA = 234;

/**
 * El despiece viene sobre fondo casi blanco, así que "tinta" es todo lo que no
 * es fondo. "Tela" (cuello de la camisa) es la sub-banda clara y desaturada que
 * cuelga del bloque hacia abajo: se separa en su propia máscara para poder
 * recortarla después sin comerse la piel clara de la cara. El techo de LUMA es
 * el propio umbral de fondo, así la tela nunca sesolda con el fondo por el borde
 * y el recorte por inundación no se escapa por la silueta.
 */
function probeImage(image: HTMLImageElement): Probe {
  const canvas = document.createElement('canvas');
  canvas.width = PROBE_SIZE;
  canvas.height = PROBE_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return { ink: new Uint8Array(PROBE_SIZE * PROBE_SIZE), cloth: new Uint8Array(PROBE_SIZE * PROBE_SIZE) };
  }
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, PROBE_SIZE, PROBE_SIZE);
  ctx.drawImage(image, 0, 0, PROBE_SIZE, PROBE_SIZE);
  const data = ctx.getImageData(0, 0, PROBE_SIZE, PROBE_SIZE).data;

  const ink = new Uint8Array(PROBE_SIZE * PROBE_SIZE);
  const cloth = new Uint8Array(PROBE_SIZE * PROBE_SIZE);
  for (let i = 0; i < ink.length; i += 1) {
    const alpha = data[i * 4 + 3];
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    ink[i] = alpha > 24 && luma < INK_LUMA ? 1 : 0;
    cloth[i] = alpha > 24 && luma > 200 && luma < INK_LUMA && chroma < 26 ? 1 : 0;
  }
  return { ink, cloth };
}

interface Span {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const SPAN_TOLERANCE = 6;
const MIN_BAND_HEIGHT = 3;
const MIN_COL_WIDTH = 4;
const COLUMN_MERGE_GAP = 2;

/**
 * Refinado a resolución nativa. La detección por sonda va en 256, así que cada
 * borde del bloque puede quedar hasta ~5 px pasado hacia el fondo blanco del
 * despiece: en la baldosa eso es una línea blanca de 1 px en el canto. Aquí cada
 * borde se aprieta contra la última fila/columna que sea realmente tinta.
 *
 * El relleno mínimo por eje sale de la forma del despiece: los bloques son
 * rectángulos casi macizos, así que un corte vertical da columnas al ~100% y
 * sólo un pelo suelto se queda al 59%. En horizontal el borde sí afila (la
 * barbilla llega al 38%, los hombros al 52%), por eso el listón es más bajo.
 */
const COLUMN_FILL = 0.8;
const ROW_FILL = 0.25;

function refineToInk(
  image: HTMLImageElement,
  regions: Record<HeadFace, [number, number, number, number]>,
): Record<HeadFace, [number, number, number, number]> {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const out = {} as Record<HeadFace, [number, number, number, number]>;
  for (const face of TILE_ORDER) {
    out[face] = refineRegion(image, width, height, regions[face]);
  }
  return out;
}

function refineRegion(
  image: HTMLImageElement,
  width: number,
  height: number,
  region: [number, number, number, number],
): [number, number, number, number] {
  const sx = Math.max(0, Math.floor(region[0] * width));
  const sy = Math.max(0, Math.floor(region[1] * height));
  const ex = Math.min(width, Math.ceil(region[2] * width));
  const ey = Math.min(height, Math.ceil(region[3] * height));
  if (ex <= sx || ey <= sy) {
    return region;
  }
  const canvas = document.createElement('canvas');
  canvas.width = ex - sx;
  canvas.height = ey - sy;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return region;
  }
  ctx.drawImage(image, sx, sy, ex - sx, ey - sy, 0, 0, ex - sx, ey - sy);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const inkAt = (x: number, y: number): boolean => {
    const i = (y * canvas.width + x) * 4;
    if (data[i + 3] <= 24) {
      return false;
    }
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < INK_LUMA;
  };

  const boxHeight = ey - sy;
  const boxWidth = ex - sx;
  let x0 = -1;
  while (x0 < boxWidth - 1 && columnFill(inkAt, x0 + 1, boxHeight) < COLUMN_FILL) {
    x0 += 1;
  }
  x0 += 1;
  let x1 = boxWidth - 1;
  while (x1 > x0 && columnFill(inkAt, x1 - 1, boxHeight) < COLUMN_FILL) {
    x1 -= 1;
  }
  let y0 = -1;
  while (y0 < boxHeight - 1 && rowFill(inkAt, y0 + 1, boxWidth) < ROW_FILL) {
    y0 += 1;
  }
  y0 += 1;
  let y1 = boxHeight - 1;
  while (y1 > y0 && rowFill(inkAt, y1 - 1, boxWidth) < ROW_FILL) {
    y1 -= 1;
  }
  if (x1 < x0 || y1 < y0) {
    return region;
  }
  return [
    (sx + x0) / width,
    (sy + y0) / height,
    (sx + x1 + 1) / width,
    (sy + y1 + 1) / height,
  ];
}

function columnFill(
  inkAt: (x: number, y: number) => boolean,
  x: number,
  boxHeight: number,
): number {
  let hits = 0;
  for (let y = 0; y < boxHeight; y += 1) {
    hits += inkAt(x, y) ? 1 : 0;
  }
  return hits / boxHeight;
}

function rowFill(
  inkAt: (x: number, y: number) => boolean,
  y: number,
  boxWidth: number,
): number {
  let hits = 0;
  for (let x = 0; x < boxWidth; x += 1) {
    hits += inkAt(x, y) ? 1 : 0;
  }
  return hits / boxWidth;
}

/**
 * Cuello de la camisa. Se inunda desde el borde inferior la malla de tela y se
 * corta por arriba del todo de ese componente: al ser una mancha conectada, se
 * lleva también las puntas aisladas del cuello, que con un simple umbral por fila
 * se colaban (esas puntas salían como dos esquinas blancas bajo la barbilla).
 *
 * Se entra sólo si el borde inferior ya es claramente tela, y nunca se come más
 * del 45% del bloque por si el despiece viniera con la camisa metida de fondo.
 */
const COLLAR_ON = 0.14;
const COLLAR_KEEP = 0.55;

function trimCollars(
  cloth: Uint8Array,
  regions: Record<HeadFace, [number, number, number, number]>,
): Record<HeadFace, [number, number, number, number]> {
  const out = {} as Record<HeadFace, [number, number, number, number]>;
  for (const face of TILE_ORDER) {
    out[face] = trimCollar(cloth, regions[face]);
  }
  return out;
}

function trimCollar(
  cloth: Uint8Array,
  region: [number, number, number, number],
): [number, number, number, number] {
  const y0 = Math.round(region[1] * PROBE_SIZE);
  const y1 = Math.min(PROBE_SIZE, Math.round(region[3] * PROBE_SIZE)) - 1;
  const x0 = Math.round(region[0] * PROBE_SIZE);
  const x1 = Math.min(PROBE_SIZE, Math.round(region[2] * PROBE_SIZE)) - 1;
  const width = x1 - x0 + 1;
  const height = y1 - y0 + 1;
  if (height < 2 || width < 2) {
    return region;
  }
  if (clothRatio(cloth, x0, x1, y1) < COLLAR_ON) {
    return region;
  }

  const seen = new Uint8Array(width * height);
  const filled = new Int32Array(height);
  const stack: number[] = [];
  for (let x = x0; x <= x1; x += 1) {
    if (cloth[y1 * PROBE_SIZE + x]) {
      stack.push((height - 1) * width + (x - x0));
      seen[(height - 1) * width + (x - x0)] = 1;
    }
  }
  while (stack.length > 0) {
    const cell = stack.pop() as number;
    const row = Math.floor(cell / width);
    filled[row] += 1;
    const step = [-1, 1, -width, width];
    for (let direction = 0; direction < step.length; direction += 1) {
      const next = cell + step[direction];
      if (next < 0 || next >= width * height || (direction < 2 && Math.floor(next / width) !== row)) {
        continue;
      }
      if (seen[next] === 1 || cloth[(y0 + Math.floor(next / width)) * PROBE_SIZE + x0 + (next % width)] === 0) {
        continue;
      }
      seen[next] = 1;
      stack.push(next);
    }
  }

  let cut = -1;
  for (let row = 0; row < height; row += 1) {
    if (filled[row] > 0) {
      cut = row;
      break;
    }
  }
  if (cut < 0) {
    return region;
  }
  cut = Math.max(cut, Math.floor(height * COLLAR_KEEP));
  return [region[0], region[1], region[2], (y0 + cut) / PROBE_SIZE];
}

function clothRatio(cloth: Uint8Array, x0: number, x1: number, y: number): number {
  let hits = 0;
  const width = x1 - x0 + 1;
  for (let x = x0; x <= x1; x += 1) {
    hits += cloth[y * PROBE_SIZE + x];
  }
  return hits / width;
}

function detectBlocks(
  ink: Uint8Array,
): Record<HeadFace, [number, number, number, number]> | null {
  const bands = rowBands(ink);
  if (bands.length < 2) {
    return null;
  }

  let middleIndex = -1;
  let columns: Span[] = [];
  for (let i = 0; i < bands.length; i += 1) {
    const groups = columnBands(ink, bands[i]);
    if (groups.length === 3 && groups[1].x1 - groups[1].x0 > groups[2].x1 - groups[2].x0) {
      middleIndex = i;
      columns = groups;
      break;
    }
  }
  if (middleIndex < 0) {
    return null;
  }

  // Hay bandas de 1 px sueltas entre bloques (el pelo del despiece queda
  // separado por una fila clara): se fusionan hacia arriba y hacia abajo las
  // bandas contiguas con la misma anchura que la primera candidata.
  const middle = bands[middleIndex];
  const above = bands.filter((band) => band.y1 < middle.y0 && band.y1 - band.y0 >= MIN_BAND_HEIGHT);
  const below = bands.filter((band) => band.y0 > middle.y1 && band.y1 - band.y0 >= MIN_BAND_HEIGHT);
  const top = above.length > 0 ? mergeBand(above, 0, 1) : null;
  const bottom = below.length > 0 ? mergeBand(below, 0, 1) : null;
  if (!top || !bottom) {
    return null;
  }

  const toRegion = (span: Span): [number, number, number, number] => [
    span.x0 / PROBE_SIZE,
    span.y0 / PROBE_SIZE,
    (span.x1 + 1) / PROBE_SIZE,
    (span.y1 + 1) / PROBE_SIZE,
  ];

  return {
    top: toRegion(top),
    front: toRegion(columns[1]),
    back: toRegion(top),
    left: toRegion(columns[0]),
    right: toRegion(columns[2]),
    bottom: toRegion(bottom),
  };
}

function mergeBand(bands: Span[], from: number, step: number): Span | null {
  const base = bands[from];
  if (!base) {
    return null;
  }
  let merged: Span = { x0: base.x0, y0: base.y0, x1: base.x1, y1: base.y1 };
  let index = from + step;
  while (index + step >= 0 && index + step < bands.length) {
    const candidate = bands[index + step];
    if (Math.abs(candidate.x0 - base.x0) > SPAN_TOLERANCE || Math.abs(candidate.x1 - base.x1) > SPAN_TOLERANCE) {
      break;
    }
    merged.y0 = Math.min(merged.y0, candidate.y0);
    merged.y1 = Math.max(merged.y1, candidate.y1);
    index += step;
  }
  return merged;
}

function rowBands(ink: Uint8Array): Span[] {
  const bands: Span[] = [];
  let current: Span | null = null;
  for (let y = 0; y < PROBE_SIZE; y += 1) {
    let x0 = -1;
    let x1 = -1;
    for (let x = 0; x < PROBE_SIZE; x += 1) {
      if (ink[y * PROBE_SIZE + x]) {
        if (x0 < 0) {
          x0 = x;
        }
        x1 = x;
      }
    }
    if (x0 < 0) {
      if (current) {
        bands.push(current);
      }
      current = null;
      continue;
    }
    if (current && Math.abs(current.x0 - x0) <= SPAN_TOLERANCE && Math.abs(current.x1 - x1) <= SPAN_TOLERANCE) {
      current.y1 = y;
      continue;
    }
    if (current) {
      bands.push(current);
    }
    current = { x0, y0: y, x1, y1: y };
  }
  if (current) {
    bands.push(current);
  }
  return bands;
}

function columnBands(ink: Uint8Array, band: Span): Span[] {
  const columns: Span[] = [];
  let current: Span | null = null;
  for (let x = band.x0; x <= band.x1; x += 1) {
    let y0 = -1;
    let y1 = -1;
    for (let y = band.y0; y <= band.y1; y += 1) {
      if (ink[y * PROBE_SIZE + x]) {
        if (y0 < 0) {
          y0 = y;
        }
        y1 = y;
      }
    }
    if (y0 < 0) {
      if (current) {
        columns.push(current);
      }
      current = null;
      continue;
    }
    if (current && Math.abs(current.y0 - y0) <= SPAN_TOLERANCE && Math.abs(current.y1 - y1) <= SPAN_TOLERANCE) {
      current.x1 = x;
      continue;
    }
    if (current) {
      columns.push(current);
    }
    current = { x0: x, y0, x1: x, y1 };
  }
  if (current) {
    columns.push(current);
  }
  // Los perfiles laterales quedan pegados al frontal por 1-2 px de pelo suelto:
  // esas astillas se descartan ANTES de fusionar, porque un margen de separación
  // real entre piezas es de ~5 px y con la tolerancia ancha se colaban todas en
  // un solo bloque.
  const solid = columns.filter((column) => column.x1 - column.x0 + 1 >= MIN_COL_WIDTH);
  const merged: Span[] = [];
  for (const column of solid) {
    const previous = merged[merged.length - 1];
    if (previous && column.x0 - previous.x1 <= COLUMN_MERGE_GAP) {
      previous.x1 = Math.max(previous.x1, column.x1);
      previous.y0 = Math.min(previous.y0, column.y0);
      previous.y1 = Math.max(previous.y1, column.y1);
      continue;
    }
    merged.push({ ...column });
  }
  return merged;
}

function describeBlocks(regions: Record<HeadFace, [number, number, number, number]>): string {
  return (Object.keys(regions) as HeadFace[])
    .map((face) => `${face} ${regions[face].map((n) => Math.round(n * 100)).join('/')}`)
    .join(' | ');
}

function loadImage(loader: THREE.TextureLoader, url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (texture) => {
        const image = texture.image as HTMLImageElement;
        texture.dispose();
        if (!image) {
          reject(new Error(`La textura ${url} no es una imagen`));
          return;
        }
        if (image.complete && image.naturalWidth > 0) {
          resolve(image);
          return;
        }
        image.addEventListener('load', () => resolve(image), { once: true });
        image.addEventListener('error', () => reject(new Error(`No se pudo decodificar ${url}`)), {
          once: true,
        });
      },
      undefined,
      (error) => reject(new Error(`No se pudo cargar la textura ${url}: ${String(error)}`)),
    );
  });
}

function buildAtlas(
  image: HTMLImageElement,
  regions: Record<HeadFace, [number, number, number, number]>,
  tile: number,
): HeadAtlas {
  const canvas = document.createElement('canvas');
  canvas.width = tile * ATLAS_COLUMNS;
  canvas.height = tile * ATLAS_ROWS;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('No se pudo crear el contexto 2D para la cabeza del stalker');
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  TILE_ORDER.forEach((face, index) => {
    const [x0, y0, x1, y1] = regions[face];
    const column = index % ATLAS_COLUMNS;
    const row = Math.floor(index / ATLAS_COLUMNS);
    // El bloque se estira a la baldosa entera en vez de recortarse al centro:
    // los perfiles son más altos que anchos y recortarlos se comía la coronilla
    // y la barbilla, dejando la cara flotando en mitad de la baldosa.
    ctx.drawImage(
      image,
      x0 * width,
      y0 * height,
      Math.max(1, (x1 - x0) * width),
      Math.max(1, (y1 - y0) * height),
      column * tile,
      row * tile,
      tile,
      tile,
    );
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  const tiles = new Map<HeadFace, [number, number, number, number]>();
  TILE_ORDER.forEach((face, index) => {
    const column = index % ATLAS_COLUMNS;
    const row = Math.floor(index / ATLAS_COLUMNS);
    tiles.set(face, [
      column / ATLAS_COLUMNS,
      1 - (row + 1) / ATLAS_ROWS,
      (column + 1) / ATLAS_COLUMNS,
      1 - row / ATLAS_ROWS,
    ]);
  });

  return { texture, tile, remap: (geometry) => remapBoxUvs(geometry, tiles) };
}

function remapBoxUvs(
  geometry: THREE.BoxGeometry,
  tiles: Map<HeadFace, [number, number, number, number]>,
): void {
  const uv = geometry.getAttribute('uv');
  BOX_FACE_ORDER.forEach((face, group) => {
    const tile = tiles.get(face);
    if (!tile) {
      return;
    }
    for (let corner = 0; corner < 4; corner += 1) {
      const index = group * 4 + corner;
      if (index >= uv.count) {
        return;
      }
      const u = uv.getX(index);
      const v = uv.getY(index);
      uv.setXY(index, tile[0] + u * (tile[2] - tile[0]), tile[1] + v * (tile[3] - tile[1]));
    }
  });
  uv.needsUpdate = true;
}

const SKIN = '#c98d6f';
const SKIN_DARK = '#a56a51';
const HAIR = '#241710';
const HAIR_LIGHT = '#3a2417';
const MOUTH = '#150b08';
const TEETH = '#e6dcc4';
const EYE = '#f2ead6';

function buildFallbackAtlas(): HeadAtlas {
  const tile = FALLBACK_TILE;
  const canvas = document.createElement('canvas');
  canvas.width = tile * ATLAS_COLUMNS;
  canvas.height = tile * ATLAS_ROWS;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('No se pudo crear el contexto 2D para la cabeza del stalker');
  }
  ctx.imageSmoothingEnabled = false;

  const at = (face: HeadFace): [number, number] => {
    const index = TILE_ORDER.indexOf(face);
    return [(index % ATLAS_COLUMNS) * tile, Math.floor(index / ATLAS_COLUMNS) * tile];
  };
  const fill = (face: HeadFace, color: string): void => {
    const [x, y] = at(face);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, tile, tile);
  };
  const box = (face: HeadFace, color: string, fx: number, fy: number, fw: number, fh: number): void => {
    const [x, y] = at(face);
    ctx.fillStyle = color;
    ctx.fillRect(x + Math.round(fx * tile), y + Math.round(fy * tile), Math.round(fw * tile), Math.round(fh * tile));
  };

  fill('top', HAIR);
  box('top', HAIR_LIGHT, 0.25, 0.0, 0.5, 1.0);
  fill('back', HAIR);
  box('back', HAIR_LIGHT, 0.3, 0.1, 0.4, 0.9);
  fill('bottom', SKIN_DARK);
  box('bottom', HAIR, 0.0, 0.35, 1.0, 0.65);

  fill('front', SKIN);
  box('front', HAIR, 0.0, 0.0, 1.0, 0.22);
  box('front', HAIR, 0.0, 0.18, 0.14, 0.2);
  box('front', HAIR, 0.86, 0.18, 0.14, 0.2);
  box('front', SKIN_DARK, 0.28, 0.36, 0.16, 0.06);
  box('front', SKIN_DARK, 0.56, 0.36, 0.16, 0.06);
  box('front', EYE, 0.3, 0.42, 0.12, 0.06);
  box('front', EYE, 0.58, 0.42, 0.12, 0.06);
  box('front', MOUTH, 0.46, 0.42, 0.08, 0.06);
  box('front', SKIN_DARK, 0.44, 0.52, 0.12, 0.14);
  box('front', MOUTH, 0.2, 0.62, 0.6, 0.1);
  box('front', TEETH, 0.26, 0.62, 0.48, 0.06);
  box('front', MOUTH, 0.24, 0.76, 0.52, 0.1);

  for (const face of ['left', 'right'] as HeadFace[]) {
    fill(face, SKIN);
    box(face, HAIR, 0.0, 0.0, 0.62, 0.26);
    box(face, HAIR, 0.0, 0.22, 0.3, 0.6);
    box(face, SKIN_DARK, 0.5, 0.3, 0.2, 0.14);
    box(face, EYE, 0.44, 0.36, 0.12, 0.07);
    box(face, MOUTH, 0.34, 0.55, 0.1, 0.2);
    box(face, SKIN_DARK, 0.3, 0.8, 0.5, 0.2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  const tiles = new Map<HeadFace, [number, number, number, number]>();
  TILE_ORDER.forEach((face, index) => {
    const column = index % ATLAS_COLUMNS;
    const row = Math.floor(index / ATLAS_COLUMNS);
    tiles.set(face, [
      column / ATLAS_COLUMNS,
      1 - (row + 1) / ATLAS_ROWS,
      (column + 1) / ATLAS_COLUMNS,
      1 - row / ATLAS_ROWS,
    ]);
  });

  return { texture, tile, remap: (geometry) => remapBoxUvs(geometry, tiles) };
}
