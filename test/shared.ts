// What the critter and language tests both need.
import assert from "node:assert/strict";
import type { Critter } from "../src/engine/critter.ts";
import { contrast, DARK_PAGE, LIGHT_PAGE, MIN_EDGE_CONTRAST } from "../src/engine/contrast.ts";
import type { Mood, Traits } from "../src/engine/traits.ts";

// Not every combination of traits, just the ends of each range.
export const EXTREMES: Traits[] = [];
for (const stage of [0, 3] as const) {
  for (const marks of [0, 3] as const) {
    for (const mood of ["resting", "steady", "lively"] as Mood[]) EXTREMES.push({ stage, marks, mood });
  }
}

export const describeTraits = (t: Traits) => `stage ${t.stage}, ${t.marks} marks, ${t.mood}`;

/** The palette indexes that border empty space in any frame. */
export function edgeColoursOf(critter: Critter, traits: Traits): Set<number> {
  const edgeColours = new Set<number>();
  const { width, height } = critter;
  for (let i = 0; i < critter.frames; i++) {
    const pixels = critter.frame(i, traits);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const colour = pixels[y * width + x];
        if (!colour) continue;
        const touchesAir =
          pixels[y * width + x - 1] === 0 ||
          pixels[y * width + x + 1] === 0 ||
          pixels[(y - 1) * width + x] === 0 ||
          pixels[(y + 1) * width + x] === 0;
        if (touchesAir) edgeColours.add(colour);
      }
    }
  }
  return edgeColours;
}

/** Check the colours that reach the edge of a critter's frames, at palette level. */
export function assertEdgesShow(critter: Critter, palette: Uint8Array, edgeColours: ReadonlySet<number>): void {
  for (const colour of edgeColours) {
    const rgb = [palette[colour * 3], palette[colour * 3 + 1], palette[colour * 3 + 2]];
    const name = critter.colourNames[colour - 1];
    for (const page of [LIGHT_PAGE, DARK_PAGE]) {
      const ratio = contrast(rgb, page);
      assert.ok(ratio >= MIN_EDGE_CONTRAST, `${name} is only ${ratio.toFixed(2)}:1 against ${page}`);
    }
  }
}
