import type { Point } from "./mask.ts";
import { flightPath } from "./motion.ts";
import type { Flight } from "./motion.ts";

export type Mood = "resting" | "steady" | "lively";

export interface Traits {
  /** Size: 0 hatchling to 3 elder. */
  stage: 0 | 1 | 2 | 3;
  /** How many marks the body carries, 0 to 3. */
  marks: 0 | 1 | 2 | 3;
  mood: Mood;
}

/** Today's art: full size, no marks, the usual motion. */
export const DEFAULT_TRAITS: Traits = { stage: 3, marks: 0, mood: "steady" };

/** How big each stage is, as a fraction of the full-size critter. */
export const STAGE_SCALE = [0.55, 0.7, 0.85, 1] as const;

const PACE: Readonly<Record<Mood, number>> = { resting: 0.5, steady: 1, lively: 1.4 };

export function traitsKey(traits: Traits): string {
  return `${traits.stage}${traits.marks}${traits.mood}`;
}

/** A cycle count for this mood. It stays a whole number, so loops still close. */
export function cyclesFor(mood: Mood, steady: number): number {
  return Math.max(1, Math.round(steady * PACE[mood]));
}

/** The frames with eyes shut. A resting critter closes them for longer each time. */
export function blinkFrames(mood: Mood, starts: readonly number[], frames: number): Set<number> {
  const length = mood === "resting" ? 14 : 3;
  const shut = new Set<number>();
  for (const start of starts) for (let n = 0; n < length; n++) shut.add((start + n) % frames);
  return shut;
}

/**
 * The path a critter flies. Lively goes round twice per loop, resting stays near
 * the middle of it, and steady is the path as drawn.
 */
export function roam(waypoints: readonly Point[], mood: Mood, frames: number): Flight {
  if (mood === "lively") return flightPath(waypoints, frames, 2);
  if (mood === "steady") return flightPath(waypoints, frames);
  const cx = waypoints.reduce((sum, p) => sum + p[0], 0) / waypoints.length;
  const cy = waypoints.reduce((sum, p) => sum + p[1], 0) / waypoints.length;
  const near = waypoints.map((p): Point => [cx + (p[0] - cx) * 0.3, cy + (p[1] - cy) * 0.3]);
  return flightPath(near, frames);
}

/**
 * Remember what `build` made for the most recent traits only. One combination's
 * frames come to about 4 MB, so keeping every combination would add up.
 */
export function perTraits<T>(build: (traits: Traits) => T): (traits: Traits) => T {
  let key = "";
  let value: T | undefined;
  return (traits) => {
    const next = traitsKey(traits);
    if (next !== key || value === undefined) {
      value = build(traits);
      key = next;
    }
    return value;
  };
}
