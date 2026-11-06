import type { Point } from "./mask.ts";

export const TAU = 2 * Math.PI;

export function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** Round to the nearest whole number, with halves going to the even neighbour. */
export function round(value: number): number {
  const rounded = Math.round(value);
  return Math.abs(value % 1) === 0.5 && rounded % 2 !== 0 ? rounded - 1 : rounded;
}

/** A spread-out, repeatable number in [0, 1) for the nth item, without randomness. */
export function scatter(n: number, seed: number): number {
  return (n * seed) % 1;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, f: number): number {
  return (
    0.5 *
    (2 * p1 +
      (p2 - p0) * f +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * f ** 2 +
      (3 * p1 - p0 - 3 * p2 + p3) * f ** 3)
  );
}

/** A point on the closed curve through `points`, with t in [0, 1). */
export function closedSpline(points: readonly Point[], t: number): Point {
  const n = points.length;
  const u = t * n;
  const i = Math.floor(u);
  const f = u - i;
  const at = (k: number) => points[(i + k + n) % n];
  return [
    catmullRom(at(-1)[0], at(0)[0], at(1)[0], at(2)[0], f),
    catmullRom(at(-1)[1], at(0)[1], at(1)[1], at(2)[1], f),
  ];
}

/** Sample the open curve through `rows`, each a list of numbers, end to end. */
export function openSpline(rows: readonly (readonly number[])[], samples: number): Float64Array[] {
  const n = rows.length;
  const columns = rows[0].length;
  const out = Array.from({ length: columns }, () => new Float64Array(samples));
  for (let s = 0; s < samples; s++) {
    const u = samples === 1 ? 0 : (s * (n - 1)) / (samples - 1);
    const i = Math.min(Math.trunc(u), n - 2);
    const f = u - i;
    const at = (k: number) => rows[Math.min(Math.max(i + k, 0), n - 1)];
    for (let c = 0; c < columns; c++) {
      out[c][s] = catmullRom(at(-1)[c], at(0)[c], at(1)[c], at(2)[c], f);
    }
  }
  return out;
}

/** Smooth a series that repeats, without breaking the repeat. `width` must be odd. */
export function smooth(values: Float64Array, width: number): Float64Array {
  const kernel = Array.from({ length: width }, (_, i) => 0.5 - 0.5 * Math.cos((TAU * (i + 1)) / (width + 1)));
  const total = kernel.reduce((sum, v) => sum + v, 0);
  const n = values.length;
  const half = (width - 1) / 2;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = 0; k < width; k++) sum += (kernel[k] / total) * values[(i + k - half + n) % n];
    out[i] = sum;
  }
  return out;
}

/** The slope along a series: central differences, one-sided at the two ends. */
export function gradient(values: Float64Array): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) out[i] = (values[i + 1] - values[i - 1]) / 2;
  out[0] = values[1] - values[0];
  out[n - 1] = values[n - 1] - values[n - 2];
  return out;
}

export interface Flight {
  x: Float64Array;
  y: Float64Array;
  /** Logical pixels per frame. */
  vx: Float64Array;
  vy: Float64Array;
}

/** Fly a closed path through `waypoints`, one sample per frame. */
export function flightPath(waypoints: readonly Point[], frames: number): Flight {
  const x = new Float64Array(frames);
  const y = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    [x[i], y[i]] = closedSpline(waypoints, i / frames);
  }
  const vx = new Float64Array(frames);
  const vy = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    const next = (i + 1) % frames;
    const previous = (i - 1 + frames) % frames;
    vx[i] = (x[next] - x[previous]) / 2;
    vy[i] = (y[next] - y[previous]) / 2;
  }
  return { x, y, vx, vy };
}

/**
 * How far a body turns from side-on, following horizontal travel. `rest` faces
 * right, pi/2 faces the viewer, and pi - `rest` faces left.
 */
export function yawFromTravel(vx: Float64Array, rest: number, fullSpeed: number, width: number): Float64Array {
  const target = vx.map((v) => Math.PI / 2 - (Math.PI / 2 - rest) * clamp(v / fullSpeed, -1, 1));
  return smooth(target, width);
}

/** Phases that always complete a whole number of cycles, going faster where `rate` is high. */
export function cumulativePhase(rate: Float64Array, cycles: number): Float64Array {
  const total = rate.reduce((sum, v) => sum + v, 0);
  const out = new Float64Array(rate.length);
  let sum = 0;
  for (let i = 0; i < rate.length; i++) {
    sum += (rate[i] * cycles) / total;
    out[i] = TAU * sum;
  }
  return out;
}

export interface View {
  yaw: number;
  pitch: number;
  /** How far above the critter the viewer sits. */
  elevation: number;
  origin: number;
}

/** Model space (x forward, y up, z toward the viewer) to sprite pixels. */
export function project(view: View, x: number, y: number, z = 0): Point {
  const cp = Math.cos(view.pitch);
  const sp = Math.sin(view.pitch);
  const px = x * cp - y * sp;
  const py = x * sp + y * cp;
  const cy = Math.cos(view.yaw);
  const sy = Math.sin(view.yaw);
  const depth = px * sy + z * cy;
  return [px * cy - z * sy + view.origin, -py + view.elevation * depth + view.origin];
}
