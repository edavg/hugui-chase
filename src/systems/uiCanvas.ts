import { BitmapFont, type DrawTextOptions } from './font';

export const UI_WIDTH = 640;
export const UI_HEIGHT = 480;

export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
  canvasWidth: number;
  canvasHeight: number;
}

export interface PanelOptions {
  fill?: string;
  border?: string;
  alpha?: number;
  title?: string;
  titleColor?: string;
  titleScale?: number;
}

export interface BarOptions {
  color?: string;
  segments?: number;
}

export const PALETTE = {
  void: '#000000',
  bg: '#0b0b0e',
  panel: '#16161b',
  panelLight: '#22222a',
  border: '#4a4438',
  text: '#cfc7ae',
  textDim: '#8f8876',
  textDark: '#6b6350',
  textBright: '#f4ecd6',
  accent: '#a33a2e',
  accentDim: '#6d2620',
  good: '#7f9a6a',
  shadow: '#000000',
} as const;

const BLINK_HZ = 1.6;
const CURSOR_BLOCK = '\u258c';

export type { DrawTextOptions };

function requireCanvas(): HTMLCanvasElement {
  const canvas = document.getElementById('ui');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('No se encontró el canvas #ui');
  }
  return canvas;
}

export class UiCanvas {
  readonly width = UI_WIDTH;
  readonly height = UI_HEIGHT;
  readonly ctx: CanvasRenderingContext2D;
  readonly font: BitmapFont;

  private readonly canvas: HTMLCanvasElement;
  private readonly getViewport: () => ViewportRect;
  private blinkTime = 0;
  private dirty = true;

  constructor(font: BitmapFont, getViewport: () => ViewportRect) {
    this.font = font;
    this.getViewport = getViewport;
    this.canvas = requireCanvas();
    this.canvas.width = UI_WIDTH;
    this.canvas.height = UI_HEIGHT;
    const ctx = this.canvas.getContext('2d', { alpha: true });
    if (!ctx) {
      throw new Error('No se pudo crear el contexto 2D de la interfaz');
    }
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  get blinkVisible(): boolean {
    return this.blinkTime % (1 / BLINK_HZ) < 1 / BLINK_HZ / 2;
  }

  resize = (): void => {
    const rect = this.getViewport();
    const host = this.canvas.parentElement ?? document.body;
    const hostRect = host.getBoundingClientRect();
    const scaleX = hostRect.width / Math.max(1, rect.canvasWidth);
    const scaleY = hostRect.height / Math.max(1, rect.canvasHeight);
    this.canvas.style.position = 'fixed';
    this.canvas.style.left = `${hostRect.left + rect.x * scaleX}px`;
    this.canvas.style.top = `${hostRect.top + rect.y * scaleY}px`;
    this.canvas.style.width = `${Math.max(1, Math.round(rect.width * scaleX))}px`;
    this.canvas.style.height = `${Math.max(1, Math.round(rect.height * scaleY))}px`;
    this.canvas.style.imageRendering = 'pixelated';
    this.dirty = true;
  };

  update(dt: number): void {
    this.blinkTime = (this.blinkTime + dt) % 1000;
  }

  markDirty(): void {
    this.dirty = true;
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  begin(): void {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.globalAlpha = 1;
    this.ctx.clearRect(0, 0, UI_WIDTH, UI_HEIGHT);
    this.dirty = true;
  }

  end(): void {
    this.ctx.globalAlpha = 1;
  }

  clear(color: string = PALETTE.void, alpha = 1): void {
    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, UI_WIDTH, UI_HEIGHT);
    this.ctx.globalAlpha = 1;
  }

  rect(x: number, y: number, w: number, h: number, color: string, alpha = 1): void {
    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    this.ctx.globalAlpha = 1;
  }

  frame(x: number, y: number, w: number, h: number, color: string, thickness = 1, alpha = 1): void {
    const t = Math.max(1, Math.round(thickness));
    this.rect(x, y, w, t, color, alpha);
    this.rect(x, y + h - t, w, t, color, alpha);
    this.rect(x, y + t, t, h - t * 2, color, alpha);
    this.rect(x + w - t, y + t, t, h - t * 2, color, alpha);
  }

  panel(x: number, y: number, w: number, h: number, options: PanelOptions = {}): void {
    const fill = options.fill ?? PALETTE.panel;
    const border = options.border ?? PALETTE.border;
    this.rect(x, y, w, h, fill, options.alpha ?? 0.92);
    this.frame(x, y, w, h, border, 1, options.alpha ?? 1);
    this.frame(x + 2, y + 2, w - 4, h - 4, PALETTE.panelLight, 1, 0.6);
    if (options.title) {
      const scale = options.titleScale ?? 1;
      const width = this.font.measure(options.title, scale);
      this.rect(x, y - 4, width + 8, 8 * scale, fill, 1);
      this.text(
        options.title,
        x + 4,
        y - 4,
        { scale, color: options.titleColor ?? PALETTE.text, shadow: PALETTE.shadow },
      );
    }
  }

  text(str: string, x: number, y: number, options: DrawTextOptions = {}): number {
    return this.font.draw(this.ctx, str, x, y, options);
  }

  textCentered(str: string, y: number, options: DrawTextOptions = {}): number {
    const scale = options.scale ?? 1;
    const width = this.font.measure(str, scale);
    return this.font.draw(this.ctx, str, Math.round(UI_WIDTH / 2 - width / 2), y, options);
  }

  textCenteredIn(
    str: string,
    centerX: number,
    y: number,
    options: DrawTextOptions = {},
  ): number {
    const scale = options.scale ?? 1;
    const width = this.font.measure(str, scale);
    return this.font.draw(this.ctx, str, Math.round(centerX - width / 2), y, options);
  }

  textRight(str: string, rightX: number, y: number, options: DrawTextOptions = {}): number {
    const scale = options.scale ?? 1;
    const width = this.font.measure(str, scale);
    return this.font.draw(this.ctx, str, Math.round(rightX - width), y, options);
  }

  wrapText(
    str: string,
    x: number,
    y: number,
    maxWidth: number,
    options: DrawTextOptions = {},
  ): number {
    const scale = options.scale ?? 1;
    const charWidth = this.font.advance * scale;
    const columns = Math.max(1, Math.floor(maxWidth / Math.max(1, charWidth)));
    const lineHeight = this.font.lineHeight(scale) + (options.lineSpacing ?? 0);
    const lines: string[] = [];
    for (const paragraph of str.split('\n')) {
      if (paragraph === '') {
        lines.push('');
        continue;
      }
      let current = '';
      for (const word of paragraph.split(' ')) {
        const candidate = current === '' ? word : `${current} ${word}`;
        if (current !== '' && candidate.length > columns) {
          lines.push(current);
          current = word;
        } else {
          current = candidate;
        }
      }
      lines.push(current);
    }
    lines.forEach((line, index) => {
      this.font.draw(this.ctx, line, x, y + index * lineHeight, options);
    });
    return lines.length * lineHeight;
  }

  wrapCentered(str: string, centerX: number, y: number, maxWidth: number, options: DrawTextOptions = {}): number {
    const scale = options.scale ?? 1;
    const charWidth = this.font.advance * scale;
    const columns = Math.max(1, Math.floor(maxWidth / Math.max(1, charWidth)));
    const lineHeight = this.font.lineHeight(scale) + (options.lineSpacing ?? 0);
    const lines: string[] = [];
    for (const paragraph of str.split('\n')) {
      if (paragraph === '') {
        lines.push('');
        continue;
      }
      let current = '';
      for (const word of paragraph.split(' ')) {
        const candidate = current === '' ? word : `${current} ${word}`;
        if (current !== '' && candidate.length > columns) {
          lines.push(current);
          current = word;
        } else {
          current = candidate;
        }
      }
      lines.push(current);
    }
    lines.forEach((line, index) => {
      this.textCenteredIn(line, centerX, y + index * lineHeight, options);
    });
    return lines.length * lineHeight;
  }

  bar(x: number, y: number, w: number, h: number, value: number, options: BarOptions = {}): void {
    const segments = options.segments ?? 16;
    const segmentWidth = Math.floor(w / segments);
    const filled = Math.round(Math.max(0, Math.min(1, value)) * segments);
    this.rect(x, y, w, h, PALETTE.panelLight, 1);
    this.frame(x, y, w, h, PALETTE.border, 1);
    for (let i = 0; i < segments; i += 1) {
      if (i < filled) {
        this.rect(
          x + 2 + i * segmentWidth,
          y + 2,
          Math.max(1, segmentWidth - 1),
          h - 4,
          options.color ?? PALETTE.text,
        );
      }
    }
  }

  cursor(x: number, y: number, color: string = PALETTE.accent, scale = 1): void {
    if (!this.blinkVisible) {
      return;
    }
    this.text(CURSOR_BLOCK, x, y, { color, scale });
  }

  barPercent(value: number, min: number, max: number): number {
    return (value - min) / (max - min);
  }
}
