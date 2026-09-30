import type { ImageMode, PsxConfig } from './config';
import type { Language } from './i18n';

export interface SettingsData {
  brightness: number;
  gamma: number;
  postIntensity: number;
  imageMode: ImageMode;
  masterVolume: number;
  ambienceVolume: number;
  sfxVolume: number;
  musicVolume: number;
  uiVolume: number;
  mouseSensitivity: number;
  invertLook: boolean;
  controlScheme: 'modern' | 'tank';
  authenticLoading: boolean;
  subtitles: boolean;
  gamepad: boolean;
  language: Language;
}

export const SETTINGS_VERSION = 1;

export const SETTINGS_STORAGE_KEY = 'mondyi.settings.v1';

export const BASE_LOOK_SENSITIVITY = 0.0022;

const SAVE_DEBOUNCE_MS = 250;

const ROUND_SCALE = 1e6;

export type SettingValueFormat = 'decimal2' | 'percent' | 'float1';

export type NumericSettingKey =
  | 'brightness'
  | 'gamma'
  | 'postIntensity'
  | 'masterVolume'
  | 'ambienceVolume'
  | 'sfxVolume'
  | 'musicVolume'
  | 'uiVolume'
  | 'mouseSensitivity';

export interface SettingRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly format: SettingValueFormat;
}

export const SETTING_RANGES: {
  brightness: SettingRange;
  gamma: SettingRange;
  postIntensity: SettingRange;
  masterVolume: SettingRange;
  ambienceVolume: SettingRange;
  sfxVolume: SettingRange;
  musicVolume: SettingRange;
  uiVolume: SettingRange;
  mouseSensitivity: SettingRange;
} = {
  brightness: { min: 0.6, max: 1.6, step: 0.05, format: 'decimal2' },
  gamma: { min: 0.6, max: 1.6, step: 0.05, format: 'decimal2' },
  postIntensity: { min: 0, max: 1, step: 0.05, format: 'percent' },
  masterVolume: { min: 0, max: 1, step: 0.05, format: 'percent' },
  ambienceVolume: { min: 0, max: 1, step: 0.05, format: 'percent' },
  sfxVolume: { min: 0, max: 1, step: 0.05, format: 'percent' },
  musicVolume: { min: 0, max: 1, step: 0.05, format: 'percent' },
  uiVolume: { min: 0, max: 1, step: 0.05, format: 'percent' },
  mouseSensitivity: { min: 0.4, max: 2.5, step: 0.1, format: 'float1' },
};

const DEFAULT_VALUES: SettingsData = {
  brightness: 1.0,
  gamma: 1.0,
  postIntensity: 0.6,
  imageMode: 'psx',
  masterVolume: 0.8,
  ambienceVolume: 0.65,
  sfxVolume: 0.9,
  musicVolume: 0.55,
  uiVolume: 0.5,
  mouseSensitivity: 1.0,
  invertLook: false,
  controlScheme: 'modern',
  authenticLoading: true,
  subtitles: true,
  gamepad: true,
  language: 'es',
};

export const DEFAULT_SETTINGS: Readonly<SettingsData> = Object.freeze(DEFAULT_VALUES);

const IMAGE_MODES: readonly ImageMode[] = ['psx', 'vhs', 'bw', 'crt'];

const CONTROL_SCHEMES: readonly SettingsData['controlScheme'][] = ['modern', 'tank'];

const LANGUAGES: readonly Language[] = ['es', 'en'];

const SETTINGS_KEYS = [
  'brightness',
  'gamma',
  'postIntensity',
  'imageMode',
  'masterVolume',
  'ambienceVolume',
  'sfxVolume',
  'musicVolume',
  'uiVolume',
  'mouseSensitivity',
  'invertLook',
  'controlScheme',
  'authenticLoading',
  'subtitles',
  'gamepad',
  'language',
] as const;

export interface SettingsEvent {
  readonly data: Readonly<SettingsData>;
  readonly key: keyof SettingsData | null;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function round6(value: number): number {
  return Math.round(value * ROUND_SCALE) / ROUND_SCALE;
}

function numericSetting(range: SettingRange): (raw: unknown, fallback: number) => number {
  return (raw, fallback) => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
    return round6(clamp(raw, range.min, range.max));
  };
}

function booleanSetting(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback;
}

function enumSetting<T extends string>(allowed: readonly T[]): (raw: unknown, fallback: T) => T {
  return (raw, fallback) => {
    if (typeof raw !== 'string') return fallback;
    for (const value of allowed) {
      if (value === raw) return value;
    }
    return fallback;
  };
}

type SettingSanitizers = {
  [K in keyof SettingsData]: (raw: unknown, fallback: SettingsData[K]) => SettingsData[K];
};

const SANITIZERS: SettingSanitizers = {
  brightness: numericSetting(SETTING_RANGES.brightness),
  gamma: numericSetting(SETTING_RANGES.gamma),
  postIntensity: numericSetting(SETTING_RANGES.postIntensity),
  imageMode: enumSetting(IMAGE_MODES),
  masterVolume: numericSetting(SETTING_RANGES.masterVolume),
  ambienceVolume: numericSetting(SETTING_RANGES.ambienceVolume),
  sfxVolume: numericSetting(SETTING_RANGES.sfxVolume),
  musicVolume: numericSetting(SETTING_RANGES.musicVolume),
  uiVolume: numericSetting(SETTING_RANGES.uiVolume),
  mouseSensitivity: numericSetting(SETTING_RANGES.mouseSensitivity),
  invertLook: booleanSetting,
  controlScheme: enumSetting(CONTROL_SCHEMES),
  authenticLoading: booleanSetting,
  subtitles: booleanSetting,
  gamepad: booleanSetting,
  language: enumSetting(LANGUAGES),
};

const LOOSE_SANITIZERS = SANITIZERS as unknown as Record<
  keyof SettingsData,
  (raw: unknown, fallback: unknown) => unknown
>;

function getStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readStoredValues(): SettingsData | null {
  const store = getStorage();
  if (!store) return null;
  let raw: string | null = null;
  try {
    raw = store.getItem(SETTINGS_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const envelope = parsed as { version?: unknown; data?: unknown };
  if (envelope.version !== SETTINGS_VERSION) return null;
  if (typeof envelope.data !== 'object' || envelope.data === null) return null;
  const source = envelope.data as Record<string, unknown>;
  const values: SettingsData = { ...DEFAULT_VALUES };
  const target = values as Record<keyof SettingsData, unknown>;
  for (const key of SETTINGS_KEYS) {
    const value = source[key];
    if (value === undefined) continue;
    target[key] = LOOSE_SANITIZERS[key](value, DEFAULT_VALUES[key]);
  }
  return values;
}

export function formatSettingValue(key: NumericSettingKey, value: number): string {
  const format = SETTING_RANGES[key].format;
  const safe = Number.isFinite(value) ? value : SETTING_RANGES[key].min;
  if (format === 'percent') return `${Math.round(clamp(safe, 0, 1) * 100)}%`;
  if (format === 'float1') return safe.toFixed(1);
  return safe.toFixed(2);
}

export class Settings {
  private values: SettingsData;
  private readonly listeners = new Set<(event: SettingsEvent) => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(overrides?: Partial<SettingsData>) {
    this.values = readStoredValues() ?? { ...DEFAULT_VALUES };
    if (overrides) this.merge(overrides);
  }

  static load(overrides?: Partial<SettingsData>): Settings {
    return new Settings(overrides);
  }

  get data(): Readonly<SettingsData> {
    return this.values;
  }

  get<K extends keyof SettingsData>(key: K): SettingsData[K] {
    return this.values[key];
  }

  set<K extends keyof SettingsData>(key: K, value: SettingsData[K]): void {
    this.assign(key, value);
  }

  adjust<K extends NumericSettingKey>(key: K, direction: -1 | 1): void {
    const range = SETTING_RANGES[key];
    this.assign(key, this.values[key] + range.step * direction);
  }

  reset(): void {
    Object.assign(this.values, DEFAULT_VALUES);
    this.emit(null);
    this.save();
  }

  onChange(listener: (event: SettingsEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  applyTo(config: PsxConfig): void {
    config.effects.brightness = this.values.brightness;
    config.effects.gamma = this.values.gamma;
    config.effects.post_intensity = this.values.postIntensity;
    config.effects.image_mode = this.values.imageMode;
    config.language = this.values.language;
    config.player.control_scheme = this.values.controlScheme;
    config.player.invert_look = this.values.invertLook;
    config.player.look_sensitivity = round6(BASE_LOOK_SENSITIVITY * this.values.mouseSensitivity);
    config.loading.authentic = this.values.authenticLoading;
    config.audio.master = this.values.masterVolume;
    config.audio.ambience = this.values.ambienceVolume;
    config.audio.sfx = this.values.sfxVolume;
    config.audio.music = this.values.musicVolume;
    config.audio.ui = this.values.uiVolume;
  }

  save(): void {
    const store = getStorage();
    if (!store) return;
    try {
      store.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ version: SETTINGS_VERSION, data: this.values }));
    } catch {
      return;
    }
  }

  dispose(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.listeners.clear();
  }

  private merge(overrides: Partial<SettingsData>): void {
    const source = overrides as Record<string, unknown>;
    const target = this.values as Record<keyof SettingsData, unknown>;
    for (const key of SETTINGS_KEYS) {
      const value = source[key];
      if (value === undefined) continue;
      target[key] = LOOSE_SANITIZERS[key](value, DEFAULT_VALUES[key]);
    }
  }

  private assign<K extends keyof SettingsData>(key: K, raw: SettingsData[K]): void {
    const next = SANITIZERS[key](raw, DEFAULT_VALUES[key]);
    if (Object.is(next, this.values[key])) return;
    this.values[key] = next;
    this.emit(key);
    this.scheduleSave();
  }

  private emit(key: keyof SettingsData | null): void {
    if (this.listeners.size === 0) return;
    const event: SettingsEvent = { data: this.values, key };
    for (const listener of [...this.listeners]) listener(event);
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, SAVE_DEBOUNCE_MS);
  }
}
