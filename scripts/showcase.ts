// Render the committed showcase assets, deterministically, from the engine's critters:
//   docs/showcase.gif  - animated banner of the egg and signature critters, for the README
//   site/og.png        - 1200x630 social preview card
//   npm run showcase
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import { languageColourway } from "../src/activity/colourway.ts";
import { egg, FRESH_EGG } from "../src/critters/egg.ts";
import { findCritter } from "../src/critters/index.ts";
import type { Colourway, Critter } from "../src/engine/critter.ts";
import { paletteOf } from "../src/engine/critter.ts";
import { encodeGifFrames } from "../src/engine/gif.ts";
import type { Traits } from "../src/engine/traits.ts";

export const SHOWCASE_WIDTH = 1440;
export const SHOWCASE_HEIGHT = 480;
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const CELL_SCALE = 2;
const COLUMNS = 4;
const FRAME_COUNT = 12;
const FRAME_DELAY_MS = 60;
const SHOWCASE_TRAITS: Traits = { stage: 3, marks: 2, mood: "lively" };
const OG_BACKGROUND: readonly [number, number, number] = [0x0d, 0x11, 0x17]; // GitHub's dark page

/** The banner's cells: the egg, then signature critters in distinct language palettes. */
const SHOWCASE_CELLS: readonly { id: string; languages: [string, string] }[] = [
  { id: "egg", languages: ["TypeScript", "Python"] },
  { id: "dragon", languages: ["Rust", "Go"] },
  { id: "fox", languages: ["JavaScript", "CSS"] },
  { id: "penguin", languages: ["Python", "Ruby"] },
  { id: "ghost", languages: ["Go", "Rust"] },
  { id: "axolotl", languages: ["Java", "C++"] },
  { id: "robot", languages: ["C#", "Java"] },
  { id: "jellyfish", languages: ["Swift", "Kotlin"] },
];

/** The social card's critters, beside a big egg. */
const OG_CELLS: readonly { id: string; languages: [string, string] }[] = [
  { id: "dragon", languages: ["Rust", "Go"] },
  { id: "fox", languages: ["JavaScript", "CSS"] },
  { id: "penguin", languages: ["Python", "Ruby"] },
  { id: "ghost", languages: ["Go", "Rust"] },
  { id: "axolotl", languages: ["Java", "C++"] },
  { id: "robot", languages: ["C#", "Java"] },
];

interface Cell {
  critter: Critter;
  way: Colourway;
  traits: Traits;
}

function cellsOf(list: readonly { id: string; languages: [string, string] }[]): Cell[] {
  return list.map(({ id, languages }) => {
    const critter = id === "egg" ? egg : findCritter(id)!;
    return {
      critter,
      way: languageColourway(critter, languages),
      traits: id === "egg" ? FRESH_EGG : SHOWCASE_TRAITS,
    };
  });
}

/** Blit palette-index pixels into a target, scaled, skipping the transparent index. */
function blitIndexes(
  target: Uint8Array,
  targetWidth: number,
  pixels: Uint8Array,
  critter: Critter,
  valueOffset: number,
  ox: number,
  oy: number,
  scale: number,
): void {
  for (let y = 0; y < critter.height; y++) {
    for (let x = 0; x < critter.width; x++) {
      const pixel = pixels[y * critter.width + x];
      if (pixel === 0) continue;
      const value = valueOffset + pixel - 1;
      for (let dy = 0; dy < scale; dy++) {
        const row = (oy + y * scale + dy) * targetWidth + ox + x * scale;
        for (let dx = 0; dx < scale; dx++) target[row + dx] = value;
      }
    }
  }
}

/** Blit palette-index pixels into RGBA, painting the transparent index as the background. */
function blitRgba(
  rgba: Uint8Array,
  width: number,
  pixels: Uint8Array,
  critter: Critter,
  palette: Uint8Array,
  ox: number,
  oy: number,
  scale: number,
): void {
  for (let y = 0; y < critter.height; y++) {
    for (let x = 0; x < critter.width; x++) {
      const pixel = pixels[y * critter.width + x];
      const [r, g, b] = pixel === 0 ? OG_BACKGROUND : [palette[pixel * 3], palette[pixel * 3 + 1], palette[pixel * 3 + 2]];
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const at = ((oy + y * scale + dy) * width + ox + x * scale + dx) * 4;
          rgba[at] = r;
          rgba[at + 1] = g;
          rgba[at + 2] = b;
          rgba[at + 3] = 255;
        }
      }
    }
  }
}

/** The animated README banner: the cells in a grid, every frame sharing one palette. */
export function buildShowcaseGif(): Uint8Array {
  const list = cellsOf(SHOWCASE_CELLS);
  const paletteParts = [0, 0, 0]; // transparent index 0
  const offsets: number[] = [];
  for (const { critter, way } of list) {
    offsets.push(paletteParts.length / 3);
    const palette = paletteOf(critter, way);
    for (let i = 3; i < palette.length; i++) paletteParts.push(palette[i]);
  }
  const cellWidth = list[0].critter.width * CELL_SCALE;
  const cellHeight = list[0].critter.height * CELL_SCALE;

  const frames: Uint8Array[] = [];
  for (let f = 0; f < FRAME_COUNT; f++) {
    const frame = new Uint8Array(SHOWCASE_WIDTH * SHOWCASE_HEIGHT);
    list.forEach(({ critter, traits }, cell) => {
      const index = Math.floor((f * critter.frames) / FRAME_COUNT) % critter.frames;
      blitIndexes(
        frame,
        SHOWCASE_WIDTH,
        critter.frame(index, traits),
        critter,
        offsets[cell],
        (cell % COLUMNS) * cellWidth,
        Math.floor(cell / COLUMNS) * cellHeight,
        CELL_SCALE,
      );
    });
    frames.push(frame);
  }
  return encodeGifFrames(SHOWCASE_WIDTH, SHOWCASE_HEIGHT, new Uint8Array(paletteParts), frames, FRAME_DELAY_MS);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Encode RGBA pixels as a PNG. Deterministic for the same input. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const stride = width * 4 + 1;
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1); // filter 0
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** The 1200x630 social card: a big egg on the left, six critters in a grid on the right. */
export function buildOgPng(): Uint8Array {
  const rgba = new Uint8Array(OG_WIDTH * OG_HEIGHT * 4);
  for (let i = 0; i < OG_WIDTH * OG_HEIGHT; i++) {
    rgba[i * 4] = OG_BACKGROUND[0];
    rgba[i * 4 + 1] = OG_BACKGROUND[1];
    rgba[i * 4 + 2] = OG_BACKGROUND[2];
    rgba[i * 4 + 3] = 255;
  }
  const eggCell = cellsOf([SHOWCASE_CELLS[0]])[0];
  blitRgba(rgba, OG_WIDTH, eggCell.critter.frame(eggCell.critter.poster, eggCell.traits), eggCell.critter, paletteOf(eggCell.critter, eggCell.way), 30, 75, 4);
  cellsOf(OG_CELLS).forEach(({ critter, way, traits }, i) => {
    blitRgba(
      rgba,
      OG_WIDTH,
      critter.frame(critter.poster, traits),
      critter,
      paletteOf(critter, way),
      810 + (i % 2) * critter.width,
      135 + Math.floor(i / 2) * critter.height,
      1,
    );
  });
  return encodePng(OG_WIDTH, OG_HEIGHT, rgba);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  mkdirSync("docs", { recursive: true });
  const gif = buildShowcaseGif();
  writeFileSync("docs/showcase.gif", gif);
  const png = buildOgPng();
  writeFileSync("site/og.png", png);
  console.log(`docs/showcase.gif: ${(gif.length / 1000).toFixed(0)} KB, ${SHOWCASE_WIDTH}x${SHOWCASE_HEIGHT}, ${FRAME_COUNT} frames`);
  console.log(`site/og.png: ${(png.length / 1000).toFixed(0)} KB, ${OG_WIDTH}x${OG_HEIGHT}`);
}
