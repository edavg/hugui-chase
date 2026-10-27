import * as THREE from 'three';
import type { PsxConfig } from '../systems/config';
import type { Collider } from '../systems/roomBuilder';
import type { Input } from '../systems/input';

export interface SpawnPoint {
  x: number;
  z: number;
  yaw: number;
}

const LOOK_STICK_SPEED = 320;

// Máximo avance por subpaso al empujar: menor que el grosor de muros (0.15) y
// puertas (0.07) para que la colisión no se pueda atravesar de un salto.
const KNOCKBACK_STEP = 0.05;

// Pose de despertar: 1 = tumbado en el suelo mirando al techo con una leve
// inclinación de cabeza; 0 = de pie con la vista al frente.
const WAKE_FLOOR_HEIGHT = 0.18;
const WAKE_PITCH = 0.4;
const WAKE_ROLL = 0.12;

// Aguante (valores por defecto si el config no los trae).
const DEFAULT_STAMINA_SECONDS = 6;
const DEFAULT_STAMINA_RECOVER = 8;
const DEFAULT_STAMINA_RESUME = 0.4;
const DEFAULT_EXHAUSTED_SPEED = 0.85;
// Recuperar caminando cuesta más que quieto.
const WALK_RECOVER_FACTOR = 0.6;

// Escondido: la mirada queda limitada a lo que deja ver la rejilla.
const HIDE_YAW_LIMIT = 0.55;
const HIDE_PITCH_LIMIT = 0.3;

export class Player {
  readonly camera: THREE.PerspectiveCamera;
  readonly position = new THREE.Vector3();
  // Desplazamiento real en X/Z, después de resolver las colisiones.
  readonly movement = new THREE.Vector2();
  onFootstep: ((running: boolean) => void) | null = null;

  private yaw: number;
  private pitch = 0;
  private bobPhase = 0;
  private locomotionBlend = 0;
  private running = false;
  private wakeAmount = 0;
  private stamina = 1;
  private exhausted = false;
  private hideYaw: number | null = null;

  constructor(
    private readonly config: PsxConfig,
    private readonly colliders: Collider[],
    spawn: SpawnPoint,
    aspect: number,
  ) {
    this.camera = new THREE.PerspectiveCamera(config.fov, aspect, config.near, config.far);
    this.camera.rotation.order = 'YXZ';
    this.position.set(spawn.x, 0, spawn.z);
    this.yaw = THREE.MathUtils.degToRad(spawn.yaw);
    this.placeCamera(config, 0);
  }

  lookAt(yawDegrees: number, pitchDegrees: number): void {
    this.yaw = THREE.MathUtils.degToRad(yawDegrees);
    this.pitch = THREE.MathUtils.clamp(THREE.MathUtils.degToRad(pitchDegrees), -1.5, 1.5);
    this.placeCamera(this.config, 0);
  }

  // Progreso de la secuencia de despertar: 0 despierto, 1 tumbado en el suelo.
  // Game la anima al arrancar (y al reiniciar) la partida.
  setWakeAmount(value: number): void {
    this.wakeAmount = THREE.MathUtils.clamp(value, 0, 1);
    this.placeCamera(this.config, 0);
  }

  // Estado de locomoción para el viewmodel (manos en primera persona).
  get moveBlend(): number {
    return this.locomotionBlend;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get waking(): boolean {
    return this.wakeAmount > 0.001;
  }

  get staminaLevel(): number {
    return this.stamina;
  }

  // Agotado: no puede correr hasta recuperar stamina_resume y jadea (se oye).
  get isExhausted(): boolean {
    return this.exhausted;
  }

  // El jugador se recrea al cambiar de sala: cruzar una puerta no recupera aliento.
  inheritStamina(previous: Player): void {
    this.stamina = previous.stamina;
    this.exhausted = previous.exhausted;
  }

  get hidden(): boolean {
    return this.hideYaw !== null;
  }

  // Dentro de un escondite: ojo en la rejilla, mirando hacia fuera.
  enterHide(eyeX: number, eyeZ: number, yaw: number): void {
    this.hideYaw = yaw;
    this.yaw = yaw;
    this.pitch = 0;
    this.running = false;
    this.locomotionBlend = 0;
    this.movement.set(0, 0);
    this.position.set(eyeX, 0, eyeZ);
    this.placeCamera(this.config, 0);
  }

  exitHide(x: number, z: number): void {
    this.hideYaw = null;
    this.position.set(x, 0, z);
    this.placeCamera(this.config, 0);
  }

  knockback(fromX: number, fromZ: number, distance: number): void {
    const dx = this.position.x - fromX;
    const dz = this.position.z - fromZ;
    const length = Math.hypot(dx, dz);
    if (length < 1e-4) {
      return;
    }
    const dirX = dx / length;
    const dirZ = dz / length;
    const steps = Math.max(1, Math.ceil(distance / KNOCKBACK_STEP));
    const step = distance / steps;
    for (let index = 0; index < steps; index += 1) {
      this.moveWithCollisions(dirX * step, dirZ * step, this.config.player.radius);
    }
    this.placeCamera(this.config, 0);
  }

  clampInside(halfWidth: number, halfDepth: number, margin: number): void {
    const limitX = Math.max(0, halfWidth - margin);
    const limitZ = Math.max(0, halfDepth - margin);
    const x = THREE.MathUtils.clamp(this.position.x, -limitX, limitX);
    const z = THREE.MathUtils.clamp(this.position.z, -limitZ, limitZ);
    if (x !== this.position.x || z !== this.position.z) {
      this.position.set(x, 0, z);
      this.placeCamera(this.config, 0);
    }
  }

  update(dt: number, config: PsxConfig, input: Input): void {
    const previousX = this.position.x;
    const previousZ = this.position.z;
    const mouse = input.consumeMouseDelta();
    const look = input.padLookAxis();
    const sensitivity = config.player.look_sensitivity;
    const lookX = mouse.dx + look.x * LOOK_STICK_SPEED * dt;
    const lookY = mouse.dy + look.y * LOOK_STICK_SPEED * dt;
    this.yaw -= lookX * sensitivity;
    const pitchSign = config.player.invert_look ? 1 : -1;
    this.pitch = THREE.MathUtils.clamp(this.pitch + pitchSign * lookY * sensitivity, -1.5, 1.5);

    if (this.hideYaw !== null) {
      this.yaw = this.hideYaw + THREE.MathUtils.clamp(this.yaw - this.hideYaw, -HIDE_YAW_LIMIT, HIDE_YAW_LIMIT);
      this.pitch = THREE.MathUtils.clamp(this.pitch, -HIDE_PITCH_LIMIT, HIDE_PITCH_LIMIT);
      this.updateStamina(dt, config, false, false);
      this.movement.set(0, 0);
      this.locomotionBlend = 0;
      this.placeCamera(config, 0);
      return;
    }

    const stick = input.moveAxis();
    let forward = stick.y;
    let strafe = stick.x;
    if (input.isDown('KeyW') || input.isDown('ArrowUp')) forward += 1;
    if (input.isDown('KeyS') || input.isDown('ArrowDown')) forward -= 1;

    if (config.player.control_scheme === 'tank') {
      const turn = THREE.MathUtils.degToRad(config.player.turn_deg_s) * dt;
      if (input.isDown('KeyA') || input.isDown('ArrowLeft')) this.yaw += turn;
      if (input.isDown('KeyD') || input.isDown('ArrowRight')) this.yaw -= turn;
    } else {
      if (input.isDown('KeyA') || input.isDown('ArrowLeft')) strafe -= 1;
      if (input.isDown('KeyD') || input.isDown('ArrowRight')) strafe += 1;
    }

    const sinYaw = Math.sin(this.yaw);
    const cosYaw = Math.cos(this.yaw);
    let moveX = -sinYaw * forward + cosYaw * strafe;
    let moveZ = -cosYaw * forward - sinYaw * strafe;

    const moveLength = Math.hypot(moveX, moveZ);
    const wantsRun = input.isDown('ShiftLeft') || input.isDown('ShiftRight') || input.padDown('run');
    const running = wantsRun && moveLength > 0 && !this.exhausted;
    this.running = running;
    this.updateStamina(dt, config, running, moveLength > 0);
    const speed = running
      ? config.player.run
      : config.player.walk * (this.exhausted ? config.player.exhausted_speed ?? DEFAULT_EXHAUSTED_SPEED : 1);
    let distance = 0;
    if (moveLength > 0) {
      moveX /= moveLength;
      moveZ /= moveLength;
      distance = speed * dt;
      this.moveWithCollisions(moveX * distance, moveZ * distance, config.player.radius);
      const previousPhase = this.bobPhase;
      this.bobPhase += Math.min(distance, 0.12) * Math.PI * 2;
      if (
        Math.floor(this.bobPhase / (Math.PI * 2)) !==
        Math.floor(previousPhase / (Math.PI * 2))
      ) {
        this.onFootstep?.(running);
      }
    }

    this.movement.set(this.position.x - previousX, this.position.z - previousZ);
    const targetBlend = moveLength > 0 ? 1 : 0;
    this.locomotionBlend += (targetBlend - this.locomotionBlend) * Math.min(1, dt * 10);

    const bobAmplitude =
      config.player.head_bob * Math.min(speed / config.player.run, 1) * this.locomotionBlend;
    const bobY = Math.sin(this.bobPhase) * bobAmplitude;

    this.placeCamera(config, bobY);
  }

  private updateStamina(dt: number, config: PsxConfig, running: boolean, moving: boolean): void {
    if (running) {
      this.stamina -= dt / (config.player.stamina_seconds ?? DEFAULT_STAMINA_SECONDS);
    } else {
      const recover = dt / (config.player.stamina_recover_seconds ?? DEFAULT_STAMINA_RECOVER);
      this.stamina += moving ? recover * WALK_RECOVER_FACTOR : recover;
    }
    this.stamina = THREE.MathUtils.clamp(this.stamina, 0, 1);
    if (this.stamina <= 0) {
      this.exhausted = true;
    } else if (this.exhausted && this.stamina >= (config.player.stamina_resume ?? DEFAULT_STAMINA_RESUME)) {
      this.exhausted = false;
    }
  }

  private moveWithCollisions(dx: number, dz: number, radius: number): void {
    if (!this.collidesAt(this.position.x + dx, this.position.z, radius)) {
      this.position.x += dx;
    }
    if (!this.collidesAt(this.position.x, this.position.z + dz, radius)) {
      this.position.z += dz;
    }
  }

  private collidesAt(x: number, z: number, radius: number): boolean {
    return this.colliders.some(
      (collider) =>
        x > collider.minX - radius &&
        x < collider.maxX + radius &&
        z > collider.minZ - radius &&
        z < collider.maxZ + radius,
    );
  }

  private placeCamera(config: PsxConfig, bobY: number): void {
    const wake = this.wakeAmount;
    const eyeHeight = config.player.eye_height;
    const height = eyeHeight - (eyeHeight - WAKE_FLOOR_HEIGHT) * wake;
    this.camera.position.set(this.position.x, height + bobY, this.position.z);
    this.camera.rotation.set(
      this.pitch + WAKE_PITCH * wake,
      this.yaw,
      WAKE_ROLL * Math.sin(wake * Math.PI),
    );
  }
}
