import type { PaneRect } from './layout.js';

export interface AnimatedPaneRect {
  begunAt: number;
  current: PaneRect;
  duration: number;
  from: PaneRect;
  goal: PaneRect;
}

export interface GeometryTargetOptions {
  initial?: ReadonlyMap<string, PaneRect>;
  warp?: boolean;
}

export type GeometryFrame = ReadonlyMap<string, PaneRect>;

export class PaneGeometryAnimator {
  readonly #surfaces = new Map<string, AnimatedPaneRect>();
  #fallback?: number;
  #frame?: number;

  constructor(
    private readonly apply: (frame: GeometryFrame, active: boolean) => void,
    private readonly duration = 240,
  ) {}

  target(targets: ReadonlyMap<string, PaneRect>, options: GeometryTargetOptions = {}): void {
    const now = performance.now();
    this.sample(now);
    for (const id of [...this.#surfaces.keys()]) {
      if (!targets.has(id)) this.#surfaces.delete(id);
    }
    for (const [id, goal] of targets) {
      const existing = this.#surfaces.get(id);
      const initial = options.initial?.get(id) ?? collapsedPaneRect(goal);
      this.#surfaces.set(
        id,
        retargetPaneRect(
          existing ?? warpedPaneRect(initial, now),
          goal,
          now,
          this.duration,
          options.warp,
        ),
      );
    }
    this.applyCurrent();
    if (this.active) this.schedule();
    else this.stopFrame();
  }

  warp(id: string, rect: PaneRect): void {
    const now = performance.now();
    this.#surfaces.set(id, warpedPaneRect(rect, now));
    this.applyCurrent();
  }

  current(id: string): PaneRect | undefined {
    const surface = this.#surfaces.get(id);
    if (!surface) return undefined;
    surface.current = samplePaneRect(surface, performance.now());
    return { ...surface.current };
  }

  get active(): boolean {
    return [...this.#surfaces.values()].some(
      (surface) => !samePaneRect(surface.current, surface.goal),
    );
  }

  dispose(): void {
    this.stopFrame();
    this.#surfaces.clear();
  }

  private schedule(): void {
    if (this.#frame !== undefined || this.#fallback !== undefined) return;
    this.#frame = requestAnimationFrame(this.tick);
    this.#fallback = window.setTimeout(this.fallbackTick, 32);
  }

  private tick = (now: number): void => {
    this.#frame = undefined;
    if (this.#fallback !== undefined) window.clearTimeout(this.#fallback);
    this.#fallback = undefined;
    this.advance(now);
  };

  private fallbackTick = (): void => {
    if (this.#frame !== undefined) cancelAnimationFrame(this.#frame);
    this.#frame = undefined;
    this.#fallback = undefined;
    this.advance(performance.now());
  };

  private advance(now: number): void {
    this.sample(now);
    this.applyCurrent();
    if (this.active) this.schedule();
  }

  private sample(now: number): void {
    for (const surface of this.#surfaces.values()) surface.current = samplePaneRect(surface, now);
  }

  private applyCurrent(): void {
    this.apply(
      new Map([...this.#surfaces].map(([id, surface]) => [id, { ...surface.current }])),
      this.active,
    );
  }

  private stopFrame(): void {
    if (this.#frame !== undefined) cancelAnimationFrame(this.#frame);
    if (this.#fallback !== undefined) window.clearTimeout(this.#fallback);
    this.#frame = undefined;
    this.#fallback = undefined;
  }
}

export function retargetPaneRect(
  previous: AnimatedPaneRect,
  goal: PaneRect,
  now: number,
  duration: number,
  warp = false,
): AnimatedPaneRect {
  const current = samplePaneRect(previous, now);
  if (warp || duration <= 0 || samePaneRect(current, goal)) return warpedPaneRect(goal, now);
  return {
    begunAt: now,
    current,
    duration,
    from: current,
    goal: { ...goal },
  };
}

export function samplePaneRect(animation: AnimatedPaneRect, now: number): PaneRect {
  if (animation.duration <= 0) return { ...animation.goal };
  const progress = Math.max(0, Math.min(1, (now - animation.begunAt) / animation.duration));
  if (progress >= 1) return { ...animation.goal };
  const eased = 1 - Math.pow(1 - progress, 3);
  return interpolatePaneRect(animation.from, animation.goal, eased);
}

export function warpedPaneRect(rect: PaneRect, now = 0): AnimatedPaneRect {
  return {
    begunAt: now,
    current: { ...rect },
    duration: 0,
    from: { ...rect },
    goal: { ...rect },
  };
}

export function collapsedPaneRect(rect: PaneRect): PaneRect {
  const width = Math.max(1, rect.width * 0.92);
  const height = Math.max(1, rect.height * 0.92);
  return {
    x: rect.x + (rect.width - width) / 2,
    y: rect.y + (rect.height - height) / 2,
    width,
    height,
  };
}

function interpolatePaneRect(from: PaneRect, to: PaneRect, progress: number): PaneRect {
  return {
    x: interpolate(from.x, to.x, progress),
    y: interpolate(from.y, to.y, progress),
    width: interpolate(from.width, to.width, progress),
    height: interpolate(from.height, to.height, progress),
  };
}

function interpolate(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function samePaneRect(left: PaneRect, right: PaneRect): boolean {
  return (
    Math.abs(left.x - right.x) < 0.01 &&
    Math.abs(left.y - right.y) < 0.01 &&
    Math.abs(left.width - right.width) < 0.01 &&
    Math.abs(left.height - right.height) < 0.01
  );
}
