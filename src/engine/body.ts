import type { Canvas } from "./canvas.ts";
import type { Mask } from "./mask.ts";
import { gradient, openSpline, project, round, scatter } from "./motion.ts";
import type { View } from "./motion.ts";

export interface Spine {
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  radius: Float64Array;
}

export interface TubeColours {
  fill: number;
  low: number;
  high: number;
  belly: number;
  bellyLow: number;
  /** Leave this out when the caller outlines the tube along with something else. */
  line?: number;
}

/** The silhouette of part of a spine. */
export function tubeMask(canvas: Canvas, view: View, spine: Spine, include: (i: number) => boolean): Mask {
  const body = canvas.mask();
  for (let i = 0; i < spine.x.length; i++) {
    if (!include(i)) continue;
    const [sx, sy] = project(view, spine.x[i], spine.y[i], spine.z[i]);
    body.addDisc(sx, sy, spine.radius[i]);
  }
  return body;
}

/** Draw part of a spine as a shaded tube with a pale belly along its underside. */
export function drawTube(
  canvas: Canvas,
  view: View,
  spine: Spine,
  colours: TubeColours,
  include: (i: number) => boolean,
  hasBelly: (i: number) => boolean,
): void {
  const { x, y, z, radius } = spine;
  const dx = gradient(x);
  const dy = gradient(y);
  const body = tubeMask(canvas, view, spine, include);
  const bellyArea = canvas.mask();
  for (let i = 0; i < x.length; i++) {
    if (!include(i) || !hasBelly(i)) continue;
    const r = radius[i];
    const length = Math.hypot(dx[i], dy[i]);
    const [bx, by] = project(
      view,
      x[i] + (-dy[i] / length) * r * 0.72,
      y[i] + (dx[i] / length) * r * 0.72,
      z[i],
    );
    bellyArea.addDisc(bx, by, r * 0.6);
  }
  if (colours.line !== undefined) canvas.fill(body.grown(), colours.line);
  canvas.fill(body, colours.fill);
  canvas.fill(body.minus(body.moved(0, -2)), colours.low);
  canvas.fill(body.minus(body.moved(0, 1)), colours.high);
  const belly = body.and(bellyArea);
  canvas.fill(belly, colours.belly);
  canvas.fill(belly.minus(body.moved(0, -1)), colours.bellyLow);
}

/** Draw a tapering limb from a few (forward, up) points, with three claws at the end. */
export function drawLimb(
  canvas: Canvas,
  view: View,
  points: readonly (readonly number[])[],
  z: number,
  r0: number,
  r1: number,
  colours: { fill: number; claw: number; line: number },
): void {
  const steps = 10;
  const [xs, ys] = openSpline(points, steps);
  const screen = Array.from(xs, (x, i) => project(view, x, ys[i], z));
  const limb = canvas.mask();
  screen.forEach(([sx, sy], i) => limb.addDisc(sx, sy, r0 + ((r1 - r0) * i) / (steps - 1)));

  const [endX, endY] = screen[steps - 1];
  const [backX, backY] = screen[steps - 3];
  const length = Math.hypot(endX - backX, endY - backY) || 1;
  const dx = (endX - backX) / length;
  const dy = (endY - backY) / length;
  const claws = canvas.mask();
  for (const spread of [-1.2, 0, 1.2]) {
    claws.addPixel(round(endX + dx * (r1 + 1.2) - dy * spread), round(endY + dy * (r1 + 1.2) + dx * spread));
  }
  canvas.fill(canvas.mask().add(limb).add(claws).grown(), colours.line);
  canvas.fill(limb, colours.fill);
  canvas.fill(claws, colours.claw);
}

export interface Spark {
  birth: number;
  life: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * Small particles shed along the way. They're born at fixed frames and live by
 * their age, so they loop along with everything else.
 */
export function makeSparks(
  count: number,
  frames: number,
  spawnAt: (birth: number) => readonly [number, number],
  { life, vx, vy }: { life: readonly [number, number]; vx: readonly [number, number]; vy: readonly [number, number] },
): Spark[] {
  return Array.from({ length: count }, (_, n) => {
    const birth = (Math.floor((n * frames) / count) + round(scatter(n, 0.618034) * 4)) % frames;
    const [x, y] = spawnAt(birth);
    return {
      birth,
      life: life[0] + round(scatter(n, 0.754878) * (life[1] - life[0])),
      x,
      y,
      vx: vx[0] + scatter(n, 0.56984) * (vx[1] - vx[0]),
      vy: vy[1] - scatter(n, 0.438744) * (vy[1] - vy[0]),
    };
  });
}

/** Visit each spark alive on this frame, with its whole-pixel position and age from 0 to 1. */
export function forEachSpark(
  sparks: readonly Spark[],
  index: number,
  frames: number,
  visit: (x: number, y: number, age: number) => void,
): void {
  for (const spark of sparks) {
    const age = (index - spark.birth + frames) % frames;
    if (age < spark.life) {
      visit(round(spark.x + spark.vx * age), round(spark.y + spark.vy * age), age / spark.life);
    }
  }
}
