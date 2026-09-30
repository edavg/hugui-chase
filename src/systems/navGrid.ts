import type { Collider } from './roomBuilder';

export interface NavPoint {
  x: number;
  z: number;
}

const CELL_SIZE = 0.25;
const LOS_STEP = 0.12;
const NEAREST_RING = 10;
const DIAGONAL_COST = Math.SQRT2;

const NEIGHBORS: ReadonlyArray<{ dx: number; dy: number; diagonal: boolean }> = [
  { dx: 1, dy: 0, diagonal: false },
  { dx: -1, dy: 0, diagonal: false },
  { dx: 0, dy: 1, diagonal: false },
  { dx: 0, dy: -1, diagonal: false },
  { dx: 1, dy: 1, diagonal: true },
  { dx: 1, dy: -1, diagonal: true },
  { dx: -1, dy: 1, diagonal: true },
  { dx: -1, dy: -1, diagonal: true },
];

class MinHeap {
  private readonly indices: number[] = [];
  private readonly scores: number[] = [];

  get size(): number {
    return this.indices.length;
  }

  push(index: number, score: number): void {
    this.indices.push(index);
    this.scores.push(score);
    let child = this.indices.length - 1;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (this.scores[parent] <= this.scores[child]) {
        break;
      }
      this.swap(parent, child);
      child = parent;
    }
  }

  pop(): number {
    const top = this.indices[0];
    const lastIndex = this.indices.pop() as number;
    const lastScore = this.scores.pop() as number;
    if (this.indices.length > 0) {
      this.indices[0] = lastIndex;
      this.scores[0] = lastScore;
      let parent = 0;
      for (;;) {
        const left = parent * 2 + 1;
        const right = left + 1;
        let smallest = parent;
        if (left < this.indices.length && this.scores[left] < this.scores[smallest]) {
          smallest = left;
        }
        if (right < this.indices.length && this.scores[right] < this.scores[smallest]) {
          smallest = right;
        }
        if (smallest === parent) {
          break;
        }
        this.swap(parent, smallest);
        parent = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const index = this.indices[a];
    this.indices[a] = this.indices[b];
    this.indices[b] = index;
    const score = this.scores[a];
    this.scores[a] = this.scores[b];
    this.scores[b] = score;
  }
}

/**
 * Rejilla de navegación por sala: A* con 8 direcciones sobre los colliders
 * inflados por el radio del cuerpo, más suavizado por línea de visión. Sirve
 * para que el stalker rodee muebles en vez de empotrarse y quedarse colgado.
 */
export class NavGrid {
  private readonly cols: number;
  private readonly rows: number;
  private readonly cellWidth: number;
  private readonly cellHeight: number;
  private readonly originX: number;
  private readonly originZ: number;
  private readonly blocked: Uint8Array;

  constructor(
    private readonly halfWidth: number,
    private readonly halfDepth: number,
    private readonly colliders: Collider[],
    private readonly radius: number,
  ) {
    this.cols = Math.max(2, Math.ceil((halfWidth * 2) / CELL_SIZE));
    this.rows = Math.max(2, Math.ceil((halfDepth * 2) / CELL_SIZE));
    this.cellWidth = (halfWidth * 2) / this.cols;
    this.cellHeight = (halfDepth * 2) / this.rows;
    this.originX = -halfWidth;
    this.originZ = -halfDepth;
    this.blocked = new Uint8Array(this.cols * this.rows);
    for (let row = 0; row < this.rows; row += 1) {
      for (let col = 0; col < this.cols; col += 1) {
        this.blocked[row * this.cols + col] = this.isBlocked(
          this.pointX(col),
          this.pointZ(row),
        )
          ? 1
          : 0;
      }
    }
  }

  findPath(from: NavPoint, to: NavPoint): NavPoint[] {
    const start = this.nearestCell(from.x, from.z);
    const end = this.nearestCell(to.x, to.z);
    if (start < 0 || end < 0) {
      return [{ x: to.x, z: to.z }];
    }
    const cells = start === end ? [start] : this.search(start, end);
    if (!cells) {
      return [{ x: to.x, z: to.z }];
    }
    const points = cells.map<NavPoint>((index) => {
      const col = index % this.cols;
      const row = (index - col) / this.cols;
      return { x: this.pointX(col), z: this.pointZ(row) };
    });
    points.shift();
    points.push({ x: to.x, z: to.z });
    return this.smooth(from, points);
  }

  private isBlocked(x: number, z: number): boolean {
    if (Math.abs(x) > this.halfWidth - this.radius || Math.abs(z) > this.halfDepth - this.radius) {
      return true;
    }
    for (const collider of this.colliders) {
      if (
        x > collider.minX - this.radius &&
        x < collider.maxX + this.radius &&
        z > collider.minZ - this.radius &&
        z < collider.maxZ + this.radius
      ) {
        return true;
      }
    }
    return false;
  }

  private pointX(col: number): number {
    return this.originX + (col + 0.5) * this.cellWidth;
  }

  private pointZ(row: number): number {
    return this.originZ + (row + 0.5) * this.cellHeight;
  }

  private cellCol(x: number): number {
    const col = Math.floor((x - this.originX) / this.cellWidth);
    return Math.min(this.cols - 1, Math.max(0, col));
  }

  private cellRow(z: number): number {
    const row = Math.floor((z - this.originZ) / this.cellHeight);
    return Math.min(this.rows - 1, Math.max(0, row));
  }

  private walkable(index: number): boolean {
    return this.blocked[index] === 0;
  }

  private nearestCell(x: number, z: number): number {
    const col = this.cellCol(x);
    const row = this.cellRow(z);
    const startIndex = row * this.cols + col;
    if (this.walkable(startIndex)) {
      return startIndex;
    }
    for (let ring = 1; ring <= NEAREST_RING; ring += 1) {
      for (let dc = -ring; dc <= ring; dc += 1) {
        for (let dr = -ring; dr <= ring; dr += 1) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) {
            continue;
          }
          const c = col + dc;
          const r = row + dr;
          if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) {
            continue;
          }
          const index = r * this.cols + c;
          if (this.walkable(index)) {
            return index;
          }
        }
      }
    }
    return -1;
  }

  private heuristic(index: number, goal: number): number {
    const col = index % this.cols;
    const row = (index - col) / this.cols;
    const goalCol = goal % this.cols;
    const goalRow = (goal - goalCol) / this.cols;
    const dx = Math.abs(col - goalCol);
    const dy = Math.abs(row - goalRow);
    const diagonal = Math.min(dx, dy);
    return dx + dy + (DIAGONAL_COST - 2) * diagonal;
  }

  private search(start: number, goal: number): number[] | null {
    const size = this.cols * this.rows;
    const cameFrom = new Int32Array(size).fill(-1);
    const cost = new Float64Array(size).fill(Number.POSITIVE_INFINITY);
    const closed = new Uint8Array(size);
    const open = new MinHeap();
    cost[start] = 0;
    open.push(start, this.heuristic(start, goal));

    while (open.size > 0) {
      const current = open.pop();
      if (current === goal) {
        return this.reconstruct(cameFrom, current);
      }
      if (closed[current]) {
        continue;
      }
      closed[current] = 1;

      const col = current % this.cols;
      const row = (current - col) / this.cols;
      for (const { dx, dy, diagonal } of NEIGHBORS) {
        const nextCol = col + dx;
        const nextRow = row + dy;
        if (nextCol < 0 || nextRow < 0 || nextCol >= this.cols || nextRow >= this.rows) {
          continue;
        }
        const next = nextRow * this.cols + nextCol;
        if (closed[next] || !this.walkable(next)) {
          continue;
        }
        if (diagonal) {
          // Sin cortar esquinas: hace falta que los dos lados estén libres.
          if (!this.walkable(row * this.cols + nextCol) || !this.walkable(nextRow * this.cols + col)) {
            continue;
          }
        }
        const tentative = cost[current] + (diagonal ? DIAGONAL_COST : 1);
        if (tentative < cost[next]) {
          cost[next] = tentative;
          cameFrom[next] = current;
          open.push(next, tentative + this.heuristic(next, goal));
        }
      }
    }
    return null;
  }

  private reconstruct(cameFrom: Int32Array, current: number): number[] {
    const cells = [current];
    let node = current;
    while (cameFrom[node] !== -1) {
      node = cameFrom[node];
      cells.push(node);
    }
    cells.reverse();
    return cells;
  }

  private lineOfSight(a: NavPoint, b: NavPoint): boolean {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const distance = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(distance / LOS_STEP));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      if (this.isBlocked(a.x + dx * t, a.z + dz * t)) {
        return false;
      }
    }
    return true;
  }

  private smooth(from: NavPoint, points: NavPoint[]): NavPoint[] {
    const result: NavPoint[] = [];
    let anchor = from;
    let index = 0;
    while (index < points.length) {
      let chosen = index;
      for (let probe = points.length - 1; probe > index; probe -= 1) {
        if (this.lineOfSight(anchor, points[probe])) {
          chosen = probe;
          break;
        }
      }
      const point = points[chosen];
      result.push(point);
      anchor = point;
      index = chosen + 1;
    }
    return result;
  }
}
