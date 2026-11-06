import { paletteOf, SCALE } from "./critter.ts";
import type { Colourway, Critter } from "./critter.ts";
import { DEFAULT_TRAITS } from "./traits.ts";
import type { Traits } from "./traits.ts";

const TRANSPARENT = 0;

class ByteWriter {
  private buffer = new Uint8Array(1 << 20);
  length = 0;

  private reserve(extra: number): void {
    if (this.length + extra <= this.buffer.length) return;
    const bigger = new Uint8Array(Math.max(this.buffer.length * 2, this.length + extra));
    bigger.set(this.buffer.subarray(0, this.length));
    this.buffer = bigger;
  }

  byte(value: number): void {
    this.reserve(1);
    this.buffer[this.length++] = value;
  }

  word(value: number): void {
    this.byte(value & 0xff);
    this.byte(value >> 8);
  }

  bytes(values: ArrayLike<number>): void {
    this.reserve(values.length);
    this.buffer.set(values, this.length);
    this.length += values.length;
  }

  text(value: string): void {
    for (let i = 0; i < value.length; i++) this.byte(value.charCodeAt(i));
  }

  result(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }
}

const HASH_SIZE = 1 << 14;
const hashKeys = new Int32Array(HASH_SIZE);
const hashCodes = new Int16Array(HASH_SIZE);

/** LZW-compress one frame's pixels into GIF data sub-blocks. */
function writeLzw(out: ByteWriter, pixels: Uint8Array, minCodeSize: number): void {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  out.byte(minCodeSize);

  const block = new Uint8Array(255);
  let blockLength = 0;
  let bitBuffer = 0;
  let bitCount = 0;
  let codeSize = minCodeSize + 1;
  let nextCode = end + 1;

  const emit = (code: number) => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      block[blockLength++] = bitBuffer & 0xff;
      bitBuffer >>>= 8;
      bitCount -= 8;
      if (blockLength === 255) {
        out.byte(255);
        out.bytes(block);
        blockLength = 0;
      }
    }
  };

  hashKeys.fill(-1);
  emit(clear);
  let current = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const pixel = pixels[i];
    const key = (current << 8) | pixel;
    let slot = ((current << 6) ^ pixel) & (HASH_SIZE - 1);
    while (hashKeys[slot] !== -1 && hashKeys[slot] !== key) {
      slot = (slot + 1) & (HASH_SIZE - 1);
    }
    if (hashKeys[slot] === key) {
      current = hashCodes[slot];
      continue;
    }
    emit(current);
    if (nextCode === 4096) {
      // The code table is full: tell the decoder to start again.
      emit(clear);
      hashKeys.fill(-1);
      codeSize = minCodeSize + 1;
      nextCode = end + 1;
    } else {
      if (nextCode === 1 << codeSize) codeSize++;
      hashKeys[slot] = key;
      hashCodes[slot] = nextCode++;
    }
    current = pixel;
  }
  emit(current);
  // A decoder adds a table entry after every code but the first, so account for
  // the one it will have added before reading the end code.
  if (nextCode === 1 << codeSize && codeSize < 12) codeSize++;
  emit(end);
  if (bitCount > 0) block[blockLength++] = bitBuffer & 0xff;
  if (blockLength > 0) {
    out.byte(blockLength);
    out.bytes(block.subarray(0, blockLength));
  }
  out.byte(0);
}

/** Encode a critter as a looping GIF that clears every frame, so nothing trails behind. */
export function encodeGif(
  critter: Critter,
  colourway: string | Colourway,
  traits: Traits = DEFAULT_TRAITS,
): Uint8Array {
  const { width, height, frames, delayMs } = critter;
  const palette = paletteOf(critter, colourway);
  const colours = palette.length / 3;
  let tableBits = 2;
  while (1 << tableBits < colours) tableBits++;

  const out = new ByteWriter();
  out.text("GIF89a");
  out.word(width * SCALE);
  out.word(height * SCALE);
  out.byte(0x80 | (tableBits - 1)); // has a global colour table
  out.byte(TRANSPARENT); // background colour index
  out.byte(0);
  out.bytes(palette);
  out.bytes(new Uint8Array((1 << tableBits) * 3 - palette.length));

  // Loop forever.
  out.bytes([0x21, 0xff, 0x0b]);
  out.text("NETSCAPE2.0");
  out.bytes([0x03, 0x01, 0x00, 0x00, 0x00]);

  const delay = Math.round(delayMs / 10);
  for (let index = 0; index < frames; index++) {
    const pixels = critter.frame(index, traits);

    // Store only the part of the frame the critter occupies.
    let left = width;
    let right = -1;
    let top = height;
    let bottom = -1;
    for (let y = 0, i = 0; y < height; y++) {
      for (let x = 0; x < width; x++, i++) {
        if (pixels[i] === TRANSPARENT) continue;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        bottom = y;
      }
    }
    if (right < 0) {
      left = right = top = bottom = 0;
    }

    out.bytes([0x21, 0xf9, 0x04, (2 << 2) | 1]); // restore to background, has transparency
    out.word(delay);
    out.bytes([TRANSPARENT, 0x00]);

    const tileWidth = (right - left + 1) * SCALE;
    const tileHeight = (bottom - top + 1) * SCALE;
    out.byte(0x2c);
    out.word(left * SCALE);
    out.word(top * SCALE);
    out.word(tileWidth);
    out.word(tileHeight);
    out.byte(0);

    const tile = new Uint8Array(tileWidth * tileHeight);
    for (let y = 0; y < tileHeight; y++) {
      const sourceRow = (top + Math.floor(y / SCALE)) * width + left;
      for (let x = 0; x < tileWidth; x++) {
        tile[y * tileWidth + x] = pixels[sourceRow + Math.floor(x / SCALE)];
      }
    }
    writeLzw(out, tile, tableBits);
  }
  out.byte(0x3b);
  return out.result();
}
