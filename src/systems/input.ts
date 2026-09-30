import type { Gamepad, PadAction } from './gamepad';

export interface MouseDelta {
  dx: number;
  dy: number;
}

export class Input {
  onLockChange: ((locked: boolean) => void) | null = null;
  locked = false;

  private readonly keys = new Set<string>();
  private readonly pressed = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private pad: Gamepad | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    canvas.addEventListener('click', this.requestLock);

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) {
        this.keys.clear();
        this.pressed.clear();
        this.pad?.clearPending();
      }
      this.onLockChange?.(this.locked);
    });

    window.addEventListener('keydown', (event) => {
      if (!event.repeat) {
        this.pressed.add(event.code);
        this.markKeyboard();
      }
      this.keys.add(event.code);
      if (event.code === 'ArrowUp' || event.code === 'ArrowDown' || event.code === 'Space') {
        event.preventDefault();
      }
    });

    window.addEventListener('keyup', (event) => {
      this.keys.delete(event.code);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.pressed.clear();
    });

    document.addEventListener('mousemove', (event) => {
      if (this.locked) {
        this.mouseDX += event.movementX;
        this.mouseDY += event.movementY;
      }
    });
  }

  get lastSource(): 'keyboard' | 'gamepad' {
    return this.pad ? this.pad.lastSource : 'keyboard';
  }

  attachGamepad(pad: Gamepad | null): void {
    this.pad = pad;
  }

  detachGamepad(): void {
    this.pad = null;
  }

  padPress(action: PadAction): boolean {
    return this.pad ? this.pad.press(action) : false;
  }

  padDown(action: PadAction): boolean {
    return this.pad ? this.pad.down(action) : false;
  }

  padAxis(): { x: number; y: number } {
    return this.pad ? this.pad.axis() : { x: 0, y: 0 };
  }

  padLookAxis(): { x: number; y: number } {
    return this.pad ? this.pad.lookAxis() : { x: 0, y: 0 };
  }

  padTrigger(): number {
    return this.pad ? this.pad.trigger() : 0;
  }

  lock(): void {
    this.requestLock();
  }

  unlock(): void {
    if (this.locked) {
      document.exitPointerLock();
    }
  }

  debugPressed(): string[] {
    return [...this.pressed];
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  consumePress(code: string): boolean {
    if (this.pressed.has(code)) {
      this.pressed.delete(code);
      return true;
    }
    return false;
  }

  clearPending(): void {
    this.pressed.clear();
    this.pad?.clearPending();
  }

  consumeMouseDelta(): MouseDelta {
    const delta = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return delta;
  }

  private markKeyboard(): void {
    if (this.pad) {
      this.pad.lastSource = 'keyboard';
    }
  }

  private readonly requestLock = (): void => {
    if (this.locked || document.pointerLockElement === this.canvas) {
      return;
    }
    try {
      const requested: unknown = this.canvas.requestPointerLock();
      if (requested && typeof (requested as Promise<unknown>).catch === 'function') {
        void (requested as Promise<unknown>).catch(() => {});
      }
    } catch {
      return;
    }
  };
}
