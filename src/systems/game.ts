import * as THREE from 'three';
import type { PsxConfig } from './config';
import { PsxRenderer } from './psxRenderer';
import { FixedLoop } from './loop';
import { Input } from './input';
import { buildRoom, loadRoomData, type BuiltRoom, type DoorHandle, type ItemHandle } from './roomBuilder';
import { Flags } from './flags';
import { INVENTORY_SLOT_COUNT, Inventory } from './inventory';
import { TEXTS } from './i18n';
import {
  NOTE_IDS,
  itemDesc,
  itemName,
  itemText,
  itemTitle,
  loadItemCatalog,
  type ItemDef,
} from './items';
import { Ui } from './ui';
import { UiCanvas } from './uiCanvas';
import { createBitmapFont } from './font';
import { Menu, type MenuScreen } from './menu';
import { Settings, type SettingsData } from './settings';
import { Gamepad, type PadAction } from './gamepad';
import { AudioSystem } from './audio';
import { Flashlight } from './flashlight';
import { RoomGraph } from './roomGraph';
import { Stalker, type StalkerHooks, type StalkerSense } from '../entities/stalker';
import { Player } from '../entities/player';

const GRID_COLUMNS = 4;
const DEFAULT_HEARTS = 3;
const DEFAULT_HIT_INVULN = 2.5;
const HIT_KNOCKBACK = 1.0;
const CLIMB_LIFT = 2.2;
const CLIMB_STEPS = 6;
const ARRIVAL_DOOR_SECONDS = 0.9;
const AIM_OCCLUSION_MARGIN = 0.15;
const AIM_ITEM_LIFT = 0.12;
const AIM_FLAT_VIEW_EPS = 0.08;
const AIM_FOV_FALLBACK = 32;

type State = 'playing' | 'transition' | 'reading' | 'inventory' | 'examine' | 'ending';

interface Waiter {
  remaining: number;
  total: number;
  onTick?: (progress: number) => void;
  resolve: () => void;
}

interface Interactable {
  door: DoorHandle | null;
  item: ItemHandle | null;
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
  private readonly models = new Map<string, THREE.Object3D>();
  private readonly ui: Ui;
  private readonly uiCanvas: UiCanvas;
  private readonly settings: Settings;
  private readonly gamepad: Gamepad;
  private readonly menu: Menu;
  private readonly introRoom: string;
  private readonly introSpawn: string;
  readonly audio: AudioSystem;
  private catalog = new Map<string, ItemDef>();
  private transitionStart = 0;
  private inventorySelection = 0;
  private readReturn: State = 'playing';
  private examineObject: THREE.Object3D | null = null;
  private readonly examineScene = new THREE.Scene();
  private readonly examineYawGroup = new THREE.Group();
  private readonly examinePitchGroup = new THREE.Group();
  private readonly examineCamera: THREE.PerspectiveCamera;
  private examineYaw = 0;
  private examinePitch = 0;
  private graph: RoomGraph | null = null;
  private graphPromise: Promise<RoomGraph> | null = null;
  private stalker: Stalker | null = null;
  private stalkerLoading = false;
  private stalkerRoom: string | null = null;
  private readonly flashlight: Flashlight;
  private musicLevel: 0 | 1 | 2 = 0;
  private lastPlayerX = 0;
  private lastPlayerZ = 0;
  private hearts = DEFAULT_HEARTS;
  private invulnUntil = 0;
  private clock = 0;
  private readonly aimRaycaster = new THREE.Raycaster();
  private readonly aimOffset = new THREE.Vector3();
  private readonly aimForward = new THREE.Vector3();
  private readonly aimFlat = new THREE.Vector3();
  private readonly aimFlatView = new THREE.Vector3();
  private readonly aimDoorPoint = new THREE.Vector3();
  private readonly aimItem = new THREE.Vector3();

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

    this.uiCanvas = new UiCanvas(createBitmapFont(), () => ({
      x: this.psx.viewport.x,
      y: this.psx.viewport.y,
      width: this.psx.viewport.z,
      height: this.psx.viewport.w,
      canvasWidth: this.psx.canvasWidth,
      canvasHeight: this.psx.canvasHeight,
    }));
    this.ui = new Ui(this.uiCanvas, () => this.config.language);
    this.ui.setOptions({ showSubtitles: this.settings.get('subtitles') });
    this.menu = new Menu(this.uiCanvas, this.input, this.settings, this.config, {
      resumeGame: () => this.resumeGame(),
      restartGame: () => {
        void this.restartRun();
      },
    });
    this.settings.onChange((event) => {
      this.applySettings(event.key);
    });

    this.audio = new AudioSystem(config.audio);
    this.flashlight = new Flashlight(config);
    this.loop = new FixedLoop(
      config.fps,
      (dt) => this.update(dt),
      () => this.render(),
    );

    const [resWidth, resHeight] = config.resolution;
    this.examineCamera = new THREE.PerspectiveCamera(40, resWidth / resHeight, 0.01, 5);
    this.examineCamera.position.set(0, 0.14, 0.78);
    this.examineCamera.lookAt(0, 0, 0);
    this.examineYawGroup.add(this.examinePitchGroup);
    this.examineScene.add(this.examineYawGroup);
  }

  async start(): Promise<void> {
    this.catalog = await loadItemCatalog();
    this.room = await this.getRoom(this.introRoom);
    this.player = this.createPlayer(this.room, this.introSpawn);
    this.applyRoomState(this.room);
    this.audio.setRoom(this.room.audio);
    this.resetHearts();
    this.loop.start();
    this.lastPlayerX = this.player.position.x;
    this.lastPlayerZ = this.player.position.z;
    this.openMenu(null);
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
    if (params.get('flashlight') === '1') {
      this.flashlight.give();
      this.flashlight.on = true;
      this.flashlight.update(0, this.player.camera, true);
    }
    console.info(
      `[M3] ${this.config.title} | sala "${this.room.name}" | tris: ${this.room.triangleCount} | colisiones: ${this.room.colliders.length} | puertas: ${this.room.doors.length} | ítems: ${this.room.items.length}`,
    );
    console.info('[M3] Click para capturar el ratón. E interactuar · I inventario.');
    console.info('[M6] Audio procedural activo: pasos, ambiente, reverb por sala y música reactiva.');
    console.info('[M7] Pausa y opciones con teclado y mando. ESC pausa.');
    console.info('[M5] QA: ?stalker=1&stalkerroom=<id> despierta a Hugui en esa sala.');
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
    this.setMusicLevel(0);
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

  private setMusicLevel(level: 0 | 1 | 2): void {
    if (this.musicLevel === level) {
      return;
    }
    this.musicLevel = level;
    this.audio.setMusicIntensity(level);
  }

  private updateStalker(dt: number): void {
    const stalker = this.stalker;
    if (!stalker || !stalker.active) {
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
      onRoomChange: (room) => {
        const hops = this.graph ? this.graph.hops(room, this.room.id) : 2;
        const volume = 0.6 / (1 + hops);
        const basement = this.room.audio.ambience === 'basement';
        this.audio.play(basement ? 'door_open_metal' : 'door_open_wood', volume);
      },
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

    stalker.update(dt, sense, hooks);
    this.syncStalkerPresence();

    const sameRoom = stalker.roomId === this.room.id;
    this.setMusicLevel(
      stalker.state === 'chase' ? 2 : sameRoom ? 1 : this.flags.has('stalker_active') ? 1 : 0,
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
    this.invulnUntil = 0;
    this.ui.showHearts(this.hearts, this.hearts);
  }

  private takeHit(stalkerX: number, stalkerZ: number): void {
    if (this.state !== 'playing' && this.state !== 'reading') {
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
    this.audio.play('stinger', 0.5);
  }

  private async runCaught(): Promise<void> {
    if (this.state !== 'playing' && this.state !== 'reading') {
      return;
    }
    this.state = 'transition';
    this.ui.hideAll();
    this.ui.setPrompt('');
    this.input.consumeMouseDelta();
    this.audio.play('stinger', 0.9);
    await this.wait(1.1, (progress) => this.psx.setFade(progress * 0.9));
    await this.wait(0.5, (progress) => this.psx.setFade(0.9 + progress * 0.1));
    this.showGameOver();
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


  applySettings(changed?: keyof SettingsData | null): void {
    this.settings.applyTo(this.config);
    this.gamepad.setEnabled(this.settings.get('gamepad'));
    this.psx.syncEffects(this.config);
    this.room?.sync(this.config);
    this.audio.setVolumes(this.config.audio);
    this.ui.setOptions({ showSubtitles: this.settings.get('subtitles') });
    if (changed === 'language') {
      this.menu.onLanguageChanged();
      if (this.state === 'inventory') {
        this.refreshInventory();
      }
    }
  }

  get gameOver(): () => void {
    return () => this.showGameOver();
  }

  syncConfig(): void {
    this.room.sync(this.config);
    this.stalker?.syncConfig(this.config);
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
    this.models.clear();
    this.inventorySelection = 0;
    this.examineObject = null;
    this.flashlight.reset();
    this.deactivateStalker();
    this.roomCache.clear();
    this.room = await this.getRoom(this.introRoom);
    this.player = this.createPlayer(this.room, this.introSpawn);
    this.lastPlayerX = this.player.position.x;
    this.lastPlayerZ = this.player.position.z;
    this.applyRoomState(this.room);
    this.audio.setRoom(this.room.audio);
    this.resetHearts();
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
      (this.state === 'playing' || this.state === 'inventory') &&
      (this.input.consumePress('Escape') || this.input.padPress('pause'));
    if (pausePressed) {
      this.openMenu('pause');
    }
    this.menu.update(dt);
  }

  private update(dt: number): void {
    this.clock += dt;
    this.gamepad.poll(dt);
    this.handleMenuInput(dt);
    this.flashlight.update(dt, this.player.camera, this.state !== 'examine');
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
        this.preloadNearbyDoors();
        if (this.input.consumePress('KeyI') || this.input.padPress('inventory')) {
          this.openInventory();
          break;
        }
        if (this.input.consumePress('KeyF') || this.input.padPress('combine')) {
          this.toggleFlashlight();
        }
        if (this.input.consumePress('KeyE') || this.input.padPress('interact')) {
          this.tryInteract();
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
        this.updateStalker(dt);
        break;
      case 'inventory':
        this.handleInventory();
        break;
      case 'examine':
        this.handleExamine(dt);
        break;
      case 'ending':
        break;
    }
  }

  private render(): void {
    if (this.state === 'examine' && this.examineObject) {
      this.psx.render(this.examineScene, this.examineCamera);
    } else {
      this.psx.render(this.room.scene, this.player.camera);
    }
    this.ui.draw();
    if (this.menu.active) {
      this.menu.draw();
    }
    this.uiCanvas.end();
  }

  private handleReading(): void {
    if (this.input.consumePress('Escape') || this.input.consumePress('KeyI')) {
      this.closeNote();
      return;
    }
    if (
      this.input.consumePress('KeyE') ||
      this.input.consumePress('Enter') ||
      this.input.consumePress('Space')
    ) {
      if (this.ui.noteComplete) {
        this.closeNote();
      } else {
        this.ui.revealNote();
      }
    }
  }

  private handleInventory(): void {
    const column = this.inventorySelection % GRID_COLUMNS;
    const row = Math.floor(this.inventorySelection / GRID_COLUMNS);
    let nextColumn = column;
    let nextRow = row;
    let moved = false;

    if (this.press('ArrowLeft', 'left') || this.press('KeyA', 'left')) {
      nextColumn = (column + GRID_COLUMNS - 1) % GRID_COLUMNS;
      moved = true;
    }
    if (this.press('ArrowRight', 'right') || this.press('KeyD', 'right')) {
      nextColumn = (column + 1) % GRID_COLUMNS;
      moved = true;
    }
    if (this.press('ArrowUp', 'up') || this.press('KeyW', 'up')) {
      nextRow = (row + 1) % (INVENTORY_SLOT_COUNT / GRID_COLUMNS);
      moved = true;
    }
    if (this.press('ArrowDown', 'down') || this.press('KeyS', 'down')) {
      nextRow = (row + 1) % (INVENTORY_SLOT_COUNT / GRID_COLUMNS);
      moved = true;
    }
    if (moved) {
      this.inventorySelection = nextRow * GRID_COLUMNS + nextColumn;
      this.refreshInventory();
    }

    if (this.press('KeyE', 'interact') || this.press('Enter', 'confirm')) {
      this.useSelectedItem();
      return;
    }
    if (this.press('KeyC', 'combine')) {
      this.ui.toast(TEXTS[this.config.language].combineNone);
    }
    if (this.press('KeyI', 'inventory') || this.press('Escape', 'cancel')) {
      this.closeInventory();
    }
  }

  private press(code: string, action: PadAction): boolean {
    return this.input.consumePress(code) || this.input.padPress(action);
  }

  private handleExamine(dt: number): void {
    const mouse = this.input.consumeMouseDelta();
    this.examineYaw -= mouse.dx * 0.01;
    this.examinePitch = THREE.MathUtils.clamp(this.examinePitch + mouse.dy * 0.01, -1.3, 1.3);

    const turn = 2.2 * dt;
    if (this.input.isDown('ArrowLeft') || this.input.isDown('KeyA')) {
      this.examineYaw += turn;
    }
    if (this.input.isDown('ArrowRight') || this.input.isDown('KeyD')) {
      this.examineYaw -= turn;
    }
    if (this.input.isDown('ArrowUp') || this.input.isDown('KeyW')) {
      this.examinePitch = THREE.MathUtils.clamp(this.examinePitch + turn, -1.3, 1.3);
    }
    if (this.input.isDown('ArrowDown') || this.input.isDown('KeyS')) {
      this.examinePitch = THREE.MathUtils.clamp(this.examinePitch - turn, -1.3, 1.3);
    }
    this.examineYawGroup.rotation.y = this.examineYaw;
    this.examinePitchGroup.rotation.x = this.examinePitch;

    if (this.input.consumePress('Escape') || this.input.consumePress('KeyI')) {
      this.closeExamine();
    }
  }

  private openInventory(): void {
    this.state = 'inventory';
    this.input.clearPending();
    this.ui.setPrompt('');
    this.refreshInventory();
  }

  private closeInventory(): void {
    this.ui.hideInventory();
    this.state = 'playing';
    this.input.clearPending();
  }

  private refreshInventory(): void {
    const texts = TEXTS[this.config.language];
    const slots = this.inventory.slots.map((id) => {
      if (!id) {
        return null;
      }
      const def = this.catalog.get(id);
      if (!def) {
        return id;
      }
      return def.kind === 'note'
        ? itemTitle(def, this.config.language)
        : itemName(def, this.config.language);
    });

    const selectedId = this.inventory.slots[this.inventorySelection];
    const def = selectedId ? this.catalog.get(selectedId) : undefined;
    const name = def ? itemName(def, this.config.language) : texts.inventoryEmpty;
    const desc = def ? itemDesc(def, this.config.language) : '';
    const hint = def
      ? def.kind === 'note'
        ? texts.inventoryHintsNote
        : texts.inventoryHintsKey
      : texts.inventoryHintsEmpty;
    this.ui.showInventory(slots, this.inventorySelection, name, desc, hint);
  }

  private useSelectedItem(): void {
    const id = this.inventory.slots[this.inventorySelection];
    if (!id) {
      return;
    }
    const def = this.catalog.get(id);
    if (!def) {
      return;
    }
    if (def.kind === 'note') {
      this.ui.hideInventory();
      this.openNote(def, 'inventory');
      return;
    }
    this.openExamine(def);
  }

  private openNote(def: ItemDef, returnState: State): void {
    this.state = 'reading';
    this.readReturn = returnState;
    this.input.clearPending();
    this.ui.setPrompt('');
    this.audio.play('paper_turn', 0.6);
    this.ui.showNote(itemTitle(def, this.config.language), itemText(def, this.config.language));
  }

  private closeNote(): void {
    this.audio.play('paper_turn', 0.4);
    this.ui.hideNote();
    this.input.clearPending();
    if (this.readReturn === 'inventory') {
      this.state = 'inventory';
      this.refreshInventory();
      return;
    }
    this.state = 'playing';
  }

  private openExamine(def: ItemDef): void {
    const model = this.models.get(def.id);
    if (!model) {
      return;
    }
    this.ui.hideInventory();
    this.examineObject = model.clone(true);
    this.examineObject.position.set(0, 0, 0);
    this.examineObject.rotation.set(0, 0, 0);
    this.examineObject.scale.set(1, 1, 1);

    const box = new THREE.Box3().setFromObject(this.examineObject);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z) || 1;
    const scale = 0.42 / maxDimension;
    this.examineObject.scale.setScalar(scale);
    this.examineObject.position.copy(center).multiplyScalar(-scale);
    this.examineYaw = -0.6;
    this.examinePitch = 0.5;
    this.examineYawGroup.rotation.y = this.examineYaw;
    this.examinePitchGroup.rotation.x = this.examinePitch;
    this.examinePitchGroup.add(this.examineObject);
    this.input.clearPending();
    this.ui.setPrompt('');

    this.state = 'examine';
    this.ui.showExamine(
      itemName(def, this.config.language),
      itemDesc(def, this.config.language),
      TEXTS[this.config.language].examineHint,
    );
  }

  private closeExamine(): void {
    if (this.examineObject) {
      this.examinePitchGroup.remove(this.examineObject);
      this.examineObject = null;
    }
    this.ui.hideExamine();
    this.state = 'inventory';
    this.refreshInventory();
  }

  private createPlayer(room: BuiltRoom, spawnName: string): Player {
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
    for (const door of room.doors) {
      this.closeDoor(room, door);
    }
    for (const item of room.items) {
      if (this.flags.has(`taken:${item.id}`)) {
        item.taken = true;
        item.object.removeFromParent();
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
      if (def?.kind === 'note') {
        label = texts.promptPickNote;
      } else if (def?.kind === 'tool') {
        label = texts.promptPickTool(itemName(def, this.config.language));
      }
      best = { door: null, item, label };
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
      best = { door, item: null, label: this.doorPrompt(door) };
    }

    return best;
  }

  private doorAimPoint(door: DoorHandle): THREE.Vector3 {
    const point = this.aimDoorPoint.copy(door.center);
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
      const have = door.requires.filter((id) => this.inventory.has(id)).length;
      return have >= door.requires.length
        ? texts.promptEndingReady
        : texts.promptEndingLocked(have, door.requires.length);
    }
    if (door.key && !this.inventory.has(door.key)) {
      return texts.promptKeyLocked;
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
    if (target.item) {
      this.pickUpItem(target.item);
      return;
    }
    const door = target.door;
    if (!door) {
      return;
    }
    if (door.key && !this.inventory.has(door.key)) {
      return;
    }
    if (door.ending) {
      if (!door.requires.every((id) => this.inventory.has(id))) {
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
    this.models.set(item.id, item.object.clone(true));
    this.audio.play(def.kind === 'note' ? 'pickup_note' : 'pickup_key');

    if (def.kind === 'note') {
      const have = NOTE_IDS.filter((id) => this.inventory.has(id)).length;
      this.ui.toast(texts.toastNote(have, NOTE_IDS.length));
    } else if (def.kind === 'tool') {
      this.flashlight.give();
      this.ui.toast(texts.toastFlashlight);
    } else {
      this.ui.toast(texts.toastKey(itemName(def, this.config.language)));
    }

    if (item.id === 'note_1') {
      this.flags.set('stalker_active');
      this.ui.toast(texts.toastStalker);
      void this.activateStalker();
    }

    if (def.kind === 'note') {
      this.openNote(def, 'playing');
    }
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

    const { authentic, door_anim_seconds, fade_seconds, min_seconds } = this.config.loading;
    const doorDuration = authentic ? door_anim_seconds : 0.4;
    const fadeDuration = authentic ? fade_seconds : 0.15;
    const minTotal = authentic ? min_seconds : 0;

    const roomPromise = this.getRoom(target);
    const group = door.group;
    const previousRoom = this.room.id;
    const climbing = door.action === 'up' || door.action === 'down';
    const climbSign = door.action === 'up' ? 1 : -1;

    if (group) {
      await this.wait(doorDuration, (progress) => {
        group.rotation.y = door.baseRotation + door.openAngle * easeInOut(progress);
      });
    }
    await this.wait(fadeDuration, (progress) => {
      this.psx.setFade(progress);
      if (climbing) {
        this.player.setLift(CLIMB_LIFT * climbSign * easeInOut(progress));
      }
    });
    if (climbing) {
      this.scheduleClimbSteps();
    }

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
    this.closeArrivalDoor(previousRoom, nextRoom);

    await this.wait(fadeDuration, (progress) => this.psx.setFade(1 - progress));
    this.audio.play(
      nextRoom.audio.ambience === 'basement' ? 'door_close_metal' : 'door_close_wood',
      0.45,
    );
    this.state = 'playing';
  }

  // Pasos de subida/bajada repartidos durante el fundido, sin bloquear la
  // transición. El material de suelo es el de la sala en cada momento.
  private scheduleClimbSteps(): void {
    let played = 0;
    void this.wait(1.2, (progress) => {
      const wanted = Math.min(CLIMB_STEPS, Math.floor(progress * CLIMB_STEPS) + 1);
      while (played < wanted) {
        this.audio.footstep(false);
        played += 1;
      }
    });
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
    const openRotation = chosen.baseRotation + chosen.openAngle;
    const closedRotation = chosen.baseRotation;
    group.rotation.y = openRotation;
    void this.wait(ARRIVAL_DOOR_SECONDS, (progress) => {
      group.rotation.y = openRotation + (closedRotation - openRotation) * easeInOut(progress);
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
    const group = door.group;
    this.audio.play('door_open_wood');

    await this.wait(1.6, (progress) => {
      if (group) {
        group.rotation.y = door.baseRotation + door.openAngle * easeInOut(Math.min(1, progress * 1.4));
      }
      this.psx.setFade(progress * 0.55);
    });
    await this.wait(1.0, (progress) => this.psx.setFade(0.55 + progress * 0.45));

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

  private closeDoor(room: BuiltRoom, door: DoorHandle): void {
    if (door.group) {
      door.group.rotation.y = door.baseRotation;
    }
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
    let text = '';
    if (this.input.lastSource === 'gamepad') {
      const target = this.nearestInteractable();
      text = target ? target.label : '';
    } else if (!this.input.locked) {
      text = TEXTS[this.config.language].clickToPlay;
    } else {
      const target = this.nearestInteractable();
      text = target ? target.label : '';
    }
    this.ui.setPrompt(text);
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
