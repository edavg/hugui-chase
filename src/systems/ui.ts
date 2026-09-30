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
const DESC_LINE_SPACING = 2;
const NOTE_WIDTH = 528;
const NOTE_PADDING = 24;
const NOTE_TITLE_GAP = 10;
const NOTE_MAX_HEIGHT = 400;
const NOTE_HINT_GAP = 12;
const NOTE_BOTTOM_MARGIN = 30;

const INVENTORY_TITLE_Y = 84;
const INVENTORY_RULE_Y = 112;
const INVENTORY_GRID_Y = 134;
const INVENTORY_PANEL_Y = 122;
const INVENTORY_PANEL_PAD = 12;
const INVENTORY_SECTION_GAP = 22;
const INVENTORY_DESC_GAP = 8;
const INVENTORY_HINT_GAP = 56;
const INVENTORY_INFO_WIDTH = 520;
const INVENTORY_RULE_WIDTH = 240;

const SLOT_WIDTH = 128;
const SLOT_HEIGHT = 72;
const SLOT_GAP = 4;
const SLOT_PAD = 8;
const SLOT_MAX_WIDTH = 576;
const SLOT_MAX_HEIGHT = 300;

const EXAMINE_X = 60;
const EXAMINE_WIDTH = 520;
const EXAMINE_TOP = 372;
const EXAMINE_BOTTOM = 470;
const EXAMINE_PAD = 12;
const EXAMINE_GAP = 8;

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
  inventoryColumns: number;
  inventoryRows: number;
  touchControls: boolean;
}

export interface UiVisibility {
  prompt: boolean;
  toast: boolean;
  note: boolean;
  inventory: boolean;
  examine: boolean;
}

export class Ui {
  private readonly ui: UiCanvas;
  private readonly lang: () => Language;
  private options: UiOptions = {
    showSubtitles: true,
    inventoryColumns: 4,
    inventoryRows: 2,
    touchControls: false,
  };

  private promptText = '';
  private toastText = '';
  private toastRemaining = 0;

  private noteVisible = false;
  private noteTitle = '';
  private noteFull = '';
  private noteRevealed = 0;

  private inventoryVisible = false;
  private inventorySlots: ReadonlyArray<string | null> = [];
  private inventorySelected = 0;
  private inventoryName = '';
  private inventoryDesc = '';
  private inventoryHint = '';

  private examineVisible = false;
  private examineName = '';
  private examineDesc = '';
  private examineHint = '';

  private endingVisible = false;
  private endingTitle = '';
  private endingText = '';
  private endingHint = '';

  private heartsVisible = false;
  private hearts = 3;
  private maxHearts = 3;
  private damageFlash = 0;

  private posterHave = 0;
  private posterTotal = 8;
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
      inventory: this.inventoryVisible,
      examine: this.examineVisible,
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
    this.inventoryVisible = false;
    this.examineVisible = false;
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

  showInventory(
    slots: ReadonlyArray<string | null>,
    selected: number,
    name: string,
    desc: string,
    hint: string,
  ): void {
    this.inventorySlots = slots;
    this.inventorySelected = selected;
    this.inventoryName = name;
    this.inventoryDesc = desc;
    this.inventoryHint = hint;
    this.inventoryVisible = true;
  }

  hideInventory(): void {
    this.inventoryVisible = false;
  }

  showExamine(name: string, desc: string, hint: string): void {
    this.examineName = name;
    this.examineDesc = desc;
    this.examineHint = hint;
    this.examineVisible = true;
  }

  hideExamine(): void {
    this.examineVisible = false;
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
    if (this.inventoryVisible) {
      this.drawInventory();
      return;
    }
    if (this.examineVisible) {
      this.drawExamine();
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

  private drawInventory(): void {
    const ui = this.ui;
    const texts = TEXTS[this.lang()];
    const portrait = this.portrait;
    const lineHeight = ui.font.lineHeight(LINE_SCALE);
    const columns = Math.max(1, Math.round(this.options.inventoryColumns));
    const rows = Math.max(1, Math.round(this.options.inventoryRows));
    const titleY = portrait ? 56 : INVENTORY_TITLE_Y;
    const ruleY = portrait ? 84 : INVENTORY_RULE_Y;
    const panelY = portrait ? 92 : INVENTORY_PANEL_Y;
    const gridY = portrait ? 104 : INVENTORY_GRID_Y;
    const slotMaxWidth = portrait ? ui.width - 64 : SLOT_MAX_WIDTH;
    const slotMaxHeight = portrait
      ? Math.max(48, Math.floor((ui.height - 300) / rows))
      : SLOT_MAX_HEIGHT;
    const slotWidth = Math.max(
      24,
      Math.min(SLOT_WIDTH, Math.floor((slotMaxWidth - (columns - 1) * SLOT_GAP) / columns)),
    );
    const slotHeight = Math.max(
      24,
      Math.min(SLOT_HEIGHT, Math.floor((slotMaxHeight - (rows - 1) * SLOT_GAP) / rows)),
    );
    const gridWidth = columns * slotWidth + (columns - 1) * SLOT_GAP;
    const gridHeight = rows * slotHeight + (rows - 1) * SLOT_GAP;
    const gridX = Math.round((ui.width - gridWidth) / 2);
    const panelX = gridX - INVENTORY_PANEL_PAD;
    const panelWidth = gridWidth + INVENTORY_PANEL_PAD * 2;
    const panelHeight = gridHeight + INVENTORY_PANEL_PAD * 2;
    const nameY = panelY + panelHeight + INVENTORY_SECTION_GAP;
    const descY = nameY + TITLE_SCALE * lineHeight + INVENTORY_DESC_GAP;
    const descLineHeight = lineHeight + DESC_LINE_SPACING;
    const infoWidth = portrait ? ui.width - 32 : INVENTORY_INFO_WIDTH;
    const descLines = this.splitLines(this.inventoryDesc, infoWidth);
    const hintY = descY + Math.max(INVENTORY_HINT_GAP, descLines.length * descLineHeight + 12);
    const shift = Math.max(0, hintY + 12 - (ui.height - 10));

    ui.clear(PALETTE.void, 0.88);
    ui.textCentered(texts.inventoryTitle, titleY - shift, {
      scale: TITLE_SCALE,
      color: PALETTE.text,
    });
    ui.rect(
      Math.round((ui.width - INVENTORY_RULE_WIDTH) / 2),
      ruleY - shift,
      INVENTORY_RULE_WIDTH,
      1,
      PALETTE.border,
    );
    ui.panel(panelX, panelY - shift, panelWidth, panelHeight, { alpha: 0.9 });

    for (let index = 0; index < columns * rows; index += 1) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      this.drawSlot(
        gridX + column * (slotWidth + SLOT_GAP),
        gridY + row * (slotHeight + SLOT_GAP) - shift,
        slotWidth,
        slotHeight,
        this.inventorySlots[index] ?? null,
        index === this.inventorySelected,
      );
    }

    const nameLines = this.splitLines(this.inventoryName, infoWidth, TITLE_SCALE);
    nameLines.forEach((line, index) => {
      ui.textCenteredIn(
        line,
        ui.width / 2,
        nameY - shift + index * TITLE_SCALE * lineHeight,
        { scale: TITLE_SCALE, color: PALETTE.textBright },
      );
    });
    descLines.forEach((line, index) => {
      ui.textCenteredIn(line, ui.width / 2, descY - shift + index * descLineHeight, {
        color: PALETTE.textDim,
      });
    });
    ui.textCentered(this.inventoryHint, hintY - shift, { color: PALETTE.textDark });
  }

  private drawSlot(
    x: number,
    y: number,
    width: number,
    height: number,
    label: string | null,
    selected: boolean,
  ): void {
    const ui = this.ui;
    const lineHeight = ui.font.lineHeight(LINE_SCALE);
    ui.rect(
      x,
      y,
      width,
      height,
      selected ? PALETTE.accentDim : PALETTE.panelLight,
      selected ? 0.9 : 0.5,
    );
    ui.frame(x, y, width, height, selected ? PALETTE.accent : PALETTE.border, selected ? 2 : 1);
    if (!label) {
      ui.rect(x + 6, y + Math.floor(height / 2) - 1, width - 12, 1, PALETTE.textDark, 0.4);
      return;
    }
    const lines = this.splitLines(label, width - SLOT_PAD * 2).slice(0, 3);
    const startY = y + Math.max(2, Math.floor((height - lines.length * lineHeight) / 2));
    lines.forEach((line, index) => {
      ui.textCenteredIn(line, x + width / 2, startY + index * lineHeight, {
        color: selected ? PALETTE.textBright : PALETTE.text,
      });
    });
  }

  private drawExamine(): void {
    const ui = this.ui;
    const portrait = this.portrait;
    const lineHeight = ui.font.lineHeight(LINE_SCALE) + DESC_LINE_SPACING;
    const titleLineHeight = ui.font.lineHeight(TITLE_SCALE);
    const panelX = portrait ? 16 : EXAMINE_X;
    const panelWidth = Math.min(EXAMINE_WIDTH, ui.width - panelX * 2);
    const minTop = portrait ? ui.height - 260 : EXAMINE_TOP;
    const maxBottom = portrait ? ui.height - 16 : EXAMINE_BOTTOM;
    const innerWidth = panelWidth - EXAMINE_PAD * 2;
    const nameLines = this.splitLines(this.examineName, innerWidth, TITLE_SCALE);
    const descLines = this.splitLines(this.examineDesc, innerWidth);
    const nameHeight = nameLines.length * titleLineHeight;
    const descHeight = descLines.length * lineHeight;
    const height = Math.min(
      maxBottom - minTop,
      EXAMINE_PAD * 2 + nameHeight + EXAMINE_GAP + descHeight + EXAMINE_GAP + lineHeight,
    );
    const top = Math.max(minTop, maxBottom - height);
    const centerX = ui.width / 2;
    let y = top + EXAMINE_PAD;

    ui.panel(panelX, top, panelWidth, height, {
      fill: PALETTE.void,
      border: PALETTE.border,
      alpha: 0.72,
    });
    nameLines.forEach((line, index) => {
      ui.textCenteredIn(line, centerX, y + index * titleLineHeight, {
        scale: TITLE_SCALE,
        color: PALETTE.textBright,
      });
    });
    y += nameHeight + EXAMINE_GAP;
    descLines.forEach((line, index) => {
      ui.textCenteredIn(line, centerX, y + index * lineHeight, { color: PALETTE.textDim });
    });
    y += descHeight + EXAMINE_GAP;
    ui.textCentered(this.examineHint, y, { color: PALETTE.textDark });
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
