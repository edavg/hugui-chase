export const INVENTORY_SLOT_COUNT = 8;

export class Inventory {
  readonly slots: Array<string | null> = new Array<string | null>(INVENTORY_SLOT_COUNT).fill(null);

  add(id: string): boolean {
    const index = this.slots.indexOf(null);
    if (index < 0) {
      return false;
    }
    this.slots[index] = id;
    return true;
  }

  has(id: string): boolean {
    return this.slots.includes(id);
  }

  remove(id: string): boolean {
    const index = this.slots.indexOf(id);
    if (index < 0) {
      return false;
    }
    this.slots[index] = null;
    return true;
  }

  get count(): number {
    return this.slots.reduce((total, slot) => (slot ? total + 1 : total), 0);
  }
}
