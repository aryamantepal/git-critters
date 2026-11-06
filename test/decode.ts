// A small GIF decoder, so the tests read back what was actually written.
export interface DecodedFrame {
  /** RGBA for the whole canvas, after applying the previous frame's disposal. */
  rgba: Uint8Array;
  delayMs: number;
  disposal: number;
}

export interface DecodedGif {
  width: number;
  height: number;
  loops: boolean;
  frames: DecodedFrame[];
}

export function decodeGif(bytes: Uint8Array): DecodedGif {
  const text = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  if (text(0, 6) !== "GIF89a") throw new Error("not a GIF89a file");
  const word = (at: number) => bytes[at] | (bytes[at + 1] << 8);
  const width = word(6);
  const height = word(8);
  const packed = bytes[10];
  if (!(packed & 0x80)) throw new Error("no global colour table");
  const tableLength = 1 << ((packed & 7) + 1);
  const table = bytes.subarray(13, 13 + tableLength * 3);
  let at = 13 + tableLength * 3;

  const screen = new Uint8Array(width * height * 4);
  const frames: DecodedFrame[] = [];
  let loops = false;
  let delayMs = 0;
  let disposal = 0;
  let transparent = -1;
  let clearAfter: { left: number; top: number; w: number; h: number } | undefined;

  while (at < bytes.length) {
    const block = bytes[at++];
    if (block === 0x3b) break;
    if (block === 0x21) {
      const label = bytes[at++];
      if (label === 0xf9) {
        const flags = bytes[at + 1];
        disposal = (flags >> 2) & 7;
        delayMs = word(at + 2) * 10;
        transparent = flags & 1 ? bytes[at + 4] : -1;
      } else if (label === 0xff && text(at + 1, 11) === "NETSCAPE2.0") {
        loops = word(at + 14) === 0;
      }
      while (bytes[at] !== 0) at += bytes[at] + 1;
      at++;
      continue;
    }
    if (block !== 0x2c) throw new Error(`unexpected block ${block} at ${at - 1}`);

    const left = word(at);
    const top = word(at + 2);
    const w = word(at + 4);
    const h = word(at + 6);
    if (bytes[at + 8] & 0x80) throw new Error("unexpected local colour table");
    at += 9;

    const minCodeSize = bytes[at++];
    const data: number[] = [];
    while (bytes[at] !== 0) {
      const length = bytes[at++];
      for (let i = 0; i < length; i++) data.push(bytes[at + i]);
      at += length;
    }
    at++;
    const indexes = decodeLzw(data, minCodeSize, w * h);

    if (clearAfter) {
      for (let y = clearAfter.top; y < clearAfter.top + clearAfter.h; y++) {
        screen.fill(0, (y * width + clearAfter.left) * 4, (y * width + clearAfter.left + clearAfter.w) * 4);
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const index = indexes[y * w + x];
        if (index === transparent) continue;
        const to = ((top + y) * width + left + x) * 4;
        screen[to] = table[index * 3];
        screen[to + 1] = table[index * 3 + 1];
        screen[to + 2] = table[index * 3 + 2];
        screen[to + 3] = 255;
      }
    }
    frames.push({ rgba: screen.slice(), delayMs, disposal });
    clearAfter = disposal === 2 ? { left, top, w, h } : undefined;
  }
  return { width, height, loops, frames };
}

function decodeLzw(data: number[], minCodeSize: number, expected: number): Uint8Array {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  const out = new Uint8Array(expected);
  let written = 0;
  let table: number[][] = [];
  let codeSize = minCodeSize + 1;
  let previous: number[] | undefined;
  const reset = () => {
    table = Array.from({ length: clear }, (_, i) => [i]);
    table.push([], []);
    codeSize = minCodeSize + 1;
    previous = undefined;
  };
  reset();

  let bitBuffer = 0;
  let bitCount = 0;
  let at = 0;
  while (true) {
    while (bitCount < codeSize) {
      if (at >= data.length) throw new Error("ran out of data before the end code");
      bitBuffer |= data[at++] << bitCount;
      bitCount += 8;
    }
    const code = bitBuffer & ((1 << codeSize) - 1);
    bitBuffer >>>= codeSize;
    bitCount -= codeSize;

    if (code === clear) {
      reset();
      continue;
    }
    if (code === end) break;

    let entry: number[];
    if (code < table.length) {
      entry = table[code];
    } else if (code === table.length && previous) {
      entry = [...previous, previous[0]];
    } else {
      throw new Error(`bad LZW code ${code} with a table of ${table.length}`);
    }
    for (const value of entry) {
      if (written >= expected) throw new Error("frame has more pixels than its size says");
      out[written++] = value;
    }
    if (previous && table.length < 4096) {
      table.push([...previous, entry[0]]);
      if (table.length === 1 << codeSize && codeSize < 12) codeSize++;
    }
    previous = entry;
  }
  if (written !== expected) throw new Error(`frame has ${written} pixels, expected ${expected}`);
  return out;
}
