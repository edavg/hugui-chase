import type { Language } from './i18n';
import { TEXTS } from './i18n';
import type { UiCanvas } from './uiCanvas';
import { PALETTE, UI_WIDTH } from './uiCanvas';

const TYPE_SPEED = 55;
const TOAST_SECONDS = 2.6;

const PAPER = '#cfc7ae';
const PAPER_INK = '#2b2723';
const PAPER_RULE = '#8a8065';

const STRIP_HEIGHT = 26;
const STRIP_PADDING = 16;
const STRIP_TEXT_Y = 9;
const PROMPT_BOTTOM = 72;
// En vertical el aviso se coloca por encima de la botonera derecha.
const PROMPT_BOTTOM_PORTRAIT = 200;
const TOAST_TOP = 24;

const TITLE_SCALE = 2;
const LINE_SCALE = 1;
// Aire extra entre líneas de los párrafos (la celda 8×8 sin él se ve densa).
const BODY_LINE_SPACING = 3;
const NOTE_WIDTH = 528;
const NOTE_PADDING = 24;
const NOTE_TITLE_GAP = 10;
const NOTE_MAX_HEIGHT = 400;
const NOTE_HINT_GAP = 12;
const NOTE_BOTTOM_MARGIN = 30;




const ENDING_WIDTH = 480;
const ENDING_TITLE_SCALE = 3;

// Corazón pixel-art: dos lóbulos arriba con muesca, cuerpo ancho y punta abajo.
// '1' relleno, '2' brillo, '.' vacío.
const HEART_PATTERN: readonly string[] = [
  '.11...11.',
  '1221.1111',
  '111111111',
  '111111111',
  '111111111',
  '.1111111.',
  '..11111..',
  '...111...',
  '....1....',
];
const HEART_PIXEL = 3;
const HEART_WIDTH = 9 * HEART_PIXEL;
const HEART_GAP = 4;
const HEART_MARGIN = 14;
const HEART_RED = '#c0392b';
const HEART_HIGHLIGHT = '#e0715f';
const HEART_ALPHA = 0.85;
const HEART_EMPTY_ALPHA = 0.32;
const DAMAGE_FLASH_DECAY = 1.4;

const POSTER_MARGIN = 14;
const POSTER_ICON_SIZE = 10;

export interface UiOptions {
  showSubtitles: boolean;
  touchControls: boolean;
}

export interface UiVisibility {
  prompt: boolean;
  toast: boolean;
  note: boolean;
}

export class Ui {
  private readonly ui: UiCanvas;
  private readonly lang: () => Language;
  private options: UiOptions = {
    showSubtitles: true,
    touchControls: false,
  };

  private promptText = '';
  private toastText = '';
  private toastRemaining = 0;

  private noteVisible = false;
  private noteTitle = '';
  private noteFull = '';
  private noteRevealed = 0;


  private endingVisible = false;
  private endingTitle = '';
  private endingText = '';
  private endingHint = '';

  private heartsVisible = false;
  private hearts = 3;
  private maxHearts = 3;
  private damageFlash = 0;

  private posterHave = 0;
  private posterTotal = 12;
  private posterVisible = false;

  constructor(ui: UiCanvas, lang: () => Language) {
    this.ui = ui;
    this.lang = lang;
  }

  // Vertical: la interfaz usa la resolución vertical del render (más alta que
  // ancha) y cada pantalla recalcula sus anclas.
  private get portrait(): boolean {
    return this.ui.height > this.ui.width;
  }

  setOptions(options: Partial<UiOptions>): void {
    this.options = { ...this.options, ...options };
  }

  get visibility(): UiVisibility {
    return {
      prompt: this.promptText !== '',
      toast: this.toastText !== '',
      note: this.noteVisible,
    };
  }

  currentPrompt(): string {
    return this.promptText;
  }

  setPrompt(text: string): void {
    this.promptText = text;
  }

  showHearts(current: number, max: number): void {
    this.maxHearts = Math.max(1, Math.round(max));
    this.hearts = Math.max(0, Math.min(this.maxHearts, Math.round(current)));
    this.heartsVisible = true;
  }

  setHearts(current: number): void {
    this.hearts = Math.max(0, Math.min(this.maxHearts, Math.round(current)));
  }

  setPosterCount(have: number, total: number): void {
    this.posterHave = Math.max(0, Math.round(have));
    this.posterTotal = Math.max(1, Math.round(total));
    this.posterVisible = true;
  }

  get heartCount(): number {
    return this.hearts;
  }

  flashDamage(): void {
    this.damageFlash = 1;
  }

  toast(text: string, seconds = TOAST_SECONDS): void {
    this.toastText = text;
    this.toastRemaining = seconds;
  }

  update(dt: number): void {
    this.ui.update(dt);
    if (this.damageFlash > 0) {
      this.damageFlash = Math.max(0, this.damageFlash - dt * DAMAGE_FLASH_DECAY);
    }
    if (this.toastRemaining > 0) {
      this.toastRemaining = Math.max(0, this.toastRemaining - dt);
      if (this.toastRemaining <= 0) {
        this.toastText = '';
      }
    }
    if (this.noteVisible && this.noteRevealed < this.noteFull.length) {
      this.noteRevealed = Math.min(this.noteFull.length, this.noteRevealed + TYPE_SPEED * dt);
    }
  }

  hideAll(): void {
    this.promptText = '';
    this.toastText = '';
    this.toastRemaining = 0;
    this.noteVisible = false;
    this.endingVisible = false;
  }

  showNote(title: string, body: string): void {
    this.noteTitle = title;
    this.noteFull = body;
    this.noteRevealed = 0;
    this.noteVisible = true;
  }

  get noteComplete(): boolean {
    return this.noteRevealed >= this.noteFull.length;
  }

  revealNote(): void {
    this.noteRevealed = this.noteFull.length;
  }

  hideNote(): void {
    this.noteVisible = false;
  }

  showEnding(title: string, text: string, hint: string): void {
    this.endingTitle = title;
    this.endingText = text;
    this.endingHint = hint;
    this.endingVisible = true;
  }

  hideEnding(): void {
    this.endingVisible = false;
  }

  draw(): void {
    this.ui.begin();
    if (this.damageFlash > 0) {
      this.ui.rect(0, 0, this.ui.width, this.ui.height, PALETTE.accent, 0.3 * this.damageFlash);
    }
    if (this.endingVisible) {
      this.drawEnding();
      return;
    }
    if (this.noteVisible) {
      this.drawNote();
      return;
    }
    if (this.heartsVisible) {
      this.drawHearts();
    }
    if (this.posterVisible) {
      this.drawPosterCount();
    }
    if (!this.options.showSubtitles) {
      return;
    }
    if (this.promptText !== '') {
      this.drawPrompt();
    }
    if (this.toastText !== '') {
      this.drawToast();
    }
  }

  private drawHearts(): void {
    for (let index = 0; index < this.maxHearts; index += 1) {
      this.drawHeart(HEART_MARGIN + index * (HEART_WIDTH + HEART_GAP), HEART_MARGIN, index < this.hearts);
    }
  }

  private drawPosterCount(): void {
    const ui = this.ui;
    const x = UI_WIDTH - POSTER_MARGIN - 72;
    const y = POSTER_MARGIN;
    ui.panel(x, y, 72, POSTER_ICON_SIZE + 10, {
      fill: PALETTE.void,
      border: PALETTE.border,
      alpha: 0.72,
    });
    // Icono de fuego (triángulo invertido naranja)
    ui.rect(x + 8, y + 4, 8, 8, '#e67e22', 0.9);
    ui.rect(x + 10, y + 2, 4, 3, '#f39c12', 0.95);
    ui.text(`${this.posterHave}/${this.posterTotal}`, x + 22, y + 5, { color: PALETTE.textBright });
  }

  private drawHeart(x: number, y: number, filled: boolean): void {
    for (let row = 0; row < HEART_PATTERN.length; row += 1) {
      const line = HEART_PATTERN[row];
      for (let col = 0; col < line.length; col += 1) {
        const cell = line[col];
        if (cell === '.') {
          continue;
        }
        this.ui.rect(
          x + col * HEART_PIXEL,
          y + row * HEART_PIXEL,
          HEART_PIXEL,
          HEART_PIXEL,
          filled && cell === '2' ? HEART_HIGHLIGHT : HEART_RED,
          filled ? HEART_ALPHA : HEART_EMPTY_ALPHA,
        );
      }
    }
  }

  private drawPrompt(): void {
    const bottom = this.portrait ? PROMPT_BOTTOM_PORTRAIT : PROMPT_BOTTOM;
    const y = this.ui.height - bottom - STRIP_HEIGHT;
    this.drawStrip(this.promptText, y);
    this.ui.textCentered(this.promptText, y + STRIP_TEXT_Y, { color: PALETTE.text });
  }

  private drawToast(): void {
    const ui = this.ui;
    this.drawStrip(this.toastText, TOAST_TOP);
    const textY = TOAST_TOP + STRIP_TEXT_Y;
    const width = ui.font.measure(this.toastText, LINE_SCALE);
    ui.textCentered(this.toastText, textY, { color: PALETTE.text });
    ui.cursor(Math.round(ui.width / 2 + width / 2), textY, PALETTE.accent, LINE_SCALE);
  }

  private drawStrip(text: string, y: number): void {
    const ui = this.ui;
    const width = Math.min(ui.width - 16, ui.font.measure(text, LINE_SCALE) + STRIP_PADDING * 2);
    const x = Math.round((ui.width - width) / 2);
    ui.panel(x, y, width, STRIP_HEIGHT, {
      fill: PALETTE.void,
      border: PALETTE.border,
      alpha: 0.82,
    });
  }

  private drawNote(): void {
    const ui = this.ui;
    const texts = TEXTS[this.lang()];
    const portrait = this.portrait;
    const noteWidth = portrait ? Math.min(NOTE_WIDTH, ui.width - 28) : NOTE_WIDTH;
    const noteX = Math.round((ui.width - noteWidth) / 2);
    const padding = portrait ? 18 : NOTE_PADDING;
    const innerX = noteX + padding;
    const innerWidth = noteWidth - padding * 2;
    const lineHeight = ui.font.lineHeight(LINE_SCALE) + BODY_LINE_SPACING;
    const titleHeight = TITLE_SCALE * ui.font.lineHeight(LINE_SCALE);
    const revealed = this.noteFull.slice(0, Math.floor(this.noteRevealed));
    const complete = revealed.length >= this.noteFull.length;
    const lines = this.splitLines(revealed, innerWidth);
    const bodyHeight = lines.length * lineHeight;
    const maxHeight = portrait ? Math.max(140, ui.height - 170) : NOTE_MAX_HEIGHT;
    const sheetHeight = Math.min(
      maxHeight,
      padding * 2 + titleHeight + NOTE_TITLE_GAP + bodyHeight,
    );
    const sheetY = Math.round((ui.height - NOTE_BOTTOM_MARGIN - sheetHeight) / 2);
    const bodyY = sheetY + padding + titleHeight + NOTE_TITLE_GAP;

    ui.clear(PALETTE.void, 0.9);
    ui.rect(noteX + 4, sheetY + 4, noteWidth, sheetHeight, PALETTE.void, 0.55);
    ui.frame(noteX - 3, sheetY - 3, noteWidth + 6, sheetHeight + 6, PALETTE.void, 3, 0.6);
    ui.rect(noteX, sheetY, noteWidth, sheetHeight, PAPER, 1);
    ui.frame(noteX, sheetY, noteWidth, sheetHeight, PAPER_RULE, 1);

    const titleY = sheetY + padding;
    const titleWidth = Math.min(innerWidth, ui.font.measure(this.noteTitle, TITLE_SCALE));
    ui.text(this.noteTitle, innerX, titleY, { scale: TITLE_SCALE, color: PAPER_INK });
    ui.rect(innerX, titleY + titleHeight + 3, titleWidth, 2, PAPER_RULE, 1);

    ui.ctx.save();
    ui.ctx.beginPath();
    ui.ctx.rect(noteX, sheetY, noteWidth, sheetHeight);
    ui.ctx.clip();
    ui.wrapText(revealed, innerX, bodyY, innerWidth, {
      scale: LINE_SCALE,
      color: PAPER_INK,
      lineSpacing: BODY_LINE_SPACING,
    });
    ui.ctx.restore();

    if (!complete && lines.length > 0) {
      const last = lines.length - 1;
      const cursorY = bodyY + last * lineHeight;
      if (cursorY < sheetY + sheetHeight) {
        const cursorX = innerX + lines[last].length * ui.font.advance * LINE_SCALE;
        ui.cursor(cursorX, cursorY, PAPER_INK, LINE_SCALE);
      }
    }

    ui.textRight(
      this.options.touchControls ? texts.readHintTouch : texts.readHint,
      portrait ? ui.width - 20 : ui.width - 72,
      Math.min(ui.height - 12, sheetY + sheetHeight + NOTE_HINT_GAP),
      { color: PALETTE.textDark },
    );
  }

  private drawEnding(): void {
    const ui = this.ui;
    const lineHeight = ui.font.lineHeight(LINE_SCALE);
    const bodyLineHeight = lineHeight + BODY_LINE_SPACING;
    const titleHeight = ENDING_TITLE_SCALE * lineHeight;
    const endingWidth = this.portrait ? this.ui.width - 40 : ENDING_WIDTH;
    const bodyLines = this.splitLines(this.endingText, endingWidth);
    const bodyHeight = bodyLines.length * bodyLineHeight;
    const gap = 16;
    const total = titleHeight + gap + 8 + gap + bodyHeight + gap + lineHeight;
    const top = Math.round((ui.height - total) / 2);
    const centerX = ui.width / 2;
    const titleWidth = Math.max(
      96,
      Math.min(endingWidth, ui.font.measure(this.endingTitle, ENDING_TITLE_SCALE)),
    );

    ui.clear(PALETTE.void, 1);
    ui.textCentered(this.endingTitle, top, {
      scale: ENDING_TITLE_SCALE,
      color: PALETTE.accent,
    });
    ui.rect(
      Math.round((ui.width - titleWidth) / 2),
      top + titleHeight + gap,
      titleWidth,
      1,
      PALETTE.accentDim,
    );
    ui.wrapCentered(this.endingText, centerX, top + titleHeight + gap + 8 + gap, endingWidth, {
      color: PALETTE.text,
      lineSpacing: BODY_LINE_SPACING,
    });
    ui.textCentered(this.endingHint, top + total - lineHeight, { color: PALETTE.textDark });
  }

  private splitLines(text: string, maxWidth: number, scale = LINE_SCALE): string[] {
    const charWidth = Math.max(1, this.ui.font.advance * scale);
    const columns = Math.max(1, Math.floor(maxWidth / charWidth));
    const lines: string[] = [];
    for (const paragraph of text.split('\n')) {
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
    return lines;
  }
}
