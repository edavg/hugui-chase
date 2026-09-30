export type PadAction =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'confirm'
  | 'cancel'
  | 'interact'
  | 'inventory'
  | 'combine'
  | 'pause'
  | 'menu'
  | 'load'
  | 'run'
  | 'pageUp'
  | 'pageDown';

export interface GamepadOptions {
  deadzone?: number;
  lookDeadzone?: number;
}

type NativePad = Exclude<ReturnType<Navigator['getGamepads']>[number], null>;
type NativeActuator = GamepadHapticActuator | undefined;

const DEFAULT_DEADZONE = 0.22;
const MIN_LOOK_DEADZONE = 0.3;
const TRIGGER_DEADZONE = 0.05;
const STICK_ANGLE = 0.62;
const BUTTON_PRESS = 0.5;
const MAX_STEP = 0.25;
const RUMBLE_STRONG = 0.6;
const RUMBLE_WEAK = 0.35;
const RUMBLE_DURATION = 180;
const NO_RUMBLE = -1;

const BUTTON_ACTIONS = new Map<number, readonly PadAction[]>([
  [0, ['interact', 'confirm']],
  [1, ['cancel']],
  [2, ['inventory']],
  [3, ['combine']],
  [4, ['pageUp']],
  [5, ['pageDown']],
  [6, ['run']],
  [7, ['load']],
  [8, ['menu']],
  [9, ['pause']],
  [12, ['up']],
  [13, ['down']],
  [14, ['left']],
  [15, ['right']],
]);

const DIRECTIONS: readonly (readonly [PadAction, 0 | 1, -1 | 1])[] = [
  ['up', 1, -1],
  ['down', 1, 1],
  ['left', 0, -1],
  ['right', 0, 1],
];

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function stick(x: number, y: number, deadzone: number): { x: number; y: number } {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= deadzone || magnitude === 0) {
    return { x: 0, y: 0 };
  }
  const scaled = Math.min(1, (magnitude - deadzone) / (1 - deadzone));
  return { x: (x / magnitude) * scaled, y: (y / magnitude) * scaled };
}

function ramp(value: number, deadzone: number): number {
  if (value <= deadzone) {
    return 0;
  }
  return Math.min(1, (value - deadzone) / (1 - deadzone));
}

function buttonValue(pad: NativePad | null, index: number): number {
  const button: unknown = pad?.buttons[index];
  if (typeof button === 'number') {
    return clamp01(button);
  }
  if (typeof button === 'object' && button !== null) {
    const entry = button as { pressed?: unknown; value?: unknown };
    if (typeof entry.value === 'number' && Number.isFinite(entry.value)) {
      return clamp01(entry.value);
    }
    return entry.pressed ? 1 : 0;
  }
  return 0;
}

function axisValue(pad: NativePad | null, index: number): number {
  const value: unknown = pad?.axes[index];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(-1, Math.min(1, value));
}

function triggerValue(pad: NativePad | null): number {
  const digital = Math.max(buttonValue(pad, 6), buttonValue(pad, 7));
  const analog = Math.max(axisValue(pad, 4), axisValue(pad, 5));
  return Math.max(digital, ramp(analog, TRIGGER_DEADZONE));
}

export class Gamepad {
  lastSource: 'keyboard' | 'gamepad' = 'keyboard';

  private readonly deadzone: number;
  private readonly lookDeadzone: number;
  private held = new Set<PadAction>();
  private current = new Set<PadAction>();
  private readonly pending = new Set<PadAction>();
  private pad: NativePad | null = null;
  private padId = '';
  private padIndex = -1;
  private online = false;
  private enabled = true;
  private move: { x: number; y: number } = { x: 0, y: 0 };
  private look: { x: number; y: number } = { x: 0, y: 0 };
  private throttle = 0;
  private clock = 0;
  private rumbleUntil = NO_RUMBLE;

  constructor(options: GamepadOptions = {}) {
    this.deadzone = clamp01(options.deadzone ?? DEFAULT_DEADZONE);
    this.lookDeadzone = clamp01(options.lookDeadzone ?? Math.max(this.deadzone, MIN_LOOK_DEADZONE));
    if (typeof window === 'undefined') {
      return;
    }
    window.addEventListener('gamepadconnected', this.handleConnected);
    window.addEventListener('gamepaddisconnected', this.handleDisconnected);
  }

  get connected(): boolean {
    return this.online;
  }

  get id(): string {
    return this.padId;
  }

  get index(): number {
    return this.padIndex;
  }

  poll(dt: number): void {
    this.clock += Math.max(0, Math.min(dt, MAX_STEP));
    this.stopRumble();
    const found = this.firstPad();
    if (!found) {
      this.drop();
      return;
    }
    if (!this.pad || this.pad.id !== found.id) {
      this.attach(found);
    }
    if (!this.enabled) {
      this.reset();
      return;
    }
    const move = stick(axisValue(this.pad, 0), axisValue(this.pad, 1), this.deadzone);
    const look = stick(axisValue(this.pad, 2), axisValue(this.pad, 3), this.lookDeadzone);
    const throttle = triggerValue(this.pad);
    this.current.clear();
    for (const [index, actions] of BUTTON_ACTIONS) {
      if (buttonValue(this.pad, index) > BUTTON_PRESS) {
        for (const action of actions) {
          this.current.add(action);
        }
      }
    }
    for (const [action, axis, sign] of DIRECTIONS) {
      const value = axis === 0 ? move.x : move.y;
      if (value * sign > STICK_ANGLE) {
        this.current.add(action);
      }
    }
    for (const action of this.current) {
      if (!this.held.has(action)) {
        this.pending.add(action);
      }
    }
    const previous = this.held;
    this.held = this.current;
    this.current = previous;
    if (
      this.held.size > 0 ||
      move.x !== 0 ||
      move.y !== 0 ||
      look.x !== 0 ||
      look.y !== 0 ||
      throttle > 0
    ) {
      this.lastSource = 'gamepad';
    }
    this.move = move;
    this.look = look;
    this.throttle = throttle;
  }

  press(action: PadAction): boolean {
    if (!this.ready()) {
      return false;
    }
    if (this.pending.has(action)) {
      this.pending.delete(action);
      return true;
    }
    return false;
  }

  down(action: PadAction): boolean {
    return this.ready() && this.held.has(action);
  }

  axis(): { x: number; y: number } {
    if (!this.ready()) {
      return { x: 0, y: 0 };
    }
    return { x: this.move.x, y: this.move.y };
  }

  lookAxis(): { x: number; y: number } {
    if (!this.ready()) {
      return { x: 0, y: 0 };
    }
    return { x: this.look.x, y: this.look.y };
  }

  trigger(): number {
    return this.ready() ? this.throttle : 0;
  }

  clearPending(): void {
    this.pending.clear();
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) {
      return;
    }
    this.enabled = enabled;
    if (!enabled) {
      this.lastSource = 'keyboard';
      this.reset();
      this.stopRumble();
    }
  }

  rumble(strong: number = RUMBLE_STRONG, weak: number = RUMBLE_WEAK, durationMs: number = RUMBLE_DURATION): void {
    const actuator = this.actuator();
    if (!actuator || typeof actuator.playEffect !== 'function') {
      return;
    }
    const duration = Math.max(0, durationMs);
    try {
      const played: unknown = actuator.playEffect('dual-rumble', {
        startDelay: 0,
        duration,
        strongMagnitude: clamp01(strong),
        weakMagnitude: clamp01(weak),
      });
      if (played && typeof (played as Promise<unknown>).then === 'function') {
        void (played as Promise<unknown>).then(undefined, () => {});
      }
      this.rumbleUntil = this.clock + duration / 1000;
    } catch {
      this.rumbleUntil = NO_RUMBLE;
    }
  }

  dispose(): void {
    if (typeof window === 'undefined') {
      return;
    }
    window.removeEventListener('gamepadconnected', this.handleConnected);
    window.removeEventListener('gamepaddisconnected', this.handleDisconnected);
    this.drop();
  }

  private readonly handleConnected = (event: Event): void => {
    const pad = (event as Partial<GamepadEvent>).gamepad;
    if (pad && this.padId && pad.id !== this.padId) {
      return;
    }
    this.online = true;
  };

  private readonly handleDisconnected = (event: Event): void => {
    const pad = (event as Partial<GamepadEvent>).gamepad;
    if (pad && this.padId && pad.id !== this.padId) {
      return;
    }
    this.drop();
  };

  private firstPad(): NativePad | null {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      return null;
    }
    const list = navigator.getGamepads();
    if (!list) {
      return null;
    }
    for (const pad of list) {
      if (pad) {
        return pad;
      }
    }
    return null;
  }

  private attach(pad: NativePad): void {
    this.pad = pad;
    this.padId = pad.id;
    this.padIndex = pad.index;
    this.online = true;
    this.reset();
  }

  private drop(): void {
    const had = this.pad !== null;
    this.pad = null;
    this.padId = '';
    this.padIndex = -1;
    this.online = false;
    this.rumbleUntil = NO_RUMBLE;
    if (had) {
      this.lastSource = 'keyboard';
      this.reset();
    }
  }

  private ready(): boolean {
    return this.enabled && this.online && this.pad !== null;
  }

  private reset(): void {
    this.held.clear();
    this.current.clear();
    this.pending.clear();
    this.move = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
    this.throttle = 0;
  }

  private actuator(): NativeActuator | null {
    if (!this.ready()) {
      return null;
    }
    return (this.pad?.vibrationActuator as NativeActuator) ?? null;
  }

  private stopRumble(): void {
    if (this.rumbleUntil === NO_RUMBLE || this.clock < this.rumbleUntil) {
      return;
    }
    this.rumbleUntil = NO_RUMBLE;
    const actuator = this.actuator();
    if (!actuator || typeof actuator.reset !== 'function') {
      return;
    }
    try {
      actuator.reset();
    } catch {
      this.rumbleUntil = NO_RUMBLE;
    }
  }
}
