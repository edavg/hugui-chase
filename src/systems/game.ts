import * as THREE from 'three';
import type { PsxConfig } from './config';
import { PsxRenderer } from './psxRenderer';
import { FixedLoop } from './loop';
import { Input } from './input';
import { buildRoom, loadRoomData, type BuiltRoom, type DoorHandle, type ItemHandle } from './roomBuilder';
import { Flags } from './flags';
import { Inventory } from './inventory';
import { TEXTS } from './i18n';
import {
  POSTER_IDS,
  itemName,
  itemText,
  itemTitle,
  loadItemCatalog,
  type ItemDef,
} from './items';
import { Ui } from './ui';
import { UI_HEIGHT, UiCanvas } from './uiCanvas';
import { loadPosterTexture } from './proceduralTextures';
import { BURN_SECONDS, PosterBurn } from './burnFx';
import { createBitmapFont } from './font';
import { Menu, type MenuScreen } from './menu';
import { Settings, type SettingsData } from './settings';
import { Gamepad, type PadAction } from './gamepad';
import { TouchControls } from './touch';
import { AudioSystem } from './audio';
import { Flashlight } from './flashlight';
import { RoomGraph } from './roomGraph';
import { setSceneLights, updateSceneLights } from './sceneLights';
import { setHideOpen, type HideHandle } from './hides';
import { ScareDirector, type ScareContext } from './roomEvents';
import { Traces } from './traces';
import { Stalker, type StalkerHooks, type StalkerSense } from '../entities/stalker';
import { Player } from '../entities/player';

const PORTRAIT_FOV_FALLBACK = 95;
const DEFAULT_HEARTS = 3;
const MAX_HEARTS = 8;
const DEFAULT_HIT_INVULN = 2.5;
const HIT_KNOCKBACK = 1.0;
const INTRO_OBJECTIVE_SECONDS = 7;
const WAKE_SECONDS = 3.2;
const ARRIVAL_DOOR_SECONDS = 0.9;
const AIM_OCCLUSION_MARGIN = 0.15;
const AIM_ITEM_LIFT = 0.12;
const AIM_FLAT_VIEW_EPS = 0.08;
const AIM_FOV_FALLBACK = 32;
// Sala donde termina la partida (puerta con `ending: true`): al quemar los 8
// afiches aparece ahí un 2º stalker vigilando la salida.
const ENDING_ROOM_ID = 'room_vestibulo';
// M13: escondites, aguante, rastros y sustos.
const HIDE_DOOR_SECONDS = 0.35;
const INSPECT_OPEN_SECONDS = 1.2;
const HIDE_DANGER_RADIUS = 5;
const PANT_INTERVAL = 1.5;
const SEEN_CHECK_INTERVAL = 0.25;
const SEEN_RANGE = 9;
const DOOR_AJAR = 0.28;
const DEFAULT_HIDE_CHECK_USES = 3;
const DEFAULT_BURN_NOISE_HOPS = 1;

type State = 'playing' | 'transition' | 'reading' | 'ending';


interface Waiter {
  remaining: number;
  total: number;
  onTick?: (progress: number) => void;
  resolve: () => void;
}

interface Interactable {
  door: DoorHandle | null;
  item: ItemHandle | null;
  hide: HideHandle | null;
  label: string;
}

export class Game {
  private room!: BuiltRoom;
  private player!: Player;
  private state: State = 'playing';
  private readonly loop: FixedLoop;
  private readonly roomCache = new Map<string, Promise<BuiltRoom>>();
  private readonly waiters: Waiter[] = [];
  private readonly flags = new Flags();
  private readonly inventory = new Inventory();
  private readonly ui: Ui;
  private readonly uiCanvas: UiCanvas;
  private readonly settings: Settings;
  private readonly gamepad: Gamepad;
  private readonly menu: Menu;
  private readonly touch: TouchControls;
  private readonly introRoom: string;
  private readonly introSpawn: string;
  private readonly wakeEnabled: boolean;
  private unlocking = false;
  private readonly unlockReadyAt = new Map<string, number>();
  readonly audio: AudioSystem;
  private catalog = new Map<string, ItemDef>();
  private transitionStart = 0;
  private graph: RoomGraph | null = null;
  private graphPromise: Promise<RoomGraph> | null = null;
  private stalker: Stalker | null = null;
  private stalkerLoading = false;
  private stalkerRoom: string | null = null;
  // 2º stalker: aparece en la zona final al quemar los 8 afiches y vigila
  // ENDING_ROOM_ID. Tiene su propio enganche a escena y su propio flag de
  // carga para no interferir con el primero.
  private stalkerSecond: Stalker | null = null;
  private stalkerSecondLoading = false;
  private stalkerSecondRoom: string | null = null;
  private secondStalkerSpawned = false;
  private readonly flashlight: Flashlight;
  private musicLevel: 0 | 1 | 2 = 0;
  private lastPlayerX = 0;
  private lastPlayerZ = 0;
  private hearts = DEFAULT_HEARTS;
  private heartSlots = DEFAULT_HEARTS;
  private invulnUntil = 0;
  private clock = 0;
  private readonly aimRaycaster = new THREE.Raycaster();
  private readonly aimOffset = new THREE.Vector3();
  private readonly aimForward = new THREE.Vector3();
  private readonly aimFlat = new THREE.Vector3();
  private readonly aimFlatView = new THREE.Vector3();
  private readonly aimDoorPoint = new THREE.Vector3();
  private readonly aimItem = new THREE.Vector3();
  private readonly aimHide = new THREE.Vector3();
  private readonly seenFrustum = new THREE.Frustum();
  private readonly seenProjection = new THREE.Matrix4();
  private readonly traces: Traces;
  private readonly scares = new ScareDirector();
  private readonly roomVisits = new Map<string, number>();
  private hidden: HideHandle | null = null;
  private pantTimer = 0;
  private hiddenHeartTimer = 0;
  private seenTimer = 0;

  constructor(
    private readonly config: PsxConfig,
    private readonly psx: PsxRenderer,
    private readonly input: Input,
    settings?: Settings,
    gamepad?: Gamepad,
  ) {
    this.settings = settings ?? new Settings();
    this.settings.applyTo(this.config);
    this.gamepad = gamepad ?? new Gamepad();
    this.gamepad.setEnabled(this.settings.get('gamepad'));
    this.input.attachGamepad(this.gamepad);

    const params = new URLSearchParams(window.location.search);
    this.introRoom = params.get('room') ?? 'room_vestibulo';
    this.introSpawn = params.get('spawn') ?? 'start';
    this.wakeEnabled = params.get('wake') !== '0';

    this.uiCanvas = new UiCanvas(createBitmapFont(), () => ({
      x: this.psx.viewport.x,
      y: this.psx.viewport.y,
      width: this.psx.viewport.z,
      height: this.psx.viewport.w,
      canvasWidth: this.psx.canvasWidth,
      canvasHeight: this.psx.canvasHeight,
    }));
    this.ui = new Ui(this.uiCanvas, () => this.config.language);
    this.ui.setOptions({
      showSubtitles: this.settings.get('subtitles'),
      touchControls: this.touchActive,
    });
    this.menu = new Menu(this.uiCanvas, this.input, this.settings, this.config, {
      resumeGame: () => this.resumeGame(),
      restartGame: () => {
        void this.restartRun();
      },
    });
    this.touch = new TouchControls(this.input, {
      getLanguage: () => this.config.language,
      // La interfaz espera navegación fuera del juego activo: menús, lectura,
      // lectura y examen. Ahí el joystick emite flechas en lugar de movimiento.
      isNavMode: () => this.menu.active || this.state !== 'playing',
      isMenuActive: () => this.menu.active,
      isFlashlightOwned: () => this.flashlight.owned,
    });
    this.touch.setEnabled(this.touchActive);
    this.settings.onChange((event) => {
      this.applySettings(event.key);
    });

    this.audio = new AudioSystem(config.audio);
    this.flashlight = new Flashlight(config);
    this.traces = new Traces(config);
    this.loop = new FixedLoop(
      config.fps,
      (dt) => this.update(dt),
      () => this.render(),
    );

    const [resWidth, resHeight] = config.resolution;
    this.psx.onResolutionChange = (width, height) => this.handleResolutionChange(width, height);
    const [activeWidth, activeHeight] = this.psx.activeResolution;
    if (activeWidth !== resWidth || activeHeight !== resHeight) {
      this.handleResolutionChange(activeWidth, activeHeight);
    }
  }

  // Propaga el aspecto del render a la cámara, los materiales y el HUD.
  private handleResolutionChange(width: number, height: number): void {
    this.config.resolution = [width, height];
    const portrait = height > width;
    this.room?.sync(this.config);
    this.traces.sync();
    this.stalker?.syncConfig(this.config);
    this.stalkerSecond?.syncConfig(this.config);
    if (this.player) {
      this.player.camera.aspect = width / height;
      this.player.camera.fov = this.fovFor(portrait);
      this.player.camera.updateProjectionMatrix();
    }
    // El HUD conserva su escala legible aunque el render 3D use más píxeles.
    this.uiCanvas.setLogicalSize(
      portrait ? 360 : Math.round(UI_HEIGHT * width / height),
      portrait ? Math.round(360 * height / width) : UI_HEIGHT,
    );
  }

  private fovFor(portrait: boolean): number {
    if (!portrait) {
      return this.config.fov;
    }
    return this.config.fov_portrait ?? PORTRAIT_FOV_FALLBACK;
  }

  async start(): Promise<void> {
    this.catalog = await loadItemCatalog();
    this.room = await this.getRoom(this.introRoom);
    this.player = this.createPlayer(this.room, this.introSpawn);
    this.applyRoomState(this.room);
    this.audio.setRoom(this.room.audio);
    this.resetHearts();
    this.updatePosterHud();
    this.loop.start();
    this.lastPlayerX = this.player.position.x;
    this.lastPlayerZ = this.player.position.z;
    this.openMenu(null);
    this.flags.set('stalker_active');
    void this.activateStalker();
    const params = new URLSearchParams(window.location.search);
    const qaX = params.get('x');
    const qaZ = params.get('z');
    if (qaX !== null && qaZ !== null) {
      const qaYaw = Number(params.get('yaw') ?? '0');
      this.debugTeleport(Number(qaX), Number(qaZ), qaYaw);
      if (params.get('pitch') !== null) {
        this.player.lookAt(qaYaw, Number(params.get('pitch')));
      }
    }
    if (params.get('stalker') === '1') {
      void this.activateStalker(params.get('stalkerroom'));
    }
    if (params.get('stalker2') === '1') {
      void this.activateSecondStalker(params.get('stalker2room') ?? ENDING_ROOM_ID);
    }
    if (params.get('flashlight') === '1') {
      this.flashlight.give();
      this.flashlight.on = true;
      this.flashlight.update(0, this.player.camera, true);
    }
    if (import.meta.env.DEV && params.get('preview') === 'ending') {
      this.showEnding();
    } else {
      this.beginIntro();
    }
    console.info(
      `[M3] ${this.config.title} | sala "${this.room.name}" | tris: ${this.room.triangleCount} | colisiones: ${this.room.colliders.length} | puertas: ${this.room.doors.length} | ítems: ${this.room.items.length}`,
    );
    console.info('[M3] Click para capturar el ratón. E interactuar.');
    console.info('[M6] Audio procedural activo: pasos, ambiente, reverb por sala y música reactiva.');
    console.info('[M7] Pausa y opciones con teclado y mando. ESC pausa.');
    console.info('[M5] QA: ?stalker=1&stalkerroom=<id> despierta a Hugui en esa sala.');
    console.info('[M5] QA: ?stalker2=1&stalker2room=<id> despierta al 2º stalker del final.');
    console.info('[M8] Post-proceso PSX/VHS/B&N/CRT activo (modo de imagen en opciones).');
    console.info('[M9] Linterna del sótano: F para encender/apagar. QA: ?flashlight=1.');
  }

  private ensureGraph(): Promise<RoomGraph> {
    if (this.graphPromise) {
      return this.graphPromise;
    }
    this.graphPromise = RoomGraph.load()
      .then((graph) => {
        this.graph = graph;
        console.info(`[M5] Grafo de salas listo: ${graph.roomIds.length} salas`);
        return graph;
      })
      .catch((error: unknown) => {
        this.graphPromise = null;
        console.error('[M5] No se pudo cargar el grafo de salas', error);
        throw error;
      });
    return this.graphPromise;
  }

  private async activateStalker(room?: string | null): Promise<void> {
    if (this.stalker || this.stalkerLoading) {
      return;
    }
    this.stalkerLoading = true;
    try {
      const graph = await this.ensureGraph();
      const stalker = await Stalker.create(this.config, graph);
      stalker.setBurnedPosters(this.burnedPosters());
      stalker.activate();
      const target = room && graph.hasRoom(room) ? room : this.config.enemy.spawn_room;
      if (target !== stalker.roomId) {
        const entry = graph.room(target)?.spawns.start;
        stalker.teleportTo(target, entry?.position[0] ?? 0, entry?.position[1] ?? 0, 0);
      }
      this.stalker = stalker;
      this.syncStalkerPresence();
    } catch (error) {
      console.error('[M5] No se pudo despertar al stalker', error);
    } finally {
      this.stalkerLoading = false;
    }
  }

  private deactivateStalker(): void {
    if (this.stalker) {
      this.stalker.object.removeFromParent();
    }
    this.stalker = null;
    this.stalkerRoom = null;
    this.deactivateSecondStalker();
    this.setMusicLevel(0);
  }

  // 2º stalker del final: nace en ENDING_ROOM_ID al quemar los 8 afiches y
  // se queda vigilando esa zona (guardRoom). Si el jugador ya está allí,
  // se coloca en el spawn más lejano para no aparecer encima.
  private async activateSecondStalker(room?: string | null): Promise<void> {
    if (this.stalkerSecond || this.stalkerSecondLoading || this.secondStalkerSpawned) {
      return;
    }
    this.stalkerSecondLoading = true;
    try {
      const graph = await this.ensureGraph();
      const target =
        room && graph.hasRoom(room)
          ? room
          : graph.hasRoom(ENDING_ROOM_ID)
            ? ENDING_ROOM_ID
            : this.room.id;
      const stalker = await Stalker.create(this.config, graph);
      stalker.object.name = 'stalker2';
      stalker.setBurnedPosters(this.burnedPosters());
      stalker.setGuardRoom(graph.hasRoom(ENDING_ROOM_ID) ? ENDING_ROOM_ID : target);
      stalker.activate();
      const spawn = this.pickSecondStalkerSpawn(graph, target);
      stalker.teleportTo(target, spawn.x, spawn.z, spawn.yaw);
      // teleportTo repasa patrolTarget con el guard: reimponer por si acaso.
      if (graph.hasRoom(ENDING_ROOM_ID)) {
        stalker.setGuardRoom(ENDING_ROOM_ID);
      }
      this.stalkerSecond = stalker;
      this.secondStalkerSpawned = true;
      this.syncSecondStalkerPresence();
      this.audio.play('stinger', 0.9);
      this.ui.toast(TEXTS[this.config.language].toastSecondStalker);
      console.info(`[M5] 2º stalker en ${target} vigilando ${stalker.guardRoomId ?? target}`);
    } catch (error) {
      console.error('[M5] No se pudo despertar al 2º stalker', error);
    } finally {
      this.stalkerSecondLoading = false;
    }
  }

  private pickSecondStalkerSpawn(
    graph: RoomGraph,
    target: string,
  ): { x: number; z: number; yaw: number } {
    const nav = graph.room(target);
    const fallback = { x: 0, z: 0, yaw: 0 };
    if (!nav) {
      return fallback;
    }
    const spawns = Object.values(nav.spawns);
    if (spawns.length === 0) {
      return fallback;
    }
    // Si el jugador está en la sala destino, elegir el spawn más lejano a él
    // para que el 2º stalker no aparezca encima.
    if (target === this.room.id) {
      let best = spawns[0];
      let bestDistance = -Infinity;
      for (const spawn of spawns) {
        const distance = Math.hypot(
          spawn.position[0] - this.player.position.x,
          spawn.position[1] - this.player.position.z,
        );
        if (distance > bestDistance) {
          bestDistance = distance;
          best = spawn;
        }
      }
      return {
        x: best.position[0],
        z: best.position[1],
        yaw: (best.yaw * Math.PI) / 180,
      };
    }
    const start = nav.spawns.start ?? spawns[0];
    return {
      x: start.position[0],
      z: start.position[1],
      yaw: (start.yaw * Math.PI) / 180,
    };
  }

  private deactivateSecondStalker(): void {
    if (this.stalkerSecond) {
      this.stalkerSecond.object.removeFromParent();
    }
    this.stalkerSecond = null;
    this.stalkerSecondRoom = null;
  }

  private syncStalkerPresence(): void {
    const stalker = this.stalker;
    if (!stalker || !stalker.active) {
      this.detachStalker();
      return;
    }
    const here = stalker.roomId === this.room.id;
    if (here && this.stalkerRoom !== this.room.id) {
      this.detachStalker();
      this.room.scene.add(stalker.object);
      this.stalkerRoom = this.room.id;
      stalker.syncAtmosphere(this.config, this.room.atmosphere);
    } else if (!here) {
      this.detachStalker();
    }
  }

  private detachStalker(): void {
    if (this.stalkerRoom !== null) {
      this.stalker?.object.removeFromParent();
      this.stalkerRoom = null;
    }
  }

  private syncSecondStalkerPresence(): void {
    const stalker = this.stalkerSecond;
    if (!stalker || !stalker.active) {
      this.detachSecondStalker();
      return;
    }
    const here = stalker.roomId === this.room.id;
    if (here && this.stalkerSecondRoom !== this.room.id) {
      this.detachSecondStalker();
      this.room.scene.add(stalker.object);
      this.stalkerSecondRoom = this.room.id;
      stalker.syncAtmosphere(this.config, this.room.atmosphere);
    } else if (!here) {
      this.detachSecondStalker();
    }
  }

  private detachSecondStalker(): void {
    if (this.stalkerSecondRoom !== null) {
      this.stalkerSecond?.object.removeFromParent();
      this.stalkerSecondRoom = null;
    }
  }

  private setMusicLevel(level: 0 | 1 | 2): void {
    if (this.musicLevel === level) {
      return;
    }
    this.musicLevel = level;
    this.audio.setMusicIntensity(level);
  }

  private updateStalker(dt: number): void {
    const stalkers = [this.stalker, this.stalkerSecond].filter(
      (candidate): candidate is Stalker => !!candidate && candidate.active,
    );
    if (stalkers.length === 0) {
      return;
    }
    const position = this.player.position;
    const speed = Math.hypot(position.x - this.lastPlayerX, position.z - this.lastPlayerZ) / dt;
    this.lastPlayerX = position.x;
    this.lastPlayerZ = position.z;

    const sense: StalkerSense = {
      playerRoom: this.room.id,
      playerX: position.x,
      playerZ: position.z,
      playerMoving: speed > 0.2,
      playerRunning: speed > (this.config.player.walk + this.config.player.run) * 0.45,
      playerInvulnerable: this.clock < this.invulnUntil,
      playerYaw: this.player.camera.rotation.y,
      flashlightOn: this.flashlight.owned && this.flashlight.on,
      playerPanting: this.player.isExhausted,
      roomDark: (this.room.atmosphere?.ambient ?? 0.3) < 0.1,
      hiddenIn: this.hidden?.spot.id ?? null,
    };

    const listenerYaw = this.player.camera.rotation.y;
    const hooks: StalkerHooks = {
      onHit: (x, z) => {
        this.takeHit(x, z);
      },
      onAttackStart: (x, z) => {
        this.audio.playAt('attack_warn', x, z, position.x, position.z, listenerYaw, 0.8);
      },
      onDetect: () => {
        this.audio.play('stinger');
        this.ui.toast(TEXTS[this.config.language].toastStalkerSeen);
      },
      onRoomChange: (from, room) => {
        const hops = this.graph ? this.graph.hops(room, this.room.id) : 2;
        const volume = 0.6 / (1 + hops);
        const basement = this.room.audio.ambience === 'basement';
        this.audio.play(basement ? 'door_open_metal' : 'door_open_wood', volume);
        // Deja la puerta entornada; si es de esta sala se ve al momento.
        this.traces.markDoor(from, room, this.clock);
        const other = from === this.room.id ? room : room === this.room.id ? from : null;
        const door = other ? this.room.doors.find((candidate) => candidate.to === other) : null;
        if (door && this.canStandAjar(door)) {
          void this.wait(0.5, (progress) => this.setDoorOpen(door, DOOR_AJAR * easeInOut(progress)));
        }
      },
      onStride: (room, x, z, yaw) => {
        this.traces.addPrint(room, x, z, yaw, this.clock);
      },
      onLure: (approachRoom) => {
        this.playLure(approachRoom);
      },
      onInspect: (hideId) => this.resolveInspect(hideId),
      onFootstep: (x, z, running) => {
        this.audio.playAt('stalker_step', x, z, position.x, position.z, listenerYaw, running ? 1 : 0.8);
      },
      onBreath: (x, z) => {
        this.audio.playAt('breath', x, z, position.x, position.z, listenerYaw, 0.7);
      },
      onHeartbeat: (x, z) => {
        this.audio.playAt('heartbeat', x, z, position.x, position.z, listenerYaw, 0.5);
      },
    };

    for (const stalker of stalkers) {
      stalker.update(dt, sense, hooks);
    }
    this.syncStalkerPresence();
    this.syncSecondStalkerPresence();

    const anyChase = stalkers.some(
      (stalker) => stalker.state === 'chase' || (stalker.state === 'inspect' && stalker.roomId === this.room.id),
    );
    const anySameRoom = stalkers.some((stalker) => stalker.roomId === this.room.id);
    this.setMusicLevel(
      anyChase ? 2 : anySameRoom ? 1 : this.flags.has('stalker_active') ? 1 : 0,
    );
  }

  private configuredHearts(): number {
    const value = this.config.player.hearts;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return DEFAULT_HEARTS;
    }
    return Math.max(1, Math.round(value));
  }

  private resetHearts(): void {
    this.hearts = this.configuredHearts();
    this.heartSlots = this.hearts;
    this.invulnUntil = 0;
    this.ui.showHearts(this.hearts, this.heartSlots);
  }

  // Chipa: +1 corazón. Se puede pasar de los 3 iniciales (hasta MAX_HEARTS);
  // los huecos ganados se quedan dibujados aunque luego te golpeen.
  private eatFood(item: ItemHandle): void {
    const texts = TEXTS[this.config.language];
    item.taken = true;
    this.flags.set(`taken:${item.id}`);
    item.object.removeFromParent();
    this.audio.play('eat');
    if (this.hearts >= MAX_HEARTS) {
      this.ui.toast(texts.toastFoodFull);
      return;
    }
    this.hearts += 1;
    this.heartSlots = Math.max(this.heartSlots, this.hearts);
    this.ui.showHearts(this.hearts, this.heartSlots);
    this.ui.toast(texts.toastFood(this.hearts));
  }

  private takeHit(stalkerX: number, stalkerZ: number): void {
    if (this.state !== 'playing') {
      return;
    }
    if (this.clock < this.invulnUntil) {
      return;
    }
    this.hearts -= 1;
    this.ui.setHearts(this.hearts);
    if (this.hearts <= 0) {
      void this.runCaught();
      return;
    }
    this.invulnUntil = this.clock + (this.config.player.hit_invuln_seconds ?? DEFAULT_HIT_INVULN);
    this.player.knockback(stalkerX, stalkerZ, HIT_KNOCKBACK);
    const nav = this.graph?.room(this.room.id);
    if (nav) {
      this.player.clampInside(nav.halfWidth, nav.halfDepth, this.config.player.radius + 0.12);
    }
    this.ui.flashDamage();
    this.ui.toast(TEXTS[this.config.language].toastHit(this.hearts));
    this.audio.play('hurt', 0.9);
    this.audio.play('stinger', 0.35);
  }

  private async runCaught(): Promise<void> {
    if (this.state !== 'playing') {
      return;
    }
    this.state = 'transition';
    this.ui.hideAll();
    this.ui.setPrompt('');
    this.input.consumeMouseDelta();
    this.audio.play('hurt', 1);
    this.audio.play('stinger', 0.9);
    await this.wait(1.1, (progress) => this.psx.setFade(progress * 0.9));
    await this.wait(0.5, (progress) => this.psx.setFade(0.9 + progress * 0.1));
    this.showGameOver();
  }

  private activeStalkers(): Stalker[] {
    return [this.stalker, this.stalkerSecond].filter(
      (candidate): candidate is Stalker => !!candidate && candidate.active,
    );
  }

  // --- M13: escondites ----------------------------------------------------

  private enterHide(handle: HideHandle): void {
    if (this.hidden) {
      return;
    }
    const position = this.player.position;
    for (const stalker of this.activeStalkers()) {
      stalker.noteHideEntered(handle.spot.id, this.room.id, position.x, position.z);
    }
    this.hidden = handle;
    this.player.enterHide(handle.spot.eyeX, handle.spot.eyeZ, handle.spot.yaw);
    this.lastPlayerX = this.player.position.x;
    this.lastPlayerZ = this.player.position.z;
    this.audio.play('cabinet', 0.8);
    this.animateHide(handle, 0.5, 0);
    const uses = this.stalker?.hideUseCount(handle.spot.id) ?? 0;
    if (uses === (this.config.enemy.hide_check_uses ?? DEFAULT_HIDE_CHECK_USES)) {
      this.ui.toast(TEXTS[this.config.language].toastHideOveruse);
    }
  }

  private exitHide(x?: number, z?: number): void {
    const handle = this.hidden;
    if (!handle) {
      return;
    }
    this.hidden = null;
    this.player.exitHide(x ?? handle.spot.frontX, z ?? handle.spot.frontZ);
    this.lastPlayerX = this.player.position.x;
    this.lastPlayerZ = this.player.position.z;
    this.audio.play('cabinet', 0.8);
    this.animateHide(handle, 0.7, 0);
  }

  // Abre las puertas del escondite hasta `amount`, las mantiene `hold` s y las cierra.
  private animateHide(handle: HideHandle, amount: number, hold: number): void {
    const total = HIDE_DOOR_SECONDS * 2 + hold;
    void this.wait(total, (progress) => {
      const t = progress * total;
      const open =
        t < HIDE_DOOR_SECONDS ? t / HIDE_DOOR_SECONDS : t < HIDE_DOOR_SECONDS + hold ? 1 : 1 - (t - HIDE_DOOR_SECONDS - hold) / HIDE_DOOR_SECONDS;
      setHideOpen(handle, amount * easeInOut(THREE.MathUtils.clamp(open, 0, 1)));
    });
  }

  // El stalker abre un escondite: si estabas dentro te saca de un tirón.
  private resolveInspect(hideId: string): boolean {
    const handle = this.room.hides.find((candidate) => candidate.spot.id === hideId);
    if (!handle) {
      return false;
    }
    const camera = this.player.camera;
    this.audio.playAt('cabinet', handle.spot.x, handle.spot.z, camera.position.x, camera.position.z, camera.rotation.y, 1);
    if (this.hidden !== handle) {
      this.animateHide(handle, 1, INSPECT_OPEN_SECONDS);
      return false;
    }
    const stalker = this.activeStalkers()
      .filter((candidate) => candidate.roomId === this.room.id)
      .sort((a, b) => a.distanceTo(handle.spot.x, handle.spot.z) - b.distanceTo(handle.spot.x, handle.spot.z))[0];
    // Sale por un costado del frente para que el empujón lo aparte del stalker.
    const { spot } = handle;
    const sideX = Math.cos(spot.yaw);
    const sideZ = -Math.sin(spot.yaw);
    const exits = [1, -1]
      .map((sign) => ({ x: spot.frontX + sideX * 0.7 * sign, z: spot.frontZ + sideZ * 0.7 * sign }))
      .filter((point) => !this.pointBlocked(point.x, point.z, this.config.player.radius));
    const exit = exits[0] ?? { x: spot.frontX, z: spot.frontZ };
    this.exitHide(exit.x, exit.z);
    this.animateHide(handle, 1, INSPECT_OPEN_SECONDS);
    this.ui.toast(TEXTS[this.config.language].toastFoundHiding);
    this.takeHit(stalker?.position.x ?? spot.x, stalker?.position.z ?? spot.z);
    return true;
  }

  // --- M13: trampas, ruido, aguante y rastros ------------------------------

  // Señuelo del stalker: portazo o silbido en una puerta que no es la suya.
  private playLure(approachRoom: string | null): void {
    if (this.state !== 'playing') {
      return;
    }
    const doors = this.room.doors.filter((door) => door.to && !door.ending && door.to !== approachRoom);
    const camera = this.player.camera;
    const door = doors[Math.floor(Math.random() * doors.length)];
    if (!door) {
      this.audio.play('whistle', 0.35);
      return;
    }
    const slam = door.leaves.length > 0 && this.canStandAjar(door) && Math.random() < 0.6;
    console.info(`[M13] Señuelo: ${slam ? 'portazo' : 'silbido'} en la puerta a ${door.to} (llega por ${approachRoom ?? '?'})`);
    this.audio.playAt(
      slam ? 'door_slam' : 'whistle',
      door.center.x,
      door.center.z,
      camera.position.x,
      camera.position.z,
      camera.rotation.y,
      slam ? 1 : 0.7,
    );
    if (slam) {
      const start = this.doorOpenAmount(door);
      void this.wait(0.45, (progress) => this.setDoorOpen(door, start + 0.18 * Math.sin(progress * Math.PI)));
    }
  }

  // Quemar un afiche hace ruido: los stalkers cercanos vienen a ver.
  private alertStalkers(x: number, z: number): void {
    const hops = this.config.enemy.burn_noise_hops ?? DEFAULT_BURN_NOISE_HOPS;
    for (const stalker of this.activeStalkers()) {
      stalker.alertNoise(this.room.id, x, z, hops);
    }
  }

  private updateSurvival(dt: number): void {
    if (this.player.isExhausted) {
      this.pantTimer -= dt;
      if (this.pantTimer <= 0) {
        this.audio.play('pant', 0.75);
        this.pantTimer = PANT_INTERVAL;
      }
    } else {
      this.pantTimer = 0;
    }
    let danger = 0;
    if (this.hidden) {
      for (const stalker of this.activeStalkers()) {
        if (stalker.roomId === this.room.id) {
          const distance = stalker.distanceTo(this.hidden.spot.x, this.hidden.spot.z);
          danger = Math.max(danger, 1 - distance / HIDE_DANGER_RADIUS);
        }
      }
      this.hiddenHeartTimer -= dt;
      if (danger > 0 && this.hiddenHeartTimer <= 0) {
        this.audio.play('heartbeat', 0.35 + 0.5 * danger);
        this.hiddenHeartTimer = 1.1 - 0.5 * danger;
      }
    }
    this.ui.setHidden(this.hidden !== null, danger);
    this.ui.setStamina(this.player.staminaLevel, this.player.isExhausted);
  }

  // Los afiches sólo aparecen en el minimapa después de haberlos visto.
  private markSeenPosters(dt: number): void {
    this.seenTimer -= dt;
    if (this.seenTimer > 0 || this.hidden) {
      return;
    }
    this.seenTimer = SEEN_CHECK_INTERVAL;
    const camera = this.player.camera;
    camera.updateMatrixWorld();
    this.seenProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.seenFrustum.setFromProjectionMatrix(this.seenProjection);
    for (const item of this.room.items) {
      if (item.kind !== 'poster' || item.taken || this.flags.has(`seen:${item.id}`)) {
        continue;
      }
      const point = this.aimItemPoint(item);
      if (this.inReach(point, SEEN_RANGE) && this.seenFrustum.containsPoint(point) && this.aimVisible(point, item.object)) {
        this.flags.set(`seen:${item.id}`);
      }
    }
  }

  // Al entrar en una sala: visitas, rastros del stalker y sustos.
  private enterRoomEffects(room: BuiltRoom): void {
    this.roomVisits.set(room.id, (this.roomVisits.get(room.id) ?? 0) + 1);
    this.traces.attach(room);
    for (const door of room.doors) {
      if (door.to && this.canStandAjar(door) && this.traces.doorAjar(room.id, door.to, this.clock)) {
        this.setDoorOpen(door, DOOR_AJAR);
      }
    }
    this.scares.enterRoom(this.scareContext());
  }

  private scareContext(): ScareContext {
    return {
      room: this.room,
      flags: this.flags,
      posters: this.burnedPosters(),
      visits: this.roomVisits.get(this.room.id) ?? 1,
      camera: this.player.camera,
      flashlightOn: this.flashlight.owned && this.flashlight.on,
      flashlightRange: this.config.flashlight.range,
      audio: this.audio,
    };
  }

  debugHides(): Array<{ id: string; x: number; z: number; front: [number, number] }> {
    return this.room.hides.map((hide) => ({
      id: hide.spot.id,
      x: hide.spot.x,
      z: hide.spot.z,
      front: [hide.spot.frontX, hide.spot.frontZ],
    }));
  }

  debugEnterHide(id: string): boolean {
    const handle = this.room.hides.find((hide) => hide.spot.id === id);
    if (!handle) {
      return false;
    }
    this.enterHide(handle);
    return true;
  }

  debugHidden(): string | null {
    return this.hidden?.spot.id ?? null;
  }

  debugStamina(): { level: number; exhausted: boolean } {
    return { level: this.player.staminaLevel, exhausted: this.player.isExhausted };
  }

  debugFootprints(room = this.room.id): number {
    return this.traces.printCount(room);
  }

  debugFlags(prefix = ''): string[] {
    return this.flags.list().filter((flag) => flag.startsWith(prefix));
  }

  debugTeleportStalker(room: string, x: number, z: number, state?: 'patrol' | 'chase' | 'search'): void {
    if (!this.stalker) {
      return;
    }
    this.stalker.teleportTo(room, x, z, 0);
    if (state) {
      this.stalker.forceState(state);
    }
    this.syncStalkerPresence();
  }

  debugLureNow(): void {
    this.stalker?.forceLure();
  }

  debugDoorOpen(to: string): number {
    const door = this.room.doors.find((candidate) => candidate.to === to);
    return door && door.leaves.length > 0 ? this.doorOpenAmount(door) : -1;
  }

  debugSetFlag(flag: string): void {
    this.flags.set(flag);
  }

  // Simula volver a entrar en la sala actual (visitas, rastros y sustos).
  debugReenterRoom(): void {
    this.scares.leaveRoom();
    this.applyRoomState(this.room);
  }

  debugScares(): Array<{ id: string; kind: string; visible: boolean | null }> {
    return this.room.events.map((handle) => ({
      id: handle.def.id,
      kind: handle.def.kind,
      visible: handle.object ? handle.object.visible : null,
    }));
  }

  debugWakeStalker(): void {
    void this.activateStalker(this.room.id);
  }

  debugSendStalkerHere(): void {
    if (!this.stalker) {
      this.debugWakeStalker();
      return;
    }
    const yaw = this.player.camera.rotation.y;
    const colliders = this.room.colliders;
    const offsets = [0, Math.PI / 2, -Math.PI / 2, Math.PI, (Math.PI * 3) / 4, -(Math.PI * 3) / 4];
    for (const offset of offsets) {
      const angle = yaw + offset;
      const x = this.player.position.x - Math.sin(angle) * 2.2;
      const z = this.player.position.z - Math.cos(angle) * 2.2;
      const blocked = colliders.some(
        (collider) =>
          x > collider.minX - 0.4 &&
          x < collider.maxX + 0.4 &&
          z > collider.minZ - 0.4 &&
          z < collider.maxZ + 0.4,
      );
      if (blocked) {
        continue;
      }
      this.stalker.teleportTo(this.room.id, x, z, angle + Math.PI);
      this.syncStalkerPresence();
      return;
    }
    this.stalker.teleportTo(this.room.id, this.player.position.x, this.player.position.z, yaw + Math.PI);
    this.syncStalkerPresence();
  }

  debugScene(): THREE.Scene {
    return this.room.scene;
  }

  debugStalkerObject(): THREE.Object3D | null {
    return this.stalker?.object ?? null;
  }

  debugPlayerX(): number {
    return this.player.position.x;
  }

  debugPlayerZ(): number {
    return this.player.position.z;
  }

  debugItems(): Array<{ id: string; taken: boolean; distance: number; y: number }> {
    return this.room.items.map((item) => ({
      id: item.id,
      taken: item.taken,
      distance: Math.hypot(
        item.position.x - this.player.position.x,
        item.position.z - this.player.position.z,
      ),
      y: item.position.y,
    }));
  }

  debugPressed(): string[] {
    return this.input.debugPressed();
  }

  debugInteract(): void {
    this.tryInteract();
  }

  debugDoors(): Array<{ name: string; cx: number; cz: number; to: string | null }> {
    return this.room.doors.map((door) => ({
      name: door.name,
      cx: door.center.x,
      cz: door.center.z,
      to: door.to,
    }));
  }

  debugPrompt(): string {
    return this.ui.currentPrompt();
  }

  debugRoomId(): string {
    return this.room.id;
  }

  debugLook(yawDegrees: number, pitchDegrees = 0): void {
    this.player.lookAt(yawDegrees, pitchDegrees);
  }

  debugPlaceStalker(distance: number, sideDegrees = 0, state?: 'patrol' | 'chase' | 'search'): void {
    const stalker = this.stalker;
    if (!stalker || !Number.isFinite(distance) || !Number.isFinite(sideDegrees)) {
      return;
    }
    const baseYaw = this.player.camera.rotation.y;
    const distances = [distance, distance * 0.75, distance * 0.55, distance * 0.4];
    const sides = [0, 25, -25, 50, -50];
    for (const side of sides) {
      for (const range of distances) {
        const yaw = baseYaw + THREE.MathUtils.degToRad(side);
        const x = this.player.position.x - Math.sin(yaw) * range;
        const z = this.player.position.z - Math.cos(yaw) * range;
        if (this.pointBlocked(x, z, 0.45)) {
          continue;
        }
        stalker.teleportTo(this.room.id, x, z, yaw + Math.PI);
        if (state) {
          stalker.forceState(state);
        }
        this.syncStalkerPresence();
        return;
      }
    }
  }

  debugRigInfo(): Record<string, unknown> | null {
    const rig = this.stalker?.rigInfo();
    return rig ? { ...rig } : null;
  }

  debugSetStalkerYaw(yawDegrees: number): void {
    if (this.stalker && Number.isFinite(yawDegrees)) {
      this.stalker.setYaw(THREE.MathUtils.degToRad(yawDegrees));
    }
  }

  private pointBlocked(x: number, z: number, margin: number): boolean {
    const nav = this.graph?.room(this.room.id);
    if (nav && (Math.abs(x) > nav.halfWidth - margin || Math.abs(z) > nav.halfDepth - margin)) {
      return true;
    }
    return this.room.colliders.some(
      (collider) =>
        x > collider.minX - margin &&
        x < collider.maxX + margin &&
        z > collider.minZ - margin &&
        z < collider.maxZ + margin,
    );
  }

  debugConfig(): PsxConfig {
    return this.config;
  }

  get debugGraphReady(): boolean {
    return this.graph !== null;
  }

  debugState(): string {
    return this.state;
  }

  debugHearts(): number {
    return this.hearts;
  }

  debugGiveFlashlight(): void {
    this.flashlight.give();
  }

  debugToggleFlashlight(): void {
    this.toggleFlashlight();
  }

  debugFlashlight(): { owned: boolean; on: boolean; intensity: number } {
    return {
      owned: this.flashlight.owned,
      on: this.flashlight.on,
      intensity: this.flashlight.intensity,
    };
  }

  debugTeleport(x: number, z: number, yawDegrees = this.player.camera.rotation.y * (180 / Math.PI)): void {
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      return;
    }
    this.player.position.set(x, 0, z);
    this.player.lookAt(yawDegrees, 0);
    this.lastPlayerX = x;
    this.lastPlayerZ = z;
  }

  debugCameraY(): number {
    return this.player.camera.position.y;
  }

  debugHit(): void {
    const yaw = this.player.camera.rotation.y;
    this.takeHit(
      this.player.position.x + Math.sin(yaw),
      this.player.position.z + Math.cos(yaw),
    );
  }

  debugMusicLevel(): number {
    return this.musicLevel;
  }

  debugMenuScreen(): string | null {
    return this.menu.screen;
  }

  debugStalkerState(): string {
    return this.stalker?.state ?? 'none';
  }

  debugStalkerPosition(): { x: number; z: number; room: string; yaw: number } {
    const stalker = this.stalker;
    if (!stalker) {
      return { x: 0, z: 0, room: '', yaw: 0 };
    }
    return {
      x: stalker.position.x,
      z: stalker.position.z,
      room: stalker.roomId,
      yaw: stalker.yaw,
    };
  }

  async debugStalkerInfo(): Promise<{
    active: boolean;
    roomId: string;
    state: string;
    faceMeshes: number;
    height: number;
    inScene: boolean;
    insideCollider: boolean;
  }> {
    const stalker = this.stalker;
    if (!stalker) {
      return {
        active: false,
        roomId: '',
        state: 'none',
        faceMeshes: 0,
        height: 0,
        inScene: false,
        insideCollider: false,
      };
    }
    stalker.object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(stalker.object);
    let faceMeshes = 0;
    stalker.object.traverse((object) => {
      if (object instanceof THREE.Mesh && object.material === stalker.faceMaterial) {
        faceMeshes += 1;
      }
    });
    return {
      active: stalker.active,
      roomId: stalker.roomId,
      state: stalker.state,
      faceMeshes,
      height: box.max.y - box.min.y,
      inScene: stalker.object.parent === this.room.scene,
      insideCollider: this.debugStalkerInside(),
    };
  }

  debugStalkerInside(): boolean {
    return this.stalker?.overlapsCollider() ?? false;
  }

  debugWakeSecondStalker(): void {
    void this.activateSecondStalker(this.room.id);
  }

  debugSecondStalkerState(): string {
    return this.stalkerSecond?.state ?? 'none';
  }

  debugSecondStalkerPosition(): { x: number; z: number; room: string; yaw: number } {
    const stalker = this.stalkerSecond;
    if (!stalker) {
      return { x: 0, z: 0, room: '', yaw: 0 };
    }
    return {
      x: stalker.position.x,
      z: stalker.position.z,
      room: stalker.roomId,
      yaw: stalker.yaw,
    };
  }

  debugSecondStalkerSpawned(): boolean {
    return this.secondStalkerSpawned;
  }


  // Los controles táctiles solo se muestran en dispositivos táctiles y si el
  // ajuste está activo (se puede desactivar desde OPCIONES > CONTROLES).
  private get touchActive(): boolean {
    return this.input.touchCapable && this.settings.get('touchControls');
  }

  applySettings(changed?: keyof SettingsData | null): void {
    this.settings.applyTo(this.config);
    this.gamepad.setEnabled(this.settings.get('gamepad'));
    this.psx.syncEffects(this.config);
    this.room?.sync(this.config);
    this.traces.sync();
    this.audio.setVolumes(this.config.audio);
    this.ui.setOptions({
      showSubtitles: this.settings.get('subtitles'),
      touchControls: this.touchActive,
    });
    this.touch.setEnabled(this.touchActive);
    if (changed === 'language') {
      this.menu.onLanguageChanged();
      this.touch.refreshLabels();
    }
  }

  get gameOver(): () => void {
    return () => this.showGameOver();
  }

  syncConfig(): void {
    this.room.sync(this.config);
    this.traces.sync();
    this.stalker?.syncConfig(this.config);
    this.stalker?.setBurnedPosters(this.burnedPosters());
    this.stalkerSecond?.syncConfig(this.config);
    this.stalkerSecond?.setBurnedPosters(this.burnedPosters());
    this.psx.syncEffects(this.config);
    this.audio.setVolumes(this.config.audio);
    this.audio.setMuted(!this.config.audio.enabled);
  }

  private openMenu(screen: MenuScreen | null): void {
    if (screen) {
      this.menu.open(screen);
    } else {
      this.menu.close();
    }
    if (this.menu.active) {
      this.ui.hideAll();
      this.ui.setPrompt('');
      this.input.unlock();
    }
  }

  private resumeGame(): void {
    this.openMenu(null);
    this.input.lock();
  }

  private async restartRun(): Promise<void> {
    await this.resetRun();
    this.openMenu(null);
    this.input.lock();
  }

  private async resetRun(): Promise<void> {
    this.state = 'playing';
    this.ui.hideAll();
    this.ui.setPrompt('');
    this.psx.setFade(0);
    this.flags.clear();
    for (let index = 0; index < this.inventory.slots.length; index += 1) {
      this.inventory.slots[index] = null;
    }
    this.flashlight.reset();
    this.hidden = null;
    this.pantTimer = 0;
    this.traces.reset();
    this.scares.reset();
    this.roomVisits.clear();
    this.deactivateStalker();
    this.secondStalkerSpawned = false;
    this.stalkerSecondLoading = false;
    this.roomCache.clear();
    this.room = await this.getRoom(this.introRoom);
    this.player = this.createPlayer(this.room, this.introSpawn, false);
    this.lastPlayerX = this.player.position.x;
    this.lastPlayerZ = this.player.position.z;
    this.applyRoomState(this.room);
    this.audio.setRoom(this.room.audio);
    this.resetHearts();
    this.updatePosterHud();
    this.flags.set('stalker_active');
    void this.activateStalker();
    this.beginIntro();
  }

  private showGameOver(): void {
    if (this.menu.screen === 'gameover' || this.menu.screen === 'ending') {
      return;
    }
    this.state = 'playing';
    this.ui.hideAll();
    this.openMenu('gameover');
  }

  private handleMenuInput(dt: number): void {
    const pausePressed =
      this.menu.active === false &&
      this.state === 'playing' &&
      (this.input.consumePress('Escape') || this.input.padPress('pause'));
    if (pausePressed) {
      this.openMenu('pause');
    }
    this.menu.update(dt);
  }

  private update(dt: number): void {
    this.clock += dt;
    this.gamepad.poll(dt);
    this.touch.sync();
    this.handleMenuInput(dt);
    this.flashlight.update(dt, this.player.camera, true);
    updateSceneLights(dt);
    if (this.menu.active) {
      this.ui.update(dt);
      this.flushWaiters(dt);
      return;
    }
    this.ui.update(dt);
    this.flushWaiters(dt);

    switch (this.state) {
      case 'playing':
        this.player.update(dt, this.config, this.input);
        this.updateStalker(dt);
        this.traces.update(this.clock);
        this.scares.update(dt, this.scareContext());
        this.markSeenPosters(dt);
        this.updateSurvival(dt);
        this.preloadNearbyDoors();
        if (this.input.consumePress('KeyF') || this.input.padPress('combine')) {
          this.toggleFlashlight();
        }
        if (this.input.consumePress('KeyE') || this.input.padPress('interact')) {
          if (this.hidden) {
            this.exitHide();
          } else {
            this.tryInteract();
          }
        }
        if (this.state === 'playing') {
          this.updatePrompt();
        }
        break;
      case 'transition':
        this.input.consumeMouseDelta();
        break;
      case 'reading':
        this.handleReading();
        break;
      case 'ending':
        break;
    }
  }

  private render(): void {
    this.psx.setShadowCaster(this.flashlight.shadowCaster());
    this.psx.render(this.room.scene, this.player.camera);
    this.ui.draw(this.state === 'playing' && !this.menu.active && !this.hidden
      ? { room: this.room, player: this.player, flags: this.flags }
      : undefined);
    if (this.menu.active) {
      this.menu.draw();
    }
    this.uiCanvas.end();
  }

  private press(code: string, action: PadAction): boolean {
    return this.input.consumePress(code) || this.input.padPress(action);
  }

  private createPlayer(room: BuiltRoom, spawnName: string, inherit = true): Player {
    const spawn = room.spawns[spawnName] ?? room.spawns.start ?? Object.values(room.spawns)[0];
    if (!spawn) {
      throw new Error(`La sala ${room.id} no tiene ningún spawn`);
    }
    const [resWidth, resHeight] = this.config.resolution;
    const player = new Player(
      this.config,
      room.colliders,
      { x: spawn.position[0], z: spawn.position[1], yaw: spawn.yaw },
      resWidth / resHeight,
    );
    player.camera.fov = this.fovFor(resHeight > resWidth);
    player.camera.updateProjectionMatrix();
    if (inherit && this.player) {
      player.inheritStamina(this.player);
    }
    player.onFootstep = (running) => {
      this.audio.footstep(running);
    };
    return player;
  }

  private getRoom(id: string): Promise<BuiltRoom> {
    const cached = this.roomCache.get(id);
    if (cached) {
      return cached;
    }
    const promise = loadRoomData(id)
      .then((data) => buildRoom(data, this.config, this.catalog))
      .catch((error: unknown) => {
        this.roomCache.delete(id);
        throw error;
      });
    this.roomCache.set(id, promise);
    return promise;
  }

  private applyRoomState(room: BuiltRoom): void {
    setSceneLights(room.lights);
    this.syncEndingLocks(room);
    for (const door of room.doors) {
      if (door.lock && this.flags.has(`unlocked:${door.lockId}`) && door.lock.body.parent !== room.scene) {
        door.lock.body.visible = false;
      }
    }
    for (const door of room.doors) {
      this.closeDoor(room, door);
    }
    for (const item of room.items) {
      if (this.flags.has(`taken:${item.id}`) || this.flags.has(`burned:${item.id}`)) {
        item.taken = true;
        item.object.removeFromParent();
      }
    }
    this.enterRoomEffects(room);
  }

  private syncEndingLocks(room: BuiltRoom): void {
    for (const door of room.doors) {
      if (door.posterLock) {
        door.posterLock.visible = !door.requires.every((id) => this.flags.has(`burned:${id}`));
      }
    }
  }

  private nearestInteractable(): Interactable | null {
    let best: Interactable | null = null;
    let bestScore = Infinity;
    const radius = this.config.player.interact_radius;
    const texts = TEXTS[this.config.language];

    for (const item of this.room.items) {
      if (item.taken || !this.inReach(item.position, radius)) {
        continue;
      }
      const point = this.aimItemPoint(item);
      const score = this.facingScore(point, false);
      if (score === null || score >= bestScore || !this.aimVisible(point, item.object)) {
        continue;
      }
      bestScore = score;
      const def = this.catalog.get(item.id);
      let label = texts.promptPickKey;
      if (def?.kind === 'poster') {
        label = texts.promptBurnPoster;
      } else if (def?.kind === 'tool') {
        label = texts.promptPickTool(itemName(def, this.config.language));
      } else if (def?.kind === 'lore') {
        label = texts.promptExamine;
      } else if (def?.kind === 'food') {
        label = texts.promptEat;
      }
      best = { door: null, item, hide: null, label };
    }

    for (const door of this.room.doors) {
      if (!this.inReach(door.center, radius)) {
        continue;
      }
      const point = this.doorAimPoint(door);
      const score = this.facingScore(point, true);
      if (score === null || score >= bestScore || !this.aimVisible(point, door.group)) {
        continue;
      }
      bestScore = score;
      best = { door, item: null, hide: null, label: this.doorPrompt(door) };
    }

    for (const hide of this.room.hides) {
      const point = this.aimHide.set(hide.spot.x, Math.min(1.2, hide.spot.height - 0.3), hide.spot.z);
      if (!this.inReach(point, radius + hide.spot.depth / 2)) {
        continue;
      }
      const score = this.facingScore(point, true);
      if (score === null || score >= bestScore || !this.aimVisible(point, hide.group)) {
        continue;
      }
      bestScore = score;
      best = { door: null, item: null, hide, label: texts.promptHide };
    }

    return best;
  }

  private doorAimPoint(door: DoorHandle): THREE.Vector3 {
    const point = this.aimDoorPoint.copy(door.aimPoint);
    point.y = Math.min(this.config.player.eye_height, Math.max(0.2, door.height - 0.15));
    return point;
  }

  private aimItemPoint(item: ItemHandle): THREE.Vector3 {
    return this.aimItem.copy(item.position).setY(item.position.y + AIM_ITEM_LIFT);
  }

  private inReach(point: THREE.Vector3, radius: number): boolean {
    return Math.hypot(point.x - this.player.position.x, point.z - this.player.position.z) < radius;
  }

  private facingScore(point: THREE.Vector3, horizontal: boolean): number | null {
    const camera = this.player.camera;
    camera.updateMatrixWorld();
    camera.getWorldDirection(this.aimForward);
    const limit = Math.cos(THREE.MathUtils.degToRad(this.config.player.interact_fov_deg ?? AIM_FOV_FALLBACK));
    const direction = this.aimOffset.copy(point).sub(camera.position);
    if (!horizontal) {
      const distance = direction.length();
      if (distance <= AIM_OCCLUSION_MARGIN) {
        return 0;
      }
      const cos = direction.divideScalar(distance).dot(this.aimForward);
      return cos < limit ? null : Math.acos(THREE.MathUtils.clamp(cos, -1, 1));
    }
    const view = this.aimFlatView.set(this.aimForward.x, 0, this.aimForward.z);
    const viewLength = view.length();
    const flat = this.aimFlat.set(direction.x, 0, direction.z);
    const flatLength = flat.length();
    if (flatLength <= AIM_OCCLUSION_MARGIN || viewLength < AIM_FLAT_VIEW_EPS) {
      return null;
    }
    const cos = flat.divideScalar(flatLength).dot(view.divideScalar(viewLength));
    return cos < limit ? null : Math.acos(THREE.MathUtils.clamp(cos, -1, 1));
  }

  private aimVisible(point: THREE.Vector3, self: THREE.Object3D | null): boolean {
    const camera = this.player.camera;
    const direction = this.aimOffset.copy(point).sub(camera.position);
    const distance = direction.length();
    if (distance <= AIM_OCCLUSION_MARGIN) {
      return true;
    }
    this.aimRaycaster.set(camera.position, direction.divideScalar(distance));
    this.aimRaycaster.near = 0;
    this.aimRaycaster.far = distance - AIM_OCCLUSION_MARGIN;
    for (const hit of this.aimRaycaster.intersectObjects(this.room.scene.children, true)) {
      if (!self || !withinObject(hit.object, self)) {
        return false;
      }
    }
    return true;
  }

  private doorPrompt(door: DoorHandle): string {
    const texts = TEXTS[this.config.language];
    if (door.ending) {
      const have = door.requires.filter((id) => this.flags.has(`burned:${id}`)).length;
      return have >= door.requires.length
        ? texts.promptEndingReady
        : texts.promptEndingLocked(have, door.requires.length);
    }
    if (door.key && !this.flags.has(`unlocked:${door.lockId}`)) {
      return this.inventory.has(door.key) ? texts.promptUnlock : texts.promptPadlock;
    }
    if (door.key && this.clock < (this.unlockReadyAt.get(door.lockId) ?? 0)) {
      return '';
    }
    if (door.action === 'up') {
      return texts.promptUp;
    }
    if (door.action === 'down') {
      return texts.promptDown;
    }
    if (!door.to) {
      return texts.promptClosed;
    }
    return texts.promptOpen;
  }

  private preloadNearbyDoors(): void {
    for (const door of this.room.doors) {
      if (!door.to || this.roomCache.has(door.to)) {
        continue;
      }
      const distance = Math.hypot(
        door.center.x - this.player.position.x,
        door.center.z - this.player.position.z,
      );
      if (distance < this.config.loading.preload_radius) {
        this.getRoom(door.to).catch((error: unknown) => {
          console.error(`[M3] Error precargando ${door.to}`, error);
        });
      }
    }
  }

  private tryInteract(): void {
    const target = this.nearestInteractable();
    if (!target) {
      return;
    }
    if (target.hide) {
      this.enterHide(target.hide);
      return;
    }
    if (target.item) {
      const def = this.catalog.get(target.item.id);
      if (def?.kind === 'poster') {
        void this.burnPoster(target.item);
      } else if (def?.kind === 'food') {
        this.eatFood(target.item);
      } else if (def?.kind === 'lore') {
        this.readLore(target.item);
      } else {
        this.pickUpItem(target.item);
      }
      return;
    }
    const door = target.door;
    if (!door) {
      return;
    }
    if (door.key && !this.flags.has(`unlocked:${door.lockId}`)) {
      if (!this.inventory.has(door.key)) {
        this.audio.play('door_locked', 0.85);
        const keyDef = this.catalog.get(door.key);
        if (keyDef) {
          this.ui.toast(TEXTS[this.config.language].toastNeedKey(itemName(keyDef, this.config.language).toUpperCase()));
        }
        return;
      }
      if (!this.unlocking) {
        void this.runUnlock(door);
      }
      return;
    }
    if (door.key && this.clock < (this.unlockReadyAt.get(door.lockId) ?? 0)) {
      return;
    }
    if (door.ending) {
      if (!door.requires.every((id) => this.flags.has(`burned:${id}`))) {
        this.audio.play('door_locked', 0.9);
        this.ui.toast(TEXTS[this.config.language].endingDoorHint);
        return;
      }
      void this.runEnding(door);
      return;
    }
    if (!door.to) {
      return;
    }
    void this.runDoorTransition(door);
  }

  // Abrir el candado con la llave: giro, salta el grillete y el candado cae
  // al suelo. La puerta se puede abrir tras una breve pausa.
  private async runUnlock(door: DoorHandle): Promise<void> {
    this.unlocking = true;
    const room = this.room;
    this.audio.play('padlock_unlock');
    const lock = door.lock;
    if (lock) {
      await this.wait(0.45, (progress) => {
        lock.body.rotation.z = Math.sin(progress * Math.PI * 4) * 0.14 * (1 - progress);
      });
      await this.wait(0.2, (progress) => {
        lock.shackle.position.y = 0.014 * easeInOut(progress);
        lock.body.rotation.z = -0.25 * progress;
      });
      room.scene.attach(lock.body);
      const start = lock.body.position.clone();
      const startRotX = lock.body.rotation.x;
      const away = new THREE.Vector3(this.player.position.x - door.center.x, 0, this.player.position.z - door.center.z);
      if (away.lengthSq() > 1e-6) {
        away.normalize().multiplyScalar(0.22);
      }
      const floorY = 0.075;
      await this.wait(0.45, (progress) => {
        const fall = progress * progress;
        lock.body.position.set(start.x + away.x * progress, start.y + (floorY - start.y) * fall, start.z + away.z * progress);
        lock.body.rotation.x = startRotX + progress * 1.57;
      });
    } else {
      await this.wait(0.9);
    }
    this.flags.set(`unlocked:${door.lockId}`);
    this.unlockReadyAt.set(door.lockId, this.clock + 0.8);
    this.ui.toast(TEXTS[this.config.language].toastUnlocked);
    this.unlocking = false;
  }

  private async burnPoster(item: ItemHandle): Promise<void> {
    const texts = TEXTS[this.config.language];
    item.taken = true;
    this.audio.play('burn');
    this.alertStalkers(item.position.x, item.position.z);

    const mesh = item.object.children[0] as THREE.Mesh;
    const brightness = this.room.audio.ambience === 'basement' ? 0.45 : 0.85;
    const burnScene = this.room.scene;
    const fx = new PosterBurn(burnScene, mesh, loadPosterTexture(), brightness);
    let previous = 0;
    await this.wait(BURN_SECONDS, (progress) => {
      const dt = Math.max(0, (progress - previous) * BURN_SECONDS);
      previous = progress;
      fx.update(dt, progress, this.room.scene === burnScene);
    });
    fx.update(0, 1, this.room.scene === burnScene);
    fx.leaveScorch();
    item.object.removeFromParent();
    this.flags.set(`burned:${item.id}`);
    this.syncEndingLocks(this.room);
    // El humo y la ceniza siguen un rato sin bloquear al jugador.
    let tailPrevious = 0;
    void this.wait(3, (progress) => {
      const dt = Math.max(0, (progress - tailPrevious) * 3);
      tailPrevious = progress;
      fx.update(dt, 1, false);
    }).then(() => fx.dispose());

    const have = this.burnedPosters();
    this.stalker?.setBurnedPosters(have);
    this.stalkerSecond?.setBurnedPosters(have);
    this.ui.toast(texts.toastPoster(have, POSTER_IDS.length));
    this.updatePosterHud();
    // Al completar todos los afiches desaparece el candado y aparece el guardián.
    if (have >= POSTER_IDS.length) {
      this.audio.play('padlock_unlock', 0.8);
      void this.activateSecondStalker();
    }
  }

  private updatePosterHud(): void {
    this.ui.setPosterCount(this.burnedPosters(), POSTER_IDS.length);
  }

  // Aviso inicial: recuerda el objetivo de la partida (quemar los 8 afiches).
  private showIntroObjective(): void {
    this.ui.toast(TEXTS[this.config.language].introObjective, INTRO_OBJECTIVE_SECONDS);
  }

  private beginIntro(): void {
    if (this.wakeEnabled) {
      void this.runWakeUp();
    } else {
      this.showIntroObjective();
    }
  }

  // El jugador despierta tumbado en el suelo: la cámara sube desde la altura
  // del suelo hasta los ojos mientras el negro y el desenfoque se disipan.
  // Se ejecuta al arrancar y al reiniciar la partida.
  private async runWakeUp(): Promise<void> {
    this.state = 'transition';
    this.ui.hideAll();
    this.ui.setPrompt('');
    this.input.consumeMouseDelta();
    this.psx.setFade(1);
    this.psx.setBlur(1);
    this.player.setWakeAmount(1);
    await this.wait(WAKE_SECONDS, (progress) => {
      this.player.setWakeAmount(1 - easeInOut(progress));
      this.psx.setBlur(Math.pow(1 - progress, 1.7));
      this.psx.setFade(Math.max(0, 1 - progress * 3.2));
    });
    this.player.setWakeAmount(0);
    this.psx.setBlur(0);
    this.psx.setFade(0);
    this.state = 'playing';
    this.showIntroObjective();
  }

  private burnedPosters(): number {
    return POSTER_IDS.filter((id) => this.flags.has(`burned:${id}`)).length;
  }

  private pickUpItem(item: ItemHandle): void {
    const def = this.catalog.get(item.id);
    if (!def) {
      return;
    }
    const texts = TEXTS[this.config.language];
    if (!this.inventory.add(item.id)) {
      this.ui.toast(texts.inventoryFull);
      return;
    }

    item.taken = true;
    this.flags.set(`taken:${item.id}`);
    item.object.removeFromParent();
    this.audio.play('pickup_key');

    if (def.kind === 'tool') {
      this.flashlight.give();
      this.ui.toast(texts.toastFlashlight);
    } else {
      this.ui.toast(texts.toastKey(itemName(def, this.config.language)));
    }
  }

  // Examinable fijo (placa de la escalera): muestra el texto en pantalla sin
  // recogerlo. Se puede releer; solo marca `read:<id>`.
  private readLore(item: ItemHandle): void {
    const def = this.catalog.get(item.id);
    if (!def) {
      return;
    }
    this.flags.set(`read:${item.id}`);
    this.audio.play('pickup_note');
    this.ui.setPrompt('');
    this.ui.showNote(
      itemTitle(def, this.config.language),
      itemText(def, this.config.language),
    );
    this.input.clearPending();
    this.state = 'reading';
  }

  private handleReading(): void {
    if (this.press('KeyE', 'interact') || this.press('Enter', 'confirm')) {
      if (!this.ui.noteComplete) {
        this.ui.revealNote();
        return;
      }
      this.closeReading();
      return;
    }
    if (this.press('Escape', 'cancel')) {
      this.closeReading();
    }
  }

  private closeReading(): void {
    this.ui.hideNote();
    this.state = 'playing';
    this.input.clearPending();
  }

  private toggleFlashlight(): void {
    if (!this.flashlight.toggle()) {
      return;
    }
    this.audio.play('flash_click', 0.7);
  }

  private async runDoorTransition(door: DoorHandle): Promise<void> {
    const target = door.to;
    if (!target) {
      return;
    }

    this.state = 'transition';
    this.ui.setPrompt('');
    this.removeDoorCollider(door);
    this.audio.play(this.room.audio.ambience === 'basement' ? 'door_open_metal' : 'door_open_wood');
    this.transitionStart = performance.now();
    this.traces.clearDoor(this.room.id, target);
    this.scares.leaveRoom();
    for (const stalker of [this.stalker, this.stalkerSecond]) {
      stalker?.notePlayerDoor(this.room.id, target, door.center.x, door.center.z);
    }

    const { authentic, door_anim_seconds, fade_seconds, min_seconds } = this.config.loading;
    const doorDuration = authentic ? door_anim_seconds : 0.4;
    const fadeDuration = authentic ? fade_seconds : 0.15;
    const minTotal = authentic ? min_seconds : 0;

    const roomPromise = this.getRoom(target);
    const previousRoom = this.room.id;

    // Parte de la apertura actual: una puerta entornada no se cierra de golpe antes de abrirse.
    const start = this.doorOpenAmount(door);
    if (door.leaves.length > 0) {
      await this.wait(doorDuration, (progress) => {
        this.setDoorOpen(door, start + (1 - start) * easeInOut(progress));
      });
    }
    await this.wait(fadeDuration, (progress) => {
      this.psx.setFade(progress);
    });

    const elapsed = (performance.now() - this.transitionStart) / 1000;
    const remainingMin = Math.max(0, minTotal - elapsed);

    let nextRoom: BuiltRoom;
    try {
      [nextRoom] = await Promise.all([roomPromise, this.wait(remainingMin)]);
    } catch (error) {
      console.error(`[M3] Error cargando la sala ${target}`, error);
      this.psx.setFade(0);
      this.state = 'playing';
      return;
    }

    nextRoom.sync(this.config);
    this.room = nextRoom;
    this.player = this.createPlayer(nextRoom, door.spawn ?? 'start');
    this.lastPlayerX = this.player.position.x;
    this.lastPlayerZ = this.player.position.z;
    this.applyRoomState(nextRoom);
    this.syncStalkerPresence();
    this.syncSecondStalkerPresence();
    this.closeArrivalDoor(previousRoom, nextRoom);

    await this.wait(fadeDuration, (progress) => this.psx.setFade(1 - progress));
    this.audio.play(
      nextRoom.audio.ambience === 'basement' ? 'door_close_metal' : 'door_close_wood',
      0.45,
    );
    this.state = 'playing';
  }

  // La puerta de la sala destino por la que acabas de entrar aparece abierta
  // y se cierra sola a tu espalda (antes quedaba cerrada de golpe).
  private closeArrivalDoor(previousRoom: string, room: BuiltRoom): void {
    let chosen: DoorHandle | null = null;
    let bestDistance = Infinity;
    for (const door of room.doors) {
      if (!door.group || door.to !== previousRoom) {
        continue;
      }
      const distance = Math.hypot(
        door.center.x - this.player.position.x,
        door.center.z - this.player.position.z,
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        chosen = door;
      }
    }
    const group = chosen?.group;
    if (!chosen || !group) {
      return;
    }
    this.setDoorOpen(chosen, 1);
    void this.wait(ARRIVAL_DOOR_SECONDS, (progress) => {
      this.setDoorOpen(chosen, 1 - easeInOut(progress));
    });
    void this.wait(ARRIVAL_DOOR_SECONDS + 0.05, () => {
      this.audio.play(
        room.audio.ambience === 'basement' ? 'door_close_metal' : 'door_close_wood',
        0.3,
      );
    });
  }

  private async runEnding(door: DoorHandle): Promise<void> {
    this.state = 'transition';
    this.ui.setPrompt('');
    this.removeDoorCollider(door);
    this.audio.play('door_open_wood');

    await this.wait(1.6, (progress) => {
      this.setDoorOpen(door, easeInOut(Math.min(1, progress * 1.4)));
      this.psx.setFade(progress * 0.55);
    });
    await this.wait(1.0, (progress) => this.psx.setFade(0.55 + progress * 0.45));

    this.showEnding();
  }

  private showEnding(): void {
    this.psx.setFade(1);
    this.audio.play('ending_stinger');
    this.state = 'ending';
    this.openMenu('ending');
  }

  private removeDoorCollider(door: DoorHandle): void {
    if (!door.collider) {
      return;
    }
    const index = this.room.colliders.indexOf(door.collider);
    if (index >= 0) {
      this.room.colliders.splice(index, 1);
    }
  }

  // Aplica el grado de apertura (0 cerrada, 1 abierta) a todas las hojas. En
  // puertas dobles cada hoja gira sobre su jamba y el hueco se abre por el centro.
  private setDoorOpen(door: DoorHandle, progress: number): void {
    for (const leaf of door.leaves) {
      leaf.group.rotation.y = leaf.baseRotation + leaf.openAngle * progress;
    }
  }

  // Una puerta con candado sin abrir (o la salida) sigue cerrada aunque el stalker la cruce.
  private canStandAjar(door: DoorHandle): boolean {
    return !door.ending && (!door.key || this.flags.has(`unlocked:${door.lockId}`));
  }

  // Grado de apertura actual (0 cerrada, 1 abierta), inverso de setDoorOpen.
  private doorOpenAmount(door: DoorHandle): number {
    const leaf = door.leaves[0];
    return leaf ? THREE.MathUtils.clamp((leaf.group.rotation.y - leaf.baseRotation) / leaf.openAngle, 0, 1) : 0;
  }

  private closeDoor(room: BuiltRoom, door: DoorHandle): void {
    this.setDoorOpen(door, 0);
    if (door.collider && !room.colliders.includes(door.collider)) {
      room.colliders.push(door.collider);
    }
  }

  private wait(seconds: number, onTick?: (progress: number) => void): Promise<void> {
    if (seconds <= 0) {
      onTick?.(1);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiters.push({ remaining: seconds, total: seconds, onTick, resolve });
    });
  }

  private flushWaiters(dt: number): void {
    for (let i = this.waiters.length - 1; i >= 0; i -= 1) {
      const waiter = this.waiters[i];
      waiter.remaining -= dt;
      const progress = THREE.MathUtils.clamp(1 - waiter.remaining / waiter.total, 0, 1);
      waiter.onTick?.(progress);
      if (waiter.remaining <= 0) {
        this.waiters.splice(i, 1);
        waiter.resolve();
      }
    }
  }

  private updatePrompt(): void {
    const texts = TEXTS[this.config.language];
    let text = '';
    if (this.hidden) {
      this.ui.setPrompt(this.touchActive ? this.touchPrompt(texts.promptLeaveHide) : texts.promptLeaveHide);
      return;
    }
    if (this.touchActive) {
      if (!this.input.touchPlayed) {
        text = texts.touchToPlay;
      } else {
        const target = this.nearestInteractable();
        text = target ? this.touchPrompt(target.label) : '';
      }
    } else if (this.input.lastSource === 'gamepad') {
      const target = this.nearestInteractable();
      text = target ? target.label : '';
    } else if (!this.input.locked) {
      text = texts.clickToPlay;
    } else {
      const target = this.nearestInteractable();
      text = target ? target.label : '';
    }
    this.ui.setPrompt(text);
  }

  // Los rótulos de mundo usan "E — ..."; en táctil la acción es el botón USAR.
  private touchPrompt(label: string): string {
    if (!label.startsWith('E — ')) {
      return label;
    }
    return `${TEXTS[this.config.language].touchUse} — ${label.slice(4)}`;
  }
}

function easeInOut(t: number): number {
  return t * t * (3 - 2 * t);
}

function withinObject(object: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (node === root) {
      return true;
    }
  }
  return false;
}
