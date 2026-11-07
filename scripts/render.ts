// Render one critter to a GIF, for working on its art. Traits are optional.
//   npm run render -- dragon ember out.gif
//   npm run render -- dragon ember out.gif stage=1 marks=2 mood=lively
import { writeFileSync } from "node:fs";
import { critters, findCritter } from "../src/critters/index.ts";
import { encodeGif } from "../src/engine/gif.ts";
import { DEFAULT_TRAITS } from "../src/engine/traits.ts";
import type { Mood, Traits } from "../src/engine/traits.ts";

const [id = "dragon", colourway, out, ...options] = process.argv.slice(2);
const critter = findCritter(id);
if (!critter) {
  console.error(`Unknown critter "${id}". Choose from: ${critters.map((c) => c.id).join(", ")}`);
  process.exit(1);
}
const way = colourway ?? critter.colourways[0].id;
const path = out ?? `${critter.id}-${way}.gif`;

const traits: Traits = { ...DEFAULT_TRAITS };
for (const option of options) {
  const [name, value] = option.split("=");
  if (name === "stage" && ["0", "1", "2", "3"].includes(value)) traits.stage = Number(value) as Traits["stage"];
  else if (name === "marks" && ["0", "1", "2", "3"].includes(value)) traits.marks = Number(value) as Traits["marks"];
  else if (name === "mood" && ["resting", "steady", "lively"].includes(value)) traits.mood = value as Mood;
  else {
    console.error(`Unknown option "${option}". Use stage=0-3, marks=0-3 or mood=resting|steady|lively.`);
    process.exit(1);
  }
}

const started = performance.now();
for (let i = 0; i < critter.frames; i++) critter.frame(i, traits);
const drawn = performance.now();
const gif = encodeGif(critter, way, traits);
const encoded = performance.now();
writeFileSync(path, gif);

const drawMs = drawn - started;
console.log(
  `${path}: ${(gif.length / 1000).toFixed(0)} KB, ${critter.frames} frames, ` +
    `drew in ${drawMs.toFixed(0)} ms (${(drawMs / critter.frames).toFixed(1)} ms a frame), ` +
    `encoded in ${(encoded - drawn).toFixed(0)} ms`,
);
