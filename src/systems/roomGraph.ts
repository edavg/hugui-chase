import {
  computeColliders,
  computeDoorways,
  loadRoomData,
  type Collider,
  type RoomDoorway,
  type RoomSpawn,
} from './roomBuilder';

export const ROOM_IDS = [
  'room_vestibulo',
  'room_salon',
  'room_comedor',
  'room_cocina',
  'room_pasillo',
  'room_bano',
  'room_despacho',
  'room_escalera',
  'room_pasillo_alto',
  'room_dormitorio',
  'room_cuarto',
  'room_bano_alto',
  'room_invitados',
  'room_trastero',
  'room_sotano',
  'room_lavanderia',
  'room_calderas',
  'room_bodega',
] as const;

const ROOM_GAP = 5.5;

export interface RoomNav {
  id: string;
  name: string;
  colliders: Collider[];
  doorways: RoomDoorway[];
  spawns: Record<string, RoomSpawn>;
  halfWidth: number;
  halfDepth: number;
}

export interface GraphEntry {
  room: string;
  x: number;
  z: number;
  yaw: number;
}

export class RoomGraph {
  private readonly rooms = new Map<string, RoomNav>();
  private readonly neighbors = new Map<string, string[]>();

  private constructor() {}

  static async load(ids: readonly string[] = ROOM_IDS): Promise<RoomGraph> {
    const graph = new RoomGraph();
    const loaded = await Promise.all(
      ids.map(async (id) => {
        const data = await loadRoomData(id);
        return {
          id,
          name: data.name,
          colliders: computeColliders(data),
          doorways: computeDoorways(data),
          spawns: data.spawns,
          halfWidth: data.size[0] / 2,
          halfDepth: data.size[2] / 2,
        };
      }),
    );
    for (const room of loaded) {
      graph.rooms.set(room.id, room);
    }
    for (const room of loaded) {
      const neighbors = new Set<string>();
      for (const doorway of room.doorways) {
        if (!graph.rooms.has(doorway.to)) {
          continue;
        }
        neighbors.add(doorway.to);
        graph.neighbors.get(doorway.to)?.push(room.id);
      }
      graph.neighbors.set(room.id, [...neighbors]);
    }
    return graph;
  }

  get roomIds(): string[] {
    return [...this.rooms.keys()];
  }

  room(id: string): RoomNav | undefined {
    return this.rooms.get(id);
  }

  colliders(id: string): Collider[] {
    return this.rooms.get(id)?.colliders ?? [];
  }

  hasRoom(id: string): boolean {
    return this.rooms.has(id);
  }

  exitToward(from: string, to: string): RoomDoorway | null {
    const room = this.rooms.get(from);
    return room?.doorways.find((doorway) => doorway.to === to) ?? null;
  }

  path(from: string, to: string): string[] {
    if (from === to) {
      return [from];
    }
    if (!this.rooms.has(from) || !this.rooms.has(to)) {
      return [];
    }
    const queue: string[][] = [[from]];
    const visited = new Set<string>([from]);
    while (queue.length > 0) {
      const current = queue.shift() as string[];
      const last = current[current.length - 1];
      for (const next of this.neighbors.get(last) ?? []) {
        if (visited.has(next)) {
          continue;
        }
        const extended = [...current, next];
        if (next === to) {
          return extended;
        }
        visited.add(next);
        queue.push(extended);
      }
    }
    return [];
  }

  hops(from: string, to: string): number {
    const path = this.path(from, to);
    return Math.max(0, path.length - 1);
  }

  distance(from: string, to: string): number {
    if (from === to) {
      return 0;
    }
    const path = this.path(from, to);
    if (path.length === 0) {
      return Number.POSITIVE_INFINITY;
    }
    let total = 0;
    for (let i = 1; i < path.length; i += 1) {
      total += Math.max(ROOM_GAP, roomSpan(path[i - 1], this) + roomSpan(path[i], this));
    }
    return total;
  }

  entryOf(doorway: RoomDoorway): GraphEntry {
    const target = this.rooms.get(doorway.to);
    if (!target) {
      return { room: doorway.to, x: 0, z: 0, yaw: 0 };
    }
    const spawn = target.spawns[doorway.spawn];
    if (spawn) {
      return { room: doorway.to, x: spawn.position[0], z: spawn.position[1], yaw: degToRad(spawn.yaw) };
    }
    const back = this.exitToward(doorway.to, doorway.room);
    if (!back) {
      return { room: doorway.to, x: 0, z: 0, yaw: 0 };
    }
    const dx = -back.centerX;
    const dz = -back.centerZ;
    const length = Math.hypot(dx, dz) || 1;
    return {
      room: doorway.to,
      x: back.centerX + (dx / length) * 1.3,
      z: back.centerZ + (dz / length) * 1.3,
      yaw: Math.atan2(-dx / length, -dz / length),
    };
  }
}

function roomSpan(id: string, graph: RoomGraph): number {
  const room = graph.room(id);
  return room ? Math.max(room.halfWidth, room.halfDepth) : ROOM_GAP;
}

function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
