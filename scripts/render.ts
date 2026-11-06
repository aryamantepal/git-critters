// Render one critter to a GIF, for working on its art.
//   npm run render -- dragon ember out.gif
import { writeFileSync } from "node:fs";
import { critters, findCritter } from "../src/critters/index.ts";
import { encodeGif } from "../src/engine/gif.ts";

const [id = "dragon", colourway, out] = process.argv.slice(2);
const critter = findCritter(id);
if (!critter) {
  console.error(`Unknown critter "${id}". Choose from: ${critters.map((c) => c.id).join(", ")}`);
  process.exit(1);
}
const way = colourway ?? critter.colourways[0].id;
const path = out ?? `${critter.id}-${way}.gif`;

const started = performance.now();
for (let i = 0; i < critter.frames; i++) critter.frame(i);
const drawn = performance.now();
const gif = encodeGif(critter, way);
const encoded = performance.now();
writeFileSync(path, gif);

const drawMs = drawn - started;
console.log(
  `${path}: ${(gif.length / 1000).toFixed(0)} KB, ${critter.frames} frames, ` +
    `drew in ${drawMs.toFixed(0)} ms (${(drawMs / critter.frames).toFixed(1)} ms a frame), ` +
    `encoded in ${(encoded - drawn).toFixed(0)} ms`,
);
