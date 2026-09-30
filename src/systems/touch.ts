import type { Input } from './input';
import { TEXTS, type Language } from './i18n';

export interface TouchControlsOptions {
  getLanguage: () => Language;
  // true cuando la interfaz espera navegación (menús, inventario, examen…):
  // el joystick emite flechas en vez de mover al jugador.
  isNavMode: () => boolean;
  // true solo con pantalla de menú abierta, donde cancelar es ESC; en el
  // inventario/lectura/examen cerrar es I.
  isMenuActive: () => boolean;
  // El botón LUZ solo se muestra cuando el jugador tiene la linterna.
  isFlashlightOwned: () => boolean;
}

const JOY_RADIUS = 56;
const JOY_DEADZONE = 0.16;
// Dirección dominante del joystick para navegar menús.
const NAV_THRESHOLD = 0.42;
// Al entrar en modo navegación con el joystick ya empujado hay que soltarlo
// antes de navegar, para no desplazar el cursor con el movimiento que abrió el
// menú.
const NAV_RECENTER = 0.3;

const NAV_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] as const;

const STYLE = `
#touch-ui {
  position: fixed;
  inset: 0;
  z-index: 20;
  pointer-events: none;
  display: none;
  font-family: "Courier New", ui-monospace, monospace;
}
#touch-ui.enabled { display: block; }
.touch-joystick {
  position: fixed;
  left: 0;
  top: 0;
  width: ${JOY_RADIUS * 2}px;
  height: ${JOY_RADIUS * 2}px;
  margin-left: -${JOY_RADIUS}px;
  margin-top: -${JOY_RADIUS}px;
  border-radius: 50%;
  border: 2px solid rgba(207, 199, 174, 0.4);
  background: rgba(11, 11, 14, 0.28);
  box-shadow: inset 0 0 0 2px rgba(0, 0, 0, 0.25);
  pointer-events: none;
  display: none;
  z-index: 1;
}
.touch-joystick.visible { display: block; }
.touch-knob {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 52px;
  height: 52px;
  margin-left: -26px;
  margin-top: -26px;
  border-radius: 50%;
  border: 2px solid rgba(207, 199, 174, 0.65);
  background: rgba(34, 34, 42, 0.72);
}
.touch-btn {
  position: absolute;
  pointer-events: auto;
  touch-action: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 2px solid rgba(207, 199, 174, 0.45);
  background: rgba(11, 11, 14, 0.4);
  color: #cfc7ae;
  font-family: inherit;
  font-size: 11px;
  font-weight: bold;
  letter-spacing: 0.5px;
  text-align: center;
  z-index: 2;
  user-select: none;
  -webkit-user-select: none;
}
.touch-btn.pressed {
  background: rgba(163, 58, 46, 0.55);
  border-color: rgba(244, 236, 214, 0.85);
  color: #f4ecd6;
}
.touch-btn.disabled { opacity: 0.28; }
.touch-btn.hidden { display: none; }
.touch-btn-use {
  right: calc(24px + env(safe-area-inset-right));
  bottom: calc(24px + env(safe-area-inset-bottom));
  width: 88px;
  height: 88px;
  font-size: 13px;
}
.touch-btn-run {
  right: calc(122px + env(safe-area-inset-right));
  bottom: calc(40px + env(safe-area-inset-bottom));
  width: 60px;
  height: 60px;
}
.touch-btn-bag {
  right: calc(34px + env(safe-area-inset-right));
  bottom: calc(124px + env(safe-area-inset-bottom));
  width: 58px;
  height: 58px;
}
.touch-btn-light {
  right: calc(126px + env(safe-area-inset-right));
  bottom: calc(132px + env(safe-area-inset-bottom));
  width: 58px;
  height: 58px;
}
.touch-btn-pause {
  right: calc(16px + env(safe-area-inset-right));
  top: calc(16px + env(safe-area-inset-top));
  width: 46px;
  height: 46px;
  font-size: 14px;
}
@media (orientation: portrait) {
  .touch-btn-use {
    right: calc(20px + env(safe-area-inset-right));
    bottom: calc(20px + env(safe-area-inset-bottom));
  }
  .touch-btn-run {
    right: calc(118px + env(safe-area-inset-right));
    bottom: calc(36px + env(safe-area-inset-bottom));
  }
  .touch-btn-bag {
    right: calc(24px + env(safe-area-inset-right));
    bottom: calc(120px + env(safe-area-inset-bottom));
  }
  .touch-btn-light {
    right: calc(92px + env(safe-area-inset-right));
    bottom: calc(120px + env(safe-area-inset-bottom));
  }
}
`;

export class TouchControls {
  private readonly input: Input;
  private readonly options: TouchControlsOptions;
  private readonly root: HTMLDivElement;
  private readonly joystick: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly buttons = new Map<string, HTMLDivElement>();
  private joyOriginX = 0;
  private joyOriginY = 0;
  private joyPointer: number | null = null;
  private lookPointer: number | null = null;
  private lookX = 0;
  private lookY = 0;
  private axisX = 0;
  private axisY = 0;
  private navKeys = new Set<string>();
  private needsRecenter = false;
  private navMode = false;
  private enabled = false;
  private disposed = false;

  constructor(input: Input, options: TouchControlsOptions) {
    this.input = input;
    this.options = options;

    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    this.root = document.createElement('div');
    this.root.id = 'touch-ui';

    this.joystick = document.createElement('div');
    this.joystick.className = 'touch-joystick';
    this.knob = document.createElement('div');
    this.knob.className = 'touch-knob';
    this.joystick.appendChild(this.knob);
    this.root.appendChild(this.joystick);

    this.createButton('use', 'touch-btn touch-btn-use', () => this.onUse());
    this.createButton('run', 'touch-btn touch-btn-run', null, (down) => this.onRun(down));
    this.createButton('bag', 'touch-btn touch-btn-bag', () => this.onBag());
    this.createButton('light', 'touch-btn touch-btn-light', () => this.onLight());
    this.createButton('pause', 'touch-btn touch-btn-pause', () => this.onPause());

    document.body.appendChild(this.root);
    this.refreshLabels();

    // El joystick y la mirada se siguen a nivel de documento y solo para
    // punteros táctiles: así el ratón de los portátiles híbridos sigue
    // capturándose con pointer lock sin que la capa táctil lo intercepte.
    document.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    window.addEventListener('pointermove', this.onPointerMove, { capture: true });
    window.addEventListener('pointerup', this.onPointerUp, { capture: true });
    window.addEventListener('pointercancel', this.onPointerUp, { capture: true });
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) {
      return;
    }
    this.enabled = enabled;
    this.root.classList.toggle('enabled', enabled);
    if (!enabled) {
      this.releaseAll();
    }
  }

  // Llamado cada frame por el juego: mantiene sincronizado el estado de
  // navegación (flechas virtuales) con el modo real de la interfaz.
  sync(): void {
    if (!this.enabled) {
      return;
    }
    this.buttons
      .get('light')
      ?.classList.toggle('hidden', !this.options.isFlashlightOwned());
    const nav = this.options.isNavMode();
    if (nav !== this.navMode) {
      this.navMode = nav;
      this.clearNavKeys();
      // Solo hay que recentrar si el joystick ya estaba empujado al abrir el
      // menú; si está suelto, el primer empuje es intencionado.
      this.needsRecenter = nav && Math.hypot(this.axisX, this.axisY) > NAV_RECENTER;
      this.refreshButtonStates();
    }
    if (nav && this.joyPointer !== null && !this.needsRecenter) {
      this.applyNavKeys();
    }
  }

  refreshLabels(): void {
    const texts = TEXTS[this.options.getLanguage()];
    this.setButtonLabel('use', texts.touchUse);
    this.setButtonLabel('run', texts.touchRun);
    this.setButtonLabel('bag', texts.touchBag);
    this.setButtonLabel('light', texts.touchLight);
    this.setButtonLabel('pause', texts.touchPause);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    document.removeEventListener('pointerdown', this.onPointerDown, { capture: true });
    window.removeEventListener('pointermove', this.onPointerMove, { capture: true });
    window.removeEventListener('pointerup', this.onPointerUp, { capture: true });
    window.removeEventListener('pointercancel', this.onPointerUp, { capture: true });
    this.releaseAll();
    this.root.remove();
  }

  private createButton(
    id: string,
    className: string,
    onTap: (() => void) | null,
    onHold?: (down: boolean) => void,
  ): void {
    const button = document.createElement('div');
    button.className = className;
    button.setAttribute('role', 'button');
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      button.setPointerCapture(event.pointerId);
      button.classList.add('pressed');
      this.input.touchPlayed = true;
      if (button.classList.contains('disabled')) {
        return;
      }
      onTap?.();
      onHold?.(true);
    });
    const end = (event: PointerEvent): void => {
      event.preventDefault();
      button.classList.remove('pressed');
      onHold?.(false);
    };
    button.addEventListener('pointerup', end);
    button.addEventListener('pointercancel', end);
    this.buttons.set(id, button);
    this.root.appendChild(button);
  }

  private setButtonLabel(id: string, label: string): void {
    const button = this.buttons.get(id);
    if (button) {
      button.textContent = label;
    }
  }

  private refreshButtonStates(): void {
    this.buttons.get('run')?.classList.toggle('disabled', this.navMode);
    this.buttons.get('light')?.classList.toggle('disabled', this.navMode);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled || event.pointerType === 'mouse') {
      return;
    }
    this.input.touchPlayed = true;
    this.enterFullscreen();
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.touch-btn')) {
      return;
    }
    if (this.joyPointer === null && event.clientX < window.innerWidth * 0.5) {
      event.preventDefault();
      this.joyPointer = event.pointerId;
      this.joyOriginX = event.clientX;
      this.joyOriginY = event.clientY;
      this.placeJoystick(event.clientX, event.clientY, event.clientX, event.clientY);
      return;
    }
    if (this.lookPointer === null && !this.navMode) {
      event.preventDefault();
      this.lookPointer = event.pointerId;
      this.lookX = event.clientX;
      this.lookY = event.clientY;
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId === this.joyPointer) {
      event.preventDefault();
      let dx = event.clientX - this.joyOriginX;
      let dy = event.clientY - this.joyOriginY;
      const length = Math.hypot(dx, dy);
      // El origen persigue al dedo para que la dirección se pueda cambiar sin
      // soltar ni recolocar el pulgar (joystick "flotante" clásico de móvil).
      if (length > JOY_RADIUS) {
        const pull = length - JOY_RADIUS;
        this.joyOriginX += (dx / length) * pull;
        this.joyOriginY += (dy / length) * pull;
        dx = event.clientX - this.joyOriginX;
        dy = event.clientY - this.joyOriginY;
      }
      this.setAxis(dx / JOY_RADIUS, dy / JOY_RADIUS);
      this.placeJoystick(
        this.joyOriginX,
        this.joyOriginY,
        this.joyOriginX + dx,
        this.joyOriginY + dy,
      );
      return;
    }
    if (event.pointerId === this.lookPointer) {
      event.preventDefault();
      if (!this.navMode) {
        this.input.addTouchLook(event.clientX - this.lookX, event.clientY - this.lookY);
      }
      this.lookX = event.clientX;
      this.lookY = event.clientY;
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId === this.joyPointer) {
      event.preventDefault();
      this.joyPointer = null;
      this.setAxis(0, 0);
      this.joystick.classList.remove('visible');
      if (this.navMode) {
        this.needsRecenter = false;
        this.clearNavKeys();
      }
      return;
    }
    if (event.pointerId === this.lookPointer) {
      event.preventDefault();
      this.lookPointer = null;
    }
  };

  private enterFullscreen(): void {
    const doc = document as Document & { webkitFullscreenElement?: Element };
    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      return;
    }
    try {
      const target = document.documentElement as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void> | void;
      };
      const requested = target.requestFullscreen?.() ?? target.webkitRequestFullscreen?.();
      if (requested && typeof (requested as Promise<void>).catch === 'function') {
        void (requested as Promise<void>).catch(() => undefined);
      }
    } catch {
      return;
    }
  }

  private onUse(): void {
    this.input.virtualPress('KeyE');
  }

  private onRun(down: boolean): void {
    if (!down) {
      this.input.setVirtualKey('ShiftLeft', false);
      return;
    }
    if (this.navMode) {
      return;
    }
    this.input.setVirtualKey('ShiftLeft', true);
  }

  private onBag(): void {
    if (this.options.isMenuActive()) {
      this.input.virtualPress('Escape');
      return;
    }
    this.input.virtualPress('KeyI');
  }

  private onLight(): void {
    if (this.navMode) {
      return;
    }
    this.input.virtualPress('KeyF');
  }

  private onPause(): void {
    this.input.virtualPress('Escape');
  }

  private setAxis(px: number, py: number): void {
    const rawX = px;
    const rawY = -py;
    const length = Math.hypot(rawX, rawY);
    let magnitude = Math.min(1, length);
    if (magnitude <= JOY_DEADZONE) {
      this.axisX = 0;
      this.axisY = 0;
      this.input.setTouchMove(0, 0);
      return;
    }
    magnitude = (magnitude - JOY_DEADZONE) / (1 - JOY_DEADZONE);
    this.axisX = (rawX / length) * magnitude;
    this.axisY = (rawY / length) * magnitude;
    if (this.navMode) {
      this.input.setTouchMove(0, 0);
      if (this.needsRecenter && magnitude < NAV_RECENTER) {
        this.needsRecenter = false;
      }
      if (!this.needsRecenter) {
        this.applyNavKeys();
      }
      return;
    }
    this.input.setTouchMove(this.axisX, this.axisY);
  }

  private applyNavKeys(): void {
    const x = this.axisX;
    const y = this.axisY;
    let next: string | null = null;
    if (Math.max(Math.abs(x), Math.abs(y)) >= NAV_THRESHOLD) {
      if (Math.abs(y) >= Math.abs(x)) {
        next = y > 0 ? 'ArrowUp' : 'ArrowDown';
      } else {
        next = x > 0 ? 'ArrowRight' : 'ArrowLeft';
      }
    }
    for (const key of NAV_KEYS) {
      const wanted = key === next;
      if (wanted && !this.navKeys.has(key)) {
        this.navKeys.add(key);
        this.input.setVirtualKey(key, true);
      } else if (!wanted && this.navKeys.has(key)) {
        this.navKeys.delete(key);
        this.input.setVirtualKey(key, false);
      }
    }
  }

  private clearNavKeys(): void {
    for (const key of this.navKeys) {
      this.input.setVirtualKey(key, false);
    }
    this.navKeys.clear();
  }

  private placeJoystick(
    baseX: number,
    baseY: number,
    knobX: number,
    knobY: number,
  ): void {
    this.joystick.classList.add('visible');
    this.joystick.style.transform = `translate(${Math.round(baseX)}px, ${Math.round(baseY)}px)`;
    const offsetX = knobX - baseX;
    const offsetY = knobY - baseY;
    this.knob.style.transform = `translate(${Math.round(offsetX)}px, ${Math.round(offsetY)}px)`;
  }

  private releaseAll(): void {
    this.joyPointer = null;
    this.lookPointer = null;
    this.joystick.classList.remove('visible');
    this.setAxis(0, 0);
    this.clearNavKeys();
    this.input.setVirtualKey('ShiftLeft', false);
    this.input.setTouchMove(0, 0);
  }
}
