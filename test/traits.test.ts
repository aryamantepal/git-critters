// What each trait should look like, measured on the frames themselves.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { critters } from "../src/critters/index.ts";
import type { Critter } from "../src/engine/critter.ts";
import { DEFAULT_TRAITS, perTraits } from "../src/engine/traits.ts";
import type { Mood, Traits } from "../src/engine/traits.ts";

const MOODS: Mood[] = ["resting", "steady", "lively"];
// Every fourth frame is plenty to compare, and keeps this fast.
const STEP = 4;

function sampled(critter: Critter): number[] {
  return Array.from({ length: critter.frames / STEP }, (_, n) => n * STEP);
}

function pixelsOf(critter: Critter, traits: Traits): number[] {
  return sampled(critter).map((i) => critter.frame(i, traits).reduce((n, v) => n + (v ? 1 : 0), 0));
}

const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

/** How far the middle of the critter travels over the loop. */
function distanceTravelled(critter: Critter, traits: Traits): number {
  let total = 0;
  let previous: [number, number] | undefined;
  for (const i of [...sampled(critter), critter.frames]) {
    const pixels = critter.frame(i, traits);
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let y = 0; y < critter.height; y++) {
      for (let x = 0; x < critter.width; x++) {
        if (pixels[y * critter.width + x]) {
          sx += x;
          sy += y;
          n++;
        }
      }
    }
    const here: [number, number] = [sx / n, sy / n];
    if (previous) total += Math.hypot(here[0] - previous[0], here[1] - previous[1]);
    previous = here;
  }
  return total;
}

for (const critter of critters) {
  describe(`${critter.name} traits`, () => {
    test("each stage is bigger than the one before, in the same frame", () => {
      const sizes = ([0, 1, 2, 3] as const).map((stage) => mean(pixelsOf(critter, { ...DEFAULT_TRAITS, stage })));
      for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i] > sizes[i - 1] * 1.05, sizes.join(", "));
    });

    test("more marks always show up as more", () => {
      for (const stage of [0, 3] as const) {
        const drawn = ([0, 1, 2, 3] as const).map((marks) => {
          const traits = { ...DEFAULT_TRAITS, stage, marks };
          return sampled(critter).map((i) => critter.frame(i, traits));
        });
        const differences = drawn.map((frames) =>
          frames.reduce((total, pixels, i) => total + pixels.reduce((n, v, p) => n + (v !== drawn[0][i][p] ? 1 : 0), 0), 0),
        );
        for (let marks = 1; marks <= 3; marks++) {
          assert.ok(differences[marks] > differences[marks - 1], `stage ${stage}: ${differences.join(", ")}`);
        }
      }
    });

    test("a livelier mood travels further than a resting one, and resting still moves", () => {
      const [resting, steady, lively] = MOODS.map((mood) => distanceTravelled(critter, { ...DEFAULT_TRAITS, mood }));
      assert.ok(resting > 0);
      assert.ok(resting < steady, `${resting} against ${steady}`);
      assert.ok(steady < lively, `${steady} against ${lively}`);
    });
  });
}

test("only the most recent traits are remembered", () => {
  let built = 0;
  const memo = perTraits((traits) => {
    built++;
    return traits.stage;
  });
  memo({ ...DEFAULT_TRAITS, stage: 1 });
  memo({ ...DEFAULT_TRAITS, stage: 1 });
  assert.equal(built, 1);
  memo({ ...DEFAULT_TRAITS, stage: 2 });
  memo({ ...DEFAULT_TRAITS, stage: 1 });
  assert.equal(built, 3);
});
