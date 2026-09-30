export class Flags {
  private readonly values = new Set<string>();

  has(flag: string): boolean {
    return this.values.has(flag);
  }

  set(flag: string): void {
    this.values.add(flag);
  }

  clear(): void {
    this.values.clear();
  }
}
