import * as THREE from 'three';
import type { PsxConfig } from '../systems/config';
import { colliderForBox, type Collider, type RoomDoorway } from '../systems/roomBuilder';
import type { HideSpot } from '../systems/hides';
import type { RoomGraph } from '../systems/roomGraph';
import { NavGrid, type NavPoint } from '../systems/navGrid';
import { createPsxMaterial, type Atmosphere, type PsxMaterialHandle } from '../systems/psxMaterial';
import { loadStalkerHeadAtlas, type HeadAtlas } from '../systems/stalkerFace';
import { loadStalkerRig, type StalkerRig } from '../systems/stalkerModel';
import {
  ATTACK_CLIP,
  DEFAULT_CLIP_SPEEDS,
  IDLE_CLIP,
  RUN_CLIP,
  StalkerAnimator,
  WALK_CLIP,
} from '../systems/stalkerAnimator';
import { loadPixelTexture } from '../systems/textures';

type EnemyConfig = PsxConfig['enemy'];

export type StalkerState =
  | 'dormant'
  | 'patrol'
  | 'suspect'
  | 'chase'
  | 'attack'
  | 'search'
  | 'inspect'
  | 'return';

export interface StalkerSense {
  playerRoom: string;
  playerX: number;
  playerZ: number;
  playerMoving: boolean;
  playerRunning: boolean;
  playerInvulnerable: boolean;
  // Yaw de cámara del jugador (radianes) para saber hacia dónde apunta el haz.
  playerYaw: number;
  flashlightOn: boolean;
  // Agotado: jadea y se le oye aunque esté quieto.
  playerPanting: boolean;
  // Sala a oscuras (sin linterna se le ve peor).
  roomDark: boolean;
  // Id del escondite donde está metido, o null.
  hiddenIn: string | null;
}

export interface StalkerHooks {
  onHit: (x: number, z: number) => void;
  onAttackStart: (x: number, z: number) => void;
  onDetect: () => void;
  onRoomChange: (from: string, to: string) => void;
  // Cada zancada, esté o no el jugador en la sala (huellas).
  onStride: (room: string, x: number, z: number, yaw: number) => void;
  // Señuelo: hace ruido lejos de `approachRoom`, la sala por la que llegará.
  onLure: (approachRoom: string | null) => void;
  // Abre el escondite; true si el jugador estaba dentro.
  onInspect: (hideId: string) => boolean;
  onFootstep: (x: number, z: number, running: boolean) => void;
  onBreath: (x: number, z: number) => void;
  onHeartbeat: (x: number, z: number) => void;
}

interface LocalGoal {
  x: number;
  z: number;
}

const MODEL_HEIGHT = 2.05;
const SKIN_TEXTURE = 'Wall/Horror_Wall_11-128x128.png';
const TEXTURES_BASE = `${import.meta.env.BASE_URL}assets/textures/horror_pack/`;
const DOOR_THICKNESS = 0.07;
const GOAL_RADIUS = 0.3;
const CHASE_GOAL_RADIUS = 0.12;
const DETOUR_ANGLE = 1.05;
const STUCK_SECONDS = 0.4;
const WAYPOINT_RADIUS = 0.26;
const REPATH_MIN_INTERVAL = 0.35;
const PATH_GOAL_TOLERANCE = 0.4;

// Valores de reserva por si el config no trae los campos de ataque.
const DEFAULT_ATTACK_RANGE = 1.35;
const DEFAULT_ATTACK_WINDUP = 1.2;
const DEFAULT_ATTACK_RECOVER = 1.6;
const DEFAULT_ATTACK_COOLDOWN = 4.0;
const DEFAULT_POSTER_SPEED_STEP = 0.05;
const DEFAULT_POSTER_SPEED_MAX = 1.35;
const DEFAULT_FLASHLIGHT_SIGHT_SCALE = 1.4;
const DEFAULT_DARK_SIGHT_SCALE = 0.65;
const DEFAULT_BEAM_NOTICE_RANGE = 10;
const DEFAULT_BEAM_NOTICE_DEG = 14;
const DEFAULT_PANT_HEARING = 6;
const DEFAULT_HIDE_CHECK_USES = 3;
const DEFAULT_INSPECT_SECONDS = 1.6;
const DEFAULT_HIDE_LIGHT_RADIUS = 4;
const DEFAULT_MEMORY_SECONDS = 240;
const DEFAULT_MEMORY_CHANCE = 0.5;
const DEFAULT_LURE_MIN = 75;
const DEFAULT_LURE_MAX = 140;
// Ver entrar al jugador en un escondite: si lo perseguía y lo vio hace menos de esto.
const WITNESS_SECONDS = 1.5;
// Tiempo mínimo entre dos revisiones del mismo escondite por sospecha.
const RECHECK_SECONDS = 45;
const ADAPTIVE_CHECK_CHANCE = 0.6;
// Si no logra plantarse delante del escondite, abandona.
const INSPECT_TIMEOUT = 12;
// Señuelos: sólo si el jugador está a 1–3 salas y no lo ha visto en un rato.
const LURE_MAX_HOPS = 3;
const LURE_QUIET_SECONDS = 30;
const LURE_FIRST_DELAY = 60;

interface Inspection {
  spot: HideSpot;
  rush: boolean;
  arrived: boolean;
  timer: number;
}

export class Stalker {
  readonly object = new THREE.Group();
  state: StalkerState = 'dormant';
  roomId: string;
  readonly position = new THREE.Vector3();
  yaw = 0;

  private readonly config: EnemyConfig;
  private readonly graph: RoomGraph;
  private readonly random: () => number;
  private readonly body: PsxMaterialHandle;
  private readonly head: PsxMaterialHandle;
  private atmosphere: Atmosphere | null = null;
  private rig: StalkerRig | null = null;
  private animator: StalkerAnimator | null = null;
  private readonly hips = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly headGroup = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();

  private time = 0;
  private stateTime = 0;
  private activeAt = 0;
  private aiTimer = 0;
  private route: string[] = [];
  private transitDoorway: RoomDoorway | null = null;
  private goal: LocalGoal | null = null;
  private lastKnown: LocalGoal & { room: string } | null = null;
  // La búsqueda pasa primero por el último punto conocido (aunque esté en otra sala).
  private lastKnownReached = true;
  private lastSeenAt = -999;
  // Salas donde vio u oyó al jugador y cuándo: sesgan la patrulla.
  private readonly memory = new Map<string, number>();
  private readonly hideUses = new Map<string, number>();
  private readonly hideCheckedAt = new Map<string, number>();
  private inspection: Inspection | null = null;
  private nextLureAt = LURE_FIRST_DELAY;
  private patrolTarget: string | null = null;
  private searchDuration = 11;
  private walkPhase = 0;
  private moveBlend = 0;
  private locomotionSpeed = 0;
  private stepLatch = 0;
  private breathTimer = 2.5;
  private heartbeatTimer = 0;
  private stuckTimer = 0;
  private detourUntil = -1;
  private detourSign = 1;
  private readonly navGrids = new Map<string, NavGrid>();
  private path: NavPoint[] = [];
  private pathIndex = 0;
  private pathGoal: LocalGoal | null = null;
  private pathRoom: string | null = null;
  private repathTimer = 0;
  private attackPhase: 'windup' | 'recover' = 'windup';
  private attackTimer = 0;
  private attackReadyAt = 0;
  private speedScale = 1;
  // Sala que este stalker debe vigilar (2º stalker del final): mientras
  // patrulla o vuelve, se queda dentro en vez de vagar por patrol_rooms.
  // En persecución/búsqueda sospecha sí puede salir a por el jugador, y al
  // volver regresa a la sala vigilada.
  private guardRoom: string | null = null;

  private constructor(
    config: PsxConfig,
    graph: RoomGraph,
    bodyTexture: THREE.Texture,
    headAtlas: HeadAtlas,
  ) {
    this.config = config.enemy;
    this.graph = graph;
    this.body = createPsxMaterial(config, bodyTexture);
    this.head = createPsxMaterial(config, headAtlas.texture);
    let seed = 0x9e3779b9;
    this.random = (): number => {
      seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0;
      return seed / 4294967296;
    };
    this.roomId = this.config.spawn_room;
    this.buildModel(config, headAtlas);
    this.animate(0);
  }

  static async create(config: PsxConfig, graph: RoomGraph): Promise<Stalker> {
    const loader = new THREE.TextureLoader();
    const [headAtlas, bodyTexture] = await Promise.all([
      loadStalkerHeadAtlas(loader),
      loadPixelTexture(loader, TEXTURES_BASE + SKIN_TEXTURE),
    ]);
    const stalker = new Stalker(config, graph, bodyTexture, headAtlas);
    try {
      stalker.rig = await loadStalkerRig(config, headAtlas);
      stalker.object.add(stalker.rig.root);
      stalker.rig.mesh.visible = true;
      stalker.setBodyVisible(false);
      stalker.animator = new StalkerAnimator(stalker.rig, {
        [WALK_CLIP]: config.enemy.walk_clip_speed ?? DEFAULT_CLIP_SPEEDS[WALK_CLIP],
        [RUN_CLIP]: config.enemy.run_clip_speed ?? DEFAULT_CLIP_SPEEDS[RUN_CLIP],
      });
      stalker.animator.play(IDLE_CLIP, 0.2);
    } catch (error) {
      console.error('[M5] No se pudo cargar el modelo del stalker, se usan primitivas', error);
    }
    return stalker;
  }

  private setBodyVisible(visible: boolean): void {
    this.hips.visible = visible;
  }

  syncConfig(config: PsxConfig): void {
    this.body.sync(config, this.atmosphere);
    this.head.sync(config, this.atmosphere);
    this.rig?.material.sync(config, this.atmosphere);
    this.rig?.headMaterial.sync(config, this.atmosphere);
  }

  // La atmósfera de la sala donde se dibuja el stalker también lo oscurece: en
  // el sótano sin linterna deja de "brillar" y sólo lo revela el haz.
  syncAtmosphere(config: PsxConfig, atmosphere: Atmosphere | null): void {
    this.atmosphere = atmosphere;
    this.body.sync(config, atmosphere);
    this.head.sync(config, atmosphere);
    this.rig?.material.sync(config, atmosphere);
    this.rig?.headMaterial.sync(config, atmosphere);
  }

  get active(): boolean {
    return this.state !== 'dormant';
  }

  get faceMaterial(): THREE.Material {
    return this.head.material;
  }

  setYaw(yaw: number): void {
    this.yaw = yaw;
  }

  forceState(state: 'patrol' | 'chase' | 'search'): void {
    this.setState(state);
    this.inspection = null;
    this.route = [];
    this.transitDoorway = null;
    this.goal = null;
    this.clearPath();
  }

  rigInfo(): Record<string, unknown> | null {
    const rig = this.rig;
    if (!rig) {
      return null;
    }
    const world = new THREE.Vector3();
    const scale = new THREE.Vector3();
    rig.root.updateMatrixWorld(true);
    rig.root.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
    const box = new THREE.Box3().setFromObject(rig.mesh);
    const headBox = new THREE.Box3().setFromObject(rig.headCube);
    rig.headBone.matrixWorld.decompose(world, new THREE.Quaternion(), new THREE.Vector3());
    const cubeMesh = rig.headCube.children[0] as THREE.Mesh;
    const cubeGeometry = cubeMesh.geometry;
    cubeGeometry.computeBoundingBox();
    const cubeWorldScale = new THREE.Vector3();
    rig.headCube.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), cubeWorldScale);
    return {
      cubeGeometryBox: [
        cubeGeometry.boundingBox?.min.toArray().map((n) => +n.toFixed(2)),
        cubeGeometry.boundingBox?.max.toArray().map((n) => +n.toFixed(2)),
      ],
      cubeWorldScale: cubeWorldScale.toArray().map((n) => +n.toFixed(3)),
      cubeLocalPos: rig.headCube.position.toArray().map((n) => +n.toFixed(2)),
      rootScale: scale.toArray().map((n) => +n.toFixed(3)),
      meshBox: [box.min.toArray(), box.max.toArray()].map((v) => v.map((n) => +n.toFixed(2))),
      headBox: [headBox.min.toArray(), headBox.max.toArray()].map((v) => v.map((n) => +n.toFixed(2))),
      headBonePos: world.toArray().map((n) => +n.toFixed(2)),
      headBoneScale: rig.headBone.scale.toArray().map((n) => +n.toFixed(3)),
      headCubeScale: rig.headCube.scale.toArray().map((n) => +n.toFixed(3)),
    };
  }

  overlapsCollider(): boolean {
    const radius = this.config.body_radius * 0.6;
    return collidesAt(this.movementColliders(), this.position.x, this.position.z, radius);
  }

  distanceTo(x: number, z: number): number {
    return Math.hypot(x - this.position.x, z - this.position.z);
  }

  activate(): void {
    if (this.state !== 'dormant') {
      return;
    }
    this.activeAt = this.time;
    this.nextLureAt = this.time + LURE_FIRST_DELAY;
    this.setState('patrol');
    this.pickPatrolTarget();
    this.planPatrol();
    console.info(
      `[M5] Stalker despierto en ${this.roomId} | patrulla: ${this.config.patrol_rooms.join(', ')} | prohibido: ${this.config.forbidden_rooms.join(', ')} (${this.config.forbidden_seconds}s)`,
    );
  }

  /**
   * Cada afiche quemado acelera al stalker un poco, con un tope acumulado
   * para que la escalada siga siendo jugable.
   */
  setBurnedPosters(count: number): void {
    const step = this.config.poster_speed_step ?? DEFAULT_POSTER_SPEED_STEP;
    const max = this.config.poster_speed_max ?? DEFAULT_POSTER_SPEED_MAX;
    this.speedScale = Math.min(max, 1 + Math.max(0, count) * step);
  }

  /**
   * Fija la sala a vigilar (2º stalker del final). En patrulla/retorno se
   * queda dentro; la sala vigilada nunca cuenta como prohibida.
   */
  setGuardRoom(room: string | null): void {
    this.guardRoom = room;
    if (room) {
      this.patrolTarget = room;
    }
  }

  get guardRoomId(): string | null {
    return this.guardRoom;
  }

  // QA: el próximo pensamiento puede lanzar un señuelo.
  forceLure(): void {
    this.nextLureAt = this.time;
    this.lastSeenAt = -999;
  }

  hideUseCount(hideId: string): number {
    return this.hideUses.get(hideId) ?? 0;
  }

  get inspectingHide(): string | null {
    return this.inspection?.spot.id ?? null;
  }

  /**
   * El jugador se mete en un escondite. Cuenta el uso (adaptación) y, si el
   * stalker lo ha visto entrar, va directo a abrirlo.
   */
  noteHideEntered(hideId: string, room: string, playerX: number, playerZ: number): void {
    this.hideUses.set(hideId, this.hideUseCount(hideId) + 1);
    if (this.state === 'dormant' || room !== this.roomId) {
      return;
    }
    const witnessed =
      this.state === 'attack' ||
      (this.state === 'chase' && this.time - this.lastSeenAt < WITNESS_SECONDS) ||
      this.sightCheck(playerX, playerZ, 1, false);
    const spot = this.hideSpot(hideId);
    if (witnessed && spot) {
      this.startInspect(spot, true);
    }
  }

  /**
   * Ruido fuerte (afiche ardiendo): si está a `maxHops` salas o menos y no
   * persigue a nadie, va a mirar qué pasa.
   */
  alertNoise(room: string, x: number, z: number, maxHops: number): boolean {
    if (this.state === 'dormant' || this.state === 'chase' || this.state === 'attack' || this.state === 'inspect') {
      return false;
    }
    if (this.graph.hops(this.roomId, room) > maxHops || this.isForbidden(room)) {
      return false;
    }
    this.remember(room, x, z);
    this.setState('suspect');
    this.planToKnown();
    return true;
  }

  teleportTo(room: string, x: number, z: number, yaw: number): void {
    this.roomId = room;
    this.position.set(x, 0, z);
    this.yaw = yaw;
    this.route = [];
    this.goal = null;
    this.transitDoorway = null;
    this.lastKnown = null;
    this.inspection = null;
    this.clearPath();
    this.resolveOverlap();
    this.setState('patrol');
    this.pickPatrolTarget();
    this.planPatrol();
  }

  update(dt: number, sense: StalkerSense, hooks: StalkerHooks): void {
    if (this.state === 'dormant') {
      return;
    }
    this.time += dt;
    this.stateTime += dt;
    this.aiTimer -= dt;
    if (this.aiTimer <= 0) {
      this.aiTimer = 1 / Math.max(1, this.config.ai_hz);
      this.think(sense, hooks);
    }
    this.steer(dt, sense, hooks);
    this.updateInspect(dt, hooks);
    this.updateAttack(dt, sense, hooks);
    this.animate(dt);
    this.emitAudio(dt, sense, hooks);
  }

  private think(sense: StalkerSense, hooks: StalkerHooks): void {
    const perception = this.perceive(sense);
    if (perception.sees) {
      this.remember(sense.playerRoom, sense.playerX, sense.playerZ);
      this.lastSeenAt = this.time;
    } else if (perception.hears) {
      this.remember(sense.playerRoom, sense.playerX, sense.playerZ);
    }
    this.checkHiddenLight(sense);
    this.maybeLure(sense, hooks);

    switch (this.state) {
      case 'patrol':
        if (perception.sees) {
          this.detect(hooks);
        } else if (perception.hears) {
          this.setState('suspect');
          this.planToKnown();
        } else if (this.goal === null) {
          this.planPatrol();
        }
        break;
      case 'suspect':
        this.planToKnown();
        if (perception.sees) {
          this.detect(hooks);
        } else if (this.stateTime >= this.config.suspect_seconds) {
          this.setState('search');
          this.rollSearchDuration();
        }
        break;
      case 'attack':
        break;
      case 'chase':
        if (perception.sees) {
          break;
        }
        if (this.time - this.lastSeenAt > this.config.lose_sight_seconds) {
          this.setState('search');
          this.rollSearchDuration();
        }
        break;
      case 'search':
        if (perception.sees) {
          this.detect(hooks);
        } else if (this.stateTime >= this.searchDuration) {
          this.setState('return');
          this.planReturn();
        } else if (this.goal === null && !this.maybeInspectRoom()) {
          this.planSearch();
        }
        break;
      case 'inspect':
        if (perception.sees) {
          this.inspection = null;
          this.detect(hooks);
        } else if (this.stateTime > INSPECT_TIMEOUT && !this.inspection?.arrived) {
          this.inspection = null;
          this.setState('search');
          this.rollSearchDuration();
        }
        break;
      case 'return':
        if (perception.sees) {
          this.detect(hooks);
        } else if (this.goal === null) {
          this.planReturn();
        }
        break;
      case 'dormant':
        break;
    }
  }

  private detect(hooks: StalkerHooks): void {
    const alreadyChasing = this.state === 'chase';
    this.setState('chase');
    this.route = [];
    this.transitDoorway = null;
    this.goal = null;
    this.clearPath();
    if (!alreadyChasing) {
      hooks.onDetect();
    }
  }

  private setState(state: StalkerState): void {
    this.state = state;
    this.stateTime = 0;
  }

  private rollSearchDuration(): void {
    this.searchDuration = Math.max(
      2,
      this.config.search_seconds + (this.random() * 2 - 1) * this.config.search_variance,
    );
  }

  private perceive(sense: StalkerSense): { sees: boolean; hears: boolean } {
    if (sense.playerRoom !== this.roomId || sense.hiddenIn) {
      return { sees: false, hears: false };
    }
    const distance = this.distanceTo(sense.playerX, sense.playerZ);
    const sightScale = sense.flashlightOn
      ? this.config.flashlight_sight_scale ?? DEFAULT_FLASHLIGHT_SIGHT_SCALE
      : sense.roomDark
        ? this.config.dark_sight_scale ?? DEFAULT_DARK_SIGHT_SCALE
        : 1;
    const sees = this.sightCheck(sense.playerX, sense.playerZ, sightScale, this.beamOnMe(sense));
    let hearingRange = sense.playerRunning
      ? this.config.hearing_run
      : sense.playerMoving
        ? this.config.hearing_walk
        : 0;
    if (sense.playerPanting) {
      hearingRange = Math.max(hearingRange, this.config.pant_hearing ?? DEFAULT_PANT_HEARING);
    }
    const hears = !sees && distance <= Math.max(hearingRange, this.config.notice_radius);
    return { sees, hears };
  }

  // Cono de visión (o cerca, o el haz de la linterna apuntándole) + línea de vista.
  private sightCheck(x: number, z: number, rangeScale: number, beam: boolean): boolean {
    const dx = x - this.position.x;
    const dz = z - this.position.z;
    const distance = Math.hypot(dx, dz);
    const range = Math.max(
      this.config.sight_range * rangeScale,
      beam ? this.config.beam_notice_range ?? DEFAULT_BEAM_NOTICE_RANGE : 0,
    );
    if (distance > range) {
      return false;
    }
    const facing = Math.abs(angleDelta(Math.atan2(-dx, -dz), this.yaw));
    const halfSight = (this.config.sight_deg * Math.PI) / 360;
    const inCone = beam || distance <= this.config.notice_radius || facing <= halfSight;
    return inCone && hasLineOfSight(this.position.x, this.position.z, x, z, this.graph.colliders(this.roomId));
  }

  // El jugador le apunta con la linterna: lo nota aunque esté de espaldas.
  private beamOnMe(sense: StalkerSense): boolean {
    if (!sense.flashlightOn) {
      return false;
    }
    const toMe = Math.atan2(-(this.position.x - sense.playerX), -(this.position.z - sense.playerZ));
    const half = THREE.MathUtils.degToRad(this.config.beam_notice_deg ?? DEFAULT_BEAM_NOTICE_DEG);
    return Math.abs(angleDelta(sense.playerYaw, toMe)) <= half;
  }

  private remember(room: string, x: number, z: number): void {
    this.lastKnown = { room, x, z };
    this.lastKnownReached = false;
    this.memory.set(room, this.time);
  }

  private hideSpot(hideId: string): HideSpot | null {
    return this.graph.room(this.roomId)?.hides.find((spot) => spot.id === hideId) ?? null;
  }

  private startInspect(spot: HideSpot, rush: boolean): void {
    this.setState('inspect');
    this.inspection = { spot, rush, arrived: false, timer: 0 };
    this.hideCheckedAt.set(spot.id, this.time);
    this.route = [];
    this.transitDoorway = null;
    this.goal = { x: spot.frontX, z: spot.frontZ };
    this.clearPath();
  }

  // La linterna encendida dentro de un escondite se ve por la rejilla.
  private checkHiddenLight(sense: StalkerSense): void {
    if (
      !sense.hiddenIn ||
      !sense.flashlightOn ||
      sense.playerRoom !== this.roomId ||
      this.state === 'inspect' ||
      this.state === 'attack' ||
      this.distanceTo(sense.playerX, sense.playerZ) > (this.config.hide_light_radius ?? DEFAULT_HIDE_LIGHT_RADIUS)
    ) {
      return;
    }
    const spot = this.hideSpot(sense.hiddenIn);
    if (spot) {
      this.startInspect(spot, true);
    }
  }

  // Escondites muy usados: al entrar en su sala los revisa por su cuenta.
  private maybeInspectRoom(): boolean {
    if (this.guardRoom && this.roomId !== this.guardRoom) {
      return false;
    }
    const uses = this.config.hide_check_uses ?? DEFAULT_HIDE_CHECK_USES;
    for (const spot of this.graph.room(this.roomId)?.hides ?? []) {
      if (
        this.hideUseCount(spot.id) >= uses &&
        this.time - (this.hideCheckedAt.get(spot.id) ?? -Infinity) > RECHECK_SECONDS &&
        this.random() < ADAPTIVE_CHECK_CHANCE
      ) {
        this.startInspect(spot, false);
        return true;
      }
      // Tirada fallida: no volver a tirar en cada pensamiento.
      if (this.hideUseCount(spot.id) >= uses) {
        this.hideCheckedAt.set(spot.id, this.time);
      }
    }
    return false;
  }

  private updateInspect(dt: number, hooks: StalkerHooks): void {
    const inspection = this.inspection;
    if (this.state !== 'inspect' || !inspection?.arrived) {
      return;
    }
    inspection.timer += dt;
    if (inspection.timer < (this.config.inspect_seconds ?? DEFAULT_INSPECT_SECONDS)) {
      return;
    }
    this.inspection = null;
    if (hooks.onInspect(inspection.spot.id)) {
      this.lastSeenAt = this.time;
      this.attackReadyAt = this.time + this.attackCooldown();
      this.detect(hooks);
      return;
    }
    this.setState('search');
    this.rollSearchDuration();
  }

  // Trampa: un portazo o un silbido lejos de la puerta por la que va a entrar.
  private maybeLure(sense: StalkerSense, hooks: StalkerHooks): void {
    if (
      (this.state !== 'patrol' && this.state !== 'return') ||
      this.guardRoom ||
      sense.hiddenIn ||
      this.time < this.nextLureAt ||
      this.time - this.lastSeenAt < LURE_QUIET_SECONDS ||
      this.isForbidden(sense.playerRoom)
    ) {
      return;
    }
    const hops = this.graph.hops(this.roomId, sense.playerRoom);
    if (hops < 1 || hops > LURE_MAX_HOPS) {
      return;
    }
    const min = this.config.lure_min_seconds ?? DEFAULT_LURE_MIN;
    const max = this.config.lure_max_seconds ?? DEFAULT_LURE_MAX;
    this.nextLureAt = this.time + min + this.random() * Math.max(0, max - min);
    const path = this.graph.path(this.roomId, sense.playerRoom);
    hooks.onLure(path.length >= 2 ? path[path.length - 2] : null);
    this.patrolTarget = sense.playerRoom;
    this.routeTo(sense.playerRoom);
  }

  private planPatrol(): void {
    if (this.roomId === this.patrolTarget) {
      this.pickPatrolTarget();
    }
    this.routeTo(this.patrolTarget);
  }

  private planReturn(): void {
    this.routeTo(this.nearestPatrolRoom());
  }

  private planSearch(): void {
    if (this.lastKnown && !this.lastKnownReached) {
      this.planToKnown();
      return;
    }
    if (this.lastKnown && this.lastKnown.room === this.roomId) {
      this.route = [];
      this.transitDoorway = null;
      this.goal = { x: this.lastKnown.x, z: this.lastKnown.z };
      return;
    }
    const neighbors = (this.graph.room(this.roomId)?.doorways ?? [])
      .map((doorway) => doorway.to)
      .filter((id) => !this.isForbidden(id));
    if (neighbors.length > 0) {
      this.routeTo(neighbors[Math.floor(this.random() * neighbors.length)]);
      return;
    }
    this.routeTo(null);
  }

  private planToKnown(): void {
    if (!this.lastKnown) {
      this.routeTo(null);
      return;
    }
    if (this.lastKnown.room === this.roomId) {
      this.route = [];
      this.transitDoorway = null;
      this.goal = { x: this.lastKnown.x, z: this.lastKnown.z };
      return;
    }
    this.routeTo(this.lastKnown.room);
  }

  private routeTo(target: string | null): void {
    this.route = [];
    this.transitDoorway = null;
    if (!target || target === this.roomId || this.graph.hops(this.roomId, target) === 0) {
      this.goal = this.randomPoint();
      return;
    }
    let path = this.graph.path(this.roomId, target);
    if (path.length === 0) {
      this.goal = this.randomPoint();
      return;
    }
    if (this.isForbidden(path[path.length - 1])) {
      path = path.slice(0, -1);
    }
    const doorway = path.length > 1 ? this.graph.exitToward(this.roomId, path[1]) : null;
    if (!doorway) {
      this.goal = this.randomPoint();
      return;
    }
    this.route = path;
    this.transitDoorway = doorway;
    this.goal = { x: doorway.centerX, z: doorway.centerZ };
  }

  private pickPatrolTarget(): void {
    if (this.guardRoom) {
      this.patrolTarget = this.guardRoom;
      return;
    }
    const remembered = this.rememberedRoom();
    if (remembered) {
      this.patrolTarget = remembered;
      return;
    }
    const allowed = this.config.patrol_rooms.filter((id) => !this.isForbidden(id));
    const pool = allowed.length > 0 ? allowed : this.config.patrol_rooms;
    const options = pool.filter((id) => id !== this.roomId);
    const choices = options.length > 0 ? options : pool;
    this.patrolTarget = choices[Math.floor(this.random() * choices.length)] ?? this.roomId;
  }

  // Vuelve a las salas donde te vio u oyó: las recientes pesan más.
  private rememberedRoom(): string | null {
    const window = this.config.memory_seconds ?? DEFAULT_MEMORY_SECONDS;
    const recent = [...this.memory.entries()]
      .filter(([room, at]) => this.time - at < window && room !== this.roomId && !this.isForbidden(room) && this.graph.hasRoom(room))
      .sort((a, b) => b[1] - a[1]);
    if (recent.length === 0 || this.random() >= (this.config.memory_chance ?? DEFAULT_MEMORY_CHANCE)) {
      return null;
    }
    return recent[Math.floor(this.random() * this.random() * recent.length)][0];
  }

  private nearestPatrolRoom(): string | null {
    if (this.guardRoom) {
      return this.guardRoom;
    }
    let best: string | null = null;
    let bestHops = Number.POSITIVE_INFINITY;
    for (const id of this.config.patrol_rooms) {
      if (this.isForbidden(id)) {
        continue;
      }
      const hops = this.graph.hops(this.roomId, id);
      if (hops < bestHops) {
        bestHops = hops;
        best = id;
      }
    }
    return best;
  }

  private isForbidden(room: string): boolean {
    if (this.guardRoom && room === this.guardRoom) {
      return false;
    }
    if (!this.config.forbidden_rooms.includes(room)) {
      return false;
    }
    return this.time - this.activeAt < this.config.forbidden_seconds;
  }

  private randomPoint(): LocalGoal {
    const room = this.graph.room(this.roomId);
    if (!room) {
      return { x: this.position.x, z: this.position.z };
    }
    const colliders = this.graph.colliders(this.roomId);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const x = (this.random() * 2 - 1) * room.halfWidth * 0.7;
      const z = (this.random() * 2 - 1) * room.halfDepth * 0.7;
      if (!collidesAt(colliders, x, z, this.config.body_radius)) {
        return { x, z };
      }
    }
    return { x: 0, z: 0 };
  }

  private steer(dt: number, sense: StalkerSense, hooks: StalkerHooks): void {
    if (this.state === 'attack') {
      if (sense.playerRoom === this.roomId) {
        const angle = Math.atan2(-(sense.playerX - this.position.x), -(sense.playerZ - this.position.z));
        this.turnToward(angle, dt);
      }
      this.locomotionSpeed = 0;
      this.moveBlend = Math.max(0, this.moveBlend - dt * 6);
      return;
    }
    if (this.state === 'inspect' && this.inspection?.arrived) {
      // Plantado delante del escondite, mirándolo.
      const spot = this.inspection.spot;
      this.turnToward(Math.atan2(-(spot.x - this.position.x), -(spot.z - this.position.z)), dt);
      this.locomotionSpeed = 0;
      this.moveBlend = Math.max(0, this.moveBlend - dt * 6);
      return;
    }
    if (this.state === 'chase') {
      if (sense.playerRoom === this.roomId && !sense.hiddenIn) {
        this.route = [];
        this.transitDoorway = null;
        this.goal = { x: sense.playerX, z: sense.playerZ };
      } else if (this.goal === null) {
        if (sense.hiddenIn && this.lastKnown?.room === this.roomId) {
          this.goal = { x: this.lastKnown.x, z: this.lastKnown.z };
        } else {
          this.routeTo(sense.playerRoom);
        }
      }
    }

    const goal = this.goal;
    if (!goal) {
      this.locomotionSpeed = 0;
      this.moveBlend = Math.max(0, this.moveBlend - dt * 4);
      this.clearPath();
      return;
    }

    const dxGoal = goal.x - this.position.x;
    const dzGoal = goal.z - this.position.z;
    const distance = Math.hypot(dxGoal, dzGoal);
    const arrival = this.state === 'chase' ? CHASE_GOAL_RADIUS : GOAL_RADIUS;
    if (distance <= arrival) {
      this.locomotionSpeed = 0;
      this.onGoalReached(sense, hooks);
      return;
    }

    const target = this.currentWaypoint(goal, dt);
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    let angle = Math.atan2(-dx, -dz);
    if (this.time < this.detourUntil && this.path.length <= 1) {
      // Sin ruta con waypoints (A* no encontró camino): desvío ciego.
      angle += DETOUR_ANGLE * this.detourSign;
    }
    this.turnToward(angle, dt);
    if (Math.abs(angleDelta(angle, this.yaw)) > Math.PI / 2) {
      // Girar en el sitio: avanzar "de lado" mientras mira a otro lado se ve
      // como si patinara, así que primero se encara el objetivo.
      this.locomotionSpeed = 0;
      this.moveBlend = Math.max(0, this.moveBlend - dt * 4);
      this.stuckTimer = 0;
      return;
    }
    const step = this.currentSpeed() * dt;
    const moved = this.advance(-Math.sin(this.yaw), -Math.cos(this.yaw), step, dt);
    this.locomotionSpeed = dt > 0 ? moved / dt : 0;
    this.walkPhase += moved * 3.4;
    this.moveBlend = Math.min(1, this.moveBlend + dt * 6);
  }

  private clearPath(): void {
    this.path = [];
    this.pathIndex = 0;
    this.pathGoal = null;
    this.pathRoom = null;
    this.repathTimer = 0;
  }

  private navGridFor(room: string): NavGrid | null {
    const nav = this.graph.room(room);
    if (!nav) {
      return null;
    }
    let grid = this.navGrids.get(room);
    if (!grid) {
      grid = new NavGrid(nav.halfWidth, nav.halfDepth, nav.colliders, this.config.body_radius);
      this.navGrids.set(room, grid);
    }
    return grid;
  }

  private computePath(goal: LocalGoal): void {
    const grid = this.navGridFor(this.roomId);
    this.path = grid ? grid.findPath(this.position, goal) : [{ x: goal.x, z: goal.z }];
    this.pathIndex = 0;
    this.pathGoal = { x: goal.x, z: goal.z };
    this.pathRoom = this.roomId;
    this.repathTimer = REPATH_MIN_INTERVAL;
  }

  private currentWaypoint(goal: LocalGoal, dt: number): LocalGoal {
    this.repathTimer -= dt;
    const goalMoved =
      !this.pathGoal ||
      Math.hypot(goal.x - this.pathGoal.x, goal.z - this.pathGoal.z) > PATH_GOAL_TOLERANCE;
    if ((this.pathRoom !== this.roomId || this.path.length === 0 || goalMoved) && this.repathTimer <= 0) {
      this.computePath(goal);
    }
    while (this.pathIndex < this.path.length) {
      const waypoint = this.path[this.pathIndex];
      if (
        Math.hypot(waypoint.x - this.position.x, waypoint.z - this.position.z) <= WAYPOINT_RADIUS
      ) {
        this.pathIndex += 1;
        continue;
      }
      return waypoint;
    }
    return goal;
  }

  private onGoalReached(sense: StalkerSense, hooks: StalkerHooks): void {
    if (this.transitDoorway && this.route.length > 1) {
      const entry = this.graph.entryOf(this.transitDoorway);
      const from = this.roomId;
      this.roomId = entry.room;
      this.position.set(entry.x, 0, entry.z);
      this.yaw = entry.yaw;
      this.route = this.route.slice(1);
      this.transitDoorway = null;
      this.goal = null;
      this.stuckTimer = 0;
      this.clearPath();
      this.resolveOverlap();
      hooks.onRoomChange(from, entry.room);
      if (this.state === 'patrol' || this.state === 'return' || this.state === 'search') {
        this.maybeInspectRoom();
      }
      return;
    }
    this.goal = null;
    this.clearPath();
    if (this.lastKnown && this.lastKnown.room === this.roomId) {
      this.lastKnownReached = true;
    }
    switch (this.state) {
      case 'patrol':
        this.planPatrol();
        break;
      case 'suspect':
        this.planToKnown();
        break;
      case 'search':
        this.planSearch();
        break;
      case 'return':
        if (this.roomId === this.patrolTarget) {
          this.setState('patrol');
          this.pickPatrolTarget();
        }
        this.planPatrol();
        break;
      case 'chase':
        if (sense.playerRoom === this.roomId && !sense.hiddenIn) {
          this.goal = { x: sense.playerX, z: sense.playerZ };
        } else if (sense.playerRoom !== this.roomId) {
          this.routeTo(sense.playerRoom);
        }
        break;
      case 'inspect':
        if (this.inspection) {
          this.inspection.arrived = true;
        }
        break;
      case 'attack':
      case 'dormant':
        break;
    }
  }

  private playClipForState(): void {
    const animator = this.animator;
    if (!animator) {
      return;
    }
    switch (this.state) {
      case 'attack':
        // El clip de ataque se lanza una sola vez al iniciar la embestida.
        return;
      case 'dormant':
        animator.play(IDLE_CLIP, 0.3);
        return;
      default:
        break;
    }
    // El clip se elige por velocidad real (igual que StalkerLab), no solo por
    // estado: suspect/search sí se mueven (search_speed) pero antes forzaban
    // IDLE y se deslizaban sin mover las piernas; y patrol/chase/return
    // forzaban WALK/RUN aun quietos (giro en el sitio, repath del A*, llegada
    // a waypoint), patinando en el sitio.
    if (this.locomotionSpeed <= 0.1) {
      animator.play(IDLE_CLIP, 0.25);
      return;
    }
    const walk =
      animator.naturalSpeed(WALK_CLIP) ?? DEFAULT_CLIP_SPEEDS[WALK_CLIP] ?? 0.35;
    const run = animator.naturalSpeed(RUN_CLIP) ?? DEFAULT_CLIP_SPEEDS[RUN_CLIP] ?? 2.0;
    const threshold = (walk + run) / 2;
    if (this.locomotionSpeed <= threshold) {
      animator.play(WALK_CLIP, 0.3);
    } else {
      animator.play(RUN_CLIP, 0.18);
    }
  }

  private currentSpeed(): number {
    let base: number;
    if (this.state === 'chase' || (this.state === 'inspect' && this.inspection?.rush)) {
      base = this.config.chase_speed;
    } else if (this.state === 'inspect') {
      base = this.config.search_speed;
    } else if (this.state === 'search' || this.state === 'suspect') {
      base = this.config.search_speed;
    } else {
      base = this.config.patrol_speed;
    }
    return base * this.speedScale;
  }

  private advance(dirX: number, dirZ: number, distance: number, dt: number): number {
    const colliders = this.movementColliders();
    const radius = this.config.body_radius;
    const beforeX = this.position.x;
    const beforeZ = this.position.z;
    const startDepth = penetrationDepth(colliders, beforeX, beforeZ, radius);
    if (!collidesAt(colliders, beforeX + dirX * distance, beforeZ, radius)) {
      this.position.x += dirX * distance;
    } else if (
      startDepth > 0 &&
      penetrationDepth(colliders, beforeX + dirX * distance, beforeZ, radius) < startDepth
    ) {
      // Atrapado dentro del radio de un collider (spawn pegado a un mueble):
      // se permite avanzar mientras la penetración disminuya, para poder salir.
      this.position.x += dirX * distance;
    }
    if (!collidesAt(colliders, this.position.x, beforeZ + dirZ * distance, radius)) {
      this.position.z += dirZ * distance;
    } else if (
      startDepth > 0 &&
      penetrationDepth(colliders, this.position.x, beforeZ + dirZ * distance, radius) < startDepth
    ) {
      this.position.z += dirZ * distance;
    }
    const moved = Math.hypot(this.position.x - beforeX, this.position.z - beforeZ);
    if (moved < distance * 0.35) {
      this.stuckTimer += dt;
      if (this.stuckTimer > STUCK_SECONDS) {
        // Bloqueado: primero recalcular la ruta (puede rodear el mueble);
        // el desvío ciego queda como último recurso si el A* no encuentra nada.
        this.clearPath();
        this.repathTimer = 0;
        this.detourUntil = this.time + 1.6;
        this.detourSign = this.detourSign === 1 ? -1 : 1;
        this.stuckTimer = 0;
      }
    } else {
      this.stuckTimer = 0;
    }
    return moved;
  }

  private movementColliders(): Collider[] {
    const colliders = this.graph.colliders(this.roomId);
    const doorway = this.transitDoorway;
    if (!doorway) {
      return colliders;
    }
    const slab = colliderForBox(
      doorway.centerX,
      doorway.centerZ,
      doorway.heading,
      doorway.width,
      DOOR_THICKNESS,
    );
    return colliders.filter((collider) => !sameCollider(collider, slab));
  }

  /**
   * Si el spawn de entrada queda dentro del radio de un mueble, empuja al
   * stalker fuera por el lado más cercano para que no nazca clavado.
   */
  private resolveOverlap(): void {
    const colliders = this.movementColliders();
    const radius = this.config.body_radius;
    for (let iteration = 0; iteration < 8; iteration += 1) {
      let pushed = false;
      for (const collider of colliders) {
        const minX = collider.minX - radius;
        const maxX = collider.maxX + radius;
        const minZ = collider.minZ - radius;
        const maxZ = collider.maxZ + radius;
        if (
          this.position.x > minX &&
          this.position.x < maxX &&
          this.position.z > minZ &&
          this.position.z < maxZ
        ) {
          const pushLeft = this.position.x - minX;
          const pushRight = maxX - this.position.x;
          const pushDown = this.position.z - minZ;
          const pushUp = maxZ - this.position.z;
          const smallest = Math.min(pushLeft, pushRight, pushDown, pushUp);
          if (smallest === pushLeft) {
            this.position.x = minX - 0.001;
          } else if (smallest === pushRight) {
            this.position.x = maxX + 0.001;
          } else if (smallest === pushDown) {
            this.position.z = minZ - 0.001;
          } else {
            this.position.z = maxZ + 0.001;
          }
          pushed = true;
        }
      }
      if (!pushed) {
        return;
      }
    }
  }

  private turnToward(angle: number, dt: number): void {
    const maxTurn = ((this.config.turn_speed * Math.PI) / 180) * dt;
    // angleDelta(yaw, angle) es el paso más corto hacia el objetivo: restarlo al
    // revés hacía que el stalker girase en sentido contrario y oscilara ±180°.
    this.yaw += THREE.MathUtils.clamp(angleDelta(this.yaw, angle), -maxTurn, maxTurn);
  }

  private emitAudio(dt: number, sense: StalkerSense, hooks: StalkerHooks): void {
    const together = sense.playerRoom === this.roomId;
    if (this.moveBlend > 0.2) {
      const stride = Math.floor(this.walkPhase / Math.PI);
      if (stride !== this.stepLatch) {
        this.stepLatch = stride;
        hooks.onStride(this.roomId, this.position.x, this.position.z, this.yaw);
        if (together) {
          hooks.onFootstep(this.position.x, this.position.z, this.state === 'chase');
        }
      }
    }
    if (!together) {
      return;
    }
    this.breathTimer -= dt;
    if (this.breathTimer <= 0) {
      this.breathTimer =
        this.state === 'attack' ? 0.9 : this.state === 'chase' ? 1.9 : this.state === 'inspect' ? 1.4 : 3.6;
      hooks.onBreath(this.position.x, this.position.z);
    }
    if (this.state === 'chase' || this.state === 'attack') {
      this.heartbeatTimer -= dt;
      if (this.heartbeatTimer <= 0) {
        const distance = this.distanceTo(sense.playerX, sense.playerZ);
        this.heartbeatTimer = THREE.MathUtils.clamp(distance / 12, 0.5, 1.15);
        hooks.onHeartbeat(this.position.x, this.position.z);
      }
    }
  }

  private updateAttack(dt: number, sense: StalkerSense, hooks: StalkerHooks): void {
    if (this.state === 'attack') {
      this.attackTimer -= dt;
      if (this.attackTimer > 0) {
        return;
      }
      if (this.attackPhase === 'windup') {
        this.attackPhase = 'recover';
        this.attackTimer = this.attackRecover();
        const reachable =
          sense.playerRoom === this.roomId &&
          !sense.playerInvulnerable &&
          !sense.hiddenIn &&
          this.distanceTo(sense.playerX, sense.playerZ) <= this.config.catch_radius;
        if (reachable) {
          hooks.onHit(this.position.x, this.position.z);
        }
        return;
      }
      this.attackReadyAt = this.time + this.attackCooldown();
      this.setState('chase');
      return;
    }
    if (this.state !== 'chase' || this.time < this.attackReadyAt || sense.playerInvulnerable || sense.hiddenIn) {
      return;
    }
    if (sense.playerRoom !== this.roomId) {
      return;
    }
    if (this.distanceTo(sense.playerX, sense.playerZ) > this.attackRange()) {
      return;
    }
    this.setState('attack');
    this.attackPhase = 'windup';
    this.attackTimer = this.attackWindup();
    if (this.animator?.action(ATTACK_CLIP)) {
      this.animator.playOnce(ATTACK_CLIP, 0.08);
    }
    hooks.onAttackStart(this.position.x, this.position.z);
  }

  private attackRange(): number {
    return this.config.attack_range ?? DEFAULT_ATTACK_RANGE;
  }

  private attackWindup(): number {
    return this.config.attack_windup_seconds ?? DEFAULT_ATTACK_WINDUP;
  }

  private attackRecover(): number {
    return this.config.attack_recover_seconds ?? DEFAULT_ATTACK_RECOVER;
  }

  private attackCooldown(): number {
    return this.config.attack_cooldown_seconds ?? DEFAULT_ATTACK_COOLDOWN;
  }

  private animate(dt: number): void {
    if (this.animator) {
      this.playClipForState();
      this.animator.update(dt, { groundSpeed: this.locomotionSpeed, sync: true });
      this.object.position.set(this.position.x, 0, this.position.z);
      this.object.rotation.y = this.yaw;
      return;
    }
    const swing = Math.sin(this.walkPhase) * 0.5 * this.moveBlend;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.x = -swing * 0.75;
    this.armR.rotation.x = swing * 0.75;
    const bob = Math.abs(Math.sin(this.walkPhase)) * 0.045 * this.moveBlend;
    const breath = Math.sin(this.time * 1.6) * 0.012 * (1 - this.moveBlend);
    this.hips.position.y = 0.85 + bob + breath;
    this.hips.rotation.y = Math.sin(this.walkPhase * 0.5) * 0.06 * this.moveBlend;
    const chase = this.state === 'chase' ? 1 : 0;
    const blend = Math.min(1, dt * 4);
    this.torso.rotation.x += (-0.13 * chase - this.torso.rotation.x) * blend;
    this.armL.rotation.z += (-0.12 - chase * 0.2 - this.armL.rotation.z) * blend;
    this.armR.rotation.z += (0.12 + chase * 0.2 - this.armR.rotation.z) * blend;
    if (this.state === 'attack') {
      const raise = this.attackPhase === 'windup' ? -2.4 : -0.9;
      this.armL.rotation.x += (raise - this.armL.rotation.x) * blend;
      this.armR.rotation.x += (raise - this.armR.rotation.x) * blend;
    }
    if (this.state === 'suspect' || this.state === 'search' || this.state === 'inspect') {
      this.headGroup.rotation.y = Math.sin(this.time * 1.1) * 0.45;
    } else {
      this.headGroup.rotation.y += (0 - this.headGroup.rotation.y) * blend;
    }
    this.headGroup.rotation.x = Math.sin(this.time * 0.7) * 0.05;
    this.object.position.set(this.position.x, 0, this.position.z);
    this.object.rotation.y = this.yaw;
  }

  private buildModel(config: PsxConfig, headAtlas: HeadAtlas): void {
    const skin: [number, number, number] = [0.86, 0.7, 0.6];
    const cloth: [number, number, number] = [0.4, 0.35, 0.33];
    const dark: [number, number, number] = [0.17, 0.16, 0.17];
    const collar: [number, number, number] = [0.55, 0.5, 0.46];

    const part = (
      width: number,
      height: number,
      depth: number,
      x: number,
      y: number,
      z: number,
      shade: [number, number, number],
      handle: PsxMaterialHandle = this.body,
    ): THREE.Mesh => {
      const geometry = new THREE.BoxGeometry(width, height, depth);
      geometry.translate(x, y, z);
      paintVertexColors(geometry, () => shade);
      return new THREE.Mesh(geometry, handle.material);
    };

    this.legL.position.set(-0.16, 0, 0);
    this.legR.position.set(0.16, 0, 0);
    this.legL.add(part(0.2, 0.85, 0.24, 0, -0.42, 0, dark));
    this.legR.add(part(0.2, 0.85, 0.24, 0, -0.42, 0, dark));
    this.hips.add(part(0.44, 0.2, 0.28, 0, -0.03, 0, cloth));
    this.hips.add(this.legL, this.legR);

    this.armL.position.set(-0.4, 0.55, 0);
    this.armR.position.set(0.4, 0.55, 0);
    this.armL.add(part(0.15, 0.64, 0.2, 0, -0.32, 0, dark));
    this.armR.add(part(0.15, 0.64, 0.2, 0, -0.32, 0, dark));
    this.torso.add(part(0.54, 0.66, 0.32, 0, 0.33, 0, cloth));
    this.torso.add(part(0.2, 0.2, 0.24, -0.37, 0.6, 0, dark));
    this.torso.add(part(0.2, 0.2, 0.24, 0.37, 0.6, 0, dark));
    this.torso.add(part(0.32, 0.1, 0.28, 0, 0.69, 0, collar));
    this.torso.add(this.armL, this.armR);

    this.headGroup.position.y = 0.7;
    this.headGroup.add(part(0.2, 0.16, 0.2, 0, -0.04, 0, skin));
    const skull = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    skull.translate(0, 0.25, 0);
    headAtlas.remap(skull);
    paintVertexColors(skull, () => [1, 1, 1]);
    this.headGroup.add(new THREE.Mesh(skull, this.head.material));
    this.torso.add(this.headGroup);

    this.hips.add(this.torso);
    this.object.add(this.hips);
    this.object.name = 'stalker';
    this.object.scale.setScalar(config.enemy.height / MODEL_HEIGHT);
  }
}

function paintVertexColors(geometry: THREE.BufferGeometry, shade: () => [number, number, number]): void {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i += 1) {
    const [r, g, b] = shade();
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geometry.setAttribute('a_color', new THREE.BufferAttribute(colors, 3));
}

function collidesAt(colliders: Collider[], x: number, z: number, radius: number): boolean {
  return colliders.some(
    (collider) =>
      x > collider.minX - radius &&
      x < collider.maxX + radius &&
      z > collider.minZ - radius &&
      z < collider.maxZ + radius,
  );
}

function penetrationDepth(colliders: Collider[], x: number, z: number, radius: number): number {
  let depth = 0;
  for (const collider of colliders) {
    const minX = collider.minX - radius;
    const maxX = collider.maxX + radius;
    const minZ = collider.minZ - radius;
    const maxZ = collider.maxZ + radius;
    if (x > minX && x < maxX && z > minZ && z < maxZ) {
      const inset = Math.min(x - minX, maxX - x, z - minZ, maxZ - z);
      depth = Math.max(depth, inset);
    }
  }
  return depth;
}

function sameCollider(a: Collider, b: Collider): boolean {
  return (
    Math.abs(a.minX - b.minX) < 1e-6 &&
    Math.abs(a.maxX - b.maxX) < 1e-6 &&
    Math.abs(a.minZ - b.minZ) < 1e-6 &&
    Math.abs(a.maxZ - b.maxZ) < 1e-6
  );
}

function hasLineOfSight(x0: number, z0: number, x1: number, z1: number, colliders: Collider[]): boolean {
  return !colliders.some((collider) => segmentHitsBox(x0, z0, x1, z1, collider));
}

function segmentHitsBox(x0: number, z0: number, x1: number, z1: number, box: Collider): boolean {
  const dx = x1 - x0;
  const dz = z1 - z0;
  let tMin = 0;
  let tMax = 1;
  const axes: Array<[number, number, number, number]> = [
    [x0, dx, box.minX, box.maxX],
    [z0, dz, box.minZ, box.maxZ],
  ];
  for (const [origin, delta, min, max] of axes) {
    if (Math.abs(delta) < 1e-9) {
      if (origin < min || origin > max) {
        return false;
      }
      continue;
    }
    let t0 = (min - origin) / delta;
    let t1 = (max - origin) / delta;
    if (t0 > t1) {
      const swap = t0;
      t0 = t1;
      t1 = swap;
    }
    tMin = Math.max(tMin, t0);
    tMax = Math.min(tMax, t1);
    if (tMin > tMax) {
      return false;
    }
  }
  return true;
}

function angleDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}
