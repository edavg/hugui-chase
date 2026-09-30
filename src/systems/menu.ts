import { PALETTE } from './uiCanvas';
import type { UiCanvas } from './uiCanvas';
import { SETTING_RANGES, formatSettingValue } from './settings';
import type { NumericSettingKey, Settings } from './settings';
import { CONTROLS, TEXTS } from './i18n';
import type { Language, UiTexts } from './i18n';
import type { Input } from './input';
import type { PadAction } from './gamepad';
import type { PsxConfig } from './config';

export type MenuScreen =
  | 'options'
  | 'controls'
  | 'credits'
  | 'pause'
  | 'gameover'
  | 'ending';

export interface MenuActions {
  resumeGame(): void;
  restartGame(): void;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ListEntry {
  readonly label: string;
  readonly enabled: boolean;
  readonly note?: string;
}

interface OptionRow {
  readonly label: string;
  readonly value: string;
  readonly ratio: number | null;
  readonly adjust: ((direction: -1 | 1) => void) | null;
  readonly activate: (() => void) | null;
}

type Axis = 'up' | 'down' | 'left' | 'right';

interface AxisState {
  held: boolean;
  timer: number;
}

interface Poll {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  confirm: boolean;
  cancel: boolean;
  pause: boolean;
  pageUp: boolean;
  pageDown: boolean;
}

type ToggleKey = 'invertLook' | 'authenticLoading' | 'subtitles' | 'gamepad';

const AXES: readonly Axis[] = ['up', 'down', 'left', 'right'];

const AXIS_CODES: Record<Axis, readonly string[]> = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
};

const AXIS_PAD: Record<Axis, PadAction> = {
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
};

const CONFIRM_CODES: readonly string[] = ['KeyE', 'Enter', 'Space'];
const CANCEL_CODES: readonly string[] = ['Escape', 'Backspace'];

const NAV_REPEAT_DELAY = 0.35;
const NAV_REPEAT_INTERVAL = 0.25;

const INPUT_DELAY = 0.25;
const OUTCOME_INPUT_DELAY = 0.6;

const HINT_SEPARATOR = '\u00a0·\u00a0';
const ACTION_GLYPH = '▶';

const ENTRY_SCALE = 2;
const ENTRY_STEP = 32;
// Aire extra entre líneas de los párrafos largos (nota, final, créditos…).
const PARAGRAPH_LINE_SPACING = 3;
const ENTRY_CURSOR_GAP = 24;
const ENTRY_PANEL_PAD = 20;
const NOTE_OFFSET = 18;
const NOTE_STEP = 10;

const HINT_Y = 452;

const OPTION_PANEL_X = 40;
const OPTION_PANEL_Y = 76;
const OPTION_PANEL_WIDTH = 560;
const OPTION_PANEL_TOP_PAD = 56;
const OPTION_PANEL_BOTTOM_PAD = 20;
const OPTION_TABS_X = 56;
const OPTION_TABS_Y = 96;
const OPTION_TAB_WIDTH = 126;
const OPTION_TAB_HEIGHT = 20;
const OPTION_TAB_GAP = 8;
const OPTION_TABS_WIDTH =
  OPTION_TAB_WIDTH * 4 + OPTION_TAB_GAP * 3;
const OPTION_ROW_TOP = 132;
const OPTION_ROW_HEIGHT = 44;
const OPTION_LABEL_X = 72;
const OPTION_VALUE_X = 572;
const OPTION_BAR_X = 300;
const OPTION_BAR_WIDTH = 180;
const OPTION_BAR_HEIGHT = 6;
const OPTION_HIGHLIGHT_X = 48;
const OPTION_HIGHLIGHT_WIDTH = 544;

const CONTROLS_PANEL: Rect = { x: 60, y: 76, width: 520, height: 320 };
const CONTROLS_ACTION_X = 96;
const CONTROLS_KEYS_X = 544;
const CONTROLS_ROW_TOP = 100;
const CONTROLS_ROW_BOTTOM = 372;

const CREDITS_PANEL: Rect = { x: 50, y: 76, width: 540, height: 320 };
const CREDITS_TEXT_WIDTH = 500;
const CREDITS_BACK_Y = 412;

const PAUSE_TITLE_Y = 96;
const PAUSE_RULE_Y = 132;
const PAUSE_LIST_REGION: Rect = { x: 96, y: 160, width: 448, height: 230 };
const GAMEOVER_LIST_REGION: Rect = { x: 96, y: 236, width: 448, height: 158 };
const ENDING_LIST_REGION: Rect = GAMEOVER_LIST_REGION;

const VEL_PAUSE = 0.78;
const VEL_GAMEOVER = 0.82;
const VEL_ENDING = 0.85;

type ControlScheme = 'modern' | 'tank';

const IMAGE_MODES: readonly PsxConfig['effects']['image_mode'][] = ['psx', 'vhs', 'bw', 'crt'];
const CONTROL_SCHEMES: readonly ControlScheme[] = ['modern', 'tank'];
const LANGUAGES: readonly Language[] = ['es', 'en'];

function wrapIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return ((index % count) + count) % count;
}

export class Menu {
  private readonly ui: UiCanvas;
  private readonly input: Input;
  private readonly settings: Settings;
  private readonly config: PsxConfig;
  private readonly actions: MenuActions;
  private readonly stack: MenuScreen[] = [];
  private readonly axes: Record<Axis, AxisState> = {
    up: { held: false, timer: 0 },
    down: { held: false, timer: 0 },
    left: { held: false, timer: 0 },
    right: { held: false, timer: 0 },
  };
  private selectionIndex = 0;
  private pageIndex = 0;
  private rowIndex = 0;
  private onTabs = false;
  private rowsDirty = true;
  private cachedRows: readonly OptionRow[] = [];
  private clock = 0;
  private inputDelay = 0;

  constructor(
    ui: UiCanvas,
    input: Input,
    settings: Settings,
    config: PsxConfig,
    actions: MenuActions,
  ) {
    this.ui = ui;
    this.input = input;
    this.settings = settings;
    this.config = config;
    this.actions = actions;
    if (typeof settings?.onChange === 'function') {
      settings.onChange((event) => {
        this.rowsDirty = true;
        if (event.key === 'language') {
          this.onLanguageChanged();
        }
      });
    }
  }

  get active(): boolean {
    return this.stack.length > 0;
  }

  private get top(): MenuScreen | null {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1] : null;
  }

  get screen(): MenuScreen | null {
    return this.top;
  }

  get selection(): number {
    const screen = this.screen;
    return screen === 'options' ? this.rowIndex : this.selectionIndex;
  }

  open(screen: MenuScreen): void {
    this.stack.push(screen);
    this.enter(screen);
  }

  close(): void {
    this.stack.length = 0;
    this.selectionIndex = 0;
    this.pageIndex = 0;
    this.rowIndex = 0;
    this.onTabs = false;
    this.clock = 0;
    this.inputDelay = 0;
    this.clearAxes();
    this.input.clearPending();
  }

  togglePause(): void {
    const top = this.top;
    if (top === 'pause') {
      this.close();
      this.actions.resumeGame();
      return;
    }
    if (top !== null) {
      return;
    }
    this.open('pause');
  }

  update(dt: number): void {
    if (!this.active) {
      return;
    }
    const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.clock += step;
    const screen = this.screen;
    if (!screen) {
      return;
    }
    if (this.inputDelay > 0) {
      this.inputDelay = Math.max(0, this.inputDelay - step);
      this.holdAxes();
      return;
    }
    switch (screen) {
      case 'options':
        this.updateOptions(step);
        return;
      case 'controls':
        this.updateDismissable();
        return;
      case 'credits':
        this.updateDismissable();
        return;
      case 'pause':
        this.updatePause(step);
        return;
      case 'gameover':
        this.updateList(step, this.gameOverEntries(), () => this.activateGameOver());
        return;
      case 'ending':
        this.updateList(step, this.endingEntries(), () => this.activateEnding());
        return;
    }
  }

  draw(): void {
    if (!this.active) {
      return;
    }
    const screen = this.screen;
    if (!screen) {
      return;
    }
    const ctx = this.ui.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, this.ui.width, this.ui.height);
    switch (screen) {
      case 'options':
        this.drawBlack();
        this.drawOptions();
        return;
      case 'controls':
        this.drawBlack();
        this.drawControls();
        return;
      case 'credits':
        this.drawBlack();
        this.drawCredits();
        return;
      case 'pause':
        this.drawVel(VEL_PAUSE);
        this.drawPause();
        return;
      case 'gameover':
        this.drawVel(VEL_GAMEOVER);
        this.drawGameOver();
        return;
      case 'ending':
        this.drawVel(VEL_ENDING);
        this.drawEnding();
        return;
    }
  }

  onResize(): void {
    this.ui.resize();
  }

  onLanguageChanged(): void {
    this.rowsDirty = true;
  }

  moveSelection(delta: number): void {
    const screen = this.screen;
    if (!screen) {
      return;
    }
    if (screen === 'options') {
      const rows = this.optionRows();
      this.rowIndex = wrapIndex(this.rowIndex + delta, rows.length);
      return;
    }
    if (!isListScreen(screen)) {
      return;
    }
    this.selectionIndex = wrapIndex(this.selectionIndex + delta, this.itemCount(screen));
  }

  adjustSelection(direction: -1 | 1): void {
    if (this.screen !== 'options') {
      return;
    }
    if (this.onTabs) {
      this.changePage(direction);
      return;
    }
    const rows = this.optionRows();
    const row = rows[this.rowIndex];
    row?.adjust?.(direction);
  }

  private enter(screen: MenuScreen): void {
    this.selectionIndex = 0;
    this.pageIndex = 0;
    this.rowIndex = 0;
    this.onTabs = false;
    this.rowsDirty = true;
    this.clock = 0;
    this.inputDelay =
      screen === 'gameover' || screen === 'ending' ? OUTCOME_INPUT_DELAY : INPUT_DELAY;
    this.clearAxes();
    this.input.clearPending();
  }

  private goBack(): void {
    if (this.stack.length > 1) {
      const top = this.stack.pop();
      if (top) {
        this.enter(top);
      }
      return;
    }
    const screen = this.top;
    if (screen === 'pause') {
      this.close();
      this.actions.resumeGame();
      return;
    }
    if (screen === 'gameover' || screen === 'ending') {
      return;
    }
    this.close();
    this.actions.resumeGame();
  }

  private lang(): Language {
    const stored = this.settings.get('language');
    if (stored === 'es' || stored === 'en') {
      return stored;
    }
    return this.config.language === 'en' ? 'en' : 'es';
  }

  private texts(): UiTexts {
    return TEXTS[this.lang()];
  }

  private updateDismissable(): void {
    const nav = this.poll();
    if (nav.confirm || nav.cancel) {
      this.goBack();
    }
  }

  private updateList(dt: number, entries: readonly ListEntry[], activate: () => void): void {
    const nav = this.poll();
    if (this.step('down', nav.down, dt)) {
      this.moveSelection(1);
    }
    if (this.step('up', nav.up, dt)) {
      this.moveSelection(-1);
    }
    if (nav.cancel) {
      this.goBack();
      return;
    }
    if (nav.confirm) {
      const entry = entries[this.selectionIndex];
      if (entry?.enabled) {
        activate();
      }
    }
  }

  private updatePause(dt: number): void {
    const nav = this.poll();
    if (nav.pause || nav.cancel) {
      this.close();
      this.actions.resumeGame();
      return;
    }
    if (this.step('down', nav.down, dt)) {
      this.moveSelection(1);
    }
    if (this.step('up', nav.up, dt)) {
      this.moveSelection(-1);
    }
    if (nav.confirm) {
      this.activatePause();
    }
  }

  private updateOptions(dt: number): void {
    const nav = this.poll();
    const rows = this.optionRows();
    if (nav.pageUp) {
      this.changePage(-1);
    }
    if (nav.pageDown) {
      this.changePage(1);
    }
    if (this.onTabs) {
      if (nav.up) {
        this.onTabs = false;
        this.rowIndex = Math.max(0, rows.length - 1);
      }
      if (nav.down) {
        this.onTabs = false;
        this.rowIndex = 0;
      }
      if (nav.left) {
        this.changePage(-1);
      }
      if (nav.right || nav.confirm) {
        this.changePage(1);
      }
      if (nav.cancel) {
        this.goBack();
      }
      return;
    }
    if (this.step('up', nav.up, dt)) {
      if (this.rowIndex === 0) {
        this.onTabs = true;
      } else {
        this.rowIndex = wrapIndex(this.rowIndex - 1, rows.length);
      }
    }
    if (this.step('down', nav.down, dt)) {
      this.rowIndex = wrapIndex(this.rowIndex + 1, rows.length);
    }
    if (this.step('left', nav.left, dt)) {
      this.adjustSelection(-1);
    }
    if (this.step('right', nav.right, dt)) {
      this.adjustSelection(1);
    }
    if (nav.confirm) {
      const row = rows[this.rowIndex];
      if (row?.activate) {
        row.activate();
      } else {
        this.adjustSelection(1);
      }
    }
    if (nav.cancel) {
      this.goBack();
    }
  }

  private changePage(direction: -1 | 1): void {
    this.pageIndex = wrapIndex(this.pageIndex + direction, 4);
    this.rowsDirty = true;
    this.rowIndex = Math.min(this.rowIndex, Math.max(0, this.optionRows().length - 1));
  }

  private optionRows(): readonly OptionRow[] {
    if (!this.rowsDirty && this.cachedRows.length > 0) {
      return this.cachedRows;
    }
    const texts = this.texts();
    const rows: OptionRow[] = [];
    switch (this.pageIndex) {
      case 0:
        rows.push(this.rangeRow(texts.optionBrightness, 'brightness'));
        rows.push(this.rangeRow(texts.optionGamma, 'gamma'));
        rows.push(this.rangeRow(texts.optionPostIntensity, 'postIntensity'));
        rows.push(
          this.enumRow(texts.optionImageMode, 'imageMode', [texts.valuePsx, texts.valueVhs, texts.valueBw, texts.valueCrt]),
        );
        break;
      case 1:
        rows.push(this.rangeRow(texts.optionVolumeMaster, 'masterVolume'));
        rows.push(this.rangeRow(texts.optionVolumeAmbience, 'ambienceVolume'));
        rows.push(this.rangeRow(texts.optionVolumeSfx, 'sfxVolume'));
        rows.push(this.rangeRow(texts.optionVolumeMusic, 'musicVolume'));
        rows.push(this.rangeRow(texts.optionVolumeUi, 'uiVolume'));
        break;
      case 2:
        rows.push(this.rangeRow(texts.optionMouseSensitivity, 'mouseSensitivity'));
        rows.push(this.toggleRow(texts.optionInvertLook, 'invertLook'));
        rows.push(
          this.enumRow(texts.optionControlScheme, 'controlScheme', [texts.valueModern, texts.valueTank]),
        );
        rows.push(this.toggleRow(texts.optionGamepad, 'gamepad'));
        break;
      default:
        rows.push(this.toggleRow(texts.optionAuthenticLoading, 'authenticLoading'));
        rows.push(this.toggleRow(texts.optionSubtitles, 'subtitles'));
        rows.push(
          this.enumRow(texts.optionLanguage, 'language', [texts.valueEspanol, texts.valueEnglish]),
        );
        rows.push({
          label: texts.menuControls,
          value: ACTION_GLYPH,
          ratio: null,
          adjust: null,
          activate: () => {
            this.open('controls');
          },
        });
        rows.push({
          label: texts.menuCredits,
          value: ACTION_GLYPH,
          ratio: null,
          adjust: null,
          activate: () => {
            this.open('credits');
          },
        });
        rows.push({
          label: texts.optionsRestore,
          value: ACTION_GLYPH,
          ratio: null,
          adjust: null,
          activate: () => {
            this.settings.reset();
            this.rowsDirty = true;
          },
        });
        break;
    }
    this.cachedRows = rows;
    this.rowsDirty = false;
    if (this.rowIndex > rows.length - 1) {
      this.rowIndex = Math.max(0, rows.length - 1);
    }
    return rows;
  }

  private rangeRow(label: string, key: NumericSettingKey): OptionRow {
    const range = SETTING_RANGES[key];
    const value = this.settings.get(key);
    const span = range.max - range.min;
    return {
      label,
      value: formatSettingValue(key, value),
      ratio: span === 0 ? 0 : this.ui.barPercent(value, range.min, range.max),
      adjust: (direction) => {
        this.settings.adjust(key, direction);
      },
      activate: null,
    };
  }

  private toggleRow(label: string, key: ToggleKey): OptionRow {
    const texts = this.texts();
    const value = this.settings.get(key);
    return {
      label,
      value: value ? texts.valueOn : texts.valueOff,
      ratio: null,
      adjust: (direction) => {
        this.settings.set(key, direction > 0);
      },
      activate: null,
    };
  }

  private enumRow(
    label: string,
    key: 'imageMode' | 'controlScheme' | 'language',
    labels: readonly string[],
  ): OptionRow {
    const order: readonly string[] =
      key === 'imageMode' ? IMAGE_MODES : key === 'controlScheme' ? CONTROL_SCHEMES : LANGUAGES;
    const current = order.indexOf(this.settings.get(key));
    return {
      label,
      value: labels[Math.max(0, current)],
      ratio: null,
      adjust: (direction) => {
        const index = wrapIndex(Math.max(0, current) + direction, order.length);
        const next = order[index];
        if (key === 'language') {
          const language = next === 'en' ? 'en' : 'es';
          this.settings.set('language', language);
          this.onLanguageChanged();
        } else if (key === 'imageMode') {
          const mode = next === 'vhs' || next === 'bw' || next === 'crt' || next === 'psx' ? next : 'psx';
          this.settings.set('imageMode', mode);
        } else {
          const scheme: ControlScheme = next === 'tank' ? 'tank' : 'modern';
          this.settings.set('controlScheme', scheme);
        }
      },
      activate: null,
    };
  }

  private pauseEntries(): readonly ListEntry[] {
    const texts = this.texts();
    return [
      { label: texts.menuResume, enabled: true },
      { label: texts.menuOptions, enabled: true },
    ];
  }

  private gameOverEntries(): readonly ListEntry[] {
    const texts = this.texts();
    return [{ label: texts.menuRestart, enabled: true }];
  }

  private endingEntries(): readonly ListEntry[] {
    const texts = this.texts();
    return [{ label: texts.endingPlayAgain, enabled: true }];
  }

  private itemCount(screen: MenuScreen): number {
    switch (screen) {
      case 'pause':
        return this.pauseEntries().length;
      case 'gameover':
        return this.gameOverEntries().length;
      case 'ending':
        return this.endingEntries().length;
      default:
        return 0;
    }
  }

  private activatePause(): void {
    switch (this.selectionIndex) {
      case 0:
        this.close();
        this.actions.resumeGame();
        return;
      case 1:
        this.open('options');
        return;
      default:
        return;
    }
  }

  private activateGameOver(): void {
    this.actions.restartGame();
    this.close();
  }

  private activateEnding(): void {
    this.actions.restartGame();
    this.close();
  }

  private poll(): Poll {
    return {
      up:
        this.input.consumePress('ArrowUp') ||
        this.input.consumePress('KeyW') ||
        this.input.padPress('up'),
      down:
        this.input.consumePress('ArrowDown') ||
        this.input.consumePress('KeyS') ||
        this.input.padPress('down'),
      left:
        this.input.consumePress('ArrowLeft') ||
        this.input.consumePress('KeyA') ||
        this.input.padPress('left'),
      right:
        this.input.consumePress('ArrowRight') ||
        this.input.consumePress('KeyD') ||
        this.input.padPress('right'),
      confirm:
        this.consumeAny(CONFIRM_CODES) || this.input.padPress('confirm') || this.input.padPress('interact'),
      cancel:
        this.consumeAny(CANCEL_CODES) || this.input.padPress('cancel'),
      pause: this.input.padPress('pause'),
      pageUp: this.input.padPress('pageUp'),
      pageDown: this.input.padPress('pageDown'),
    };
  }

  private consumeAny(codes: readonly string[]): boolean {
    for (const code of codes) {
      if (this.input.consumePress(code)) {
        return true;
      }
    }
    return false;
  }

  private axisDown(axis: Axis): boolean {
    for (const code of AXIS_CODES[axis]) {
      if (this.input.isDown(code)) {
        return true;
      }
    }
    return this.input.padDown(AXIS_PAD[axis]);
  }

  private step(axis: Axis, pressed: boolean, dt: number): boolean {
    const state = this.axes[axis];
    if (pressed) {
      state.held = true;
      state.timer = NAV_REPEAT_DELAY;
      return true;
    }
    if (!this.axisDown(axis)) {
      state.held = false;
      state.timer = 0;
      return false;
    }
    if (!state.held) {
      state.held = true;
      state.timer = NAV_REPEAT_DELAY;
      return true;
    }
    state.timer -= dt;
    if (state.timer > 0) {
      return false;
    }
    state.timer = NAV_REPEAT_INTERVAL;
    return true;
  }

  private clearAxes(): void {
    for (const axis of AXES) {
      this.axes[axis].held = false;
      this.axes[axis].timer = 0;
    }
  }

  private holdAxes(): void {
    for (const axis of AXES) {
      this.axes[axis].held = this.axisDown(axis);
      this.axes[axis].timer = NAV_REPEAT_DELAY;
    }
  }

  private drawBlack(): void {
    this.ui.clear(PALETTE.void, 1);
  }

  private drawVel(alpha: number): void {
    this.ui.rect(0, 0, this.ui.width, this.ui.height, PALETTE.void, alpha);
  }

  private drawHint(): void {
    const texts = this.texts();
    const hint = `${texts.menuHintArrows}${HINT_SEPARATOR}${texts.menuHintAccept}${HINT_SEPARATOR}${texts.menuHintBack}`;
    this.ui.textCentered(hint, HINT_Y, { color: PALETTE.textDark, shadow: PALETTE.shadow });
  }

  private drawList(entries: readonly ListEntry[], region: Rect): void {
    const offsets: number[] = [];
    let width = 0;
    let height = 0;
    for (const entry of entries) {
      offsets.push(height);
      width = Math.max(width, this.ui.font.measure(entry.label, ENTRY_SCALE));
      height += ENTRY_STEP + (entry.note !== undefined ? NOTE_STEP : 0);
    }
    height = Math.max(0, height - ENTRY_STEP + 16);
    const blockWidth = ENTRY_CURSOR_GAP + width;
    const blockLeft = Math.round(region.x + region.width / 2 - blockWidth / 2);
    const top = Math.round(region.y + Math.max(0, region.height - height) / 2);
    const panelX = blockLeft - ENTRY_PANEL_PAD;
    const panelWidth = blockWidth + ENTRY_PANEL_PAD * 2;
    const panelY = top - ENTRY_PANEL_PAD;
    const panelHeight = height + ENTRY_PANEL_PAD * 2;
    this.ui.panel(panelX, panelY, panelWidth, panelHeight);
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (!entry) {
        continue;
      }
      const y = top + (offsets[index] ?? 0);
      const selected = index === this.selectionIndex;
      if (selected) {
        this.ui.rect(panelX + 6, y - 6, panelWidth - 12, 28, PALETTE.accentDim, 0.32);
      }
      if (selected && entry.enabled) {
        this.ui.cursor(blockLeft, y, PALETTE.accent, ENTRY_SCALE);
      }
      this.ui.text(entry.label, blockLeft + ENTRY_CURSOR_GAP, y, {
        scale: ENTRY_SCALE,
        color: entry.enabled
          ? selected
            ? PALETTE.textBright
            : PALETTE.text
          : PALETTE.textDark,
        shadow: PALETTE.shadow,
      });
      if (entry.note !== undefined) {
        this.ui.textCenteredIn(entry.note, this.ui.width / 2, y + NOTE_OFFSET, {
          color: PALETTE.textDark,
          shadow: PALETTE.shadow,
        });
      }
    }
    this.drawHint();
  }

  private drawPause(): void {
    const texts = this.texts();
    this.ui.textCentered(texts.pauseTitle, PAUSE_TITLE_Y, {
      scale: 3,
      color: PALETTE.textBright,
      shadow: PALETTE.shadow,
    });
    this.ui.rect(Math.round(this.ui.width / 2 - 80), PAUSE_RULE_Y, 160, 2, PALETTE.accent, 0.9);
    this.drawList(this.pauseEntries(), PAUSE_LIST_REGION);
  }

  private drawGameOver(): void {
    const texts = this.texts();
    this.ui.textCentered(texts.gameOverTitle, 112, {
      scale: 3,
      color: PALETTE.accent,
      shadow: PALETTE.shadow,
    });
    this.ui.rect(Math.round(this.ui.width / 2 - 80), 148, 160, 2, PALETTE.accentDim, 0.8);
    this.ui.wrapCentered(texts.gameOverText, this.ui.width / 2, 172, 400, {
      color: PALETTE.text,
      shadow: PALETTE.shadow,
      lineSpacing: PARAGRAPH_LINE_SPACING,
    });
    this.drawList(this.gameOverEntries(), GAMEOVER_LIST_REGION);
  }

  private drawEnding(): void {
    const texts = this.texts();
    this.ui.textCentered(texts.endingTitle, 92, {
      scale: 3,
      color: PALETTE.textBright,
      shadow: PALETTE.shadow,
    });
    this.ui.rect(Math.round(this.ui.width / 2 - 80), 124, 160, 2, PALETTE.accent, 0.9);
    this.ui.wrapCentered(texts.endingText, this.ui.width / 2, 148, 440, {
      color: PALETTE.text,
      shadow: PALETTE.shadow,
      lineSpacing: PARAGRAPH_LINE_SPACING,
    });
    this.drawList(this.endingEntries(), ENDING_LIST_REGION);
  }

  private drawOptions(): void {
    const texts = this.texts();
    const rows = this.optionRows();
    const panelHeight = OPTION_PANEL_TOP_PAD + rows.length * OPTION_ROW_HEIGHT + OPTION_PANEL_BOTTOM_PAD;
    this.ui.panel(
      OPTION_PANEL_X,
      OPTION_PANEL_Y,
      OPTION_PANEL_WIDTH,
      panelHeight,
      {
        title: texts.optionsTitle,
        titleScale: 2,
      },
    );

    const tabLabels = [
      texts.optionsPageVideo,
      texts.optionsPageAudio,
      texts.optionsPageControls,
      texts.optionsPageGame,
    ];
    for (let index = 0; index < tabLabels.length; index += 1) {
      const x = OPTION_TABS_X + index * (OPTION_TAB_WIDTH + OPTION_TAB_GAP);
      const active = index === this.pageIndex;
      this.ui.rect(
        x,
        OPTION_TABS_Y,
        OPTION_TAB_WIDTH,
        OPTION_TAB_HEIGHT,
        PALETTE.panelLight,
        active ? 0.9 : 0.4,
      );
      this.ui.frame(
        x,
        OPTION_TABS_Y,
        OPTION_TAB_WIDTH,
        OPTION_TAB_HEIGHT,
        active ? PALETTE.accent : PALETTE.border,
        1,
        active ? 1 : 0.5,
      );
      if (active && this.onTabs) {
        this.ui.cursor(x - 14, OPTION_TABS_Y + 6, PALETTE.accent, 1);
      }
      this.ui.textCenteredIn(tabLabels[index] ?? '', x + OPTION_TAB_WIDTH / 2, OPTION_TABS_Y + 6, {
        color: active ? PALETTE.textBright : PALETTE.textDim,
        shadow: PALETTE.shadow,
      });
    }
    this.ui.rect(
      OPTION_TABS_X,
      OPTION_TABS_Y + OPTION_TAB_HEIGHT + 6,
      OPTION_TABS_WIDTH,
      1,
      PALETTE.border,
      0.5,
    );

    const startY = OPTION_ROW_TOP;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (!row) {
        continue;
      }
      const y = Math.round(startY + index * OPTION_ROW_HEIGHT);
      const selected = !this.onTabs && index === this.rowIndex;
      if (selected) {
        this.ui.rect(OPTION_HIGHLIGHT_X, y - 5, OPTION_HIGHLIGHT_WIDTH, 18, PALETTE.accentDim, 0.3);
        this.ui.cursor(OPTION_HIGHLIGHT_X + 8, y, PALETTE.accent, 1);
      }
      this.ui.text(row.label, OPTION_LABEL_X, y, {
        color: selected ? PALETTE.textBright : PALETTE.text,
        shadow: PALETTE.shadow,
      });
      if (row.ratio !== null) {
        this.ui.bar(OPTION_BAR_X, y - 1, OPTION_BAR_WIDTH, OPTION_BAR_HEIGHT, row.ratio, {
          color: selected ? PALETTE.accent : PALETTE.text,
          segments: 18,
        });
      }
      this.ui.textRight(row.value, OPTION_VALUE_X, y, {
        color: selected ? PALETTE.textBright : PALETTE.textDim,
        shadow: PALETTE.shadow,
      });
    }
    this.drawHint();
  }

  private drawControls(): void {
    const lang = this.lang();
    const texts = TEXTS[lang];
    const rows = CONTROLS[lang] ?? [];
    this.ui.panel(CONTROLS_PANEL.x, CONTROLS_PANEL.y, CONTROLS_PANEL.width, CONTROLS_PANEL.height, {
      title: texts.controlsTitle,
      titleScale: 2,
    });
    const available = CONTROLS_ROW_BOTTOM - CONTROLS_ROW_TOP;
    const step = Math.min(26, Math.floor(available / Math.max(1, rows.length)));
    const startY = Math.round(CONTROLS_ROW_TOP + Math.max(0, available - rows.length * step) / 2);
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (!row) {
        continue;
      }
      const y = Math.round(startY + index * step);
      if (index % 2 === 0) {
        this.ui.rect(CONTROLS_PANEL.x + 12, y - 4, CONTROLS_PANEL.width - 24, step - 2, PALETTE.panelLight, 0.35);
      }
      this.ui.text(row[0], CONTROLS_ACTION_X, y, {
        color: PALETTE.text,
        shadow: PALETTE.shadow,
      });
      this.ui.textRight(row[1], CONTROLS_KEYS_X, y, {
        color: PALETTE.textBright,
        shadow: PALETTE.shadow,
      });
    }
    this.ui.wrapCentered(texts.controlsNote, this.ui.width / 2, 414, 600, {
      color: PALETTE.textDim,
      shadow: PALETTE.shadow,
      lineSpacing: 2,
    });
    this.drawHint();
  }

  private drawCredits(): void {
    const texts = this.texts();
    this.ui.panel(CREDITS_PANEL.x, CREDITS_PANEL.y, CREDITS_PANEL.width, CREDITS_PANEL.height, {
      title: texts.creditsTitle,
      titleScale: 2,
    });
    const body = texts.creditsBody;
    const height = this.measureWrap(body, CREDITS_TEXT_WIDTH);
    const startY = Math.round(
      CREDITS_PANEL.y + 24 + Math.max(0, CREDITS_PANEL.height - 48 - height) / 2,
    );
    this.ui.wrapCentered(body, this.ui.width / 2, startY, CREDITS_TEXT_WIDTH, {
      color: PALETTE.text,
      shadow: PALETTE.shadow,
      lineSpacing: PARAGRAPH_LINE_SPACING,
    });
    this.ui.textCentered(texts.creditsBack, CREDITS_BACK_Y, {
      color: PALETTE.textDim,
      shadow: PALETTE.shadow,
    });
    this.drawHint();
  }

  private measureWrap(body: string, maxWidth: number): number {
    const columns = Math.max(1, Math.floor(maxWidth / this.ui.font.advance));
    let lines = 0;

    for (const paragraph of body.split('\n')) {
      if (paragraph === '') {
        lines += 1;
        continue;
      }
      let current = '';
      let count = 1;
      for (const word of paragraph.split(' ')) {
        const candidate = current === '' ? word : `${current} ${word}`;
        if (current !== '' && candidate.length > columns) {
          count += 1;
          current = word;
        } else {
          current = candidate;
        }
      }
      lines += count;
    }
    return lines * (this.ui.font.lineHeight(1) + PARAGRAPH_LINE_SPACING);
  }
}

function isListScreen(screen: MenuScreen): boolean {
  return screen === 'pause' || screen === 'gameover' || screen === 'ending';
}
