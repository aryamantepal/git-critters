// Every critter and colourway has to pass these, so adding one is mostly art.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { egg } from "../src/critters/egg.ts";
import { critters } from "../src/critters/index.ts";
import { paletteOf, SCALE } from "../src/engine/critter.ts";
import { encodeGif } from "../src/engine/gif.ts";
import { DEFAULT_TRAITS, traitsKey } from "../src/engine/traits.ts";
import type { Traits } from "../src/engine/traits.ts";
import { decodeGif } from "./decode.ts";
import type { DecodedGif } from "./decode.ts";
import { assertEdgesShow, describeTraits, edgeColoursOf, EGG_TRAITS, EXTREMES } from "./shared.ts";

const MAX_BYTES = 1_000_000;

// Reading a GIF back is the slow part, so only these are, along with the default.
// The last two are the egg's other crack levels, which the others don't use.
const READ_BACK = new Set(
  [
    { stage: 0, marks: 3, mood: "resting" },
    { stage: 0, marks: 0, mood: "lively" },
    { stage: 3, marks: 3, mood: "lively" },
    { stage: 3, marks: 0, mood: "resting" },
    { stage: 1, marks: 0, mood: "steady" },
    { stage: 2, marks: 0, mood: "lively" },
  ].map((t) => traitsKey(t as Traits)),
);

function changedIndexes(a: Uint8Array, b: Uint8Array): number {
  let changed = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changed++;
  return changed;
}

const decoded = new Map<string, { gif: DecodedGif; size: number }>();
function gifOf(critterId: string, wayId: string, traits: Traits = DEFAULT_TRAITS) {
  const key = `${critterId}/${wayId}/${traitsKey(traits)}`;
  let entry = decoded.get(key);
  if (!entry) {
    const critter = [...critters, egg].find((c) => c.id === critterId)!;
    const bytes = encodeGif(critter, wayId, traits);
    entry = { gif: decodeGif(bytes), size: bytes.length };
    decoded.set(key, entry);
  }
  return entry;
}

test("ids are unique and usable in a workflow", () => {
  const ids = critters.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z][a-z0-9-]*$/);
});

// The egg isn't a species, but it has to pass the same checks, at every crack level.
for (const critter of [...critters, egg]) {
  describe(critter.name, () => {
    test("draws the same frame every time, in any order", () => {
      for (const i of [0, Math.floor(critter.frames / 2), critter.frames - 1]) {
        const first = critter.draw(i);
        critter.draw((i + 7) % critter.frames);
        assert.deepEqual(critter.draw(i), first);
      }
      assert.equal(critter.frame(critter.frames), critter.frame(0));
    });

    test("every colourway defines every colour", () => {
      assert.ok(critter.colourways.length > 0);
      assert.equal(new Set(critter.colourways.map((w) => w.id)).size, critter.colourways.length);
      assert.ok(critter.colourNames.length + 1 <= 256);
      for (const way of critter.colourways) {
        for (const name of critter.colourNames) {
          assert.match(way.colours[name] ?? "", /^#[0-9a-f]{6}$/, `${way.id} ${name}`);
        }
      }
    });

    test("the poster is a real frame, and the alt text says what it is", () => {
      assert.ok(critter.poster >= 0 && critter.poster < critter.frames);
      assert.ok(critter.alt.length > 30);
    });

    test("no colourway's GIF is too big to load quickly", () => {
      for (const way of critter.colourways) {
        const { size } = gifOf(critter.id, way.id);
        assert.ok(size < MAX_BYTES, `${way.id} is ${size} bytes`);
      }
    });

    const way = critter.colourways[0];

    for (const traits of critter === egg ? EGG_TRAITS : EXTREMES) {
      const when = describeTraits(traits);
      const isDefault = traitsKey(traits) === traitsKey(DEFAULT_TRAITS);
      const readBack = isDefault || READ_BACK.has(traitsKey(traits));

      test(`is small enough to load quickly (${when})`, () => {
        const size = encodeGif(critter, way.id, traits).length;
        assert.ok(size < MAX_BYTES, `${size} bytes`);
      });

      if (readBack) {
        test(`saves every frame, looping forever at a steady rate (${when})`, () => {
          const { gif } = gifOf(critter.id, way.id, traits);
          assert.equal(gif.frames.length, critter.frames);
          assert.ok(gif.loops);
          assert.equal(gif.width, critter.width * SCALE);
          assert.equal(gif.height, critter.height * SCALE);
          assert.ok(gif.frames.every((f) => f.delayMs === critter.delayMs && f.disposal === 2));
        });

        test(`the saved file holds exactly what was drawn, so nothing trails behind (${when})`, () => {
          const { gif } = gifOf(critter.id, way.id, traits);
          const palette = paletteOf(critter, way.id);
          // Every frame of the default GIF, and every fifth of the others.
          for (let index = 0; index < gif.frames.length; index += isDefault ? 1 : 5) {
            const frame = gif.frames[index];
            const pixels = critter.frame(index, traits);
            for (let y = 0; y < gif.height; y++) {
              for (let x = 0; x < gif.width; x++) {
                const colour = pixels[Math.floor(y / SCALE) * critter.width + Math.floor(x / SCALE)];
                const at = (y * gif.width + x) * 4;
                if (colour === 0) {
                  assert.equal(frame.rgba[at + 3], 0, `frame ${index} has a stray pixel at ${x},${y}`);
                } else {
                  assert.equal(frame.rgba[at + 3], 255, `frame ${index} is missing a pixel at ${x},${y}`);
                  assert.equal(frame.rgba[at], palette[colour * 3]);
                  assert.equal(frame.rgba[at + 1], palette[colour * 3 + 1]);
                  assert.equal(frame.rgba[at + 2], palette[colour * 3 + 2]);
                }
              }
            }
          }
        });
      }

      test(`it's always moving, and the loop has no visible jump (${when})`, () => {
        const changes = Array.from({ length: critter.frames }, (_, i) =>
          changedIndexes(critter.frame(i, traits), critter.frame(i + 1, traits)),
        );
        assert.ok(Math.min(...changes) > 0, "two frames in a row are identical");
        const seam = changes[changes.length - 1];
        assert.ok(seam <= Math.max(...changes.slice(0, -1)), `the seam changes ${seam} pixels`);
      });

      test(`stays inside the frame (${when})`, () => {
        for (let i = 0; i < critter.frames; i++) {
          const pixels = critter.frame(i, traits);
          for (let x = 0; x < critter.width; x++) {
            assert.equal(pixels[x], 0, `frame ${i} touches the top`);
            assert.equal(pixels[(critter.height - 1) * critter.width + x], 0, `frame ${i} touches the bottom`);
          }
          for (let y = 0; y < critter.height; y++) {
            assert.equal(pixels[y * critter.width], 0, `frame ${i} touches the left`);
            assert.equal(pixels[y * critter.width + critter.width - 1], 0, `frame ${i} touches the right`);
          }
        }
      });

      test(`the outline shows on GitHub's light and dark pages (${when})`, () => {
        assertEdgesShow(critter, paletteOf(critter, way.id), edgeColoursOf(critter, traits));
      });
    }

    test("draws the same frame for the same traits, whatever was drawn in between", () => {
      const [a, b] = [EXTREMES[0], EXTREMES[EXTREMES.length - 1]];      const first = critter.frame(9, a).slice();
      critter.frame(9, b);
      assert.deepEqual(critter.frame(9, a), first);
      assert.deepEqual(critter.draw(9, a), first);
    });

    for (const colourway of critter.colourways) {
      test(`the ${colourway.name} outline shows on GitHub's light and dark pages`, () => {
        assertEdgesShow(critter, paletteOf(critter, colourway.id), edgeColoursOf(critter, DEFAULT_TRAITS));
      });
    }
  });
}
