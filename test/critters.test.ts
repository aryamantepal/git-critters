// Every critter and colourway has to pass these, so adding one is mostly art.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { critters } from "../src/critters/index.ts";
import { paletteOf, SCALE } from "../src/engine/critter.ts";
import { encodeGif } from "../src/engine/gif.ts";
import { decodeGif } from "./decode.ts";
import type { DecodedGif } from "./decode.ts";

const LIGHT = [255, 255, 255];
const DARK = [0x0d, 0x11, 0x17];
const MAX_BYTES = 1_000_000;
const MIN_EDGE_CONTRAST = 2;

function luminance(r: number, g: number, b: number): number {
  const linear = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: number[], b: number[]): number {
  const la = luminance(a[0], a[1], a[2]);
  const lb = luminance(b[0], b[1], b[2]);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function changedPixels(a: Uint8Array, b: Uint8Array): number {
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) changed++;
  }
  return changed;
}

const decoded = new Map<string, { gif: DecodedGif; size: number }>();
function gifOf(critterId: string, wayId: string) {
  const key = `${critterId}/${wayId}`;
  let entry = decoded.get(key);
  if (!entry) {
    const critter = critters.find((c) => c.id === critterId)!;
    const bytes = encodeGif(critter, wayId);
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

for (const critter of critters) {
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

    test("saves every frame, looping forever at a steady rate", () => {
      const { gif } = gifOf(critter.id, way.id);
      assert.equal(gif.frames.length, critter.frames);
      assert.ok(gif.loops);
      assert.equal(gif.width, critter.width * SCALE);
      assert.equal(gif.height, critter.height * SCALE);
      assert.ok(gif.frames.every((f) => f.delayMs === critter.delayMs && f.disposal === 2));
    });

    test("the saved file holds exactly what was drawn, so nothing trails behind", () => {
      const { gif } = gifOf(critter.id, way.id);
      const palette = paletteOf(critter, way.id);
      gif.frames.forEach((frame, index) => {
        const pixels = critter.frame(index);
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
      });
    });

    test("it's always moving, and the loop has no visible jump", () => {
      const { gif } = gifOf(critter.id, way.id);
      const changes = gif.frames.map((frame, i) =>
        changedPixels(frame.rgba, gif.frames[(i + 1) % gif.frames.length].rgba),
      );
      assert.ok(Math.min(...changes) > 0, "two frames in a row are identical");
      const seam = changes[changes.length - 1];
      assert.ok(seam <= Math.max(...changes.slice(0, -1)), `the seam changes ${seam} pixels`);
    });

    test("stays inside the frame", () => {
      for (let i = 0; i < critter.frames; i++) {
        const pixels = critter.frame(i);
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

    for (const colourway of critter.colourways) {
      test(`the ${colourway.name} outline shows on GitHub's light and dark pages`, () => {
        const palette = paletteOf(critter, colourway.id);
        const edgeColours = new Set<number>();
        for (let i = 0; i < critter.frames; i++) {
          const pixels = critter.frame(i);
          const { width, height } = critter;
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
        for (const colour of edgeColours) {
          const rgb = [palette[colour * 3], palette[colour * 3 + 1], palette[colour * 3 + 2]];
          const name = critter.colourNames[colour - 1];
          for (const page of [LIGHT, DARK]) {
            const ratio = contrast(rgb, page);
            assert.ok(ratio >= MIN_EDGE_CONTRAST, `${name} is only ${ratio.toFixed(2)}:1 against ${page}`);
          }
        }
      });
    }
  });
}
