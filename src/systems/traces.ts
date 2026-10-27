import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PsxConfig } from './config';
import { createFootprintTexture } from './proceduralTextures';
import { createPsxMaterial, type PsxMaterialHandle } from './psxMaterial';
import type { BuiltRoom } from './roomBuilder';

// Rastros del stalker (M13): huellas de barro por donde camina y puertas que
// deja entornadas al cruzarlas. Se registran aunque el jugador esté en otra
// sala y caducan tras `trace_seconds`.

const DEFAULT_TRACE_SECONDS = 150;
const MAX_PRINTS_PER_ROOM = 36;
const PRINT_WIDTH = 0.13;
const PRINT_LENGTH = 0.3;
const PRINT_SPREAD = 0.11;
const PRINT_LIFT = 0.006;

interface Footprint {
  x: number;
  z: number;
  yaw: number;
  at: number;
}

export class Traces {
  private readonly prints = new Map<string, Footprint[]>();
  private readonly doors = new Map<string, number>();
  private readonly material: PsxMaterialHandle;
  private mesh: THREE.Mesh | null = null;
  private room: BuiltRoom | null = null;
  private dirty = false;
  private stride = 0;

  constructor(private readonly config: PsxConfig) {
    this.material = createPsxMaterial(config, createFootprintTexture(), null, { blend: true, spec: 0.05 });
    const material = this.material.material;
    material.side = THREE.FrontSide;
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = -1;
  }

  private get lifetime(): number {
    return this.config.enemy.trace_seconds ?? DEFAULT_TRACE_SECONDS;
  }

  // Una zancada del stalker: pie izquierdo/derecho alternos a cada lado del rumbo.
  addPrint(room: string, x: number, z: number, yaw: number, now: number): void {
    this.stride += 1;
    const side = this.stride % 2 === 0 ? 1 : -1;
    const list = this.prints.get(room) ?? [];
    list.push({
      x: x + Math.cos(yaw) * PRINT_SPREAD * side,
      z: z - Math.sin(yaw) * PRINT_SPREAD * side,
      yaw,
      at: now,
    });
    if (list.length > MAX_PRINTS_PER_ROOM) {
      list.splice(0, list.length - MAX_PRINTS_PER_ROOM);
    }
    this.prints.set(room, list);
    if (room === this.room?.id) {
      this.dirty = true;
    }
  }

  markDoor(from: string, to: string, now: number): void {
    this.doors.set(doorKey(from, to), now);
  }

  clearDoor(a: string, b: string): void {
    this.doors.delete(doorKey(a, b));
  }

  doorAjar(a: string, b: string, now: number): boolean {
    const at = this.doors.get(doorKey(a, b));
    return at !== undefined && now - at < this.lifetime;
  }

  // Al entrar en una sala: las huellas pasan a su escena con su atmósfera.
  attach(room: BuiltRoom): void {
    this.detach();
    this.room = room;
    this.material.sync(this.config, room.atmosphere);
    this.dirty = true;
  }

  update(now: number): void {
    const room = this.room;
    if (!room) {
      return;
    }
    const list = this.prints.get(room.id);
    if (list && list.length > 0 && now - list[0].at > this.lifetime) {
      this.prints.set(room.id, list.filter((print) => now - print.at < this.lifetime));
      this.dirty = true;
    }
    if (this.dirty) {
      this.dirty = false;
      this.rebuild(room);
    }
  }

  sync(): void {
    this.material.sync(this.config, this.room?.atmosphere ?? null);
  }

  reset(): void {
    this.detach();
    this.prints.clear();
    this.doors.clear();
  }

  printCount(room: string): number {
    return this.prints.get(room)?.length ?? 0;
  }

  private detach(): void {
    if (this.mesh) {
      this.mesh.removeFromParent();
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    this.room = null;
  }

  private rebuild(room: BuiltRoom): void {
    if (this.mesh) {
      this.mesh.removeFromParent();
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    const list = this.prints.get(room.id) ?? [];
    if (list.length === 0) {
      return;
    }
    const parts = list.map((print, index) => {
      const geometry = new THREE.PlaneGeometry(PRINT_WIDTH, PRINT_LENGTH);
      geometry.rotateX(-Math.PI / 2);
      geometry.rotateY(print.yaw);
      geometry.translate(print.x, PRINT_LIFT + index * 0.00005, print.z);
      return geometry;
    });
    const geometry = mergeGeometries(parts, false);
    if (!geometry) {
      return;
    }
    geometry.setAttribute(
      'a_color',
      new THREE.BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 3).fill(1), 3),
    );
    this.mesh = new THREE.Mesh(geometry, this.material.material);
    this.mesh.name = 'stalker_footprints';
    room.scene.add(this.mesh);
  }
}

function doorKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
