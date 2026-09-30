import type { Gamepad, PadAction } from './gamepad';

export interface MouseDelta {
  dx: number;
  dy: number;
}

export interface MoveAxis {
  x: number;
  y: number;
}

// El arrastre táctil en CSS px se multiplica para acercarlo a la sensibilidad
// del ratón; girar 180° con el pulgar debe caber en un gesto corto.
const TOUCH_LOOK_SCALE = 1.7;

function detectTouch(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  if (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) {
    return true;
  }
  if (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) {
    return true;
  }
  return 'ontouchstart' in window;
}

export class Input {
  onLockChange: ((locked: boolean) => void) | null = null;
  locked = false;
  readonly touchCapable: boolean;
  touchPlayed = false;

  private readonly keys = new Set<string>();
  private readonly pressed = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private touchDX = 0;
  private touchDY = 0;
  private touchMove: MoveAxis = { x: 0, y: 0 };
  private pad: Gamepad | null = null;
  private lastTouchAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const params = new URLSearchParams(window.location.search);
    const override = params.get('touch');
    this.touchCapable = override === '1' ? true : override === '0' ? false : detectTouch();

    canvas.addEventListener('click', this.requestLock);

    // El clic sintetizado tras un toque no debe pedir pointer lock (y menos en
    // un dispositivo táctil puro, donde no existe); en híbridos, el ratón
    // sigue funcionando porque no toca la pantalla.
    window.addEventListener(
      'pointerdown',
      (event) => {
        if (event.pointerType === 'touch' || event.pointerType === 'pen') {
          this.lastTouchAt = performance.now();
        }
      },
      { capture: true, passive: true },
    );

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

  padAxis(): MoveAxis {
    return this.pad ? this.pad.axis() : { x: 0, y: 0 };
  }

  // Eje de movimiento canónico: x = derecha, y = delante. El stick del mando
  // llega con la Y invertida (arriba es -1 en el estándar), así que se voltea;
  // el joystick táctil ya llega en este espacio.
  moveAxis(): MoveAxis {
    const touchLength = Math.hypot(this.touchMove.x, this.touchMove.y);
    if (touchLength > 0.001) {
      return { x: this.touchMove.x, y: this.touchMove.y };
    }
    const pad = this.padAxis();
    return { x: pad.x, y: -pad.y };
  }

  padLookAxis(): MoveAxis {
    return this.pad ? this.pad.lookAxis() : { x: 0, y: 0 };
  }

  padTrigger(): number {
    return this.pad ? this.pad.trigger() : 0;
  }

  // Entrada inyectada por los controles táctiles: un toque de botón equivale a
  // pulsar una tecla una vez.
  virtualPress(code: string): void {
    this.pressed.add(code);
  }

  // Tecla "mantenida" virtual (correr, navegación con el joystick).
  setVirtualKey(code: string, down: boolean): void {
    if (down) {
      this.keys.add(code);
    } else {
      this.keys.delete(code);
    }
  }

  setTouchMove(x: number, y: number): void {
    this.touchMove.x = x;
    this.touchMove.y = y;
  }

  addTouchLook(dx: number, dy: number): void {
    this.touchDX += dx * TOUCH_LOOK_SCALE;
    this.touchDY += dy * TOUCH_LOOK_SCALE;
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
    const delta = { dx: this.mouseDX + this.touchDX, dy: this.mouseDY + this.touchDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.touchDX = 0;
    this.touchDY = 0;
    return delta;
  }

  private markKeyboard(): void {
    if (this.pad) {
      this.pad.lastSource = 'keyboard';
    }
  }

  private readonly requestLock = (): void => {
    if (performance.now() - this.lastTouchAt < 500) {
      return;
    }
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
