import type { Player } from '../entities/player';
import type { Flags } from './flags';
import type { Language } from './i18n';
import { TEXTS } from './i18n';
import type { BuiltRoom } from './roomBuilder';
import { PALETTE, type UiCanvas } from './uiCanvas';

export interface MinimapState {
  room: BuiltRoom;
  player: Player;
  flags: Flags;
}

export interface MinimapBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const PENDING = '#e6a55a';
const BURNED = '#94bd89';
const PASSAGE = '#7fa7ae';
const FLOOR = '#1c2529';
const WALL = '#697477';
const MAP_PADDING = 9;

// Plano 2D: reutiliza la geometría de colisión, sin una segunda cámara 3D.
// El fondo se prepara una vez por sala/tamaño; solo los marcadores se animan.
export class Minimap {
  private readonly background = document.createElement('canvas');
  private cachedRoom: BuiltRoom | null = null;
  private cachedSize = 0;
  private scale = 1;
  private centerX = 0;
  private centerZ = 0;

  constructor(private readonly ui: UiCanvas) {}

  draw(state: MinimapState, language: Language, touchControls: boolean): MinimapBounds {
    const { ui } = this;
    const texts = TEXTS[language];
    const portrait = ui.height > ui.width;
    const compact = portrait || touchControls;
    const width = compact ? 128 : 160;
    const mapSize = width - 16;
    const height = mapSize + 64;
    // En horizontal queda a la izquierda de la pausa; en vertical, debajo.
    const pauseSpace = touchControls && !portrait ? 76 / ui.cssScale : 0;
    const top = touchControls ? (portrait ? Math.max(54, 76 / ui.cssScale) : 14) : 54;
    const x = Math.round(ui.width - ui.safeArea.right - width - 14 - pauseSpace);
    const y = Math.round(ui.safeArea.top + top);
    const mapX = x + 8;
    const mapY = y + 30;
    const { room, player, flags } = state;
    if (this.cachedRoom !== room || this.cachedSize !== mapSize) {
      this.buildBackground(room, mapSize);
    }

    ui.panel(x, y, width, height, { fill: PALETTE.bg, alpha: 0.88 });
    ui.text(texts.minimapTitle, x + 8, y + 7, { color: PALETTE.textBright });
    ui.textRight('N', x + width - 8, y + 7, { color: PASSAGE });
    const columns = Math.floor((width - 16) / ui.font.advance);
    const name = room.name.toUpperCase();
    ui.text(name.length > columns ? `${name.slice(0, columns - 3)}...` : name, x + 8, y + 19, {
      color: PALETTE.textDim,
    });

    const ctx = ui.ctx;
    ctx.drawImage(this.background, mapX, mapY);
    ctx.save();
    ctx.beginPath();
    ctx.rect(mapX, mapY, mapSize, mapSize);
    ctx.clip();

    // Las puertas siguen visibles aunque se abran o cambie su collider.
    for (const door of room.doors) {
      if (!door.to && !door.ending) continue;
      const px = mapX + this.centerX + door.center.x * this.scale;
      const py = mapY + this.centerZ + door.center.z * this.scale;
      ctx.strokeStyle = door.ending ? PENDING : PASSAGE;
      ctx.lineWidth = 3;
      const dx = Math.cos(door.heading) * Math.max(3, door.halfWidth * this.scale);
      const dy = -Math.sin(door.heading) * Math.max(3, door.halfWidth * this.scale);
      ctx.beginPath();
      ctx.moveTo(px - dx, py - dy);
      ctx.lineTo(px + dx, py + dy);
      ctx.stroke();
    }

    // Sólo los afiches ya vistos (o quemados): el mapa no delata los que faltan.
    for (const item of room.items) {
      if (item.kind !== 'poster') continue;
      if (!flags.has(`seen:${item.id}`) && !flags.has(`burned:${item.id}`)) continue;
      const px = Math.round(mapX + this.centerX + item.position.x * this.scale);
      const py = Math.round(mapY + this.centerZ + item.position.z * this.scale);
      this.poster(px, py, flags.has(`burned:${item.id}`));
    }

    const px = mapX + this.centerX + player.position.x * this.scale;
    const py = mapY + this.centerZ + player.position.z * this.scale;
    // El cono indica la mirada; la flecha sigue el desplazamiento real,
    // incluso al caminar hacia atrás o de costado. En reposo sigue la mirada.
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-player.camera.rotation.y);
    ctx.fillStyle = 'rgba(160, 201, 205, 0.16)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, compact ? 18 : 23, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    const moving = player.movement.lengthSq() > 0.000001;
    const heading = moving
      ? Math.atan2(player.movement.x, -player.movement.y)
      : -player.camera.rotation.y;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(heading);
    ctx.fillStyle = PALETTE.textBright;
    ctx.strokeStyle = PALETTE.bg;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 5);
    ctx.lineTo(0, 2);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();
    ctx.restore();

    const legendY = mapY + mapSize + 9;
    this.poster(x + 12, legendY, false);
    ui.text(texts.minimapPending, x + 20, legendY - 3, { color: PALETTE.textDim });
    this.poster(x + 12, legendY + 12, true);
    ui.text(texts.minimapBurned, x + 20, legendY + 9, { color: PALETTE.textDim });
    return { x, y, width, height };
  }

  private poster(x: number, y: number, burned: boolean): void {
    const { ctx } = this.ui;
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(x - 4, y - 4, 9, 9);
    ctx.strokeStyle = burned ? BURNED : PENDING;
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 2.5, y - 3.5, 5, 7);
    if (burned) {
      ctx.beginPath();
      ctx.moveTo(x - 2, y);
      ctx.lineTo(x, y + 2);
      ctx.lineTo(x + 4, y - 3);
      ctx.stroke();
    } else {
      ctx.fillStyle = PENDING;
      ctx.fillRect(x - 1, y - 2, 2, 4);
    }
  }

  private buildBackground(room: BuiltRoom, size: number): void {
    this.background.width = size;
    this.background.height = size;
    const ctx = this.background.getContext('2d');
    if (!ctx) throw new Error('No se pudo crear el minimapa');
    this.cachedRoom = room;
    this.cachedSize = size;
    const [width, depth] = room.mapSize;
    this.scale = (size - MAP_PADDING * 2) / Math.max(width, depth, 1);
    this.centerX = size / 2;
    this.centerZ = size / 2;
    const floorX = this.centerX - width * this.scale / 2;
    const floorY = this.centerZ - depth * this.scale / 2;
    ctx.fillStyle = '#10171b';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = FLOOR;
    ctx.fillRect(floorX, floorY, width * this.scale, depth * this.scale);
    ctx.strokeStyle = '#29363c';
    ctx.lineWidth = 1;
    const grid = 2 * this.scale;
    ctx.beginPath();
    for (let x = floorX; x <= floorX + width * this.scale; x += grid) {
      ctx.moveTo(x, floorY);
      ctx.lineTo(x, floorY + depth * this.scale);
    }
    for (let y = floorY; y <= floorY + depth * this.scale; y += grid) {
      ctx.moveTo(floorX, y);
      ctx.lineTo(floorX + width * this.scale, y);
    }
    ctx.stroke();
    ctx.fillStyle = WALL;
    for (const collider of room.colliders) {
      ctx.fillRect(
        Math.round(this.centerX + collider.minX * this.scale),
        Math.round(this.centerZ + collider.minZ * this.scale),
        Math.max(1, Math.round((collider.maxX - collider.minX) * this.scale)),
        Math.max(1, Math.round((collider.maxZ - collider.minZ) * this.scale)),
      );
    }
  }
}
