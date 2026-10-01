import * as THREE from 'three';
import type { ImageMode, PsxConfig } from './config';
import blitVert from '../shaders/blit.vert.glsl?raw';
import blitFrag from '../shaders/blit.frag.glsl?raw';

const IMAGE_MODE_IDS: Readonly<Record<ImageMode, number>> = {
  psx: 0,
  vhs: 1,
  bw: 2,
  crt: 3,
};

const BRIGHTNESS_RANGE = { min: 0, max: 4 };
const GAMMA_RANGE = { min: 0.1, max: 4 };

// En vertical el render cubre toda la pantalla con un ancho lógico fijo y la
// altura derivada del aspecto del dispositivo (los móviles son muy altos).
const PORTRAIT_WIDTH = 360;
const PORTRAIT_MIN_HEIGHT = 320;

// Radio máximo del desenfoque de despertar, en texels de la resolución base
// (640×480). A más resolución se escala para conservar el mismo tamaño en
// pantalla.
const BLUR_MAX_TEXELS = 6;

function imageModeId(mode: ImageMode): number {
  const id = IMAGE_MODE_IDS[mode];
  return typeof id === 'number' ? id : IMAGE_MODE_IDS.psx;
}

function isPortraitWindow(): boolean {
  return window.innerHeight > window.innerWidth;
}

export class PsxRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly viewport = new THREE.Vector4();
  onResolutionChange: ((width: number, height: number) => void) | null = null;

  private renderTarget: THREE.WebGLRenderTarget;
  private readonly config: PsxConfig;
  // En iOS el cambio de orientación llega antes que el nuevo tamaño de ventana;
  // el par "base" queda fijo para poder volver a horizontal sin releer config.
  private readonly baseResolution: [number, number];
  private resolution: [number, number];
  private readonly portraitEnabled: boolean;
  private readonly blitScene = new THREE.Scene();
  private readonly blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly blitMaterial: THREE.ShaderMaterial;
  private readonly clearColor = new THREE.Color();
  private surfaceWidth = 1;
  private surfaceHeight = 1;
  private imageMode: ImageMode = 'psx';
  private blurAmount = 0;

  constructor(canvas: HTMLCanvasElement, config: PsxConfig, portraitEnabled = false) {
    this.config = config;
    this.portraitEnabled = portraitEnabled;
    this.baseResolution = [config.resolution[0], config.resolution[1]];
    this.resolution = [config.resolution[0], config.resolution[1]];
    const [resWidth, resHeight] = this.resolution;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(1);
    this.renderer.autoClear = false;
    this.renderer.shadowMap.enabled = false;

    this.renderTarget = this.createRenderTarget(resWidth, resHeight);

    this.clearColor.setRGB(config.clear_color[0], config.clear_color[1], config.clear_color[2]);

    this.blitMaterial = new THREE.ShaderMaterial({
      vertexShader: blitVert,
      fragmentShader: blitFrag,
      uniforms: {
        u_source: { value: this.renderTarget.texture },
        u_fade: { value: 0 },
        u_brightness: { value: 1 },
        u_gamma: { value: 1 },
        u_mode: { value: IMAGE_MODE_IDS.psx },
        u_intensity: { value: 0 },
        u_time: { value: 0 },
        u_texel: { value: new THREE.Vector2(1 / resWidth, 1 / resHeight) },
        u_blur: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blitMaterial);
    quad.frustumCulled = false;
    this.blitScene.add(quad);

    this.syncEffects(config);
    this.refresh();
    window.addEventListener('resize', this.refresh);
    // Móvil: la barra del navegador y el giro del dispositivo no siempre
    // emiten "resize" a tiempo; estos eventos cubren esos cambios de pantalla.
    window.visualViewport?.addEventListener('resize', this.refresh);
    window.addEventListener('orientationchange', this.handleOrientationChange);
    document.addEventListener('fullscreenchange', this.refresh);
  }

  private readonly handleOrientationChange = (): void => {
    this.refresh();
    window.setTimeout(this.refresh, 250);
  };

  get canvasWidth(): number {
    return this.surfaceWidth;
  }

  get canvasHeight(): number {
    return this.surfaceHeight;
  }

  get mode(): ImageMode {
    return this.imageMode;
  }

  // Par de resolución activo (horizontal 4:3 u vertical dinámico de móvil).
  get activeResolution(): readonly [number, number] {
    return this.resolution;
  }

  refresh = (): void => {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(window.innerWidth * dpr));
    const height = Math.max(1, Math.round(window.innerHeight * dpr));
    this.surfaceWidth = width;
    this.surfaceHeight = height;
    this.renderer.setSize(width, height, false);

    const next = this.desiredResolution();
    const changed = next[0] !== this.resolution[0] || next[1] !== this.resolution[1];
    if (changed) {
      this.setResolution(next[0], next[1]);
    }

    const [resWidth, resHeight] = this.resolution;
    (this.blitMaterial.uniforms.u_texel.value as THREE.Vector2).set(1 / resWidth, 1 / resHeight);
    this.syncBlur();

    const fit = Math.min(width / resWidth, height / resHeight);
    // En vertical se prioriza llenar la pantalla: el escalado entero dejaría
    // franjas negras aunque la resolución ya coincide con el aspecto real.
    const portraitActive = this.portraitEnabled && isPortraitWindow();
    const scale =
      this.config.effects.integer_scaling && !portraitActive && fit >= 1 ? Math.floor(fit) : fit;
    const viewWidth = Math.min(width, Math.max(1, Math.round(resWidth * scale)));
    const viewHeight = Math.min(height, Math.max(1, Math.round(resHeight * scale)));
    this.viewport.set(
      Math.floor((width - viewWidth) / 2),
      Math.floor((height - viewHeight) / 2),
      viewWidth,
      viewHeight,
    );

    this.syncEffects(this.config);
    if (changed) {
      this.onResolutionChange?.(resWidth, resHeight);
    }
  };

  private desiredResolution(): [number, number] {
    if (!this.portraitEnabled || !isPortraitWindow()) {
      return this.baseResolution;
    }
    const aspect = window.innerHeight / Math.max(1, window.innerWidth);
    const height = Math.max(PORTRAIT_MIN_HEIGHT, Math.round(PORTRAIT_WIDTH * aspect));
    return [PORTRAIT_WIDTH, height];
  }

  private setResolution(width: number, height: number): void {
    const previous = this.renderTarget;
    this.resolution = [width, height];
    this.renderTarget = this.createRenderTarget(width, height);
    this.blitMaterial.uniforms.u_source.value = this.renderTarget.texture;
    previous.dispose();
  }

  private createRenderTarget(width: number, height: number): THREE.WebGLRenderTarget {
    const target = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
      depthBuffer: true,
    });
    const texture = target.texture;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    return target;
  }

  syncEffects(config: PsxConfig): void {
    const effects = config.effects;
    const uniforms = this.blitMaterial.uniforms;
    uniforms.u_brightness.value = THREE.MathUtils.clamp(
      effects.brightness,
      BRIGHTNESS_RANGE.min,
      BRIGHTNESS_RANGE.max,
    );
    uniforms.u_gamma.value = THREE.MathUtils.clamp(
      effects.gamma,
      GAMMA_RANGE.min,
      GAMMA_RANGE.max,
    );
    uniforms.u_intensity.value = THREE.MathUtils.clamp(effects.post_intensity, 0, 1);
    this.imageMode = effects.image_mode;
    uniforms.u_mode.value = imageModeId(effects.image_mode);
  }

  setImageMode(mode: ImageMode): void {
    if (typeof IMAGE_MODE_IDS[mode] !== 'number') {
      return;
    }
    this.imageMode = mode;
    this.config.effects.image_mode = mode;
    this.blitMaterial.uniforms.u_mode.value = imageModeId(mode);
  }

  setBrightness(value: number): void {
    this.config.effects.brightness = value;
    this.syncEffects(this.config);
  }

  setGamma(value: number): void {
    this.config.effects.gamma = value;
    this.syncEffects(this.config);
  }

  setIntensity(value: number): void {
    this.config.effects.post_intensity = value;
    this.syncEffects(this.config);
  }

  setFade(value: number): void {
    this.blitMaterial.uniforms.u_fade.value = THREE.MathUtils.clamp(value, 0, 1);
  }

  // Desenfoque de pantalla completa (0–1) para la secuencia de despertar.
  setBlur(value: number): void {
    this.blurAmount = THREE.MathUtils.clamp(value, 0, 1);
    this.syncBlur();
  }

  private syncBlur(): void {
    const scale = this.resolution[1] / this.baseResolution[1];
    this.blitMaterial.uniforms.u_blur.value = this.blurAmount * BLUR_MAX_TEXELS * scale;
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const renderer = this.renderer;
    const [resWidth, resHeight] = this.resolution;

    this.blitMaterial.uniforms.u_time.value = performance.now() / 1000;
    renderer.setRenderTarget(this.renderTarget);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, resWidth, resHeight);
    renderer.setClearColor(this.clearColor, 1);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);

    renderer.setRenderTarget(null);
    renderer.setScissorTest(true);
    renderer.setScissor(0, 0, this.surfaceWidth, this.surfaceHeight);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    renderer.setScissorTest(false);
    renderer.setViewport(this.viewport);
    renderer.render(this.blitScene, this.blitCamera);
  }
}
