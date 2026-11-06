"use strict";

// src/action/main.ts
var import_node_child_process = require("node:child_process");
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");

// src/engine/motion.ts
var TAU = 2 * Math.PI;
function clamp(value, low, high) {
  return Math.min(Math.max(value, low), high);
}
function round(value) {
  const rounded = Math.round(value);
  return Math.abs(value % 1) === 0.5 && rounded % 2 !== 0 ? rounded - 1 : rounded;
}
function scatter(n, seed) {
  return n * seed % 1;
}
function catmullRom(p0, p1, p2, p3, f) {
  return 0.5 * (2 * p1 + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f ** 2 + (3 * p1 - p0 - 3 * p2 + p3) * f ** 3);
}
function closedSpline(points, t) {
  const n = points.length;
  const u = t * n;
  const i = Math.floor(u);
  const f = u - i;
  const at = (k) => points[(i + k + n) % n];
  return [
    catmullRom(at(-1)[0], at(0)[0], at(1)[0], at(2)[0], f),
    catmullRom(at(-1)[1], at(0)[1], at(1)[1], at(2)[1], f)
  ];
}
function openSpline(rows, samples) {
  const n = rows.length;
  const columns = rows[0].length;
  const out = Array.from({ length: columns }, () => new Float64Array(samples));
  for (let s = 0; s < samples; s++) {
    const u = samples === 1 ? 0 : s * (n - 1) / (samples - 1);
    const i = Math.min(Math.trunc(u), n - 2);
    const f = u - i;
    const at = (k) => rows[Math.min(Math.max(i + k, 0), n - 1)];
    for (let c = 0; c < columns; c++) {
      out[c][s] = catmullRom(at(-1)[c], at(0)[c], at(1)[c], at(2)[c], f);
    }
  }
  return out;
}
function smooth(values, width) {
  const kernel = Array.from({ length: width }, (_, i) => 0.5 - 0.5 * Math.cos(TAU * (i + 1) / (width + 1)));
  const total = kernel.reduce((sum, v) => sum + v, 0);
  const n = values.length;
  const half = (width - 1) / 2;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = 0; k < width; k++) sum += kernel[k] / total * values[(i + k - half + n) % n];
    out[i] = sum;
  }
  return out;
}
function gradient(values) {
  const n = values.length;
  const out = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) out[i] = (values[i + 1] - values[i - 1]) / 2;
  out[0] = values[1] - values[0];
  out[n - 1] = values[n - 1] - values[n - 2];
  return out;
}
function flightPath(waypoints, frames) {
  const x = new Float64Array(frames);
  const y = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    [x[i], y[i]] = closedSpline(waypoints, i / frames);
  }
  const vx = new Float64Array(frames);
  const vy = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    const next = (i + 1) % frames;
    const previous = (i - 1 + frames) % frames;
    vx[i] = (x[next] - x[previous]) / 2;
    vy[i] = (y[next] - y[previous]) / 2;
  }
  return { x, y, vx, vy };
}
function yawFromTravel(vx, rest, fullSpeed, width) {
  const target = vx.map((v) => Math.PI / 2 - (Math.PI / 2 - rest) * clamp(v / fullSpeed, -1, 1));
  return smooth(target, width);
}
function cumulativePhase(rate, cycles) {
  const total = rate.reduce((sum2, v) => sum2 + v, 0);
  const out = new Float64Array(rate.length);
  let sum = 0;
  for (let i = 0; i < rate.length; i++) {
    sum += rate[i] * cycles / total;
    out[i] = TAU * sum;
  }
  return out;
}
function project(view, x, y, z = 0) {
  const cp = Math.cos(view.pitch);
  const sp = Math.sin(view.pitch);
  const px = x * cp - y * sp;
  const py = x * sp + y * cp;
  const cy = Math.cos(view.yaw);
  const sy = Math.sin(view.yaw);
  const depth = px * sy + z * cy;
  return [px * cy - z * sy + view.origin, -py + view.elevation * depth + view.origin];
}

// src/engine/body.ts
function tubeMask(canvas, view, spine, include) {
  const body = canvas.mask();
  for (let i = 0; i < spine.x.length; i++) {
    if (!include(i)) continue;
    const [sx, sy] = project(view, spine.x[i], spine.y[i], spine.z[i]);
    body.addDisc(sx, sy, spine.radius[i]);
  }
  return body;
}
function drawTube(canvas, view, spine, colours, include, hasBelly) {
  const { x, y, z, radius } = spine;
  const dx = gradient(x);
  const dy = gradient(y);
  const body = tubeMask(canvas, view, spine, include);
  const bellyArea = canvas.mask();
  for (let i = 0; i < x.length; i++) {
    if (!include(i) || !hasBelly(i)) continue;
    const r = radius[i];
    const length = Math.hypot(dx[i], dy[i]);
    const [bx, by] = project(
      view,
      x[i] + -dy[i] / length * r * 0.72,
      y[i] + dx[i] / length * r * 0.72,
      z[i]
    );
    bellyArea.addDisc(bx, by, r * 0.6);
  }
  if (colours.line !== void 0) canvas.fill(body.grown(), colours.line);
  canvas.fill(body, colours.fill);
  canvas.fill(body.minus(body.moved(0, -2)), colours.low);
  canvas.fill(body.minus(body.moved(0, 1)), colours.high);
  const belly = body.and(bellyArea);
  canvas.fill(belly, colours.belly);
  canvas.fill(belly.minus(body.moved(0, -1)), colours.bellyLow);
}
function drawLimb(canvas, view, points, z, r0, r1, colours) {
  const steps = 10;
  const [xs, ys] = openSpline(points, steps);
  const screen = Array.from(xs, (x, i) => project(view, x, ys[i], z));
  const limb = canvas.mask();
  screen.forEach(([sx, sy], i) => limb.addDisc(sx, sy, r0 + (r1 - r0) * i / (steps - 1)));
  const [endX, endY] = screen[steps - 1];
  const [backX, backY] = screen[steps - 3];
  const length = Math.hypot(endX - backX, endY - backY) || 1;
  const dx = (endX - backX) / length;
  const dy = (endY - backY) / length;
  const claws = canvas.mask();
  for (const spread of [-1.2, 0, 1.2]) {
    claws.addPixel(round(endX + dx * (r1 + 1.2) - dy * spread), round(endY + dy * (r1 + 1.2) + dx * spread));
  }
  canvas.fill(canvas.mask().add(limb).add(claws).grown(), colours.line);
  canvas.fill(limb, colours.fill);
  canvas.fill(claws, colours.claw);
}
function makeSparks(count, frames, spawnAt, { life, vx, vy }) {
  return Array.from({ length: count }, (_, n) => {
    const birth = (Math.floor(n * frames / count) + round(scatter(n, 0.618034) * 4)) % frames;
    const [x, y] = spawnAt(birth);
    return {
      birth,
      life: life[0] + round(scatter(n, 0.754878) * (life[1] - life[0])),
      x,
      y,
      vx: vx[0] + scatter(n, 0.56984) * (vx[1] - vx[0]),
      vy: vy[1] - scatter(n, 0.438744) * (vy[1] - vy[0])
    };
  });
}
function forEachSpark(sparks, index, frames, visit) {
  for (const spark of sparks) {
    const age = (index - spark.birth + frames) % frames;
    if (age < spark.life) {
      visit(round(spark.x + spark.vx * age), round(spark.y + spark.vy * age), age / spark.life);
    }
  }
}

// src/engine/mask.ts
var Mask = class _Mask {
  width;
  height;
  bits;
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.bits = new Uint8Array(width * height);
  }
  blank() {
    return new _Mask(this.width, this.height);
  }
  /** Switch on every pixel that is on in `other`. */
  add(other) {
    const { bits } = this;
    const from = other.bits;
    for (let i = 0; i < bits.length; i++) bits[i] |= from[i];
    return this;
  }
  /** A new mask of the pixels on in both this and `other`. */
  and(other) {
    const out = this.blank();
    for (let i = 0; i < out.bits.length; i++) out.bits[i] = this.bits[i] & other.bits[i];
    return out;
  }
  /** A new mask of the pixels on in this but not in `other`. */
  minus(other) {
    const out = this.blank();
    for (let i = 0; i < out.bits.length; i++) out.bits[i] = this.bits[i] & (other.bits[i] ^ 1);
    return out;
  }
  /** A new mask grown by one pixel, without corners, for clean pixel-art outlines. */
  grown() {
    const { width, height, bits } = this;
    const out = this.blank();
    const to = out.bits;
    for (let y = 0, i = 0; y < height; y++) {
      for (let x = 0; x < width; x++, i++) {
        if (!bits[i]) continue;
        to[i] = 1;
        if (x > 0) to[i - 1] = 1;
        if (x < width - 1) to[i + 1] = 1;
        if (y > 0) to[i - width] = 1;
        if (y < height - 1) to[i + width] = 1;
      }
    }
    return out;
  }
  /** A new mask shifted by whole pixels. Whatever leaves the grid is dropped. */
  moved(dx, dy) {
    const { width, height, bits } = this;
    const out = this.blank();
    for (let y = Math.max(0, -dy); y < Math.min(height, height - dy); y++) {
      for (let x = Math.max(0, -dx); x < Math.min(width, width - dx); x++) {
        out.bits[(y + dy) * width + x + dx] = bits[y * width + x];
      }
    }
    return out;
  }
  addDisc(x, y, radius) {
    const { width, height, bits } = this;
    const x0 = Math.max(0, Math.trunc(x - radius - 1));
    const x1 = Math.min(width, Math.trunc(x + radius + 2));
    const y0 = Math.max(0, Math.trunc(y - radius - 1));
    const y1 = Math.min(height, Math.trunc(y + radius + 2));
    const limit = radius * radius;
    for (let gy = y0; gy < y1; gy++) {
      const dy2 = (gy - y) * (gy - y);
      for (let gx = x0; gx < x1; gx++) {
        if ((gx - x) * (gx - x) + dy2 <= limit) bits[gy * width + gx] = 1;
      }
    }
    return this;
  }
  addPixel(x, y) {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
      this.bits[y * this.width + x] = 1;
    }
    return this;
  }
  addRow(x0, y, x1) {
    if (y < 0 || y >= this.height) return;
    const from = Math.max(0, Math.min(x0, x1));
    const to = Math.min(this.width - 1, Math.max(x0, x1));
    for (let x = from; x <= to; x++) this.bits[y * this.width + x] = 1;
  }
  /** Fill a polygon with hard pixel edges: vertices snap down to whole pixels. */
  addPolygon(points) {
    const xs = points.map((p) => Math.trunc(p[0]));
    const ys = points.map((p) => Math.trunc(p[1]));
    const edges = [];
    let top = this.height - 1;
    let bottom = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      if (xs[i] === xs[j] && ys[i] === ys[j]) continue;
      const low = Math.min(ys[i], ys[j]);
      const high = Math.max(ys[i], ys[j]);
      top = Math.min(top, low);
      bottom = Math.max(bottom, high);
      if (low === high) {
        this.addRow(xs[i], low, xs[j]);
      } else {
        edges.push({ y0: ys[i], x0: xs[i], low, high, slope: (xs[j] - xs[i]) / (ys[j] - ys[i]) });
      }
    }
    top = Math.max(0, top);
    bottom = Math.min(this.height, bottom);
    const crossings = [];
    for (let y = top; y <= bottom; y++) {
      crossings.length = 0;
      for (const edge of edges) {
        if (y < edge.low || y > edge.high) continue;
        const x = (y - edge.y0) * edge.slope + edge.x0;
        crossings.push(x);
        if (y === edge.high && y < bottom) crossings.push(x);
      }
      crossings.sort((a, b) => a - b);
      let next = 0;
      for (let i = 1; i < crossings.length; i += 2) {
        const end = Math.ceil(crossings[i] - 0.5);
        if (end < next) continue;
        const start = Math.max(next, Math.floor(crossings[i - 1] + 0.5));
        if (end < start) continue;
        this.addRow(start, y, end);
        next = end + 1;
      }
    }
    return this;
  }
  /** Draw connected one-pixel lines. Points snap down to whole pixels. */
  addLine(points) {
    for (let i = 0; i + 1 < points.length; i++) {
      let x = Math.trunc(points[i][0]);
      let y = Math.trunc(points[i][1]);
      const x1 = Math.trunc(points[i + 1][0]);
      const y1 = Math.trunc(points[i + 1][1]);
      const dx = Math.abs(x1 - x);
      const dy = Math.abs(y1 - y);
      const stepX = x1 >= x ? 1 : -1;
      const stepY = y1 >= y ? 1 : -1;
      if (dx > dy) {
        let error = 2 * dy - dx;
        for (let n = 0; n < dx; n++) {
          this.addPixel(x, y);
          if (error >= 0) {
            y += stepY;
            error -= 2 * dx;
          }
          error += 2 * dy;
          x += stepX;
        }
      } else {
        let error = 2 * dx - dy;
        for (let n = 0; n < dy; n++) {
          this.addPixel(x, y);
          if (error >= 0) {
            x += stepX;
            error -= 2 * dy;
          }
          error += 2 * dx;
          y += stepY;
        }
      }
      if (i + 2 === points.length) this.addPixel(x1, y1);
    }
    return this;
  }
};

// src/engine/canvas.ts
function parseArt(text, key) {
  const rows = text.trim().split("\n");
  const width = rows[0].length;
  const pixels = new Uint8Array(width * rows.length);
  rows.forEach((row, y) => {
    if (row.length !== width) throw new Error(`art row ${y} is ${row.length} wide, not ${width}`);
    for (let x = 0; x < width; x++) {
      if (row[x] === ".") continue;
      const colour = key[row[x]];
      if (colour === void 0) throw new Error(`art uses unknown colour "${row[x]}"`);
      pixels[y * width + x] = colour;
    }
  });
  return { width, height: rows.length, pixels };
}
function flipArt(art) {
  const pixels = new Uint8Array(art.pixels.length);
  for (let y = 0; y < art.height; y++) {
    for (let x = 0; x < art.width; x++) {
      pixels[y * art.width + (art.width - 1 - x)] = art.pixels[y * art.width + x];
    }
  }
  return { ...art, pixels };
}
var Canvas = class {
  width;
  height;
  pixels;
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height);
  }
  mask() {
    return new Mask(this.width, this.height);
  }
  fill(mask, colour) {
    const { pixels } = this;
    const { bits } = mask;
    for (let i = 0; i < pixels.length; i++) if (bits[i]) pixels[i] = colour;
  }
  /** Fill a mask with a one-pixel outline around it, like a sticker. */
  sticker(mask, colour, line) {
    this.fill(mask.grown(), line);
    this.fill(mask, colour);
  }
  stampArt(art, left, top, line) {
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
  strengthenEdges(swaps) {
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
  stampOnto(frame, offsetX, offsetY, margin) {
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
};

// src/engine/critter.ts
var SCALE = 4;
function defineCritter(definition) {
  const cache = new Array(definition.frames);
  return {
    ...definition,
    frame(index) {
      const i = (index % definition.frames + definition.frames) % definition.frames;
      return cache[i] ??= definition.draw(i);
    }
  };
}
function colourIndexes(names) {
  return Object.fromEntries(names.map((name, i) => [name, i + 1]));
}
function paletteOf(critter2, colourwayId) {
  const way = critter2.colourways.find((c) => c.id === colourwayId);
  if (!way) throw new Error(`${critter2.name} has no colourway "${colourwayId}"`);
  const palette = new Uint8Array((critter2.colourNames.length + 1) * 3);
  critter2.colourNames.forEach((name, i) => {
    const hex = way.colours[name];
    for (let c = 0; c < 3; c++) {
      palette[(i + 1) * 3 + c] = Number.parseInt(hex.slice(1 + c * 2, 3 + c * 2), 16);
    }
  });
  return palette;
}

// src/critters/axolotl.ts
var WIDTH = 180;
var HEIGHT = 120;
var FRAMES = 200;
var MARGIN = 2;
var SWIM_CYCLES = 14;
var GILL_CYCLES = 9;
var BUBBLES = 22;
var LOCAL = 130;
var ORIGIN = LOCAL / 2;
var REST_YAW = 12 * Math.PI / 180;
var WAYPOINTS = [
  [46, 74],
  [76, 42],
  [112, 58],
  [134, 36],
  [138, 76],
  [110, 90],
  [78, 72],
  [58, 92],
  [38, 56]
];
var COLOUR_NAMES = [
  "rim",
  "line",
  "body",
  "bodyHi",
  "bodyLo",
  "belly",
  "bellyLo",
  "fin",
  "gill",
  "gillHi",
  "blush",
  "eye",
  "white",
  "toe",
  "bubble"
];
var C = colourIndexes(COLOUR_NAMES);
var ART_KEY = {
  o: C.body,
  h: C.bodyHi,
  s: C.bodyLo,
  c: C.belly,
  d: C.bellyLo,
  b: C.blush,
  k: C.eye,
  w: C.white,
  n: C.line
};
var HEAD_SIDE = parseArt(
  `
.........oooooo.........
......oooohhhhhooo......
....ooohhhhhhhhhhooo....
...oohhhhhhhhhooooooo...
..ooohhhoooooooooooooo..
..oooooooooooowkkoooooo.
.ooooooooooooookkkoooooo
.ooooooooooooookkkoooooo
.ooooooooobbbooooooooooo
.sooooooonnooooooooooooo
.ssooooooooonnnnnnnnnnnn
..ssssooocccccccccccccc.
...ssssscccccccccccccc..
.....ssdddddddddddddd...
........dddddddddd......
`,
  ART_KEY
);
var HEAD_SIDE_ANCHOR = [6, 8];
var HEAD_FRONT = parseArt(
  `
........ooooooo........
.....ooohhhhhhhooo.....
...oohhhhhhhhhhhhhoo...
..oohhhhhhhhhhhhhhhoo..
.ooooooooooooooooooooo.
.oookkoooooooooookkooo.
ooookwoooooooooookwoooo
ooookkoooooooooookkoooo
oobbbooooooooooooobbboo
.ooooonooooooooonooooo.
.sooooonnnnnnnnnooooos.
..ssoooocccccccooooss..
....ssssdddddddssss....
`,
  ART_KEY
);
var HEAD_FRONT_ANCHOR = [11, 8];
function withEyeShut(art) {
  const pixels = art.pixels.slice();
  const columns = /* @__PURE__ */ new Set();
  for (let y = 5; y < 8; y++) {
    for (let x = 0; x < art.width; x++) {
      const at = y * art.width + x;
      if (pixels[at] === C.white || pixels[at] === C.eye) {
        pixels[at] = C.body;
        columns.add(x);
      }
    }
  }
  for (const x of columns) pixels[6 * art.width + x] = C.line;
  return { ...art, pixels };
}
var HEADS = {
  side: HEAD_SIDE,
  sideLeft: flipArt(HEAD_SIDE),
  blink: withEyeShut(HEAD_SIDE),
  blinkLeft: flipArt(withEyeShut(HEAD_SIDE)),
  front: HEAD_FRONT
};
var SPINE = [
  [13, 1, 5.2],
  [8, 0, 6.2],
  [1, 0, 6.6],
  [-6, 0, 5.8],
  [-13, 0, 3.9],
  [-20, 0.5, 2.5],
  [-27, 1, 1.5],
  [-33, 2, 0.7]
];
var SAMPLES = 70;
var HIP = 3 / 7;
var [SPINE_X, SPINE_Y, SPINE_R] = openSpline(SPINE, SAMPLES);
var SPINE_U = Float64Array.from({ length: SAMPLES }, (_, i) => i / (SAMPLES - 1));
var TAIL_WEIGHT = SPINE_U.map((u) => clamp((u - HIP * 0.5) / (1 - HIP * 0.5), 0, 1) ** 1.4);
var SPECKLES = [0.2, 0.3, 0.42, 0.52, 0.62];
var LIMB_OFFSET = 5;
var GILLS = [
  [1.3, 12],
  [0.85, 14],
  [0.4, 13]
];
function buildPoses() {
  const { x, y, vx, vy } = flightPath(WAYPOINTS, FRAMES);
  const yaw = yawFromTravel(vx, REST_YAW, 0.6, 9);
  const pitch = smooth(vy.map((v) => clamp(-v * 0.3, -0.28, 0.28)), 11);
  const blinks = /* @__PURE__ */ new Set([20, 21, 22, 96, 97, 98, 150, 151, 152]);
  return Array.from({ length: FRAMES }, (_, i) => ({
    x: x[i],
    y: y[i],
    swim: TAU * SWIM_CYCLES * i / FRAMES,
    gill: TAU * GILL_CYCLES * i / FRAMES,
    blink: blinks.has(i),
    view: { yaw: yaw[i], pitch: pitch[i], elevation: 0.22, origin: ORIGIN }
  }));
}
function animatedSpine(pose) {
  const y = new Float64Array(SAMPLES);
  const z = new Float64Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) {
    const tail = TAIL_WEIGHT[i];
    y[i] = SPINE_Y[i] + tail * 5 * Math.sin(pose.swim - 4.2 * SPINE_U[i]);
    z[i] = tail * 2 * Math.sin(pose.swim + 1 - 4.2 * SPINE_U[i]);
  }
  return { x: SPINE_X, y, z, radius: SPINE_R };
}
var TUBE = { fill: C.body, low: C.bodyLo, high: C.bodyHi, belly: C.belly, bellyLow: C.bellyLo };
function drawBody(canvas, pose, spine) {
  const fin = canvas.mask();
  for (let i = 0; i < SAMPLES; i++) {
    const u = SPINE_U[i];
    if (u < 0.34) continue;
    const [sx, sy] = project(pose.view, spine.x[i], spine.y[i], spine.z[i]);
    const taper = 1 - 0.7 * clamp((u - 0.85) / 0.15, 0, 1) ** 2;
    fin.addDisc(sx, sy, spine.radius[i] + (1 + 3.6 * clamp((u - 0.34) / 0.25, 0, 1)) * taper);
  }
  const body = tubeMask(canvas, pose.view, spine, () => true);
  canvas.fill(canvas.mask().add(fin).add(body).grown(), C.line);
  canvas.fill(fin, C.fin);
  drawTube(canvas, pose.view, spine, TUBE, () => true, (i) => SPINE_U[i] < 0.6);
}
function drawGills(canvas, pose, side, root) {
  const stalks = canvas.mask();
  const branches = canvas.mask();
  GILLS.forEach(([angle, length], g) => {
    const steps = 14;
    let previous;
    for (let k = 0; k <= steps; k++) {
      const s = k / steps;
      const wave = 1.6 * s * Math.sin(pose.gill + 2.2 * g - 2.5 * s + side);
      const point = project(
        pose.view,
        root[0] - 1 - s * length * Math.cos(angle) * 0.9,
        root[1] + 5 + s * length * Math.sin(angle) + wave,
        side * (5 + s * length * 0.6)
      );
      if (previous) stalks.addLine([previous, point]);
      previous = point;
      if (k % 3 === 2) {
        const [x, y] = [round(point[0]), round(point[1])];
        if (Math.abs(Math.sin(angle)) > 0.7) branches.addPixel(x - 1, y).addPixel(x + 1, y);
        else branches.addPixel(x, y - 1).addPixel(x, y + 1);
      }
    }
  });
  canvas.fill(branches, C.gillHi);
  canvas.fill(stalks, C.gill);
}
function drawHead(canvas, pose, joint) {
  const cosYaw = Math.cos(pose.view.yaw);
  let art;
  let anchorX;
  let anchorY;
  if (Math.abs(cosYaw) > 0.5) {
    [anchorX, anchorY] = HEAD_SIDE_ANCHOR;
    if (cosYaw < 0) {
      art = pose.blink ? HEADS.blinkLeft : HEADS.sideLeft;
      anchorX = art.width - 1 - anchorX;
    } else {
      art = pose.blink ? HEADS.blink : HEADS.side;
    }
  } else {
    art = HEADS.front;
    [anchorX, anchorY] = HEAD_FRONT_ANCHOR;
  }
  const [hx, hy] = project(pose.view, joint[0], joint[1], 0);
  canvas.stampArt(art, round(hx) - anchorX, round(hy) - anchorY, C.line);
}
function renderSprite(pose) {
  const canvas = new Canvas(LOCAL, LOCAL);
  const spine = animatedSpine(pose);
  const cosYaw = Math.cos(pose.view.yaw);
  const sinYaw = Math.sin(pose.view.yaw);
  const joint = [spine.x[0], spine.y[0]];
  const paddle = Math.sin(pose.swim * 0.5);
  const parts = [];
  const speckles = () => {
    const spots = canvas.mask();
    for (const u of SPECKLES) {
      const i = Math.trunc(u * (SAMPLES - 1));
      const [sx, sy] = project(pose.view, spine.x[i], spine.y[i] + spine.radius[i] * 0.45, spine.z[i]);
      spots.addDisc(sx, sy, 0.8);
    }
    canvas.fill(spots, C.bodyLo);
  };
  parts.push([
    0,
    () => {
      drawBody(canvas, pose, spine);
      speckles();
    }
  ]);
  for (const side of [1, -1]) {
    const z = side * LIMB_OFFSET;
    const near = side * cosYaw > 0;
    const limb = { fill: near ? C.body : C.bodyLo, claw: C.toe, line: C.line };
    const beat = side * paddle * 2;
    const arm = [
      [8, -4],
      [10 + beat * 0.5, -7],
      [12 + beat, -8.5]
    ];
    const leg = [
      [-6, -3.5],
      [-8 - beat * 0.5, -6.5],
      [-10 - beat, -8.5]
    ];
    parts.push([8 * sinYaw + z * cosYaw, () => drawLimb(canvas, pose.view, arm, z, 2, 1.1, limb)]);
    parts.push([-6 * sinYaw + z * cosYaw, () => drawLimb(canvas, pose.view, leg, z, 2.3, 1.2, limb)]);
    parts.push([side * cosYaw * 16 + sinYaw * 13, () => drawGills(canvas, pose, side, joint)]);
  }
  parts.push([12, () => drawHead(canvas, pose, joint)]);
  parts.sort((a, b) => a[0] - b[0]);
  for (const [, draw5] of parts) draw5();
  canvas.strengthenEdges([[C.line, C.rim]]);
  return canvas;
}
function spriteOffset(pose) {
  const glide = 1.2 * Math.sin(pose.swim * 0.5);
  return [round(pose.x) - ORIGIN, round(pose.y + glide) - ORIGIN];
}
var prepared;
function prepare() {
  if (!prepared) {
    const poses = buildPoses();
    const bubbles = makeSparks(
      BUBBLES,
      FRAMES,
      (birth) => {
        const pose = poses[birth];
        const [ox, oy] = spriteOffset(pose);
        const [hx, hy] = project(pose.view, 30, 2, 0);
        return [hx + ox, hy + oy];
      },
      { life: [22, 44], vx: [-0.12, 0.12], vy: [-0.55, -0.3] }
    );
    prepared = { poses, bubbles };
  }
  return prepared;
}
function draw(index) {
  const { poses, bubbles } = prepare();
  const frame = new Canvas(WIDTH, HEIGHT);
  forEachSpark(bubbles, index, FRAMES, (x, y, age) => {
    const inFrame = (px, py) => px >= MARGIN && px < WIDTH - MARGIN && py >= MARGIN && py < HEIGHT - MARGIN;
    const dots = age < 0.45 ? [[x, y]] : [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1]
    ];
    for (const [px, py] of dots) {
      if (inFrame(px, py)) frame.pixels[py * WIDTH + px] = C.bubble;
    }
  });
  const pose = poses[index];
  const [ox, oy] = spriteOffset(pose);
  renderSprite(pose).stampOnto(frame, ox, oy, MARGIN);
  return frame.pixels;
}
var axolotl = defineCritter({
  id: "axolotl",
  name: "Axolotl",
  blurb: "Swims around smiling, with feathery gills and a trail of bubbles.",
  alt: "Animated pixel art of a smiling axolotl with feathery gills, swimming around the frame and blowing bubbles",
  width: WIDTH,
  height: HEIGHT,
  frames: FRAMES,
  delayMs: 60,
  poster: 30,
  colourNames: COLOUR_NAMES,
  colourways: [
    {
      id: "blossom",
      name: "Blossom",
      colours: {
        rim: "#c0507e",
        line: "#6e2348",
        body: "#ffa8c6",
        bodyHi: "#ffd0e0",
        bodyLo: "#ec7ea6",
        belly: "#fff0f4",
        bellyLo: "#ffd3e0",
        fin: "#ffc7da",
        gill: "#e0407f",
        gillHi: "#ff7fb0",
        blush: "#ff7fa8",
        eye: "#2a1020",
        white: "#ffffff",
        toe: "#fff0f4",
        bubble: "#4fa8e0"
      }
    },
    {
      id: "gold",
      name: "Gold",
      colours: {
        rim: "#b57a12",
        line: "#6b4408",
        body: "#ffd35c",
        bodyHi: "#ffe89a",
        bodyLo: "#eeb02f",
        belly: "#fff8dc",
        bellyLo: "#ffe9a8",
        fin: "#ffe48a",
        gill: "#e8691f",
        gillHi: "#ff9a4d",
        blush: "#ff9d5c",
        eye: "#2c1a06",
        white: "#ffffff",
        toe: "#fff8dc",
        bubble: "#3f9fd8"
      }
    },
    {
      id: "dusk",
      name: "Dusk",
      colours: {
        rim: "#7a68c4",
        line: "#2c2358",
        body: "#6c5bb0",
        bodyHi: "#9484d6",
        bodyLo: "#51428f",
        belly: "#c9bff0",
        bellyLo: "#a699de",
        fin: "#8d7dd0",
        gill: "#d65ca8",
        gillHi: "#f28ccb",
        blush: "#b86bc4",
        eye: "#100a24",
        white: "#ffffff",
        toe: "#c9bff0",
        bubble: "#4fa8e0"
      }
    }
  ],
  draw
});

// src/critters/dragon.ts
var WIDTH2 = 180;
var HEIGHT2 = 120;
var FRAMES2 = 200;
var MARGIN2 = 2;
var FLAP_CYCLES = 24;
var SWAY_CYCLES = 12;
var EMBERS = 44;
var LOCAL2 = 140;
var ORIGIN2 = LOCAL2 / 2;
var ELEVATION = 0.25;
var REST_YAW2 = 14 * Math.PI / 180;
var WAYPOINTS2 = [
  [44, 92],
  [72, 62],
  [104, 78],
  [137, 50],
  [140, 88],
  [110, 96],
  [82, 84],
  [92, 52],
  [66, 47],
  [40, 62]
];
var COLOUR_NAMES2 = [
  "rim",
  // silhouette edge: must read on light and dark pages
  "line",
  // lines between parts of the body
  "body",
  "bodyHi",
  "bodyLo",
  "belly",
  "bellyLo",
  "wingHi",
  "wing",
  "wingLo",
  "wingFar",
  "wingFarLo",
  "horn",
  "hornLo",
  "eye",
  "white",
  "fireOuter",
  "fireMid",
  "fireInner",
  "fireCore"
];
var C2 = colourIndexes(COLOUR_NAMES2);
var ART_KEY2 = {
  o: C2.body,
  h: C2.bodyHi,
  s: C2.bodyLo,
  c: C2.belly,
  d: C2.bellyLo,
  f: C2.wing,
  g: C2.wingLo,
  i: C2.horn,
  j: C2.hornLo,
  k: C2.eye,
  n: C2.line,
  w: C2.white
};
var HEAD_SIDE2 = parseArt(
  `
ff........................
.fff.....ooooo............
..ffff.oohhhhhoo..........
...ffffohhnnhhhoo.........
fff.gggoooonnnhooo........
.ffffgooooowwknnooooo.ii..
..fffgooooowkkkooooooiij..
...gggooooowkkkoooooooooo.
.....ggooooooooooooooooono
......gooooonnoooooooooooo
......sooooooonnnnnnnnnnnn
.......sssoooocccccwcccc..
.........ssssccccccccccc..
...........sssddddddddd...
..............dddddd......
`,
  ART_KEY2
);
var HEAD_SIDE_ANCHOR2 = [9, 10];
var HEAD_SIDE_EYE_ROWS = [5, 8];
var HEAD_FRONT2 = parseArt(
  `
.....................
f...................f
ff.....ooooooo.....ff
.ff..oohhhhhhhoo..ff.
.fffoohhhhhhhhhoofff.
..ggoooohhhhhoooogg..
f.ggonnnooooonnnogg.f
.ffgowkkooooowkkogff.
..fgokkkooiookkkogf..
...goohhhhihhhhoog...
....oohhnhhhnhhoo....
....sohhhhhhhhhos....
.....sooooooooos.....
.....ssnnnnnnnss.....
......scccccccs......
.......ddddddd.......
`,
  ART_KEY2
);
var HEAD_FRONT_ANCHOR2 = [10, 11];
function withEyeShut2(art) {
  const pixels = art.pixels.slice();
  const [first, last] = HEAD_SIDE_EYE_ROWS;
  const columns = /* @__PURE__ */ new Set();
  for (let y = first; y < last; y++) {
    for (let x = 0; x < art.width; x++) {
      const at = y * art.width + x;
      if (pixels[at] === C2.white || pixels[at] === C2.eye) {
        pixels[at] = C2.body;
        columns.add(x);
      }
    }
  }
  for (const x of columns) pixels[(first + 1) * art.width + x] = C2.line;
  return { ...art, pixels };
}
var HEADS2 = {
  side: HEAD_SIDE2,
  sideLeft: flipArt(HEAD_SIDE2),
  blink: withEyeShut2(HEAD_SIDE2),
  blinkLeft: flipArt(withEyeShut2(HEAD_SIDE2)),
  front: HEAD_FRONT2
};
var SPINE2 = [
  [15, 14, 3],
  [12, 9, 3.8],
  [7.5, 3, 6.2],
  [1, 0.5, 7.2],
  [-6, -0.5, 6],
  [-12.5, -2, 4.4],
  [-19, -3, 3.2],
  [-25.5, -2.5, 2.3],
  [-30.5, 1.5, 1.6],
  [-32.5, 7, 1.1]
];
var SAMPLES2 = 90;
var CHEST = 2 / 9;
var HIP2 = 4 / 9;
var SPIKES_AT = [0.1, 0.18, 0.55, 0.66, 0.77];
var [SPINE_X2, SPINE_Y2, SPINE_R2] = openSpline(SPINE2, SAMPLES2);
var SPINE_U2 = Float64Array.from({ length: SAMPLES2 }, (_, i) => i / (SAMPLES2 - 1));
var TAIL_WEIGHT2 = SPINE_U2.map((u) => clamp((u - HIP2) / (1 - HIP2), 0, 1) ** 1.5);
var NECK_WEIGHT = SPINE_U2.map((u) => clamp((CHEST - u) / CHEST, 0, 1));
var WING_WRIST = [8, 15];
var WING_TIPS = [
  [0, 34],
  [-14, 31],
  [-24, 22],
  [-28, 10]
];
var WING_ROOT = [-15, 0];
var WING_DROOP = 0.22;
var SHOULDER = [3, 6, 3];
var ARM = [
  [7, -3],
  [10, -6],
  [13, -6.5]
];
var LEG = [
  [-6, -3.5],
  [-10, -8],
  [-15, -9.5]
];
var LIMB_OFFSET2 = 4.5;
function buildPoses2() {
  const { x, y, vx, vy } = flightPath(WAYPOINTS2, FRAMES2);
  const yaw = yawFromTravel(vx, REST_YAW2, 0.7, 7);
  const pitch = smooth(vy.map((v) => clamp(-v * 0.24, -0.3, 0.3)), 9);
  const climb = smooth(vy.map((v) => clamp(-v / 1.2, -1, 1)), 9);
  const flap = cumulativePhase(climb.map((c) => 1 + 0.4 * c), FLAP_CYCLES);
  const blinks = /* @__PURE__ */ new Set([28, 29, 30, 36, 37, 38, 128, 129, 130]);
  return Array.from({ length: FRAMES2 }, (_, i) => ({
    t: i / FRAMES2,
    x: x[i],
    y: y[i],
    vx: vx[i],
    flap: flap[i],
    lift: clamp(0.75 + 0.35 * climb[i], 0.45, 1),
    sway: TAU * SWAY_CYCLES * i / FRAMES2,
    blink: blinks.has(i),
    view: { yaw: yaw[i], pitch: pitch[i], elevation: ELEVATION, origin: ORIGIN2 }
  }));
}
function animatedSpine2(pose) {
  const y = new Float64Array(SAMPLES2);
  const z = new Float64Array(SAMPLES2);
  for (let i = 0; i < SAMPLES2; i++) {
    const tail = TAIL_WEIGHT2[i];
    y[i] = SPINE_Y2[i] + tail * 3.2 * Math.sin(pose.sway - 3 * tail) + NECK_WEIGHT[i] * Math.sin(pose.flap + 1.2);
    z[i] = tail * 2.5 * Math.sin(pose.sway + 1);
  }
  return { x: SPINE_X2, y, z, radius: SPINE_R2 };
}
function tailTip(pose, spine) {
  const last = SAMPLES2 - 1;
  return project(pose.view, spine.x[last], spine.y[last], spine.z[last]);
}
var TUBE2 = { fill: C2.body, low: C2.bodyLo, high: C2.bodyHi, belly: C2.belly, bellyLow: C2.bellyLo, line: C2.line };
function drawChain(canvas, pose, spine, include) {
  drawTube(canvas, pose.view, spine, TUBE2, (i) => include(SPINE_U2[i]), (i) => SPINE_U2[i] < 0.82);
}
function drawSpikes(canvas, pose, spine) {
  const { x, y, z } = spine;
  const dx = gradient(x);
  const dy = gradient(y);
  const mask = canvas.mask();
  for (const u of SPIKES_AT) {
    const j = Math.trunc(u * (SAMPLES2 - 1));
    const length = Math.hypot(dx[j], dy[j]);
    const alongX = dx[j] / length;
    const alongY = dy[j] / length;
    const backX = alongY;
    const backY = -alongX;
    const r = SPINE_R2[j];
    const height = 1.4 + r * 0.3;
    const halfWidth = 1 + r * 0.14;
    const corner = (side) => project(
      pose.view,
      x[j] + backX * r * 0.7 + side * alongX * halfWidth,
      y[j] + backY * r * 0.7 + side * alongY * halfWidth,
      z[j]
    );
    const tip = project(
      pose.view,
      x[j] + backX * (r + height) + alongX * height * 0.5,
      y[j] + backY * (r + height) + alongY * height * 0.5,
      z[j]
    );
    mask.addPolygon([corner(-1), tip, corner(1)]);
  }
  canvas.sticker(mask, C2.wing, C2.line);
}
function drawWing(canvas, pose, side) {
  let power = clamp((pose.lift - 0.45) / 0.25, 0, 1);
  power = power * power * (3 - 2 * power);
  const amplitude = (12 + 38 * power) * Math.PI / 180;
  const centre = (46 - 24 * power) * Math.PI / 180;
  const inner = centre + amplitude * Math.sin(pose.flap);
  const outer = centre + 6 * Math.PI / 180 + 1.15 * amplitude * Math.sin(pose.flap - 0.85);
  const point = ([along, span]) => {
    const spanIn = Math.min(span, WING_WRIST[1]);
    const spanOut = Math.max(0, span - WING_WRIST[1]);
    const up = spanIn * Math.sin(inner) + spanOut * Math.sin(outer);
    const out = spanIn * Math.cos(inner) + spanOut * Math.cos(outer);
    return project(
      pose.view,
      SHOULDER[0] + along,
      SHOULDER[1] + up + Math.min(along, 0) * WING_DROOP,
      side * (SHOULDER[2] + out)
    );
  };
  const near = side * Math.cos(pose.view.yaw) > 0;
  const shades = near ? [C2.wingHi, C2.wing, C2.wingHi, C2.wing] : [C2.wingFar, C2.wingFarLo, C2.wingFar, C2.wingFarLo];
  const shoulder = point([0, 0]);
  const wrist = point(WING_WRIST);
  const tips = WING_TIPS.map(point);
  const scallops = [...WING_TIPS.keys()].map((i) => {
    const [a0, s0] = WING_TIPS[i];
    const [a1, s1] = WING_TIPS[i + 1] ?? WING_ROOT;
    const midA = (a0 + a1) / 2;
    const midS = (s0 + s1) / 2;
    return point([midA + (WING_WRIST[0] - midA) * 0.28, midS + (WING_WRIST[1] - midS) * 0.28]);
  });
  const last = tips.length - 1;
  const panels = tips.map(
    (tip, i) => i < last ? canvas.mask().addPolygon([wrist, tip, scallops[i], tips[i + 1]]) : canvas.mask().addPolygon([wrist, tip, scallops[i], point(WING_ROOT), shoulder])
  );
  const arm = canvas.mask();
  for (let k = 0; k < 8; k++) {
    const f = k / 7;
    arm.addDisc(
      shoulder[0] + (wrist[0] - shoulder[0]) * f,
      shoulder[1] + (wrist[1] - shoulder[1]) * f,
      1.9 - 0.9 * f
    );
  }
  const outlined = canvas.mask().add(arm);
  for (const panel of panels) outlined.add(panel);
  const fingers = canvas.mask();
  for (const tip of tips) fingers.addLine([wrist, tip]);
  const edgeOn = Math.abs(tips[0][1] - wrist[1]) < 4;
  const bone = near ? C2.body : C2.bodyLo;
  const outline = outlined.grown();
  canvas.fill(outline, C2.line);
  panels.forEach((panel, i) => canvas.fill(panel, edgeOn ? shades[1] : shades[i]));
  if (!edgeOn) {
    canvas.fill(fingers.grown().minus(outline), C2.line);
    canvas.fill(fingers, bone);
  }
  canvas.fill(arm, bone);
}
function drawHead2(canvas, pose, spine) {
  const [hx, hy] = project(pose.view, spine.x[0], spine.y[0], spine.z[0]);
  const cosYaw = Math.cos(pose.view.yaw);
  let art;
  let anchorX;
  let anchorY;
  if (Math.abs(cosYaw) > 0.5) {
    [anchorX, anchorY] = HEAD_SIDE_ANCHOR2;
    if (cosYaw < 0) {
      art = pose.blink ? HEADS2.blinkLeft : HEADS2.sideLeft;
      anchorX = art.width - 1 - anchorX;
    } else {
      art = pose.blink ? HEADS2.blink : HEADS2.side;
    }
  } else {
    art = HEADS2.front;
    [anchorX, anchorY] = HEAD_FRONT_ANCHOR2;
  }
  canvas.stampArt(art, round(hx) - anchorX, round(hy) - anchorY, C2.line);
}
function drawFlame(canvas, pose, spine) {
  const [ox, oy] = tailTip(pose, spine);
  const lean = -clamp(pose.vx * 0.22, -1.1, 1.1);
  const tongues = [
    [0, 1, 31, 0],
    [-2.4, 0.62, 43, 1.7],
    [2.2, 0.7, 37, 3.1]
  ];
  const layers = [
    [C2.fireOuter, 1],
    [C2.fireMid, 0.72],
    [C2.fireInner, 0.46],
    [C2.fireCore, 0.22]
  ];
  for (const [colour, size] of layers) {
    const mask = canvas.mask();
    for (const [sideways, length, cycles, phase] of tongues) {
      const flicker = 0.85 + 0.15 * Math.sin(TAU * cycles * pose.t + phase);
      const reach = 16 * length * flicker * size ** 0.6;
      for (let n = 0; n < 14; n++) {
        const k = n / 13;
        const wiggle = k * 1.3 * Math.sin(TAU * (cycles + 11) * pose.t - 5 * k + phase);
        mask.addDisc(
          ox + k * (lean * reach + sideways) + wiggle,
          oy + (1 - size) * 2 - k * reach,
          4.2 * size * (1 - k) ** 0.75 + 0.35
        );
      }
    }
    canvas.fill(mask, colour);
  }
}
function renderSprite2(pose) {
  const canvas = new Canvas(LOCAL2, LOCAL2);
  const spine = animatedSpine2(pose);
  const cosYaw = Math.cos(pose.view.yaw);
  const sinYaw = Math.sin(pose.view.yaw);
  const parts = [[-0.5, () => drawSpikes(canvas, pose, spine)]];
  let tailDepth;
  if (Math.abs(cosYaw) > 0.5) {
    tailDepth = 0;
    parts.push([0, () => drawChain(canvas, pose, spine, () => true)]);
  } else {
    tailDepth = -8;
    parts.push([-8, () => drawChain(canvas, pose, spine, (u) => u >= HIP2)]);
    parts.push([0, () => drawChain(canvas, pose, spine, (u) => u >= CHEST && u <= HIP2 + 0.02)]);
    parts.push([8, () => drawChain(canvas, pose, spine, (u) => u <= CHEST + 0.02)]);
  }
  for (const side of [1, -1]) {
    parts.push([side * cosYaw * 15 - sinYaw * 5, () => drawWing(canvas, pose, side)]);
    const near = side * cosYaw > 0;
    const limb = { fill: near ? C2.body : C2.bodyLo, claw: near ? C2.horn : C2.hornLo, line: C2.line };
    const z = side * LIMB_OFFSET2;
    parts.push([ARM[0][0] * sinYaw + z * cosYaw, () => drawLimb(canvas, pose.view, ARM, z, 2.3, 1.3, limb)]);
    parts.push([LEG[0][0] * sinYaw + z * cosYaw, () => drawLimb(canvas, pose.view, LEG, z, 3.6, 1.6, limb)]);
  }
  parts.push([12, () => drawHead2(canvas, pose, spine)]);
  parts.push([tailDepth + 0.5, () => drawFlame(canvas, pose, spine)]);
  parts.sort((a, b) => a[0] - b[0]);
  for (const [, draw5] of parts) draw5();
  canvas.strengthenEdges([
    [C2.line, C2.rim],
    [C2.fireInner, C2.fireOuter],
    [C2.fireCore, C2.fireOuter]
  ]);
  return canvas;
}
function spriteOffset2(pose) {
  const bob = 1.5 * pose.lift * Math.sin(pose.flap);
  return [round(pose.x) - ORIGIN2, round(pose.y + bob) - ORIGIN2];
}
var prepared2;
function prepare2() {
  if (!prepared2) {
    const poses = buildPoses2();
    const embers = makeSparks(
      EMBERS,
      FRAMES2,
      (birth) => {
        const [ox, oy] = spriteOffset2(poses[birth]);
        const [tipX, tipY] = tailTip(poses[birth], animatedSpine2(poses[birth]));
        return [tipX + ox, tipY + oy - 6];
      },
      { life: [8, 17], vx: [-0.35, 0.35], vy: [-0.8, -0.35] }
    );
    prepared2 = { poses, embers };
  }
  return prepared2;
}
function draw2(index) {
  const { poses, embers } = prepare2();
  const frame = new Canvas(WIDTH2, HEIGHT2);
  forEachSpark(embers, index, FRAMES2, (x, y, age) => {
    if (x >= MARGIN2 && x < WIDTH2 - MARGIN2 && y >= MARGIN2 && y < HEIGHT2 - MARGIN2) {
      frame.pixels[y * WIDTH2 + x] = age < 0.5 ? C2.fireMid : C2.fireOuter;
    }
  });
  const pose = poses[index];
  const [ox, oy] = spriteOffset2(pose);
  renderSprite2(pose).stampOnto(frame, ox, oy, MARGIN2);
  return frame.pixels;
}
var dragon = defineCritter({
  id: "dragon",
  name: "Dragon",
  blurb: "Flaps, soars and turns to look at you, with a flame for a tail tip.",
  alt: "Animated pixel art of a dragon with a flaming tail, flapping its wings as it wanders around the frame",
  width: WIDTH2,
  height: HEIGHT2,
  frames: FRAMES2,
  delayMs: 60,
  poster: 46,
  colourNames: COLOUR_NAMES2,
  colourways: [
    {
      id: "ember",
      name: "Ember",
      colours: {
        rim: "#b4451a",
        line: "#5e2110",
        body: "#f58a2c",
        bodyHi: "#ffb65c",
        bodyLo: "#d4641f",
        belly: "#ffe6ad",
        bellyLo: "#f0bd7a",
        wingHi: "#e65a45",
        wing: "#c93a3c",
        wingLo: "#9c2a3c",
        wingFar: "#a02f3e",
        wingFarLo: "#7f2536",
        horn: "#fff3d0",
        hornLo: "#e3c48c",
        eye: "#2a1408",
        white: "#ffffff",
        fireOuter: "#e9401c",
        fireMid: "#ff8a1f",
        fireInner: "#ffd23d",
        fireCore: "#fff6c2"
      }
    },
    {
      id: "frost",
      name: "Frost",
      colours: {
        rim: "#2f6fb0",
        line: "#173a6b",
        body: "#59a8e8",
        bodyHi: "#a7dcff",
        bodyLo: "#3a7fc9",
        belly: "#e6f6ff",
        bellyLo: "#b5dcf2",
        wingHi: "#6f7fe0",
        wing: "#4f5bc4",
        wingLo: "#3b3f99",
        wingFar: "#434aa8",
        wingFarLo: "#33377f",
        horn: "#f2fbff",
        hornLo: "#b9d6e8",
        eye: "#0f2240",
        white: "#ffffff",
        fireOuter: "#2a7de1",
        fireMid: "#45b4f5",
        fireInner: "#a8ecff",
        fireCore: "#f0fdff"
      }
    },
    {
      id: "moss",
      name: "Moss",
      colours: {
        rim: "#3f7d2a",
        line: "#1f4316",
        body: "#6fbf3f",
        bodyHi: "#a6e070",
        bodyLo: "#4d9a2b",
        belly: "#f2f5c2",
        bellyLo: "#d3dc8a",
        wingHi: "#2fa98c",
        wing: "#1f8a78",
        wingLo: "#176b66",
        wingFar: "#1c7a6e",
        wingFarLo: "#155a58",
        horn: "#fbf7d6",
        hornLo: "#d7cf94",
        eye: "#16240c",
        white: "#ffffff",
        fireOuter: "#2f9e2f",
        fireMid: "#67c93a",
        fireInner: "#c8f25a",
        fireCore: "#f6ffd0"
      }
    }
  ],
  draw: draw2
});

// src/critters/ghost.ts
var WIDTH3 = 180;
var HEIGHT3 = 120;
var FRAMES3 = 200;
var MARGIN3 = 2;
var BOBS = 6;
var HEM_CYCLES = 16;
var SPARKLES = 26;
var LOCAL3 = 90;
var ORIGIN3 = LOCAL3 / 2;
var RADIUS = 15;
var SKIRT = 20;
var HEM_LOBES = 4;
var BOO_START = 104;
var BOO_END = 130;
var WAYPOINTS3 = [
  [40, 50],
  [70, 30],
  [104, 44],
  [138, 26],
  [146, 62],
  [112, 78],
  [90, 58],
  [60, 76],
  [34, 70]
];
var COLOUR_NAMES3 = ["rim", "line", "body", "bodyHi", "bodyLo", "eye", "white", "blush", "mouth", "sparkle"];
var C3 = colourIndexes(COLOUR_NAMES3);
function buildPoses3() {
  const { x, y, vx } = flightPath(WAYPOINTS3, FRAMES3);
  const look = smooth(vx.map((v) => clamp(v * 3.4, -4.5, 4.5)), 13);
  const lean = smooth(vx.map((v) => clamp(v * 1.8, -3, 3)), 21);
  const blinks = /* @__PURE__ */ new Set([30, 31, 32, 60, 61, 62, 170, 171, 172]);
  return Array.from({ length: FRAMES3 }, (_, i) => {
    const edge = Math.min(i - BOO_START, BOO_END - i);
    const boo = i >= BOO_START && i <= BOO_END ? clamp(edge / 4, 0, 1) : 0;
    return {
      x: x[i],
      y: y[i] + 2.4 * Math.sin(TAU * BOBS * i / FRAMES3),
      look: look[i],
      lean: lean[i],
      hem: TAU * HEM_CYCLES * i / FRAMES3,
      boo,
      blink: blinks.has(i)
    };
  });
}
function drawBody2(canvas, pose) {
  const body = canvas.mask();
  const stretch = 3 * pose.boo;
  const flare = 2.6 + 1.4 * pose.boo;
  const skirt = SKIRT + stretch;
  for (let y = -RADIUS - round(stretch); y <= skirt + 4; y++) {
    const row = y + stretch;
    const down = Math.max(0, y) / skirt;
    const half = row < 0 ? Math.sqrt(Math.max(0, RADIUS * RADIUS - row * row)) : RADIUS + down * flare;
    const shift = -pose.lean * down * down;
    for (let x = Math.trunc(-half - 6); x <= half + 6; x++) {
      const dx = x - shift;
      if (Math.abs(dx) > half) continue;
      const tuck = 4 * (Math.abs(dx) / half) ** 6;
      const hem = skirt - tuck + 2.2 * Math.sin(HEM_LOBES * Math.PI * (dx + half) / (2 * half) + pose.hem);
      if (y <= hem) body.addPixel(ORIGIN3 + x, ORIGIN3 + y);
    }
  }
  canvas.sticker(body, C3.body, C3.line);
  canvas.fill(body.minus(body.moved(-2, -2)), C3.bodyLo);
  canvas.fill(body.minus(body.moved(1, 2)), C3.bodyHi);
}
function drawArms(canvas, pose) {
  const arms = canvas.mask();
  const lift = 5 + 16 * pose.boo;
  const wave = 1.2 * Math.sin(pose.hem * 0.5);
  for (const side of [-1, 1]) {
    const reach = RADIUS + 1.5 + 3 * pose.boo;
    arms.addDisc(ORIGIN3 + side * reach, ORIGIN3 + 9 - lift + 5 + side * wave, 3.3);
    arms.addDisc(ORIGIN3 + side * (reach - 2), ORIGIN3 + 11 - lift + 5 + side * wave, 3);
  }
  canvas.sticker(arms, C3.body, C3.line);
  canvas.fill(arms.minus(arms.moved(-1, -1)), C3.bodyLo);
}
function drawFace(canvas, pose) {
  const cx = ORIGIN3 + round(pose.look);
  const cy = ORIGIN3 - 2 - round(3 * pose.boo);
  const eyes = canvas.mask();
  const glints = canvas.mask();
  const gap = 6;
  const tall = pose.boo > 0.5 ? 5 : 4;
  for (const side of [-1, 1]) {
    const left = cx + side * gap - 1;
    if (pose.blink) {
      for (let x = -1; x < 3; x++) eyes.addPixel(left + x, cy + 2);
      continue;
    }
    for (let y = 0; y < tall; y++) {
      for (let x = 0; x < 3; x++) {
        const bottomCorner = y === tall - 1 && x !== 1;
        if (!bottomCorner) eyes.addPixel(left + x, cy + y);
      }
    }
    glints.addPixel(left, cy);
  }
  canvas.fill(eyes, C3.eye);
  canvas.fill(glints, C3.white);
  const blush = canvas.mask();
  for (const side of [-1, 1]) {
    const bx = cx + side * (gap + 4);
    for (let x = -1; x <= 1; x++) {
      blush.addPixel(bx + x, cy + 5);
      blush.addPixel(bx + x, cy + 6);
    }
  }
  canvas.fill(blush, C3.blush);
  const mouth = canvas.mask();
  if (pose.boo > 0.5) {
    mouth.addDisc(cx, cy + 9, 3.4);
    canvas.fill(mouth, C3.mouth);
  } else {
    mouth.addPixel(cx - 2, cy + 6).addPixel(cx - 1, cy + 7).addPixel(cx, cy + 7).addPixel(cx + 1, cy + 7).addPixel(cx + 2, cy + 6);
    canvas.fill(mouth, C3.line);
  }
}
function renderSprite3(pose) {
  const canvas = new Canvas(LOCAL3, LOCAL3);
  drawBody2(canvas, pose);
  drawArms(canvas, pose);
  drawFace(canvas, pose);
  canvas.strengthenEdges([[C3.line, C3.rim]]);
  return canvas;
}
function spriteOffset3(pose) {
  return [round(pose.x) - ORIGIN3, round(pose.y) - ORIGIN3];
}
var prepared3;
function prepare3() {
  if (!prepared3) {
    const poses = buildPoses3();
    const sparkles = makeSparks(
      SPARKLES,
      FRAMES3,
      (birth) => {
        const pose = poses[birth];
        const side = birth % 2 === 0 ? -1 : 1;
        return [pose.x + side * (6 + birth % 11), pose.y + SKIRT + 4];
      },
      { life: [16, 34], vx: [-0.12, 0.12], vy: [-0.1, 0.22] }
    );
    prepared3 = { poses, sparkles };
  }
  return prepared3;
}
function draw3(index) {
  const { poses, sparkles } = prepare3();
  const frame = new Canvas(WIDTH3, HEIGHT3);
  forEachSpark(sparkles, index, FRAMES3, (x, y, age) => {
    const dots = age < 0.5 ? [
      [x, y],
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1]
    ] : [[x, y]];
    for (const [px, py] of dots) {
      if (px >= MARGIN3 && px < WIDTH3 - MARGIN3 && py >= MARGIN3 && py < HEIGHT3 - MARGIN3) {
        frame.pixels[py * WIDTH3 + px] = C3.sparkle;
      }
    }
  });
  const pose = poses[index];
  const [ox, oy] = spriteOffset3(pose);
  renderSprite3(pose).stampOnto(frame, ox, oy, MARGIN3);
  return frame.pixels;
}
var ghost = defineCritter({
  id: "ghost",
  name: "Ghost",
  blurb: "Floats about, leaves sparkles, and stops once a loop to say boo.",
  alt: "Animated pixel art of a friendly ghost floating around the frame, leaving sparkles and stopping to say boo",
  width: WIDTH3,
  height: HEIGHT3,
  frames: FRAMES3,
  delayMs: 60,
  poster: 12,
  colourNames: COLOUR_NAMES3,
  colourways: [
    {
      id: "moon",
      name: "Moon",
      colours: {
        rim: "#7d6fc0",
        line: "#4a3f86",
        body: "#f1edff",
        bodyHi: "#ffffff",
        bodyLo: "#cdc4ee",
        eye: "#2b2350",
        white: "#ffffff",
        blush: "#f7a8c4",
        mouth: "#5b3f7a",
        sparkle: "#9a86e8"
      }
    },
    {
      id: "mint",
      name: "Mint",
      colours: {
        rim: "#3f9c7f",
        line: "#1f5f4c",
        body: "#d9fbee",
        bodyHi: "#f4fffa",
        bodyLo: "#a4e6cd",
        eye: "#123a2f",
        white: "#ffffff",
        blush: "#f7b2a8",
        mouth: "#2d6b58",
        sparkle: "#3fb893"
      }
    },
    {
      id: "peach",
      name: "Peach",
      colours: {
        rim: "#c7704a",
        line: "#7c3f28",
        body: "#ffe9dc",
        bodyHi: "#fff7f1",
        bodyLo: "#f8c4a6",
        eye: "#3f1e10",
        white: "#ffffff",
        blush: "#ff9d8a",
        mouth: "#8a452c",
        sparkle: "#e0805a"
      }
    }
  ],
  draw: draw3
});

// src/critters/jellyfish.ts
var WIDTH4 = 180;
var HEIGHT4 = 120;
var FRAMES4 = 200;
var MARGIN4 = 2;
var PULSES = 8;
var MOTES = 30;
var LOCAL4 = 110;
var ORIGIN4 = LOCAL4 / 2;
var TOP = 34;
var LOBES = 8;
var TENTACLES = 7;
var WAYPOINTS4 = [
  [38, 28],
  [66, 18],
  [96, 36],
  [128, 22],
  [146, 44],
  [116, 56],
  [84, 48],
  [52, 58]
];
var COLOUR_NAMES4 = [
  "rim",
  "line",
  "bell",
  "bellHi",
  "bellLo",
  "inner",
  "spot",
  "arm",
  "armLo",
  "tentacle",
  "tentacleLo",
  "eye",
  "white",
  "blush",
  "mote"
];
var C4 = colourIndexes(COLOUR_NAMES4);
function buildPoses4() {
  const { x, y, vx } = flightPath(WAYPOINTS4, FRAMES4);
  const tilt = smooth(vx.map((v) => clamp(v * 0.35, -0.3, 0.3)), 15);
  const blinks = /* @__PURE__ */ new Set([40, 41, 42, 120, 121, 122]);
  return Array.from({ length: FRAMES4 }, (_, i) => {
    const phase = TAU * PULSES * i / FRAMES4;
    const squeeze = 0.5 - 0.5 * Math.cos(phase + 0.6 * Math.sin(phase));
    return {
      x: x[i],
      // Each squeeze pushes it up, then it sinks a little while relaxing.
      y: y[i] + 2.4 * Math.cos(phase - 0.9),
      squeeze,
      phase,
      drift: vx[i],
      tilt: tilt[i],
      blink: blinks.has(i)
    };
  });
}
function bellOutline(pose) {
  const rx = 18 - 3.5 * pose.squeeze;
  const ry = 13 + 3 * pose.squeeze;
  const cos = Math.cos(pose.tilt);
  const sin = Math.sin(pose.tilt);
  const turn = (x, y) => [
    ORIGIN4 + x * cos - y * sin,
    TOP + x * sin + y * cos
  ];
  const points = [];
  for (let n = 0; n <= 28; n++) {
    const a = Math.PI + n / 28 * Math.PI;
    points.push(turn(rx * Math.cos(a), ry * Math.sin(a)));
  }
  const steps = LOBES * 4;
  for (let n = 1; n < steps; n++) {
    const f = n / steps;
    const x = rx - 2 * rx * f;
    const scallop = Math.abs(Math.sin(Math.PI * LOBES * f));
    const ripple = 0.8 * Math.sin(pose.phase * 2 + f * TAU);
    points.push(turn(x, 1 + 2.6 * scallop + ripple));
  }
  return points;
}
function drawTentacles(canvas, pose) {
  const near = canvas.mask();
  const far = canvas.mask();
  const rx = 15 - 3 * pose.squeeze;
  for (let t = 0; t < TENTACLES; t++) {
    const f = t / (TENTACLES - 1) - 0.5;
    const length = 30 + 6 * Math.abs(Math.sin(t * 1.7)) - 5 * pose.squeeze;
    const points = [];
    for (let k = 0; k <= 14; k++) {
      const s = k / 14;
      const wave = s * 3.4 * Math.sin(pose.phase - 3.4 * s + t * 1.3);
      const trail = -pose.drift * 7 * s * s + pose.tilt * -8 * s;
      points.push([ORIGIN4 + f * 2 * rx * (1 - 0.25 * s) + wave + trail, TOP + 2 + s * length]);
    }
    (t % 2 === 0 ? near : far).addLine(points);
  }
  canvas.fill(far, C4.tentacleLo);
  canvas.fill(near, C4.tentacle);
}
function drawArms2(canvas, pose) {
  const arms = canvas.mask();
  const shade = canvas.mask();
  for (const [f, reach] of [
    [-0.42, 22],
    [0.4, 24],
    [0, 27]
  ]) {
    const length = reach - 4 * pose.squeeze;
    for (let k = 0; k <= 18; k++) {
      const s = k / 18;
      const wave = s * 2.2 * Math.sin(pose.phase - 2.6 * s + f * 6);
      const trail = -pose.drift * 5 * s * s + pose.tilt * -6 * s;
      const frill = 0.8 * Math.sin(k * 1.9 + pose.phase);
      const x = ORIGIN4 + f * 12 * (1 - 0.3 * s) + wave + trail + frill;
      const y = TOP + 1 + s * length;
      arms.addDisc(x, y, 2.5 - 1.7 * s);
      if (k % 3 === 0) shade.addDisc(x + 0.6, y, 0.9);
    }
  }
  canvas.sticker(arms, C4.arm, C4.line);
  canvas.fill(shade.and(arms), C4.armLo);
}
function drawBell(canvas, pose) {
  const bell = canvas.mask().addPolygon(bellOutline(pose));
  canvas.sticker(bell, C4.bell, C4.line);
  canvas.fill(bell.minus(bell.moved(0, -3)), C4.bellLo);
  canvas.fill(bell.minus(bell.moved(-1, 2)), C4.bellHi);
  const cos = Math.cos(pose.tilt);
  const sin = Math.sin(pose.tilt);
  const place = (x, y) => [
    round(ORIGIN4 + x * cos - y * sin),
    round(TOP + x * sin + y * cos)
  ];
  const wide = 1 - 0.18 * pose.squeeze;
  const inner = canvas.mask();
  const [ix, iy] = place(0, -8 - 2 * pose.squeeze);
  inner.addDisc(ix, iy, 7.2 * wide);
  canvas.fill(inner.and(bell), C4.inner);
  const spots = canvas.mask();
  for (const dx of [-5.2, -1.8, 1.8, 5.2]) {
    const [sx, sy] = place(dx * wide, -10 - 2 * pose.squeeze + Math.abs(dx) * 0.5);
    spots.addDisc(sx, sy, 1.5);
  }
  canvas.fill(spots.and(bell), C4.spot);
  const face = canvas.mask();
  const eye = (dx) => {
    const [ex, ey] = place(dx * wide, -3.4);
    if (pose.blink) {
      face.addPixel(ex - 1, ey + 1).addPixel(ex, ey + 1);
    } else {
      face.addPixel(ex - 1, ey).addPixel(ex, ey).addPixel(ex - 1, ey + 1).addPixel(ex, ey + 1);
    }
    return [ex, ey];
  };
  const [lx, ly] = eye(-6);
  const [rx, ry] = eye(6);
  canvas.fill(face, C4.eye);
  if (!pose.blink) {
    const glint = canvas.mask().addPixel(lx - 1, ly).addPixel(rx - 1, ry);
    canvas.fill(glint, C4.white);
  }
  const blush = canvas.mask();
  for (const dx of [-10, 10]) {
    const [bx, by] = place(dx * wide, -1.4);
    blush.addPixel(bx - 1, by).addPixel(bx, by).addPixel(bx + 1, by);
  }
  canvas.fill(blush.and(bell), C4.blush);
  const smile = canvas.mask();
  const [mx, my] = place(0, -1.6);
  smile.addPixel(mx - 2, my).addPixel(mx - 1, my + 1).addPixel(mx, my + 1).addPixel(mx + 1, my + 1).addPixel(mx + 2, my);
  canvas.fill(smile, C4.line);
}
function renderSprite4(pose) {
  const canvas = new Canvas(LOCAL4, LOCAL4);
  drawTentacles(canvas, pose);
  drawArms2(canvas, pose);
  drawBell(canvas, pose);
  canvas.strengthenEdges([[C4.line, C4.rim]]);
  return canvas;
}
function spriteOffset4(pose) {
  return [round(pose.x) - ORIGIN4, round(pose.y) - (TOP - 16)];
}
var prepared4;
function prepare4() {
  if (!prepared4) {
    const poses = buildPoses4();
    const motes = makeSparks(
      MOTES,
      FRAMES4,
      (birth) => {
        const pose = poses[birth];
        const [ox, oy] = spriteOffset4(pose);
        const side = birth % 2 === 0 ? -1 : 1;
        return [ORIGIN4 + ox + side * (8 + birth % 13), TOP + oy + 2];
      },
      { life: [18, 40], vx: [-0.14, 0.14], vy: [0.12, 0.34] }
    );
    prepared4 = { poses, motes };
  }
  return prepared4;
}
function draw4(index) {
  const { poses, motes } = prepare4();
  const frame = new Canvas(WIDTH4, HEIGHT4);
  forEachSpark(motes, index, FRAMES4, (x, y) => {
    if (x >= MARGIN4 && x < WIDTH4 - MARGIN4 && y >= MARGIN4 && y < HEIGHT4 - MARGIN4) {
      frame.pixels[y * WIDTH4 + x] = C4.mote;
    }
  });
  const pose = poses[index];
  const [ox, oy] = spriteOffset4(pose);
  renderSprite4(pose).stampOnto(frame, ox, oy, MARGIN4);
  return frame.pixels;
}
var jellyfish = defineCritter({
  id: "jellyfish",
  name: "Jellyfish",
  blurb: "Pulses gently across the frame, shedding little specks of glow.",
  alt: "Animated pixel art of a smiling jellyfish pulsing as it drifts around the frame, trailing long tentacles",
  width: WIDTH4,
  height: HEIGHT4,
  frames: FRAMES4,
  delayMs: 60,
  poster: 24,
  colourNames: COLOUR_NAMES4,
  colourways: [
    {
      id: "lagoon",
      name: "Lagoon",
      colours: {
        rim: "#2a86b8",
        line: "#134a6e",
        bell: "#7fdcf5",
        bellHi: "#c8f4ff",
        bellLo: "#4fb8e0",
        inner: "#b5efff",
        spot: "#3fa0d8",
        arm: "#a8e8fa",
        armLo: "#6cc8ea",
        tentacle: "#2f9ed0",
        tentacleLo: "#2f86c0",
        eye: "#0e2a44",
        white: "#ffffff",
        blush: "#ff9db8",
        mote: "#35a4d8"
      }
    },
    {
      id: "orchid",
      name: "Orchid",
      colours: {
        rim: "#9a55c8",
        line: "#532878",
        bell: "#d6a8f7",
        bellHi: "#f0dcff",
        bellLo: "#b57ee6",
        inner: "#ecd2ff",
        spot: "#a05ad8",
        arm: "#e2c0fb",
        armLo: "#c592ee",
        tentacle: "#a25fd6",
        tentacleLo: "#8c4cc4",
        eye: "#2a1244",
        white: "#ffffff",
        blush: "#ff8fc0",
        mote: "#a866de"
      }
    },
    {
      id: "coral",
      name: "Coral",
      colours: {
        rim: "#d4603f",
        line: "#7a2f1c",
        bell: "#ffb199",
        bellHi: "#ffdccf",
        bellLo: "#f58c6f",
        inner: "#ffd4c4",
        spot: "#e8694a",
        arm: "#ffc8b6",
        armLo: "#fa9f85",
        tentacle: "#e0694a",
        tentacleLo: "#cf5a3d",
        eye: "#3a140a",
        white: "#ffffff",
        blush: "#f0607a",
        mote: "#e56f4f"
      }
    }
  ],
  draw: draw4
});

// src/critters/index.ts
var critters = [dragon, axolotl, jellyfish, ghost];
function findCritter(id) {
  return critters.find((critter2) => critter2.id === id);
}

// src/engine/gif.ts
var TRANSPARENT = 0;
var ByteWriter = class {
  buffer = new Uint8Array(1 << 20);
  length = 0;
  reserve(extra) {
    if (this.length + extra <= this.buffer.length) return;
    const bigger = new Uint8Array(Math.max(this.buffer.length * 2, this.length + extra));
    bigger.set(this.buffer.subarray(0, this.length));
    this.buffer = bigger;
  }
  byte(value) {
    this.reserve(1);
    this.buffer[this.length++] = value;
  }
  word(value) {
    this.byte(value & 255);
    this.byte(value >> 8);
  }
  bytes(values) {
    this.reserve(values.length);
    this.buffer.set(values, this.length);
    this.length += values.length;
  }
  text(value) {
    for (let i = 0; i < value.length; i++) this.byte(value.charCodeAt(i));
  }
  result() {
    return this.buffer.slice(0, this.length);
  }
};
var HASH_SIZE = 1 << 14;
var hashKeys = new Int32Array(HASH_SIZE);
var hashCodes = new Int16Array(HASH_SIZE);
function writeLzw(out, pixels, minCodeSize) {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  out.byte(minCodeSize);
  const block = new Uint8Array(255);
  let blockLength = 0;
  let bitBuffer = 0;
  let bitCount = 0;
  let codeSize = minCodeSize + 1;
  let nextCode = end + 1;
  const emit = (code) => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      block[blockLength++] = bitBuffer & 255;
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
    const key = current << 8 | pixel;
    let slot = (current << 6 ^ pixel) & HASH_SIZE - 1;
    while (hashKeys[slot] !== -1 && hashKeys[slot] !== key) {
      slot = slot + 1 & HASH_SIZE - 1;
    }
    if (hashKeys[slot] === key) {
      current = hashCodes[slot];
      continue;
    }
    emit(current);
    if (nextCode === 4096) {
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
  if (nextCode === 1 << codeSize && codeSize < 12) codeSize++;
  emit(end);
  if (bitCount > 0) block[blockLength++] = bitBuffer & 255;
  if (blockLength > 0) {
    out.byte(blockLength);
    out.bytes(block.subarray(0, blockLength));
  }
  out.byte(0);
}
function encodeGif(critter2, colourwayId) {
  const { width, height, frames, delayMs } = critter2;
  const palette = paletteOf(critter2, colourwayId);
  const colours = palette.length / 3;
  let tableBits = 2;
  while (1 << tableBits < colours) tableBits++;
  const out = new ByteWriter();
  out.text("GIF89a");
  out.word(width * SCALE);
  out.word(height * SCALE);
  out.byte(128 | tableBits - 1);
  out.byte(TRANSPARENT);
  out.byte(0);
  out.bytes(palette);
  out.bytes(new Uint8Array((1 << tableBits) * 3 - palette.length));
  out.bytes([33, 255, 11]);
  out.text("NETSCAPE2.0");
  out.bytes([3, 1, 0, 0, 0]);
  const delay = Math.round(delayMs / 10);
  for (let index = 0; index < frames; index++) {
    const pixels = critter2.frame(index);
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
    out.bytes([33, 249, 4, 2 << 2 | 1]);
    out.word(delay);
    out.bytes([TRANSPARENT, 0]);
    const tileWidth = (right - left + 1) * SCALE;
    const tileHeight = (bottom - top + 1) * SCALE;
    out.byte(44);
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
  out.byte(59);
  return out.result();
}

// src/action/readme.ts
var START = "<!-- git-critters:start -->";
var END = "<!-- git-critters:end -->";
var KIT_URL = "https://github.com/aryamantepal/git-critters";
function escapeAttribute(text) {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
function critterBlock(critter2, gifPath2) {
  return [
    START,
    '<p align="center">',
    `  <img src="${escapeAttribute(gifPath2)}" width="${critter2.width * SCALE}" alt="${escapeAttribute(critter2.alt)}" />`,
    "  <br />",
    `  <sub>Made with <a href="${KIT_URL}">git-critters</a></sub>`,
    "</p>",
    END
  ].join("\n");
}
function withCritterBlock(readme2, block) {
  const start = readme2.indexOf(START);
  const end = readme2.indexOf(END);
  if (start !== -1 && end > start) {
    return readme2.slice(0, start) + block + readme2.slice(end + END.length);
  }
  return readme2.trim() === "" ? `${block}
` : `${block}

${readme2}`;
}

// src/action/main.ts
function input(name) {
  return (process.env[`INPUT_${name.toUpperCase()}`] ?? "").trim();
}
function fail(message) {
  console.log(`::error::${message}`);
  process.exit(1);
}
function git(...args) {
  return (0, import_node_child_process.execFileSync)("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}
var critter = findCritter(input("critter"));
if (!critter) {
  fail(`Unknown critter "${input("critter")}". Choose from: ${critters.map((c) => c.id).join(", ")}.`);
}
var colourway = input("colour") || critter.colourways[0].id;
if (!critter.colourways.some((way) => way.id === colourway)) {
  fail(
    `${critter.name} doesn't come in "${colourway}". Choose from: ${critter.colourways.map((way) => way.id).join(", ")}.`
  );
}
var gifPath = input("output") || "critter.gif";
if (gifPath.startsWith("/") || gifPath.split("/").includes("..")) {
  fail(`output must be a path inside the repository, not "${gifPath}".`);
}
(0, import_node_fs.mkdirSync)((0, import_node_path.dirname)(gifPath), { recursive: true });
(0, import_node_fs.writeFileSync)(gifPath, encodeGif(critter, colourway));
var readmeName = (0, import_node_fs.readdirSync)(".").find((name) => /^readme(\.md)?$/i.test(name)) ?? "README.md";
var readme = (0, import_node_fs.existsSync)(readmeName) ? (0, import_node_fs.readFileSync)(readmeName, "utf8") : "";
(0, import_node_fs.writeFileSync)(readmeName, withCritterBlock(readme, critterBlock(critter, gifPath)));
git("add", "--force", "--", gifPath, readmeName);
if (git("diff", "--cached", "--name-only").trim() === "") {
  console.log("The critter is already up to date, so there's nothing to commit.");
  process.exit(0);
}
git("config", "user.name", "github-actions[bot]");
git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");
git("commit", "--quiet", "--message", `critter: draw the ${colourway} ${critter.id}`);
git("push", "--quiet");
console.log(`Added the ${colourway} ${critter.id} to ${readmeName}.`);
