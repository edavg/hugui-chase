import * as THREE from 'three';
import { loadConfig, type PsxConfig } from '../systems/config';
import { FixedLoop } from '../systems/loop';
import { createPsxMaterial } from '../systems/psxMaterial';
import { PsxRenderer } from '../systems/psxRenderer';
import {
  ATTACK_CLIP,
  DEFAULT_CLIP_SPEEDS,
  IDLE_CLIP,
  RUN_CLIP,
  SCREAM_CLIP,
  StalkerAnimator,
  WALK_CLIP,
  WALL_SLAM_CLIP,
} from '../systems/stalkerAnimator';
import { loadStalkerHeadAtlas } from '../systems/stalkerFace';
import { loadStalkerRig, type StalkerRig } from '../systems/stalkerModel';
import { loadPixelTexture } from '../systems/textures';

const TEXTURES_BASE = `${import.meta.env.BASE_URL}assets/textures/horror_pack/`;
const ATTACK_IMPACT_T = 0.63;
const CIRCLE_RADIUS = 3.5;
const ARENA_SIZE = 30;
const LINE_POINTS: ReadonlyArray<{ x: number; z: number }> = [
  { x: 0, z: -8 },
  { x: 0, z: 8 },
];

const CLIP_OPTIONS: ReadonlyArray<{ clip: string; label: string }> = [
  { clip: IDLE_CLIP, label: 'Idle_Watchful · quieto' },
  { clip: WALK_CLIP, label: 'Walk_Nervous · andar' },
  { clip: RUN_CLIP, label: 'Run_Frantic · correr' },
  { clip: ATTACK_CLIP, label: 'Attack_Lunge · ataque' },
  { clip: SCREAM_CLIP, label: 'Scream.lol · grito' },
  { clip: WALL_SLAM_CLIP, label: 'WallSlam_Recover' },
];

const MODE_LABELS: Record<MoveMode, string> = {
  pursue: 'persecución + ataque',
  line: 'andar en línea',
  circle: 'círculo',
  idle: 'quieto',
};

type MoveMode = 'idle' | 'line' | 'circle' | 'pursue';
type PursuePhase = 'approach' | 'attack' | 'hold' | 'done';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`Falta #${id} en stalker-lab.html`);
  }
  return node as T;
}

function angleDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function tint(geometry: THREE.BufferGeometry, color: [number, number, number]): void {
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    colors[i * 3] = color[0];
    colors[i * 3 + 1] = color[1];
    colors[i * 3 + 2] = color[2];
  }
  geometry.setAttribute('a_color', new THREE.BufferAttribute(colors, 3));
}

function createCheckerTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('No se pudo crear el contexto 2D del suelo del lab');
  }
  const cell = size / 2;
  const colors = ['#8d8a82', '#726f68'];
  for (let y = 0; y < 2; y += 1) {
    for (let x = 0; x < 2; x += 1) {
      ctx.fillStyle = colors[(x + y) % 2];
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.fillRect(0, 0, size, 1);
  ctx.fillRect(0, 0, 1, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function makeRing(radius: number, color: number): THREE.LineLoop {
  const segments = 40;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 });
  return new THREE.LineLoop(geometry, material);
}

class StalkerLab {
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly psx: PsxRenderer;
  private readonly loop: FixedLoop;
  private readonly stalkerRoot = new THREE.Group();
  private readonly dummy = new THREE.Group();
  private readonly catchRing = makeRing(1, 0x8f3a30);
  private readonly impactRing: THREE.Mesh;

  private rig: StalkerRig | null = null;
  private animator: StalkerAnimator | null = null;
  private readonly clipSpeeds: Record<string, number> = {
    [WALK_CLIP]: DEFAULT_CLIP_SPEEDS[WALK_CLIP],
    [RUN_CLIP]: DEFAULT_CLIP_SPEEDS[RUN_CLIP],
  };

  private readonly position = new THREE.Vector3();
  private yaw = 0;
  private locomotionSpeed = 0;

  private mode: MoveMode = 'pursue';
  private moveSpeed = 3.6;
  private autoClip = true;
  private syncSpeed = true;
  private attackDistance = 6;
  private attackLoop = true;
  private pursuePhase: PursuePhase = 'approach';
  private holdTimer = 0;
  private lineIndex = 0;
  private circleTheta = 0;

  private playing = true;
  private fade = 0.25;
  private manualTimeScale = 1;
  private attackAction: THREE.AnimationAction | null = null;
  private attackFlashed = false;
  private impactTimer = -1;

  private readonly feet: THREE.Object3D[] = [];
  private measuredNatural: number | null = null;

  private camYaw = 0.85;
  private camPitch = 0.3;
  private camDist = 6.5;
  private camOrbit = false;
  private camFollow = true;
  private readonly camTarget = new THREE.Vector3();

  private hudTimer = 0;

  private readonly ui = {
    mode: el<HTMLElement>('out-mode'),
    clip: el<HTMLElement>('out-clip'),
    time: el<HTMLElement>('out-time'),
    timescale: el<HTMLElement>('out-timescale'),
    speed: el<HTMLElement>('out-speed'),
    foot: el<HTMLElement>('out-foot'),
    natural: el<HTMLElement>('out-natural'),
    slip: el<HTMLElement>('out-slip'),
    pos: el<HTMLElement>('out-pos'),
    clipSelect: el<HTMLSelectElement>('clip-select'),
    clipTimescale: el<HTMLInputElement>('clip-timescale'),
    clipTimescaleOut: el<HTMLElement>('clip-timescale-out'),
    clipFade: el<HTMLInputElement>('clip-fade'),
    clipFadeOut: el<HTMLElement>('clip-fade-out'),
    clipScrub: el<HTMLInputElement>('clip-scrub'),
    clipScrubOut: el<HTMLElement>('clip-scrub-out'),
    play: el<HTMLButtonElement>('btn-play'),
    restart: el<HTMLButtonElement>('btn-restart'),
    moveMode: el<HTMLSelectElement>('move-mode'),
    moveSpeed: el<HTMLInputElement>('move-speed'),
    moveSpeedOut: el<HTMLElement>('move-speed-out'),
    moveAuto: el<HTMLInputElement>('move-auto'),
    moveSync: el<HTMLInputElement>('move-sync'),
    naturalWalk: el<HTMLInputElement>('natural-walk'),
    naturalRun: el<HTMLInputElement>('natural-run'),
    calibrate: el<HTMLButtonElement>('btn-calibrate'),
    moveStatus: el<HTMLElement>('move-status'),
    attack: el<HTMLButtonElement>('btn-attack'),
    attackDistance: el<HTMLInputElement>('attack-distance'),
    attackDistanceOut: el<HTMLElement>('attack-distance-out'),
    attackLoop: el<HTMLInputElement>('attack-loop'),
    attackStatus: el<HTMLElement>('attack-status'),
    camOrbit: el<HTMLInputElement>('cam-orbit'),
    camFollow: el<HTMLInputElement>('cam-follow'),
    camReset: el<HTMLButtonElement>('btn-cam-reset'),
    flash: el<HTMLElement>('flash'),
  };

  constructor(
    private readonly config: PsxConfig,
    private readonly canvas: HTMLCanvasElement,
  ) {
    const [resWidth, resHeight] = config.resolution;
    this.camera = new THREE.PerspectiveCamera(
      config.fov,
      resWidth / resHeight,
      config.near,
      config.far,
    );
    this.psx = new PsxRenderer(canvas, config);
    this.impactRing = new THREE.Mesh(
      new THREE.RingGeometry(0.26, 0.42, 24),
      new THREE.MeshBasicMaterial({
        color: 0xa8322a,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.impactRing.rotation.x = -Math.PI / 2;
    this.impactRing.visible = false;

    this.scene.add(this.stalkerRoot, this.catchRing, this.impactRing, this.dummy);
    this.loop = new FixedLoop(
      config.fps,
      (dt) => this.update(dt),
      () => this.render(),
    );

    this.populateClips();
    this.bindControls();
    this.bindPointer();
    this.resetPursue();
  }

  async start(): Promise<void> {
    const loader = new THREE.TextureLoader();
    const [headAtlas, wallTexture, metalTexture] = await Promise.all([
      loadStalkerHeadAtlas(loader),
      loadPixelTexture(loader, `${TEXTURES_BASE}Wall/Horror_Wall_11-128x128.png`),
      loadPixelTexture(loader, `${TEXTURES_BASE}Metal/Horror_Metal_01-128x128.png`),
    ]);

    this.buildArena(wallTexture);
    this.buildDummy(metalTexture);
    this.catchRing.scale.setScalar(this.config.enemy.catch_radius);

    this.rig = await loadStalkerRig(this.config, headAtlas);
    this.rig.mesh.visible = true;
    this.stalkerRoot.add(this.rig.root);
    this.animator = new StalkerAnimator(this.rig, this.clipSpeeds);
    this.animator.play(RUN_CLIP, 0);
    for (const name of ['footL', 'footR', 'toeL', 'toeR']) {
      const bone = this.rig.root.getObjectByName(name);
      if (bone) {
        this.feet.push(bone);
      }
    }
    this.rig.mixer.addEventListener('finished', (event) => {
      if (event.action === this.attackAction) {
        this.onAttackFinished();
      }
    });

    this.loop.start();
    this.refreshHud();
    console.info(
      '[lab] Stalker Lab listo. Rueda: zoom · arrastrar: órbita · Espacio: pausa · 1-6: clips · A: atacar · C: modo',
    );
  }

  private populateClips(): void {
    for (const { clip, label } of CLIP_OPTIONS) {
      const option = document.createElement('option');
      option.value = clip;
      option.textContent = label;
      this.ui.clipSelect.append(option);
    }
    this.ui.clipSelect.value = RUN_CLIP;
    this.ui.clipFade.value = String(this.fade);
    this.ui.clipTimescale.value = String(this.manualTimeScale);
    this.ui.clipTimescaleOut.textContent = `${this.manualTimeScale.toFixed(2)}×`;
    this.ui.clipFadeOut.textContent = `${this.fade.toFixed(2)} s`;
    this.ui.moveSpeed.value = String(this.moveSpeed);
    this.ui.moveSpeedOut.textContent = `${this.moveSpeed.toFixed(2)} m/s`;
    this.ui.attackDistance.value = String(this.attackDistance);
    this.ui.attackDistanceOut.textContent = `${this.attackDistance.toFixed(1)} m`;
    this.ui.naturalWalk.value = String(this.clipSpeeds[WALK_CLIP]);
    this.ui.naturalRun.value = String(this.clipSpeeds[RUN_CLIP]);
    this.syncTimescaleEnabled();
  }

  private buildArena(wallTexture: THREE.Texture): void {
    const checker = createCheckerTexture();
    checker.repeat.set(ARENA_SIZE, ARENA_SIZE);
    const floorMaterial = createPsxMaterial(this.config, checker);
    const floor = new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE);
    floor.rotateX(-Math.PI / 2);
    tint(floor, [0.92, 0.9, 0.86]);
    this.scene.add(new THREE.Mesh(floor, floorMaterial.material));

    const wall = createPsxMaterial(this.config, wallTexture);
    const pillar = new THREE.BoxGeometry(1, 2.8, 1);
    tint(pillar, [0.8, 0.8, 0.8]);
    const spots: Array<[number, number]> = [
      [-7, -7],
      [7, -7],
      [-7, 7],
      [7, 7],
      [-7, 0],
      [7, 0],
    ];
    for (const [x, z] of spots) {
      const mesh = new THREE.Mesh(pillar, wall.material);
      mesh.position.set(x, 1.4, z);
      this.scene.add(mesh);
    }
  }

  private buildDummy(metalTexture: THREE.Texture): void {
    const metal = createPsxMaterial(this.config, metalTexture);
    const body = new THREE.BoxGeometry(0.5, 1.1, 0.32);
    body.translate(0, 0.75, 0);
    tint(body, [1.0, 0.45, 0.4]);
    const head = new THREE.BoxGeometry(0.28, 0.28, 0.28);
    head.translate(0, 1.5, 0);
    tint(head, [1.0, 0.45, 0.4]);
    this.dummy.add(new THREE.Mesh(body, metal.material), new THREE.Mesh(head, metal.material));
    this.dummy.name = 'objetivo';
  }

  private bindControls(): void {
    this.ui.clipSelect.addEventListener('change', () => this.selectClip(this.ui.clipSelect.value));
    this.ui.clipTimescale.addEventListener('input', () => {
      this.manualTimeScale = Number(this.ui.clipTimescale.value);
      this.ui.clipTimescaleOut.textContent = `${this.manualTimeScale.toFixed(2)}×`;
      if (!this.syncSpeed) {
        this.animator?.setTimeScale(this.manualTimeScale);
      }
    });
    this.ui.clipFade.addEventListener('input', () => {
      this.fade = Number(this.ui.clipFade.value);
      this.ui.clipFadeOut.textContent = `${this.fade.toFixed(2)} s`;
    });
    this.ui.clipScrub.addEventListener('input', () => {
      const animator = this.animator;
      if (!animator) {
        return;
      }
      this.playing = false;
      this.updatePlayLabel();
      const fraction = Number(this.ui.clipScrub.value);
      const duration = animator.activeClip ? animator.clipDuration(animator.activeClip) : 0;
      const action = animator.current();
      if (action) {
        action.time = fraction * duration;
      }
      animator.update(0);
      this.ui.clipScrubOut.textContent = `${Math.round(fraction * 100)}%`;
    });
    this.ui.play.addEventListener('click', () => this.togglePlay());
    this.ui.restart.addEventListener('click', () => {
      const action = this.animator?.current();
      if (action) {
        action.time = 0;
        this.playing = true;
        this.updatePlayLabel();
      }
    });

    this.ui.moveMode.addEventListener('change', () =>
      this.setMode(this.ui.moveMode.value as MoveMode),
    );
    this.ui.moveSpeed.addEventListener('input', () => {
      this.moveSpeed = Number(this.ui.moveSpeed.value);
      this.ui.moveSpeedOut.textContent = `${this.moveSpeed.toFixed(2)} m/s`;
    });
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-speed]')) {
      button.addEventListener('click', () => {
        this.moveSpeed = Number(button.dataset.speed ?? '0');
        this.ui.moveSpeed.value = String(this.moveSpeed);
        this.ui.moveSpeedOut.textContent = `${this.moveSpeed.toFixed(2)} m/s`;
      });
    }
    this.ui.moveAuto.addEventListener('change', () => {
      this.autoClip = this.ui.moveAuto.checked;
    });
    this.ui.moveSync.addEventListener('change', () => {
      this.syncSpeed = this.ui.moveSync.checked;
      this.syncTimescaleEnabled();
    });
    this.ui.naturalWalk.addEventListener('input', () => {
      this.clipSpeeds[WALK_CLIP] = Math.max(0.05, Number(this.ui.naturalWalk.value) || 0.05);
    });
    this.ui.naturalRun.addEventListener('input', () => {
      this.clipSpeeds[RUN_CLIP] = Math.max(0.05, Number(this.ui.naturalRun.value) || 0.05);
    });
    this.ui.calibrate.addEventListener('click', () => this.measureActiveClip());

    this.ui.attack.addEventListener('click', () => this.startAttack());
    this.ui.attackDistance.addEventListener('input', () => {
      this.attackDistance = Number(this.ui.attackDistance.value);
      this.ui.attackDistanceOut.textContent = `${this.attackDistance.toFixed(1)} m`;
      if (this.mode === 'pursue') {
        this.resetPursue();
      }
    });
    this.ui.attackLoop.addEventListener('change', () => {
      this.attackLoop = this.ui.attackLoop.checked;
    });

    this.ui.camOrbit.addEventListener('change', () => {
      this.camOrbit = this.ui.camOrbit.checked;
    });
    this.ui.camFollow.addEventListener('change', () => {
      this.camFollow = this.ui.camFollow.checked;
    });
    this.ui.camReset.addEventListener('click', () => this.resetCamera());

    window.addEventListener('keydown', (event) => {
      if (event.code === 'Space') {
        this.togglePlay();
        event.preventDefault();
        return;
      }
      const index = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'].indexOf(
        event.code,
      );
      if (index >= 0) {
        const option = CLIP_OPTIONS[index];
        if (option) {
          this.selectClip(option.clip);
          event.preventDefault();
        }
        return;
      }
      if (event.code === 'KeyA') {
        this.startAttack();
      } else if (event.code === 'KeyC') {
        this.cycleMode();
      } else if (event.code === 'KeyR') {
        this.resetCamera();
      }
    });
  }

  private bindPointer(): void {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    this.canvas.addEventListener('pointerdown', (event) => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener('pointermove', (event) => {
      if (!dragging) {
        return;
      }
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      this.camYaw -= dx * 0.008;
      this.camPitch = THREE.MathUtils.clamp(this.camPitch + dy * 0.006, 0.05, 1.25);
    });
    const release = (event: PointerEvent): void => {
      dragging = false;
      if (this.canvas.hasPointerCapture(event.pointerId)) {
        this.canvas.releasePointerCapture(event.pointerId);
      }
    };
    this.canvas.addEventListener('pointerup', release);
    this.canvas.addEventListener('pointercancel', release);
    this.canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.camDist = THREE.MathUtils.clamp(this.camDist + Math.sign(event.deltaY) * 0.6, 2, 22);
      },
      { passive: false },
    );
  }

  private syncTimescaleEnabled(): void {
    this.ui.clipTimescale.disabled = this.syncSpeed;
    if (this.syncSpeed && this.animator) {
      this.animator.update(0, { groundSpeed: this.locomotionSpeed, sync: true });
    }
  }

  private updatePlayLabel(): void {
    this.ui.play.textContent = this.playing ? 'Pausar' : 'Reproducir';
  }

  private togglePlay(): void {
    this.playing = !this.playing;
    this.updatePlayLabel();
  }

  private selectClip(clip: string): void {
    if (clip === ATTACK_CLIP) {
      this.startAttack();
      return;
    }
    this.autoClip = false;
    this.ui.moveAuto.checked = false;
    this.playing = true;
    this.updatePlayLabel();
    this.animator?.play(clip, this.fade);
    this.ui.clipSelect.value = clip;
  }

  private cycleMode(): void {
    const order: MoveMode[] = ['pursue', 'line', 'circle', 'idle'];
    const next = order[(order.indexOf(this.mode) + 1) % order.length];
    if (next) {
      this.ui.moveMode.value = next;
      this.setMode(next);
    }
  }

  private setMode(mode: MoveMode): void {
    this.mode = mode;
    this.dummy.visible = mode === 'pursue';
    if (mode === 'pursue') {
      this.resetPursue();
    } else if (mode === 'line') {
      this.lineIndex = 0;
    } else if (mode === 'circle') {
      this.circleTheta = Math.atan2(this.position.z, this.position.x);
    }
    if (mode === 'idle' || mode === 'pursue') {
      this.locomotionSpeed = 0;
    }
  }

  private resetPursue(): void {
    const gap = Math.max(this.config.enemy.catch_radius + 0.5, this.attackDistance);
    this.dummy.position.set(0, 0, -gap / 2);
    this.dummy.visible = this.mode === 'pursue';
    this.position.set(0, 0, gap / 2);
    this.yaw = 0;
    this.locomotionSpeed = 0;
    this.pursuePhase = 'approach';
    this.attackAction = null;
    this.holdTimer = 0;
  }

  private startAttack(): void {
    const animator = this.animator;
    if (!animator || this.attackAction) {
      return;
    }
    this.attackAction = animator.playOnce(ATTACK_CLIP, 0.1);
    this.attackFlashed = false;
    this.playing = true;
    this.updatePlayLabel();
    if (this.mode === 'pursue') {
      this.pursuePhase = 'attack';
    }
  }

  private onAttackFinished(): void {
    this.attackAction = null;
    if (this.mode === 'pursue' && this.pursuePhase === 'attack') {
      this.pursuePhase = 'hold';
      this.holdTimer = 1.1;
      return;
    }
    this.animator?.play(IDLE_CLIP, 0.2);
    this.playing = true;
    this.updatePlayLabel();
  }

  private flashImpact(): void {
    const forwardX = -Math.sin(this.yaw);
    const forwardZ = -Math.cos(this.yaw);
    this.impactRing.position.set(
      this.position.x + forwardX * 0.9,
      0.03,
      this.position.z + forwardZ * 0.9,
    );
    this.impactRing.scale.setScalar(0.6);
    this.impactRing.visible = true;
    this.impactTimer = 0;
    this.ui.flash.classList.add('on');
    window.setTimeout(() => this.ui.flash.classList.remove('on'), 90);
    this.ui.attackStatus.textContent = 'impacto: mano y cabeza al frente (≈0.63 s del clip)';
  }

  private updateMovement(dt: number): void {
    if (!this.playing) {
      this.locomotionSpeed = 0;
      return;
    }
    switch (this.mode) {
      case 'idle':
        this.locomotionSpeed = 0;
        break;
      case 'line': {
        const target = LINE_POINTS[this.lineIndex];
        if (target && this.steerTo(target.x, target.z, dt, 0.12)) {
          this.lineIndex = (this.lineIndex + 1) % LINE_POINTS.length;
        }
        break;
      }
      case 'circle': {
        this.circleTheta += (this.moveSpeed / CIRCLE_RADIUS) * dt;
        this.steerTo(
          Math.cos(this.circleTheta) * CIRCLE_RADIUS,
          Math.sin(this.circleTheta) * CIRCLE_RADIUS,
          dt,
          0.05,
        );
        break;
      }
      case 'pursue':
        this.updatePursue(dt);
        break;
    }
  }

  private updatePursue(dt: number): void {
    switch (this.pursuePhase) {
      case 'approach': {
        if (this.attackAction) {
          break;
        }
        const reached = this.steerTo(
          this.dummy.position.x,
          this.dummy.position.z,
          dt,
          this.config.enemy.catch_radius + 0.1,
        );
        if (reached) {
          this.startAttack();
        }
        break;
      }
      case 'attack':
        this.locomotionSpeed = 0;
        break;
      case 'hold':
        this.locomotionSpeed = 0;
        this.holdTimer -= dt;
        if (this.holdTimer <= 0) {
          if (this.attackLoop) {
            this.resetPursue();
          } else {
            this.pursuePhase = 'done';
          }
        }
        break;
      case 'done':
        this.locomotionSpeed = 0;
        break;
    }
  }

  private steerTo(x: number, z: number, dt: number, arrival: number): boolean {
    const dx = x - this.position.x;
    const dz = z - this.position.z;
    if (Math.hypot(dx, dz) <= arrival) {
      this.locomotionSpeed = 0;
      return true;
    }
    const angle = Math.atan2(-dx, -dz);
    const maxTurn = ((this.config.enemy.turn_speed * Math.PI) / 180) * dt;
    this.yaw += THREE.MathUtils.clamp(angleDelta(this.yaw, angle), -maxTurn, maxTurn);
    if (Math.abs(angleDelta(angle, this.yaw)) > Math.PI / 2) {
      this.locomotionSpeed = 0;
      return false;
    }
    const step = this.moveSpeed * dt;
    this.position.x += -Math.sin(this.yaw) * step;
    this.position.z += -Math.cos(this.yaw) * step;
    this.locomotionSpeed = this.moveSpeed;
    return false;
  }

  private updateAttack(dt: number): void {
    const action = this.attackAction;
    if (action && !this.attackFlashed && action.time >= ATTACK_IMPACT_T) {
      this.attackFlashed = true;
      this.flashImpact();
    }
    if (this.impactTimer >= 0) {
      this.impactTimer += dt;
      const progress = this.impactTimer / 0.45;
      if (progress >= 1) {
        this.impactTimer = -1;
        this.impactRing.visible = false;
      } else {
        this.impactRing.scale.setScalar(0.6 + progress * 2.2);
        (this.impactRing.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - progress);
      }
    }
  }

  private updateAnimation(dt: number): void {
    const animator = this.animator;
    if (!animator || !this.playing) {
      return;
    }
    const attacking = this.attackAction !== null;
    if (!attacking) {
      if (this.autoClip) {
        const walk = this.clipSpeeds[WALK_CLIP] ?? DEFAULT_CLIP_SPEEDS[WALK_CLIP];
        const run = this.clipSpeeds[RUN_CLIP] ?? DEFAULT_CLIP_SPEEDS[RUN_CLIP];
        const clip =
          this.locomotionSpeed <= 0.01
            ? IDLE_CLIP
            : this.locomotionSpeed <= (walk + run) / 2
              ? WALK_CLIP
              : RUN_CLIP;
        animator.play(clip, this.fade);
      }
      if (!this.syncSpeed) {
        animator.setTimeScale(this.manualTimeScale);
      }
    }
    animator.update(dt, {
      groundSpeed: this.locomotionSpeed,
      sync: this.syncSpeed && !attacking,
    });
  }

  /**
   * Mide la velocidad "natural" del clip activo: reproduce un ciclo completo a
   * timeScale 1 a 120 Hz y busca las fases de apoyo (el pie plantado retrocede
   * respecto al cuerpo). La mediana de esas fases es la velocidad a la que hay
   * que ir para que el pie no patine.
   */
  private measureActiveClip(): void {
    const animator = this.animator;
    const rig = this.rig;
    const clip = animator?.activeClip ?? null;
    const action = clip ? animator?.action(clip) ?? null : null;
    if (!animator || !rig || !clip || !action || this.feet.length === 0) {
      this.ui.moveStatus.textContent = 'No hay clip activo que medir.';
      return;
    }
    rig.mixer.stopAllAction();
    action.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
    const hz = 120;
    const dt = 1 / hz;
    const steps = Math.ceil(animator.clipDuration(clip) * hz);
    const position = new THREE.Vector3();
    const runs: number[] = [];
    for (const foot of this.feet) {
      let previous: { y: number; z: number } | null = null;
      let runDistance = 0;
      let runTime = 0;
      const closeRun = (): void => {
        if (runTime >= 0.12 && runDistance > 0) {
          runs.push(runDistance / runTime);
        }
        runDistance = 0;
        runTime = 0;
      };
      for (let step = 0; step <= steps; step += 1) {
        this.stalkerRoot.updateMatrixWorld(true);
        foot.getWorldPosition(position);
        this.stalkerRoot.worldToLocal(position);
        const current = { y: position.y, z: position.z };
        if (previous) {
          const dz = current.z - previous.z;
          const dy = Math.abs(current.y - previous.y);
          if (dz > 0 && dy < 0.08) {
            runDistance += dz;
            runTime += dt;
          } else {
            closeRun();
          }
        }
        previous = current;
        if (step < steps) {
          rig.mixer.update(dt);
        }
      }
      closeRun();
    }
    runs.sort((a, b) => a - b);
    animator.restart(clip, 0);
    this.playing = true;
    this.updatePlayLabel();

    const middle = runs.length > 0 ? runs[Math.floor(runs.length / 2)] : undefined;
    if (middle === undefined) {
      this.measuredNatural = null;
      this.ui.moveStatus.textContent = `No se pudo medir ${clip}: apenas hay apoyos.`;
      return;
    }
    this.measuredNatural = middle;
    if (clip in this.clipSpeeds) {
      this.clipSpeeds[clip] = middle;
      if (clip === WALK_CLIP) {
        this.ui.naturalWalk.value = middle.toFixed(2);
      } else {
        this.ui.naturalRun.value = middle.toFixed(2);
      }
      this.ui.moveStatus.textContent = `${clip}: pie a ${middle.toFixed(2)} m/s · natural ajustado (${runs.length} apoyos medidos)`;
    } else {
      this.ui.moveStatus.textContent = `${clip}: pie a ${middle.toFixed(2)} m/s (clip sin sincronización de velocidad)`;
    }
  }

  private updateCamera(dt: number): void {
    if (this.camOrbit) {
      this.camYaw += dt * 0.25;
    }
    if (this.camFollow) {
      this.camTarget.set(this.position.x, 1.05, this.position.z);
    } else {
      this.camTarget.set(0, 1.05, 0);
    }
    const cos = Math.cos(this.camPitch);
    this.camera.position.set(
      this.camTarget.x + this.camDist * cos * Math.sin(this.camYaw),
      Math.max(0.2, this.camTarget.y + this.camDist * Math.sin(this.camPitch)),
      this.camTarget.z + this.camDist * cos * Math.cos(this.camYaw),
    );
    this.camera.lookAt(this.camTarget);
  }

  private resetCamera(): void {
    this.camYaw = 0.85;
    this.camPitch = 0.3;
    this.camDist = 6.5;
  }

  private update(dt: number): void {
    this.updateMovement(dt);
    this.updateAttack(dt);
    this.updateAnimation(dt);
    this.stalkerRoot.position.set(this.position.x, 0, this.position.z);
    this.stalkerRoot.rotation.y = this.yaw;
    this.catchRing.position.set(this.position.x, 0.02, this.position.z);
    this.updateCamera(dt);
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      this.refreshHud();
    }
  }

  private refreshHud(): void {
    const animator = this.animator;
    const clip = animator?.activeClip ?? '—';
    const duration = clip !== '—' ? (animator?.clipDuration(clip) ?? 0) : 0;
    const action = animator?.current() ?? null;
    const time = action?.time ?? 0;
    const timeScale = animator?.timeScale() ?? 1;

    this.ui.mode.textContent = MODE_LABELS[this.mode];
    this.ui.clip.textContent = clip;
    this.ui.time.textContent = `${time.toFixed(2)} / ${duration.toFixed(2)} s`;
    this.ui.timescale.textContent = `${timeScale.toFixed(2)}×`;
    this.ui.speed.textContent = `${this.locomotionSpeed.toFixed(2)} m/s`;
    this.ui.pos.textContent = `${this.position.x.toFixed(1)}, ${this.position.z.toFixed(1)}`;

    const natural = animator?.naturalSpeed(clip) ?? null;
    this.ui.natural.textContent = natural ? `${natural.toFixed(2)} m/s` : '—';
    this.ui.foot.textContent =
      this.measuredNatural !== null ? `${this.measuredNatural.toFixed(2)} m/s` : 'sin medir';

    const slipReference = this.measuredNatural ?? natural;
    const moving = this.locomotionSpeed > 0.05 && !this.attackAction;
    if (moving && slipReference) {
      const slip = 1 - (timeScale * slipReference) / this.locomotionSpeed;
      this.ui.slip.textContent = `${slip >= 0 ? '+' : ''}${Math.round(slip * 100)} % ${
        Math.abs(slip) < 0.08 ? 'ok' : slip > 0 ? '(pie atrasado)' : '(pie adelantado)'
      }`;
      this.ui.slip.classList.toggle('ok', Math.abs(slip) < 0.08);
      this.ui.slip.classList.toggle('bad', Math.abs(slip) >= 0.08);
    } else {
      this.ui.slip.textContent = '—';
      this.ui.slip.classList.remove('ok', 'bad');
    }

    this.ui.clipScrub.value = String(duration > 0 ? time / duration : 0);
    this.ui.clipScrubOut.textContent = `${Math.round(duration > 0 ? (time / duration) * 100 : 0)}%`;
  }

  private render(): void {
    this.psx.render(this.scene, this.camera);
  }
}

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game');
  if (!canvas) {
    throw new Error('No se encontró el canvas #game');
  }
  const config = await loadConfig();
  const lab = new StalkerLab(config, canvas);
  await lab.start();
  if (import.meta.env.DEV) {
    (window as unknown as { __stalkerLab?: StalkerLab }).__stalkerLab = lab;
  }
}

boot().catch((error) => {
  console.error(error);
});
