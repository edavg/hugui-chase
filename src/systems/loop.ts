export class FixedLoop {
  private accumulator = 0;
  private lastTime = 0;
  private frame = 0;

  constructor(
    private readonly hz: number,
    private readonly update: (dt: number) => void,
    private readonly render: () => void,
  ) {}

  start(): void {
    this.lastTime = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
  }

  private readonly tick = (now: number): void => {
    this.frame = requestAnimationFrame(this.tick);
    const step = 1 / this.hz;
    this.accumulator += Math.min((now - this.lastTime) / 1000, 0.25);
    this.lastTime = now;

    let steps = 0;
    while (this.accumulator >= step && steps < 5) {
      this.update(step);
      this.accumulator -= step;
      steps += 1;
    }
    if (steps > 0) {
      this.render();
    }
  };
}
