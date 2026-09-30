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

function imageModeId(mode: ImageMode): number {
  const id = IMAGE_MODE_IDS[mode];
  return typeof id === 'number' ? id : IMAGE_MODE_IDS.psx;
}

export class PsxRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly renderTarget: THREE.WebGLRenderTarget;
  readonly viewport = new THREE.Vector4();

  private readonly config: PsxConfig;
  private readonly blitScene = new THREE.Scene();
  private readonly blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly blitMaterial: THREE.ShaderMaterial;
  private readonly clearColor = new THREE.Color();
  private surfaceWidth = 1;
  private surfaceHeight = 1;
  private imageMode: ImageMode = 'psx';

  constructor(canvas: HTMLCanvasElement, config: PsxConfig) {
    this.config = config;
    const [resWidth, resHeight] = config.resolution;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(1);
    this.renderer.autoClear = false;
    this.renderer.shadowMap.enabled = false;

    this.renderTarget = new THREE.WebGLRenderTarget(resWidth, resHeight, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
      depthBuffer: true,
    });
    const target = this.renderTarget.texture;
    target.generateMipmaps = false;
    target.minFilter = THREE.NearestFilter;
    target.magFilter = THREE.NearestFilter;
    target.wrapS = THREE.ClampToEdgeWrapping;
    target.wrapT = THREE.ClampToEdgeWrapping;

    this.clearColor.setRGB(config.clear_color[0], config.clear_color[1], config.clear_color[2]);

    this.blitMaterial = new THREE.ShaderMaterial({
      vertexShader: blitVert,
      fragmentShader: blitFrag,
      uniforms: {
        u_source: { value: target },
        u_fade: { value: 0 },
        u_brightness: { value: 1 },
        u_gamma: { value: 1 },
        u_mode: { value: IMAGE_MODE_IDS.psx },
        u_intensity: { value: 0 },
        u_time: { value: 0 },
        u_texel: { value: new THREE.Vector2(1 / resWidth, 1 / resHeight) },
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
  }

  get canvasWidth(): number {
    return this.surfaceWidth;
  }

  get canvasHeight(): number {
    return this.surfaceHeight;
  }

  get mode(): ImageMode {
    return this.imageMode;
  }

  refresh = (): void => {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(window.innerWidth * dpr));
    const height = Math.max(1, Math.round(window.innerHeight * dpr));
    this.surfaceWidth = width;
    this.surfaceHeight = height;
    this.renderer.setSize(width, height, false);

    const [resWidth, resHeight] = this.config.resolution;
    (this.blitMaterial.uniforms.u_texel.value as THREE.Vector2).set(1 / resWidth, 1 / resHeight);

    const fit = Math.min(width / resWidth, height / resHeight);
    const scale = this.config.effects.integer_scaling && fit >= 1 ? Math.floor(fit) : fit;
    const viewWidth = Math.min(width, Math.max(1, Math.round(resWidth * scale)));
    const viewHeight = Math.min(height, Math.max(1, Math.round(resHeight * scale)));
    this.viewport.set(
      Math.floor((width - viewWidth) / 2),
      Math.floor((height - viewHeight) / 2),
      viewWidth,
      viewHeight,
    );

    this.syncEffects(this.config);
  };

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

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const renderer = this.renderer;
    const [resWidth, resHeight] = this.config.resolution;

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
