export const GLYPH_SIZE = 8;
export const GLYPH_ADVANCE = 8;

const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;
const GLYPH_OFFSET_X = 1;
const ATLAS_COLUMNS = 16;
const FALLBACK = '�';

type Bitmap = boolean[][];

export interface DrawTextOptions {
  scale?: number;
  color?: string;
  align?: 'left' | 'center' | 'right';
  shadow?: string | null;
  spacing?: number;
  // Píxeles extra entre líneas (solo lo usan wrapText/wrapCentered).
  lineSpacing?: number;
}

const BASE: Record<string, string> = {
  ' ': '',
  '!': '..#../..#../..#../..#../..#../...../..#..',
  '"': '.#.#./.#.#./...../...../...../...../.....',
  '#': '.#.#./.#.#./#####/.#.#./#####/.#.#./.#.#.',
  $: '..#../.####/#.#../.###./..#.#/####./..#..',
  '%': '##.../##..#/...#./..#../.#.../#..##/...##',
  '&': '.##../#..#./#.#../.#.../#.#.#/#..#./.##.#',
  "'": '..#../..#../...../...../...../...../.....',
  '(': '...#./..#../.#.../.#.../.#.../..#../...#.',
  ')': '.#.../..#../...#./...#./...#./..#../.#...',
  '*': '..#../#.#.#/.###./#.#.#/..#../...../.....',
  '+': '...../..#../..#../#####/..#../..#../.....',
  ',': '...../...../...../...../..#../..#../.#...',
  '-': '...../...../...../#####/...../...../.....',
  '.': '...../...../...../...../...../.##../.##..',
  '/': '....#/...#./..#../..#../.#.../#..../#....',
  0: '.###./#...#/#..##/#.#.#/##..#/#...#/.###.',
  1: '..#../.##../..#../..#../..#../..#../.###.',
  2: '.###./#...#/....#/...#./..#../.#.../#####',
  3: '#####/...#./..##./....#/....#/#...#/.###.',
  4: '...#./..##./.#.#./#..#./#####/...#./...#.',
  5: '#####/#..../####./....#/....#/#...#/.###.',
  6: '..##./.#.../#..../####./#...#/#...#/.###.',
  7: '#####/....#/...#./..#../.#.../.#.../.#...',
  8: '.###./#...#/#...#/.###./#...#/#...#/.###.',
  9: '.###./#...#/#...#/.####/....#/...#./.##..',
  ':': '...../.##../.##../...../.##../.##../.....',
  ';': '...../.##../.##../...../.##../..#../.#...',
  '<': '...#./..#../.#.../#..../.#.../..#../...#.',
  '=': '...../...../#####/...../#####/...../.....',
  '>': '.#.../..#../...#./....#/...#./..#../.#...',
  '?': '.###./#...#/....#/...#./..#../...../..#..',
  '@': '.###./#...#/#.###/#.#.#/#.###/#..../.###.',
  A: '.###./#...#/#...#/#####/#...#/#...#/#...#',
  B: '####./#...#/#...#/####./#...#/#...#/####.',
  C: '.###./#...#/#..../#..../#..../#...#/.###.',
  D: '####./#...#/#...#/#...#/#...#/#...#/####.',
  E: '#####/#..../#..../####./#..../#..../#####',
  F: '#####/#..../#..../####./#..../#..../#....',
  G: '.###./#...#/#..../#.###/#...#/#...#/.###.',
  H: '#...#/#...#/#...#/#####/#...#/#...#/#...#',
  I: '.###./..#../..#../..#../..#../..#../.###.',
  J: '..###/...#./...#./...#./...#./#..#./.##..',
  K: '#...#/#..#./#.#../##.../#.#../#..#./#...#',
  L: '#..../#..../#..../#..../#..../#..../#####',
  M: '#...#/##.##/#.#.#/#...#/#...#/#...#/#...#',
  N: '#...#/##..#/##..#/#.#.#/#..##/#..##/#...#',
  O: '.###./#...#/#...#/#...#/#...#/#...#/.###.',
  P: '####./#...#/#...#/####./#..../#..../#....',
  Q: '.###./#...#/#...#/#...#/#.#.#/#..#./.##.#',
  R: '####./#...#/#...#/####./#.#../#..#./#...#',
  S: '.####/#..../#..../.###./....#/....#/####.',
  T: '#####/..#../..#../..#../..#../..#../..#..',
  U: '#...#/#...#/#...#/#...#/#...#/#...#/.###.',
  V: '#...#/#...#/#...#/#...#/#...#/.#.#./..#..',
  W: '#...#/#...#/#...#/#...#/#.#.#/##.##/#...#',
  X: '#...#/#...#/.#.#./..#../.#.#./#...#/#...#',
  Y: '#...#/#...#/.#.#./..#../..#../..#../..#..',
  Z: '#####/....#/...#./..#../.#.../#..../#####',
  '[': '..###/..#../..#../..#../..#../..#../..###',
  '\\': '#..../#..../.#.../..#../...#./....#/....#',
  ']': '###../..#../..#../..#../..#../..#../###..',
  '^': '..#../.#.#./#...#/...../...../...../.....',
  _: '...../...../...../...../...../...../#####',
  '`': '.#.../..#../...../...../...../...../.....',
  a: '...../...../.###./#...#/#####/#...#/.###.',
  b: '#..../#..../####./#...#/#...#/#...#/####.',
  c: '...../...../.###./#..../#..../#..../.###.',
  d: '....#/....#/.####/#...#/#...#/#...#/.####',
  e: '...../...../.###./#...#/#####/#..../.###.',
  f: '..##./.#..#/.#.../###../.#.../.#.../.#...',
  g: '...../...../.####/#...#/.####/....#/.###.',
  h: '#..../#..../####./#...#/#...#/#...#/#...#',
  i: '..#../...../.##../..#../..#../..#../.###.',
  ı: '..#../...../..#../..#../..#../..#../.###.',
  j: '...#./...../..##./...#./...#./#..#./.##..',
  k: '#..../#..../#..#./#.#../##.../#.#../#..#.',
  l: '.##../..#../..#../..#../..#../..#../.###.',
  m: '...../...../##.#./#.#.#/#.#.#/#.#.#/#.#.#',
  n: '...../...../####./#...#/#...#/#...#/#...#',
  o: '...../...../.###./#...#/#...#/#...#/.###.',
  p: '...../...../####./#...#/#...#/####./#....',
  q: '...../...../.####/#...#/.####/....#/....#',
  r: '...../...../#.##./##.../#..../#..../#....',
  s: '...../...../.####/#..../.###./....#/####.',
  t: '.#.../.#.../###../.#.../.#.../.#..#/..##.',
  u: '...../...../#...#/#...#/#...#/#...#/.####',
  v: '...../...../#...#/#...#/#...#/.#.#./..#..',
  w: '...../...../#...#/#.#.#/#.#.#/#.#.#/.#.#.',
  x: '...../...../#...#/.#.#./..#../.#.#./#...#',
  y: '...../...../#...#/#...#/.####/....#/.###.',
  z: '...../...../#####/...#./..#../.#.../#####',
  '{': '...##/..#../..#../.#.../..#../..#../...##',
  '|': '..#../..#../..#../..#../..#../..#../..#..',
  '}': '##.../..#../..#../...#./..#../..#../##...',
  '~': '...../...../.##../#..##/...../...../.....',
  '¿': '..#../...../..#../...#./#..../#...#/.###.',
  '¡': '..#../...../..#../..#../..#../..#../..#..',
  '«': '...../...../.#.#./#...#/.#.#./...../.....',
  '»': '...../...../#.#../#...#/#.#../...../.....',
  '·': '...../...../...../.##../.##../...../.....',
  '–': '...../...../...../.###./...../...../.....',
  '—': '...../...../...../#####/...../...../.....',
  '°': '.##../#..#./#..#./.##../...../...../.....',
  '©': '.###./#..#./#.##./#.#../#.##./#..#./.###.',
  '€': '..###/..#../.##../..#../.##../..#../..###',
  '█': '#####/#####/#####/#####/#####/#####/#####',
  '▓': '#.#.#/.#.#./#.#.#/.#.#./#.#.#/.#.#./#.#.#',
  '▒': '...../.#.#./#.#.#/.#.#./#.#.#/...../.....',
  '░': '...../...../...../...../...../...../.#.#.',
  '▌': '##.../##.../##.../##.../##.../##.../##...',
  '▐': '...##/...##/...##/...##/...##/...##/...##',
  '▀': '#####/#####/#####/...../...../...../.....',
  '▄': '...../...../...../#####/#####/#####/#####',
  '■': '...../#####/#####/#####/#####/...../.....',
  '□': '...../.###./.#.#./.#.#./.###./...../.....',
  '▲': '...../..#../.###./#####/...../...../.....',
  '▼': '...../...../#####/.###./..#../...../.....',
  '◀': '..#../.##../.###./.##../..#../...../.....',
  '▶': '..#../..##./..###/..##./..#../...../.....',
  '●': '...../.###./#####/#####/#####/.###./.....',
  '○': '...../.###./#...#/#...#/#...#/.###./.....',
  '★': '..#../..#../#####/.###./.#.#./...../.....',
  '✔': '...../....#/...#./#..#./.##../..#../.....',
  '✖': '...../#...#/.#.#./..#../.#.#./#...#/.....',
  '→': '...../..#../...#./#####/...#./..#../.....',
  '←': '...../..#../.#.../#####/.#.../..#../.....',
  '↑': '..#../.###./#.#.#/..#../..#../..#../.....',
  '↓': '...../..#../..#../..#../#.#.#/.###./..#..',
};

type Mark = ReadonlyArray<readonly [col: number, row: number]>;

const SPACE_LIKE = new Set(['\n', '\r', '\t', '\u00a0', '\u2007', '\u202f', '\u2009', '\u200a']);

const ACUTE: Mark = [[2, 0]];
const DIAERESIS: Mark = [
  [1, 0],
  [3, 0],
];
const TILDE: Mark = [
  [1, 0],
  [2, 0],
  [3, 0],
];

const ACCENTED: Record<string, readonly [base: string, mark: Mark, xHeight: boolean]> = {
  Á: ['A', ACUTE, false],
  É: ['E', ACUTE, false],
  Í: ['I', ACUTE, false],
  Ó: ['O', ACUTE, false],
  Ú: ['U', ACUTE, false],
  Ü: ['U', DIAERESIS, false],
  Ñ: ['N', TILDE, false],
  á: ['a', ACUTE, true],
  é: ['e', ACUTE, true],
  í: ['ı', ACUTE, true],
  ó: ['o', ACUTE, true],
  ú: ['u', ACUTE, true],
  ü: ['u', DIAERESIS, true],
  ñ: ['n', TILDE, true],
};

function emptyBitmap(): Bitmap {
  return Array.from({ length: GLYPH_HEIGHT }, () => new Array<boolean>(GLYPH_WIDTH).fill(false));
}

function parseGlyph(data: string): Bitmap {
  const bitmap = emptyBitmap();
  if (data === '') {
    return bitmap;
  }
  const rows = data.split('/');
  for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
    const line = rows[row] ?? '';
    for (let col = 0; col < GLYPH_WIDTH; col += 1) {
      bitmap[row][col] = line[col] === '#';
    }
  }
  return bitmap;
}

function fitBelow(bitmap: Bitmap, mark: Mark): Bitmap {
  const result = emptyBitmap();
  for (let col = 0; col < GLYPH_WIDTH; col += 1) {
    result[GLYPH_HEIGHT - 1][col] = bitmap[GLYPH_HEIGHT - 2][col];
    for (let row = 0; row < GLYPH_HEIGHT - 2; row += 1) {
      result[row + 1][col] = bitmap[row][col];
    }
  }
  return applyMark(result, mark);
}

function applyMark(bitmap: Bitmap, mark: Mark): Bitmap {
  const result = bitmap.map((row) => row.slice());
  for (const [col, row] of mark) {
    if (col < GLYPH_WIDTH && row < GLYPH_HEIGHT) {
      result[row][col] = true;
    }
  }
  return result;
}

function buildGlyphs(): Map<string, Bitmap> {
  const glyphs = new Map<string, Bitmap>();
  for (const [char, data] of Object.entries(BASE)) {
    glyphs.set(char, parseGlyph(data));
  }
  for (const [char, [base, mark, xHeight]] of Object.entries(ACCENTED)) {
    const bitmap = glyphs.get(base);
    if (!bitmap) {
      continue;
    }
    glyphs.set(char, xHeight ? applyMark(bitmap, mark) : fitBelow(bitmap, mark));
  }
  const box = emptyBitmap();
  box[0][0] = true;
  box[0][1] = true;
  box[0][2] = true;
  box[0][3] = true;
  box[0][4] = true;
  box[6][0] = true;
  box[6][1] = true;
  box[6][2] = true;
  box[6][3] = true;
  box[6][4] = true;
  for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
    box[row][0] = true;
    box[row][4] = true;
  }
  glyphs.set(FALLBACK, box);
  return glyphs;
}

export class BitmapFont {
  readonly atlas: HTMLCanvasElement;
  readonly advance = GLYPH_ADVANCE;
  readonly cell = GLYPH_SIZE;

  private readonly glyphs: Map<string, Bitmap>;
  private readonly order: string[];
  private readonly cells = new Map<string, { x: number; y: number }>();
  private readonly tinted = new Map<string, HTMLCanvasElement>();

  constructor() {
    this.glyphs = buildGlyphs();
    this.order = [...this.glyphs.keys()];
    for (let index = 0; index < this.order.length; index += 1) {
      const column = index % ATLAS_COLUMNS;
      const row = Math.floor(index / ATLAS_COLUMNS);
      this.cells.set(this.order[index], { x: column * GLYPH_SIZE, y: row * GLYPH_SIZE });
    }
    this.atlas = this.buildAtlas();
  }

  measure(text: string, scale: number = 1): number {
    return text.length * GLYPH_ADVANCE * Math.max(1, Math.round(scale));
  }

  lineHeight(scale: number = 1): number {
    return GLYPH_SIZE * Math.max(1, Math.round(scale));
  }

  glyphExists(char: string): boolean {
    return this.glyphs.has(char) || SPACE_LIKE.has(char);
  }

  draw(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    options: DrawTextOptions = {},
  ): number {
    const scale = Math.max(1, Math.round(options.scale ?? 1));
    const spacing = options.spacing ?? 0;
    const step = GLYPH_ADVANCE * scale + spacing;
    const originX = this.anchorX(text, x, options.align ?? 'left', step);
    const originY = Math.round(y);

    if (options.shadow) {
      this.paint(ctx, text, originX + scale, originY + scale, scale, spacing, options.shadow);
    }
    this.paint(ctx, text, originX, originY, scale, spacing, options.color ?? '#cfc7ae');

    return text.length * step;
  }

  private anchorX(text: string, x: number, align: DrawTextOptions['align'], step: number): number {
    if (align === 'center') {
      return Math.round(x - (text.length * step) / 2);
    }
    if (align === 'right') {
      return Math.round(x - text.length * step);
    }
    return Math.round(x);
  }

  private paint(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    scale: number,
    spacing: number,
    color: string,
  ): void {
    const step = GLYPH_ADVANCE * scale + spacing;
    const source = this.tintedAtlas(color);
    ctx.imageSmoothingEnabled = false;
    let cursor = x;
    for (const char of text) {
      const cell = this.cells.get(SPACE_LIKE.has(char) ? " " : char) ?? this.cells.get(FALLBACK);
      if (cell) {
        ctx.drawImage(
          source,
          cell.x,
          cell.y,
          GLYPH_SIZE,
          GLYPH_SIZE,
          cursor,
          y,
          GLYPH_SIZE * scale,
          GLYPH_SIZE * scale,
        );
      }
      cursor += step;
    }
  }

  private tintedAtlas(color: string): HTMLCanvasElement {
    const cached = this.tinted.get(color);
    if (cached) {
      return cached;
    }
    const canvas = document.createElement('canvas');
    canvas.width = this.atlas.width;
    canvas.height = this.atlas.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.atlas, 0, 0);
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'source-over';
    }
    this.tinted.set(color, canvas);
    return canvas;
  }

  private buildAtlas(): HTMLCanvasElement {
    const rows = Math.ceil(this.order.length / ATLAS_COLUMNS);
    const canvas = document.createElement('canvas');
    canvas.width = ATLAS_COLUMNS * GLYPH_SIZE;
    canvas.height = rows * GLYPH_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return canvas;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    for (let index = 0; index < this.order.length; index += 1) {
      const char = this.order[index];
      const bitmap = this.glyphs.get(char);
      const cell = this.cells.get(char);
      if (!bitmap || !cell) {
        continue;
      }
      for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
        for (let col = 0; col < GLYPH_WIDTH; col += 1) {
          if (bitmap[row][col]) {
            ctx.fillRect(cell.x + GLYPH_OFFSET_X + col, cell.y + row, 1, 1);
          }
        }
      }
    }
    return canvas;
  }
}

let instance: BitmapFont | null = null;

export function createBitmapFont(): BitmapFont {
  if (!instance) {
    instance = new BitmapFont();
  }
  return instance;
}
