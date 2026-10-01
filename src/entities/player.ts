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

export class Player {
  readonly camera: THREE.PerspectiveCamera;
  readonly position = new THREE.Vector3();
  onFootstep: ((running: boolean) => void) | null = null;

  private yaw: number;
  private pitch = 0;
  private bobPhase = 0;
  private moveBlend = 0;
  private wakeAmount = 0;

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
    const mouse = input.consumeMouseDelta();
    const look = input.padLookAxis();
    const sensitivity = config.player.look_sensitivity;
    const lookX = mouse.dx + look.x * LOOK_STICK_SPEED * dt;
    const lookY = mouse.dy + look.y * LOOK_STICK_SPEED * dt;
    this.yaw -= lookX * sensitivity;
    const pitchSign = config.player.invert_look ? 1 : -1;
    this.pitch = THREE.MathUtils.clamp(this.pitch + pitchSign * lookY * sensitivity, -1.5, 1.5);

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

    const running = input.isDown('ShiftLeft') || input.isDown('ShiftRight') || input.padDown('run');
    const speed = running ? config.player.run : config.player.walk;

    const sinYaw = Math.sin(this.yaw);
    const cosYaw = Math.cos(this.yaw);
    let moveX = -sinYaw * forward + cosYaw * strafe;
    let moveZ = -cosYaw * forward - sinYaw * strafe;

    const moveLength = Math.hypot(moveX, moveZ);
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

    const targetBlend = moveLength > 0 ? 1 : 0;
    this.moveBlend += (targetBlend - this.moveBlend) * Math.min(1, dt * 10);

    const bobAmplitude =
      config.player.head_bob * Math.min(speed / config.player.run, 1) * this.moveBlend;
    const bobY = Math.sin(this.bobPhase) * bobAmplitude;

    this.placeCamera(config, bobY);
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
