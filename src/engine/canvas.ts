import { Mask } from "./mask.ts";

/** A sprite drawn as text: each character is a colour, "." is see-through. */
export interface Art {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export function parseArt(text: string, key: Readonly<Record<string, number>>): Art {
  const rows = text.trim().split("\n");
  const width = rows[0].length;
  const pixels = new Uint8Array(width * rows.length);
  rows.forEach((row, y) => {
    if (row.length !== width) throw new Error(`art row ${y} is ${row.length} wide, not ${width}`);
    for (let x = 0; x < width; x++) {
      if (row[x] === ".") continue;
      const colour = key[row[x]];
      if (colour === undefined) throw new Error(`art uses unknown colour "${row[x]}"`);
      pixels[y * width + x] = colour;
    }
  });
  return { width, height: rows.length, pixels };
}

export function flipArt(art: Art): Art {
  const pixels = new Uint8Array(art.pixels.length);
  for (let y = 0; y < art.height; y++) {
    for (let x = 0; x < art.width; x++) {
      pixels[y * art.width + (art.width - 1 - x)] = art.pixels[y * art.width + x];
    }
  }
  return { ...art, pixels };
}

/** A grid of palette indexes. Index 0 is always transparent. */
export class Canvas {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height);
  }

  mask(): Mask {
    return new Mask(this.width, this.height);
  }

  fill(mask: Mask, colour: number): void {
    const { pixels } = this;
    const { bits } = mask;
    for (let i = 0; i < pixels.length; i++) if (bits[i]) pixels[i] = colour;
  }

  /** Fill a mask with a one-pixel outline around it, like a sticker. */
  sticker(mask: Mask, colour: number, line: number): void {
    this.fill(mask.grown(), line);
    this.fill(mask, colour);
  }

  stampArt(art: Art, left: number, top: number, line: number): void {
    const shape = this.mask();
    for (let y = 0; y < art.height; y++) {
      for (let x = 0; x < art.width; x++) {
        if (art.pixels[y * art.width + x]) shape.addPixel(left + x, top + y);
      }
    }
    this.fill(shape.grown(), line);
    for (let y = 0; y < art.height; y++) {
      for (let x = 0; x < art.width; x++) {
        const colour = art.pixels[y * art.width + x];
        const at = (top + y) * this.width + left + x;
        if (colour && at >= 0 && at < this.pixels.length) this.pixels[at] = colour;
      }
    }
  }

  /**
   * GIF transparency is all or nothing, so the outermost pixels alone decide how
   * a sprite reads against the page. Swap any that would get lost for ones that
   * show on both light and dark. Each entry maps a colour to its replacement.
   */
  strengthenEdges(swaps: ReadonlyArray<readonly [number, number]>): void {
    const empty = this.mask();
    const { pixels } = this;
    for (let i = 0; i < pixels.length; i++) empty.bits[i] = pixels[i] === 0 ? 1 : 0;
    const air = empty.grown().bits;
    for (let i = 0; i < pixels.length; i++) {
      if (!air[i]) continue;
      for (const [from, to] of swaps) {
        if (pixels[i] === from) {
          pixels[i] = to;
          break;
        }
      }
    }
  }

  /**
   * Copy this sprite onto a frame at a whole-pixel offset, so it never shimmers.
   * Throws if it would leave the frame or come closer than `margin` to the edge.
   */
  stampOnto(frame: Canvas, offsetX: number, offsetY: number, margin: number): void {
    const { width, height, pixels } = this;
    for (let y = 0, i = 0; y < height; y++) {
      for (let x = 0; x < width; x++, i++) {
        if (!pixels[i]) continue;
        const fx = x + offsetX;
        const fy = y + offsetY;
        if (fx < margin || fy < margin || fx >= frame.width - margin || fy >= frame.height - margin) {
          throw new Error(`sprite pixel at ${fx},${fy} is outside the ${frame.width}x${frame.height} frame`);
        }
        frame.pixels[fy * frame.width + fx] = pixels[i];
      }
    }
  }
}
