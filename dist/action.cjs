"use strict";

// src/action/main.ts
var import_node_child_process = require("node:child_process");
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");

// src/engine/contrast.ts
var LIGHT_PAGE = [255, 255, 255];
var DARK_PAGE = [13, 17, 23];
var MIN_EDGE_CONTRAST = 2;
function luminance(r, g, b) {
  const linear = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}
function contrast(a, b) {
  const la = luminance(a[0], a[1], a[2]);
  const lb = luminance(b[0], b[1], b[2]);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function showsOnBothPages(rgb, margin = 1) {
  return contrast(rgb, LIGHT_PAGE) >= MIN_EDGE_CONTRAST * margin && contrast(rgb, DARK_PAGE) >= MIN_EDGE_CONTRAST * margin;
}

// src/activity/languages.ts
var LANGUAGE_COLOURS = {
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  Python: "#3572A5",
  Java: "#b07219",
  C: "#555555",
  "C++": "#f34b7d",
  "C#": "#7355dd",
  Go: "#00ADD8",
  Rust: "#dea584",
  Ruby: "#701516",
  PHP: "#4F5D95",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
  Dart: "#00B4AB",
  Shell: "#89e051",
  HTML: "#e34c26",
  CSS: "#663399",
  SCSS: "#c6538c",
  Lua: "#000080",
  Perl: "#0298c3",
  R: "#198CE7",
  Scala: "#c22d40",
  Haskell: "#5e5086",
  Elixir: "#8847B9",
  Clojure: "#db5855",
  Vue: "#41b883",
  "Jupyter Notebook": "#DA5B0B",
  "Objective-C": "#438eff",
  PowerShell: "#012456",
  Dockerfile: "#384d54",
  Makefile: "#427819",
  TeX: "#3D6117",
  MATLAB: "#e16737",
  Julia: "#a270ba",
  Zig: "#ec915c",
  Nix: "#7e7eff",
  OCaml: "#ef7a08",
  Svelte: "#ff3e00",
  Erlang: "#B83998",
  Groovy: "#4298b8",
  CoffeeScript: "#244776",
  "F#": "#b845fc",
  Elm: "#60B5CC",
  Astro: "#ff5a03"
};
function topLanguages(repos) {
  const counts = /* @__PURE__ */ new Map();
  for (const { fork, language } of repos) {
    if (fork || !language || !Object.hasOwn(LANGUAGE_COLOURS, language)) continue;
    counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  return [...counts].sort(([a, countA], [b, countB]) => countB - countA || (a < b ? -1 : 1)).slice(0, 2).map(([language]) => language);
}

// src/activity/colourway.ts
var LANGUAGES_COLOURWAY = "languages";
var MIN_SATURATION = 0.12;
function toHsl(hex) {
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255);
  const high = Math.max(r, g, b);
  const low = Math.min(r, g, b);
  const l = (high + low) / 2;
  if (high === low) return [0, 0, l];
  const d = high - low;
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = high === r ? (g - b) / d % 6 : high === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}
function toRgb([h, s, l]) {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(h / 60 % 2 - 1));
  const m = l - chroma / 2;
  const sextant = Math.floor(h / 60) % 6;
  const [r, g, b] = [
    [chroma, x, 0],
    [x, chroma, 0],
    [0, chroma, x],
    [0, x, chroma],
    [x, 0, chroma],
    [chroma, 0, x]
  ][sextant];
  return [r, g, b].map((v) => Math.round((v + m) * 255));
}
function toHex(hsl) {
  return `#${toRgb(hsl).map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
function turnFor(language, reference) {
  const target = language ? LANGUAGE_COLOURS[language] : void 0;
  if (!target) return 0;
  const [hue, saturation] = toHsl(target);
  return saturation < MIN_SATURATION ? 0 : hue - toHsl(reference)[0];
}
function nudgeToShow(hsl) {
  let [h, s, l] = hsl;
  const margin = MIN_EDGE_CONTRAST * 1.02;
  for (let step = 0; step < 100; step++) {
    const rgb = toRgb([h, s, l]);
    if (contrast(rgb, LIGHT_PAGE) < margin) l = Math.max(0, l - 0.01);
    else if (contrast(rgb, DARK_PAGE) < margin) l = Math.min(1, l + 0.01);
    else break;
  }
  return [h, s, l];
}
function languageColourway(critter, languages) {
  const base = critter.colourways[0];
  const [top, second = top] = languages;
  const bodyTurn = turnFor(top, base.colours[critter.bodyColour]);
  const accentTurn = turnFor(second, base.colours[critter.accentColours[0]]);
  const colours = {};
  for (const name of critter.colourNames) {
    const original = base.colours[name];
    const turn = critter.fixedColours.includes(name) ? 0 : critter.accentColours.includes(name) ? accentTurn : bodyTurn;
    if (turn === 0) {
      colours[name] = original;
      continue;
    }
    const [h, s, l] = toHsl(original);
    let turned = [(h + turn + 360) % 360, s, l];
    if (critter.edgeColours.includes(name) && !showsOnBothPages(toRgb(turned), 1.02)) turned = nudgeToShow(turned);
    colours[name] = toHex(turned);
  }
  return { id: LANGUAGES_COLOURWAY, name: "My languages", colours };
}

// src/activity/egg.ts
var HATCH_AFTER = 25;
function crackLevelFor(contributions) {
  return Math.min(3, Math.floor(contributions * 4 / HATCH_AFTER));
}
function hasHatched(contributions) {
  return contributions >= HATCH_AFTER;
}
var SURPRISE_POOL = Object.freeze(["dragon", "axolotl", "jellyfish", "ghost"]);
function surpriseFor(login) {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(login.toLowerCase())) {
    hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  }
  return SURPRISE_POOL[hash % SURPRISE_POOL.length];
}

// src/activity/traits.ts
var STAGE_FROM = [100, 1e3, 5e3];
var MARKS_FROM = [7, 30, 100];
var LIVELY_FROM = 5;
var DAY_MS = 24 * 60 * 60 * 1e3;
function utcDay(date) {
  return date.toISOString().slice(0, 10);
}
function dayNumber(day) {
  return Date.parse(`${day}T00:00:00Z`) / DAY_MS;
}
function countAbove(thresholds, value) {
  return thresholds.filter((from) => value >= from).length;
}
function stageFor(lifetimeContributions2) {
  return countAbove(STAGE_FROM, lifetimeContributions2);
}
function longestStreak(days, today) {
  const last = dayNumber(utcDay(today));
  const active = days.filter((day) => day.contributionCount > 0).map((day) => dayNumber(day.date)).filter((number) => number <= last && number > last - 365).sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  active.forEach((number, i) => {
    run = i > 0 && number === active[i - 1] + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  });
  return longest;
}
function marksFor(days, today) {
  return countAbove(MARKS_FROM, longestStreak(days, today));
}
function yesterday(today) {
  return utcDay(new Date(today.getTime() - DAY_MS));
}
function moodFor(days, today) {
  const count = days.find((day) => day.date === yesterday(today))?.contributionCount ?? 0;
  return count === 0 ? "resting" : count < LIVELY_FROM ? "steady" : "lively";
}
function traitsFor(activity, today) {
  return {
    stage: stageFor(activity.lifetimeContributions),
    marks: marksFor(activity.days, today),
    mood: moodFor(activity.days, today)
  };
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
function flightPath(waypoints, frames, laps = 1) {
  const x = new Float64Array(frames);
  const y = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    [x[i], y[i]] = closedSpline(waypoints, laps * i / frames % 1);
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

// src/engine/traits.ts
var DEFAULT_TRAITS = { stage: 3, marks: 0, mood: "steady" };
var STAGE_SCALE = [0.55, 0.7, 0.85, 1];
var PACE = { resting: 0.5, steady: 1, lively: 1.4 };
function traitsKey(traits) {
  return `${traits.stage}${traits.marks}${traits.mood}`;
}
function cyclesFor(mood, steady) {
  return Math.max(1, Math.round(steady * PACE[mood]));
}
function blinkFrames(mood, starts, frames) {
  const length = mood === "resting" ? 14 : 3;
  const shut = /* @__PURE__ */ new Set();
  for (const start of starts) for (let n = 0; n < length; n++) shut.add((start + n) % frames);
  return shut;
}
function roam(waypoints, mood, frames) {
  if (mood === "lively") return flightPath(waypoints, frames, 2);
  if (mood === "steady") return flightPath(waypoints, frames);
  const cx = waypoints.reduce((sum, p) => sum + p[0], 0) / waypoints.length;
  const cy = waypoints.reduce((sum, p) => sum + p[1], 0) / waypoints.length;
  const near = waypoints.map((p) => [cx + (p[0] - cx) * 0.3, cy + (p[1] - cy) * 0.3]);
  return flightPath(near, frames);
}
function perTraits(build) {
  let key = "";
  let value;
  return (traits) => {
    const next = traitsKey(traits);
    if (next !== key || value === void 0) {
      value = build(traits);
      key = next;
    }
    return value;
  };
}

// src/engine/critter.ts
var SCALE = 4;
function defineCritter(definition) {
  let cacheKey = "";
  let cache = [];
  return {
    ...definition,
    draw: (index, traits = DEFAULT_TRAITS) => definition.draw(index, traits),
    frame(index, traits = DEFAULT_TRAITS) {
      const key = traitsKey(traits);
      if (key !== cacheKey) {
        cache = new Array(definition.frames);
        cacheKey = key;
      }
      const i = (index % definition.frames + definition.frames) % definition.frames;
      return cache[i] ??= definition.draw(i, traits);
    }
  };
}
function colourIndexes(names) {
  return Object.fromEntries(names.map((name, i) => [name, i + 1]));
}
function paletteOf(critter, colourway) {
  const way = typeof colourway === "string" ? critter.colourways.find((c) => c.id === colourway) : colourway;
  if (!way) throw new Error(`${critter.name} has no colourway "${colourway}"`);
  const palette = new Uint8Array((critter.colourNames.length + 1) * 3);
  critter.colourNames.forEach((name, i) => {
    const hex = way.colours[name];
    for (let c = 0; c < 3; c++) {
      palette[(i + 1) * 3 + c] = Number.parseInt(hex.slice(1 + c * 2, 3 + c * 2), 16);
    }
  });
  return palette;
}

// src/critters/egg.ts
var WIDTH = 180;
var HEIGHT = 120;
var FRAMES = 96;
var MARGIN = 2;
var LOCAL_WIDTH = 56;
var LOCAL_HEIGHT = 64;
var MIDDLE = 28;
var TOP = 5;
var SHELL_HEIGHT = 50;
var SHELL_HALF_WIDTH = 21;
var BOTTOM = TOP + SHELL_HEIGHT - 1;
var FLOOR = 90;
var ACTIVE = 0.62;
var TWINKLE = [0, 1, 2, 3, 2, 1];
var GLOW_BEAT = 24;
var LEAN = { resting: 2.5, steady: 3.5, lively: 4.5 };
var HOP = 4;
var COLOUR_NAMES = ["rim", "shell", "shellHi", "shellLo", "speck", "crack", "glow", "gleam"];
var C = colourIndexes(COLOUR_NAMES);
var SPECKS = [
  [4, 7, 2, 2],
  [-4, 10, 2, 1],
  [12, 13, 2, 2],
  [-9, 17, 3, 2],
  [7, 19, 2, 1],
  [-16, 22, 2, 2],
  [16, 24, 2, 2],
  [0, 26, 3, 2],
  [-11, 31, 2, 1],
  [10, 32, 2, 2],
  [-3, 36, 3, 2],
  [-15, 38, 2, 1],
  [14, 38, 2, 1],
  [3, 42, 2, 1]
];
var CRACKS = [
  { from: 1, glow: true, points: [[1, 3], [4, 7], [2, 10], [6, 14]] },
  { from: 2, glow: true, points: [[6, 14], [5, 18], [9, 22]] },
  { from: 2, glow: false, points: [[-15, 30], [-10, 28], [-9, 33], [-4, 31]] },
  { from: 2, glow: false, points: [[12, 36], [9, 38], [10, 42]] },
  { from: 3, glow: true, points: [[-19, 27], [-13, 22], [-8, 29], [-2, 21], [4, 30], [10, 22], [19, 28]] }
];
function poseAt(index, mood) {
  const bursts = cyclesFor(mood, 2);
  const length = FRAMES / bursts;
  const at = index % length / length;
  const swing = at < ACTIVE ? Math.sin(Math.PI * at / ACTIVE) ** 2 * Math.sin(TAU * 2 * at / ACTIVE) : 0;
  const hopAt = (at - 0.7) / 0.24;
  return {
    lean: LEAN[mood] * swing,
    hop: mood === "lively" && hopAt > 0 && hopAt < 1 ? HOP * Math.sin(Math.PI * hopAt) : 0,
    twinkle: TWINKLE[index % TWINKLE.length],
    glowing: Math.sin(TAU * index / GLOW_BEAT) > 0
  };
}
function shellMask(canvas) {
  const shell = canvas.mask();
  for (let row = 0; row < SHELL_HEIGHT; row++) {
    const s = (row + 0.5) / SHELL_HEIGHT * 2 - 1;
    const half = SHELL_HALF_WIDTH * Math.sqrt(1 - s * s) * (1 + 0.14 * s);
    for (let x = 0; x < LOCAL_WIDTH; x++) if (Math.abs(x + 0.5 - MIDDLE) <= half) shell.addPixel(x, TOP + row);
  }
  return shell;
}
function stroke(mask, points) {
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let n = 0; n <= steps; n++) {
      mask.addPixel(MIDDLE + round(x0 + (x1 - x0) * n / steps), TOP + round(y0 + (y1 - y0) * n / steps));
    }
  }
  return mask;
}
function drawShell(level, pose) {
  const canvas = new Canvas(LOCAL_WIDTH, LOCAL_HEIGHT);
  const shell = shellMask(canvas);
  canvas.fill(shell, C.shell);
  canvas.fill(shell.minus(shell.moved(-3, -2)), C.shellLo);
  canvas.fill(shell.minus(shell.moved(2, 2)), C.shellHi);
  const gloss = canvas.mask();
  for (let y = 0; y < LOCAL_HEIGHT; y++) {
    for (let x = 0; x < LOCAL_WIDTH; x++) {
      const across = (x + 0.5 - MIDDLE + 9.5) / 3.2;
      const down = (y + 0.5 - TOP - 14) / 6.5;
      if (across * across + down * down <= 1) gloss.addPixel(x, y);
    }
  }
  gloss.addPixel(MIDDLE - 12, TOP + 23).addPixel(MIDDLE - 12, TOP + 24);
  canvas.fill(gloss.and(shell), C.shellHi);
  const specks = canvas.mask();
  for (const [dx, dy, width, height] of SPECKS) {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) specks.addPixel(MIDDLE + dx + x, TOP + dy + y);
  }
  canvas.fill(specks.and(shell), C.speck);
  const thin = canvas.mask();
  const lit = canvas.mask();
  for (const crack of CRACKS) {
    if (crack.from <= level) stroke(crack.glow && level === 3 ? lit : thin, crack.points);
  }
  if (pose.glowing) lit.add(lit.moved(0, 1));
  canvas.fill(thin.add(lit.grown().minus(lit)).and(shell), C.crack);
  canvas.fill(lit.and(shell), C.glow);
  const gleam = canvas.mask();
  if (pose.twinkle > 0) {
    gleam.addPixel(MIDDLE - 10, TOP + 8);
    for (let n = 1; n < pose.twinkle; n++) {
      gleam.addPixel(MIDDLE - 10 + n, TOP + 8).addPixel(MIDDLE - 10 - n, TOP + 8);
      gleam.addPixel(MIDDLE - 10, TOP + 8 + n).addPixel(MIDDLE - 10, TOP + 8 - n);
    }
  }
  canvas.fill(gleam.and(shell), C.gleam);
  return canvas;
}
function draw(index, traits) {
  const pose = poseAt(index, traits.mood);
  const upright = drawShell(traits.stage, pose);
  const rocked = new Canvas(LOCAL_WIDTH, LOCAL_HEIGHT);
  for (let y = TOP; y <= BOTTOM; y++) {
    const shift = round(pose.lean * (BOTTOM - y) / SHELL_HEIGHT);
    for (let x = 0; x < LOCAL_WIDTH; x++) {
      const colour = upright.pixels[y * LOCAL_WIDTH + x];
      if (colour) rocked.pixels[y * LOCAL_WIDTH + x + shift] = colour;
    }
  }
  const sprite = new Canvas(LOCAL_WIDTH, LOCAL_HEIGHT);
  const solid = sprite.mask();
  rocked.pixels.forEach((colour, i) => solid.bits[i] = colour ? 1 : 0);
  sprite.fill(solid.grown(), C.rim);
  rocked.pixels.forEach((colour, i) => {
    if (colour) sprite.pixels[i] = colour;
  });
  const frame = new Canvas(WIDTH, HEIGHT);
  sprite.stampOnto(frame, WIDTH / 2 - MIDDLE, FLOOR - (BOTTOM + 1) - round(pose.hop), MARGIN);
  return frame.pixels;
}
var FRESH_EGG = { stage: 0, marks: 0, mood: "steady" };
var egg = defineCritter({
  id: "egg",
  name: "Egg",
  blurb: "A speckled egg that rocks from side to side.",
  alt: "Animated pixel art of a speckled egg rocking gently from side to side",
  width: WIDTH,
  height: HEIGHT,
  frames: FRAMES,
  delayMs: 60,
  poster: 9,
  colourNames: COLOUR_NAMES,
  bodyColour: "shell",
  accentColours: ["speck"],
  fixedColours: ["glow", "gleam"],
  edgeColours: ["rim"],
  colourways: [
    {
      id: "cream",
      name: "Cream",
      colours: {
        rim: "#a86f32",
        shell: "#f5dba6",
        shellHi: "#fff4d4",
        shellLo: "#dcb374",
        speck: "#c4553a",
        crack: "#8c5a2e",
        glow: "#ffd23f",
        gleam: "#ffffff"
      }
    }
  ],
  draw
});

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
function bandPositions(from, gap, scale, count) {
  return Array.from({ length: count }, (_, n) => from + n * gap / scale);
}
function drawBands(canvas, view, spine, positions, body, colour) {
  const dx = gradient(spine.x);
  const dy = gradient(spine.y);
  const bands = canvas.mask();
  for (const u of positions) {
    const i = Math.trunc(u * (spine.x.length - 1));
    const length = Math.hypot(dx[i], dy[i]);
    const [nx, ny] = [dy[i] / length, -dx[i] / length];
    const edge = (side) => project(
      view,
      spine.x[i] + nx * spine.radius[i] * side,
      spine.y[i] + ny * spine.radius[i] * side,
      spine.z[i]
    );
    const [[x0, y0], [x1, y1]] = [edge(-0.1), edge(1.4)];
    bands.addLine([[x0, y0], [x1, y1]]).addLine([[x0 + 1, y0], [x1 + 1, y1]]);
  }
  canvas.fill(bands.and(body), colour);
}

// src/critters/axolotl.ts
var WIDTH2 = 180;
var HEIGHT2 = 120;
var FRAMES2 = 200;
var MARGIN2 = 2;
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
var COLOUR_NAMES2 = [
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
var C2 = colourIndexes(COLOUR_NAMES2);
var ART_KEY = {
  o: C2.body,
  h: C2.bodyHi,
  s: C2.bodyLo,
  c: C2.belly,
  d: C2.bellyLo,
  b: C2.blush,
  k: C2.eye,
  w: C2.white,
  n: C2.line
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
      if (pixels[at] === C2.white || pixels[at] === C2.eye) {
        pixels[at] = C2.body;
        columns.add(x);
      }
    }
  }
  for (const x of columns) pixels[6 * art.width + x] = C2.line;
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
var SPINES = STAGE_SCALE.map((k) => openSpline(SPINE.map(([x, y, r]) => [x * k, y * k, r * k]), SAMPLES));
var SPINE_U = Float64Array.from({ length: SAMPLES }, (_, i) => i / (SAMPLES - 1));
var TAIL_WEIGHT = SPINE_U.map((u) => clamp((u - HIP * 0.5) / (1 - HIP * 0.5), 0, 1) ** 1.4);
var SPECKLES = [0.2, 0.3, 0.42, 0.52, 0.62];
var BANDS_FROM = 0.28;
var BAND_GAP = 0.09;
var LIMB_OFFSET = 5;
var GILLS = [
  [1.3, 12],
  [0.85, 14],
  [0.4, 13]
];
function buildPoses({ mood }) {
  const { x, y, vx, vy } = roam(WAYPOINTS, mood, FRAMES2);
  const yaw = yawFromTravel(vx, REST_YAW, 0.6, 9);
  const pitch = smooth(vy.map((v) => clamp(-v * 0.3, -0.28, 0.28)), 11);
  const blinks = blinkFrames(mood, [20, 96, 150], FRAMES2);
  const swim = cyclesFor(mood, SWIM_CYCLES);
  const gill = cyclesFor(mood, GILL_CYCLES);
  return Array.from({ length: FRAMES2 }, (_, i) => ({
    x: x[i],
    y: y[i],
    swim: TAU * swim * i / FRAMES2,
    gill: TAU * gill * i / FRAMES2,
    blink: blinks.has(i),
    view: { yaw: yaw[i], pitch: pitch[i], elevation: 0.22, origin: ORIGIN }
  }));
}
function animatedSpine(pose, k, stage) {
  const [SPINE_X, SPINE_Y, SPINE_R] = SPINES[stage];
  const y = new Float64Array(SAMPLES);
  const z = new Float64Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) {
    const tail = TAIL_WEIGHT[i];
    y[i] = SPINE_Y[i] + tail * 5 * k * Math.sin(pose.swim - 4.2 * SPINE_U[i]);
    z[i] = tail * 2 * k * Math.sin(pose.swim + 1 - 4.2 * SPINE_U[i]);
  }
  return { x: SPINE_X, y, z, radius: SPINE_R };
}
var TUBE = { fill: C2.body, low: C2.bodyLo, high: C2.bodyHi, belly: C2.belly, bellyLow: C2.bellyLo };
function drawBody(canvas, pose, spine, k) {
  const fin = canvas.mask();
  for (let i = 0; i < SAMPLES; i++) {
    const u = SPINE_U[i];
    if (u < 0.34) continue;
    const [sx, sy] = project(pose.view, spine.x[i], spine.y[i], spine.z[i]);
    const taper = 1 - 0.7 * clamp((u - 0.85) / 0.15, 0, 1) ** 2;
    fin.addDisc(sx, sy, spine.radius[i] + (1 + 3.6 * clamp((u - 0.34) / 0.25, 0, 1)) * taper * k);
  }
  const body = tubeMask(canvas, pose.view, spine, () => true);
  canvas.fill(canvas.mask().add(fin).add(body).grown(), C2.line);
  canvas.fill(fin, C2.fin);
  drawTube(canvas, pose.view, spine, TUBE, () => true, (i) => SPINE_U[i] < 0.6);
}
function drawGills(canvas, pose, side, root, k) {
  const stalks = canvas.mask();
  const branches = canvas.mask();
  GILLS.forEach(([angle, fullLength], g) => {
    const length = fullLength * k;
    const steps = 14;
    let previous;
    for (let n = 0; n <= steps; n++) {
      const s = n / steps;
      const wave = 1.6 * k * s * Math.sin(pose.gill + 2.2 * g - 2.5 * s + side);
      const point = project(
        pose.view,
        root[0] - k - s * length * Math.cos(angle) * 0.9,
        root[1] + 5 * k + s * length * Math.sin(angle) + wave,
        side * (5 * k + s * length * 0.6)
      );
      if (previous) stalks.addLine([previous, point]);
      previous = point;
      if (n % 3 === 2) {
        const [x, y] = [round(point[0]), round(point[1])];
        if (Math.abs(Math.sin(angle)) > 0.7) branches.addPixel(x - 1, y).addPixel(x + 1, y);
        else branches.addPixel(x, y - 1).addPixel(x, y + 1);
      }
    }
  });
  canvas.fill(branches, C2.gillHi);
  canvas.fill(stalks, C2.gill);
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
  canvas.stampArt(art, round(hx) - anchorX, round(hy) - anchorY, C2.line);
}
function renderSprite(pose, traits) {
  const k = STAGE_SCALE[traits.stage];
  const canvas = new Canvas(LOCAL, LOCAL);
  const spine = animatedSpine(pose, k, traits.stage);
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
    canvas.fill(spots, C2.bodyLo);
  };
  parts.push([
    0,
    () => {
      drawBody(canvas, pose, spine, k);
      speckles();
      drawBands(
        canvas,
        pose.view,
        spine,
        bandPositions(BANDS_FROM, BAND_GAP, k, traits.marks),
        tubeMask(canvas, pose.view, spine, () => true),
        C2.gill
      );
    }
  ]);
  for (const side of [1, -1]) {
    const z = side * LIMB_OFFSET * k;
    const near = side * cosYaw > 0;
    const limb = { fill: near ? C2.body : C2.bodyLo, claw: C2.toe, line: C2.line };
    const beat = side * paddle * 2;
    const arm = [
      [8, -4],
      [10 + beat * 0.5, -7],
      [12 + beat, -8.5]
    ].map(([x, y]) => [x * k, y * k]);
    const leg = [
      [-6, -3.5],
      [-8 - beat * 0.5, -6.5],
      [-10 - beat, -8.5]
    ].map(([x, y]) => [x * k, y * k]);
    parts.push([8 * sinYaw + z * cosYaw, () => drawLimb(canvas, pose.view, arm, z, 2 * k, 1.1 * k, limb)]);
    parts.push([-6 * sinYaw + z * cosYaw, () => drawLimb(canvas, pose.view, leg, z, 2.3 * k, 1.2 * k, limb)]);
    parts.push([side * cosYaw * 16 + sinYaw * 13, () => drawGills(canvas, pose, side, joint, k)]);
  }
  parts.push([12, () => drawHead(canvas, pose, joint)]);
  parts.sort((a, b) => a[0] - b[0]);
  for (const [, draw7] of parts) draw7();
  canvas.strengthenEdges([[C2.line, C2.rim]]);
  return canvas;
}
function spriteOffset(pose, k) {
  const glide = 1.2 * k * Math.sin(pose.swim * 0.5);
  return [round(pose.x) - ORIGIN, round(pose.y + glide) - ORIGIN];
}
var prepare = perTraits((traits) => {
  const k = STAGE_SCALE[traits.stage];
  const poses = buildPoses(traits);
  const bubbles = makeSparks(
    BUBBLES,
    FRAMES2,
    (birth) => {
      const pose = poses[birth];
      const [ox, oy] = spriteOffset(pose, k);
      const [hx, hy] = project(pose.view, 30 * k, 2 * k, 0);
      return [hx + ox, hy + oy];
    },
    { life: [22, 44], vx: [-0.12, 0.12], vy: [-0.55, -0.3] }
  );
  return { poses, bubbles };
});
function draw2(index, traits) {
  const { poses, bubbles } = prepare(traits);
  const frame = new Canvas(WIDTH2, HEIGHT2);
  forEachSpark(bubbles, index, FRAMES2, (x, y, age) => {
    const inFrame = (px, py) => px >= MARGIN2 && px < WIDTH2 - MARGIN2 && py >= MARGIN2 && py < HEIGHT2 - MARGIN2;
    const dots = age < 0.45 ? [[x, y]] : [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1]
    ];
    for (const [px, py] of dots) {
      if (inFrame(px, py)) frame.pixels[py * WIDTH2 + px] = C2.bubble;
    }
  });
  const pose = poses[index];
  const [ox, oy] = spriteOffset(pose, STAGE_SCALE[traits.stage]);
  renderSprite(pose, traits).stampOnto(frame, ox, oy, MARGIN2);
  return frame.pixels;
}
var axolotl = defineCritter({
  id: "axolotl",
  name: "Axolotl",
  blurb: "Swims around smiling, with feathery gills and a trail of bubbles.",
  alt: "Animated pixel art of a smiling axolotl with feathery gills, swimming around the frame and blowing bubbles",
  width: WIDTH2,
  height: HEIGHT2,
  frames: FRAMES2,
  delayMs: 60,
  poster: 30,
  colourNames: COLOUR_NAMES2,
  bodyColour: "body",
  accentColours: ["gill", "gillHi", "bubble"],
  fixedColours: ["eye", "white", "blush"],
  edgeColours: ["rim", "gill", "gillHi", "bubble"],
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
  draw: draw2
});

// src/critters/dragon.ts
var WIDTH3 = 180;
var HEIGHT3 = 120;
var FRAMES3 = 200;
var MARGIN3 = 2;
var FLAP_CYCLES = 24;
var SWAY_CYCLES = 12;
var BURSTS = 3;
var SPARKS_PER_BURST = 4;
var LOCAL2 = 140;
var ORIGIN2 = LOCAL2 / 2;
var ELEVATION = 0.25;
var REST_YAW2 = 14 * Math.PI / 180;
var WAYPOINTS2 = [
  [44, 92],
  [72, 62],
  [104, 78],
  [134, 50],
  [136, 88],
  [110, 96],
  [82, 84],
  [92, 52],
  [66, 47],
  [40, 62]
];
var COLOUR_NAMES3 = [
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
  "fireMid"
];
var C3 = colourIndexes(COLOUR_NAMES3);
var ART_KEY2 = {
  o: C3.body,
  h: C3.bodyHi,
  s: C3.bodyLo,
  c: C3.belly,
  d: C3.bellyLo,
  f: C3.wing,
  g: C3.wingLo,
  i: C3.horn,
  j: C3.hornLo,
  k: C3.eye,
  n: C3.line,
  w: C3.white
};
var HEAD_SIDE2 = parseArt(
  `
.i............................
..iii.........................
.....iiij.....................
........jiiii...........hh....
...jj....iihhhhhhh....hhhhoo..
.....jjj.oooookkoohhhhhhhhno..
........jssoooookwoooooooooooo
.......ffosooooooosssssssssss.
....gffffsooooonnnnnnnnnnnnnn.
.....gfffsoooccccccccwccc.....
......ggfssssddddddddd........
`,
  ART_KEY2
);
var HEAD_FRONT2 = parseArt(
  `
.i...................i.
..ii...............ii..
....ii...........ii....
.....ijhhhhhhhhhji.....
......ohhhhhhhhho......
......okkoooookko......
...ffsookwooowkoosff...
...gffsoohhhhhoosffg...
....fffsonooonosfff....
.....gfsooooooosfg.....
........snnnnns........
.........scccs.........
..........ddd..........
`,
  ART_KEY2
);
function withEyeShut2(art, [first, last]) {
  const pixels = art.pixels.slice();
  const columns = /* @__PURE__ */ new Set();
  for (let y = first; y < last; y++) {
    for (let x = 0; x < art.width; x++) {
      const at = y * art.width + x;
      if (pixels[at] === C3.white || pixels[at] === C3.eye) {
        pixels[at] = C3.body;
        columns.add(x);
      }
    }
  }
  for (const x of columns) pixels[(first + 1) * art.width + x] = C3.line;
  return { ...art, pixels };
}
function makeHead(side, eyeRows, front, anchors, noses) {
  const shut = withEyeShut2(side, eyeRows);
  return {
    side,
    sideLeft: flipArt(side),
    blink: shut,
    blinkLeft: flipArt(shut),
    front,
    anchor: anchors.side,
    frontAnchor: anchors.front,
    nose: noses.side,
    frontNose: noses.front
  };
}
var FULL_HEAD = makeHead(HEAD_SIDE2, [5, 7], HEAD_FRONT2, { side: [10, 10], front: [11, 10] }, { side: [28, 5], front: [11, 10] });
var HEAD_SIDE_SMALL = parseArt(
  `
.i...............
..iii............
....iijhhhh.hhh..
...jj.oookkhhhhn.
......soookwooooo
....gffsonnnnnnnn
.....gfsoocccccc.
.......ssssddddd.
`,
  ART_KEY2
);
var HEAD_FRONT_SMALL = parseArt(
  `
.i...........i.
..ii.......ii..
...ijhhhhhji...
....okkokko....
..ffsowhwosff..
...gsoohoosg...
.....snons.....
.....snnns.....
......scs......
.......d.......
`,
  ART_KEY2
);
var SMALL_HEAD = makeHead(HEAD_SIDE_SMALL, [3, 5], HEAD_FRONT_SMALL, { side: [8, 6], front: [7, 7] }, { side: [16, 4], front: [7, 7] });
var HEADS2 = [SMALL_HEAD, SMALL_HEAD, FULL_HEAD, FULL_HEAD];
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
var STUD_PANELS = [1, 0, 2];
var SIZES = STAGE_SCALE.map((k) => {
  const along = ([a, b]) => [a * k, b * k];
  const scaled = (rows) => rows.map(([a, b]) => [a * k, b * k]);
  return {
    scale: k,
    spine: openSpline(SPINE2.map(([x, y, r]) => [x * k, y * k, r * k]), SAMPLES2),
    wrist: along(WING_WRIST),
    tips: WING_TIPS.map(along),
    root: along(WING_ROOT),
    shoulder: [SHOULDER[0] * k, SHOULDER[1] * k, SHOULDER[2] * k],
    arm: scaled(ARM),
    leg: scaled(LEG),
    limbOffset: LIMB_OFFSET2 * k
  };
});
function buildPoses2({ mood }) {
  const { x, y, vx, vy } = roam(WAYPOINTS2, mood, FRAMES3);
  const yaw = yawFromTravel(vx, REST_YAW2, 0.7, 7);
  const pitch = smooth(vy.map((v) => clamp(-v * 0.24, -0.3, 0.3)), 9);
  const climb = smooth(vy.map((v) => clamp(-v / 1.2, -1, 1)), 9);
  const flap = cumulativePhase(climb.map((c) => 1 + 0.4 * c), cyclesFor(mood, FLAP_CYCLES));
  const sway = cyclesFor(mood, SWAY_CYCLES);
  const lift = mood === "resting" ? 0.55 : 0.75;
  const blinks = blinkFrames(mood, [28, 36, 128], FRAMES3);
  return Array.from({ length: FRAMES3 }, (_, i) => ({
    t: i / FRAMES3,
    x: x[i],
    y: y[i],
    vx: vx[i],
    flap: flap[i],
    lift: clamp(lift + 0.35 * climb[i], 0.45, 1),
    sway: TAU * sway * i / FRAMES3,
    blink: blinks.has(i),
    view: { yaw: yaw[i], pitch: pitch[i], elevation: ELEVATION, origin: ORIGIN2 }
  }));
}
function animatedSpine2(pose, size) {
  const [spineX, spineY, spineR] = size.spine;
  const k = size.scale;
  const y = new Float64Array(SAMPLES2);
  const z = new Float64Array(SAMPLES2);
  for (let i = 0; i < SAMPLES2; i++) {
    const tail = TAIL_WEIGHT2[i];
    y[i] = spineY[i] + tail * 3.2 * k * Math.sin(pose.sway - 3 * tail) + NECK_WEIGHT[i] * k * Math.sin(pose.flap + 1.2);
    z[i] = tail * 2.5 * k * Math.sin(pose.sway + 1);
  }
  return { x: spineX, y, z, radius: spineR };
}
var TUBE2 = { fill: C3.body, low: C3.bodyLo, high: C3.bodyHi, belly: C3.belly, bellyLow: C3.bellyLo, line: C3.line };
function drawBellyPlates(canvas, pose, spine, k, include) {
  const { x, y, z, radius } = spine;
  const dx = gradient(x);
  const dy = gradient(y);
  const belly = canvas.mask();
  canvas.pixels.forEach((colour, i) => {
    belly.bits[i] = colour === C3.belly ? 1 : 0;
  });
  const plates = canvas.mask();
  for (const u of bandPositions(0.1, 0.07, k, 6)) {
    if (!include(u)) continue;
    const j = Math.trunc(u * (SAMPLES2 - 1));
    const length = Math.hypot(dx[j], dy[j]);
    const r = radius[j];
    const underX = x[j] + -dy[j] / length * r * 0.72;
    const underY = y[j] + dx[j] / length * r * 0.72;
    const across = [-dy[j] / length * r * 0.45, dx[j] / length * r * 0.45];
    plates.addLine([
      project(pose.view, underX - across[0], underY - across[1], z[j]),
      project(pose.view, underX + across[0], underY + across[1], z[j])
    ]);
  }
  canvas.fill(plates.and(belly), C3.bellyLo);
}
function drawChain(canvas, pose, spine, k, include) {
  drawTube(canvas, pose.view, spine, TUBE2, (i) => include(SPINE_U2[i]), (i) => SPINE_U2[i] < 0.82);
  drawBellyPlates(canvas, pose, spine, k, include);
}
function drawSpikes(canvas, pose, spine, k) {
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
    const r = spine.radius[j];
    const height = 1.4 * k + r * 0.3;
    const halfWidth = k + r * 0.14;
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
  canvas.sticker(mask, C3.wing, C3.line);
}
function drawWing(canvas, pose, side, size, marks) {
  const { wrist: WING_WRIST2, tips: WING_TIPS2, root: WING_ROOT2, shoulder: SHOULDER2, scale: k } = size;
  let power = clamp((pose.lift - 0.45) / 0.25, 0, 1);
  power = power * power * (3 - 2 * power);
  const amplitude = (12 + 38 * power) * Math.PI / 180;
  const centre = (46 - 24 * power) * Math.PI / 180;
  const inner = centre + amplitude * Math.sin(pose.flap);
  const outer = centre + 6 * Math.PI / 180 + 1.15 * amplitude * Math.sin(pose.flap - 0.85);
  const point = ([along, span]) => {
    const spanIn = Math.min(span, WING_WRIST2[1]);
    const spanOut = Math.max(0, span - WING_WRIST2[1]);
    const up = spanIn * Math.sin(inner) + spanOut * Math.sin(outer);
    const out = spanIn * Math.cos(inner) + spanOut * Math.cos(outer);
    return project(
      pose.view,
      SHOULDER2[0] + along,
      SHOULDER2[1] + up + Math.min(along, 0) * WING_DROOP,
      side * (SHOULDER2[2] + out)
    );
  };
  const near = side * Math.cos(pose.view.yaw) > 0;
  const shades = near ? [C3.wingHi, C3.wing, C3.wingHi, C3.wing] : [C3.wingFar, C3.wingFarLo, C3.wingFar, C3.wingFarLo];
  const shoulder = point([0, 0]);
  const wrist = point(WING_WRIST2);
  const tips = WING_TIPS2.map(point);
  const scallops = [...WING_TIPS2.keys()].map((i) => {
    const [a0, s0] = WING_TIPS2[i];
    const [a1, s1] = WING_TIPS2[i + 1] ?? WING_ROOT2;
    const midA = (a0 + a1) / 2;
    const midS = (s0 + s1) / 2;
    return point([midA + (WING_WRIST2[0] - midA) * 0.28, midS + (WING_WRIST2[1] - midS) * 0.28]);
  });
  const last = tips.length - 1;
  const panels = tips.map(
    (tip, i) => i < last ? canvas.mask().addPolygon([wrist, tip, scallops[i], tips[i + 1]]) : canvas.mask().addPolygon([wrist, tip, scallops[i], point(WING_ROOT2), shoulder])
  );
  const arm = canvas.mask();
  for (let n = 0; n < 8; n++) {
    const f = n / 7;
    arm.addDisc(
      shoulder[0] + (wrist[0] - shoulder[0]) * f,
      shoulder[1] + (wrist[1] - shoulder[1]) * f,
      (1.9 - 0.9 * f) * k
    );
  }
  const outlined = canvas.mask().add(arm);
  for (const panel of panels) outlined.add(panel);
  const fingers = canvas.mask();
  for (const tip of tips) fingers.addLine([wrist, tip]);
  const edgeOn = Math.abs(tips[0][1] - wrist[1]) < 4 * k;
  const bone = near ? C3.body : C3.bodyLo;
  const outline = outlined.grown();
  canvas.fill(outline, C3.line);
  panels.forEach((panel, i) => canvas.fill(panel, edgeOn ? shades[1] : shades[i]));
  if (!edgeOn) {
    canvas.fill(fingers.grown().minus(outline), C3.line);
    canvas.fill(fingers, bone);
  }
  canvas.fill(arm, bone);
  if (!edgeOn) {
    const studs = canvas.mask();
    for (const i of STUD_PANELS.slice(0, marks)) {
      const [cx, cy] = [(tips[i][0] + tips[i + 1][0]) / 2, (tips[i][1] + tips[i + 1][1]) / 2];
      const x = round(wrist[0] + (cx - wrist[0]) * 0.62);
      const y = round(wrist[1] + (cy - wrist[1]) * 0.62);
      studs.addDisc(x, y, 1.1 + 0.8 * size.scale);
    }
    const membrane = canvas.mask();
    for (const panel of panels) membrane.add(panel);
    canvas.fill(studs.and(membrane), near ? C3.horn : C3.hornLo);
  }
}
function placeHead(pose, spine, head) {
  const [hx, hy] = project(pose.view, spine.x[0], spine.y[0], spine.z[0]);
  const cosYaw = Math.cos(pose.view.yaw);
  let art;
  let [anchorX, anchorY] = head.anchor;
  let [noseX, noseY] = head.nose;
  let facing = 1;
  if (Math.abs(cosYaw) > 0.5) {
    if (cosYaw < 0) {
      art = pose.blink ? head.blinkLeft : head.sideLeft;
      anchorX = art.width - 1 - anchorX;
      noseX = art.width - 1 - noseX;
      facing = -1;
    } else {
      art = pose.blink ? head.blink : head.side;
    }
  } else {
    art = head.front;
    [anchorX, anchorY] = head.frontAnchor;
    [noseX, noseY] = head.frontNose;
    facing = 0;
  }
  const left = round(hx) - anchorX;
  const top = round(hy) - anchorY;
  return { art, left, top, nose: [left + noseX, top + noseY], facing };
}
function drawHead2(canvas, pose, spine, head) {
  const { art, left, top } = placeHead(pose, spine, head);
  canvas.stampArt(art, left, top, C3.line);
}
function drawTailFin(canvas, pose, spine, k) {
  const last = SAMPLES2 - 1;
  const at = (i) => project(pose.view, spine.x[i], spine.y[i], spine.z[i]);
  const [tipX, tipY] = at(last);
  const [backX, backY] = at(last - 6);
  let dx = tipX - backX;
  let dy = tipY - backY;
  const length = Math.hypot(dx, dy);
  if (length < 1) {
    dx = 0;
    dy = -1;
  } else {
    dx /= length;
    dy /= length;
  }
  const reach = 9 * k;
  const half = 3.4 * k;
  const point = (along, across) => [
    tipX + dx * along - dy * across,
    tipY + dy * along + dx * across
  ];
  const outline = [point(0, 0), point(reach * 0.4, half), point(reach, 0), point(reach * 0.4, -half)];
  const fin = canvas.mask().addPolygon(outline);
  canvas.sticker(fin, C3.wing, C3.line);
  const vein = canvas.mask().addLine([point(reach * 0.15, 0), point(reach * 0.85, 0)]);
  canvas.fill(vein.and(fin), C3.wingLo);
}
function renderSprite2(pose, traits) {
  const size = SIZES[traits.stage];
  const k = size.scale;
  const canvas = new Canvas(LOCAL2, LOCAL2);
  const spine = animatedSpine2(pose, size);
  const cosYaw = Math.cos(pose.view.yaw);
  const sinYaw = Math.sin(pose.view.yaw);
  const parts = [[-0.5, () => drawSpikes(canvas, pose, spine, k)]];
  let tailDepth;
  if (Math.abs(cosYaw) > 0.5) {
    tailDepth = 0;
    parts.push([0, () => drawChain(canvas, pose, spine, k, () => true)]);
  } else {
    tailDepth = -8;
    parts.push([-8, () => drawChain(canvas, pose, spine, k, (u) => u >= HIP2)]);
    parts.push([0, () => drawChain(canvas, pose, spine, k, (u) => u >= CHEST && u <= HIP2 + 0.02)]);
    parts.push([8, () => drawChain(canvas, pose, spine, k, (u) => u <= CHEST + 0.02)]);
  }
  for (const side of [1, -1]) {
    parts.push([side * cosYaw * 15 - sinYaw * 5, () => drawWing(canvas, pose, side, size, traits.marks)]);
    const near = side * cosYaw > 0;
    const limb = { fill: near ? C3.body : C3.bodyLo, claw: near ? C3.horn : C3.hornLo, line: C3.line };
    const z = side * size.limbOffset;
    const { arm, leg } = size;
    parts.push([arm[0][0] * sinYaw + z * cosYaw, () => drawLimb(canvas, pose.view, arm, z, 2.3 * k, 1.3 * k, limb)]);
    parts.push([leg[0][0] * sinYaw + z * cosYaw, () => drawLimb(canvas, pose.view, leg, z, 3.6 * k, 1.6 * k, limb)]);
  }
  parts.push([12, () => drawHead2(canvas, pose, spine, HEADS2[traits.stage])]);
  parts.push([tailDepth + 0.5, () => drawTailFin(canvas, pose, spine, k)]);
  parts.sort((a, b) => a[0] - b[0]);
  for (const [, draw7] of parts) draw7();
  canvas.strengthenEdges([[C3.line, C3.rim]]);
  return canvas;
}
function spriteOffset2(pose, k) {
  const bob = 1.5 * k * pose.lift * Math.sin(pose.flap);
  return [round(pose.x) - ORIGIN2, round(pose.y + bob) - ORIGIN2];
}
function snoutSparks(poses, traits) {
  const size = SIZES[traits.stage];
  const head = HEADS2[traits.stage];
  return Array.from({ length: BURSTS * SPARKS_PER_BURST }, (_, n) => {
    const burst = Math.floor(n / SPARKS_PER_BURST);
    const birth = (20 + Math.floor(burst * FRAMES3 / BURSTS) + n % SPARKS_PER_BURST * 3) % FRAMES3;
    const pose = poses[birth];
    const { nose, facing } = placeHead(pose, animatedSpine2(pose, size), head);
    const [ox, oy] = spriteOffset2(pose, size.scale);
    return {
      birth,
      life: 9 + round(scatter(n, 0.754878) * 6),
      x: nose[0] + ox + facing,
      y: nose[1] + oy,
      vx: facing * 0.3 + (scatter(n, 0.56984) - 0.5) * 0.3,
      vy: -0.7 + scatter(n, 0.438744) * 0.35
    };
  });
}
var prepare2 = perTraits((traits) => {
  const poses = buildPoses2(traits);
  return { poses, embers: snoutSparks(poses, traits) };
});
function draw3(index, traits) {
  const { poses, embers } = prepare2(traits);
  const frame = new Canvas(WIDTH3, HEIGHT3);
  forEachSpark(embers, index, FRAMES3, (x, y, age) => {
    if (x >= MARGIN3 && x < WIDTH3 - MARGIN3 && y >= MARGIN3 && y < HEIGHT3 - MARGIN3) {
      frame.pixels[y * WIDTH3 + x] = age < 0.5 ? C3.fireMid : C3.fireOuter;
    }
  });
  const pose = poses[index];
  const [ox, oy] = spriteOffset2(pose, SIZES[traits.stage].scale);
  renderSprite2(pose, traits).stampOnto(frame, ox, oy, MARGIN3);
  return frame.pixels;
}
var dragon = defineCritter({
  id: "dragon",
  name: "Dragon",
  blurb: "Flaps, soars and turns to look at you, puffing little sparks.",
  alt: "Animated pixel art of a dragon with a spade-tipped tail, flapping its wings as it wanders around the frame",
  width: WIDTH3,
  height: HEIGHT3,
  frames: FRAMES3,
  delayMs: 60,
  poster: 46,
  colourNames: COLOUR_NAMES3,
  bodyColour: "body",
  accentColours: ["wingHi", "wing", "wingLo", "wingFar", "wingFarLo", "fireOuter", "fireMid"],
  fixedColours: ["horn", "hornLo", "eye", "white"],
  edgeColours: ["rim", "fireOuter", "fireMid"],
  colourways: [
    {
      id: "ember",
      name: "Ember",
      colours: {
        rim: "#a8322a",
        line: "#561418",
        body: "#c9403a",
        bodyHi: "#e8695a",
        bodyLo: "#9e2c30",
        belly: "#f0c46a",
        bellyLo: "#cf9a45",
        wingHi: "#6a4a8c",
        wing: "#4f3472",
        wingLo: "#3b2658",
        wingFar: "#432c60",
        wingFarLo: "#33214b",
        horn: "#f4ead0",
        hornLo: "#cdbb94",
        eye: "#1c0f12",
        white: "#ffffff",
        fireOuter: "#e9401c",
        fireMid: "#ff8a1f"
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
        fireMid: "#45b4f5"
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
        fireMid: "#67c93a"
      }
    }
  ],
  draw: draw3
});

// src/critters/ghost.ts
var WIDTH4 = 180;
var HEIGHT4 = 120;
var FRAMES4 = 200;
var MARGIN4 = 2;
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
var MARKS = [
  [],
  [[0, -9]],
  [
    [-5, -8],
    [5, -8]
  ],
  [
    [-8, -6],
    [0, -9],
    [8, -6]
  ]
];
var EYE_GAP = [4, 5, 5, 6];
var COLOUR_NAMES4 = ["rim", "line", "body", "bodyHi", "bodyLo", "eye", "white", "blush", "mouth", "sparkle"];
var C4 = colourIndexes(COLOUR_NAMES4);
function buildPoses3({ mood, stage }) {
  const k = STAGE_SCALE[stage];
  const { x, y, vx } = roam(WAYPOINTS3, mood, FRAMES4);
  const look = smooth(vx.map((v) => clamp(v * 3.4, -4.5 * k, 4.5 * k)), 13);
  const lean = smooth(vx.map((v) => clamp(v * 1.8, -3 * k, 3 * k)), 21);
  const blinks = blinkFrames(mood, [30, 60, 170], FRAMES4);
  const bobs = cyclesFor(mood, BOBS);
  const hem = cyclesFor(mood, HEM_CYCLES);
  return Array.from({ length: FRAMES4 }, (_, i) => {
    const edge = Math.min(i - BOO_START, BOO_END - i);
    const boo = i >= BOO_START && i <= BOO_END ? clamp(edge / 4, 0, 1) : 0;
    return {
      x: x[i],
      y: y[i] + 2.4 * k * Math.sin(TAU * bobs * i / FRAMES4),
      look: look[i],
      lean: lean[i],
      hem: TAU * hem * i / FRAMES4,
      boo,
      blink: blinks.has(i)
    };
  });
}
function drawBody2(canvas, pose, k) {
  const body = canvas.mask();
  const radius = RADIUS * k;
  const stretch = 3 * pose.boo * k;
  const flare = (2.6 + 1.4 * pose.boo) * k;
  const skirt = SKIRT * k + stretch;
  for (let y = Math.ceil(-radius) - round(stretch); y <= skirt + 4; y++) {
    const row = y + stretch;
    const down = Math.max(0, y) / skirt;
    const half = row < 0 ? Math.sqrt(Math.max(0, radius * radius - row * row)) : radius + down * flare;
    const shift = -pose.lean * down * down;
    for (let x = Math.trunc(-half - 6); x <= half + 6; x++) {
      const dx = x - shift;
      if (Math.abs(dx) > half) continue;
      const tuck = 4 * k * (Math.abs(dx) / half) ** 6;
      const hem = skirt - tuck + 2.2 * k * Math.sin(HEM_LOBES * Math.PI * (dx + half) / (2 * half) + pose.hem);
      if (y <= hem) body.addPixel(ORIGIN3 + x, ORIGIN3 + y);
    }
  }
  canvas.sticker(body, C4.body, C4.line);
  canvas.fill(body.minus(body.moved(-2, -2)), C4.bodyLo);
  canvas.fill(body.minus(body.moved(1, 2)), C4.bodyHi);
  return body;
}
function drawArms(canvas, pose, k) {
  const arms = canvas.mask();
  const lift = (5 + 16 * pose.boo) * k;
  const wave = 1.2 * k * Math.sin(pose.hem * 0.5);
  for (const side of [-1, 1]) {
    const reach = RADIUS * k + 1.5 * k + 3 * pose.boo * k;
    arms.addDisc(ORIGIN3 + side * reach, ORIGIN3 + 9 * k - lift + 5 * k + side * wave, 3.3 * k);
    arms.addDisc(ORIGIN3 + side * (reach - 2 * k), ORIGIN3 + 11 * k - lift + 5 * k + side * wave, 3 * k);
  }
  canvas.sticker(arms, C4.body, C4.line);
  canvas.fill(arms.minus(arms.moved(-1, -1)), C4.bodyLo);
}
function drawFace(canvas, pose, body, k, stage) {
  const cx = ORIGIN3 + round(pose.look);
  const cy = ORIGIN3 - round(2 * k) - round(3 * pose.boo * k);
  const eyes = canvas.mask();
  const glints = canvas.mask();
  const gap = EYE_GAP[stage];
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
  canvas.fill(eyes, C4.eye);
  canvas.fill(glints, C4.white);
  const blush = canvas.mask();
  for (const side of [-1, 1]) {
    const bx = cx + side * (gap + (stage < 2 ? 3 : 4));
    for (let x = -1; x <= 1; x++) {
      blush.addPixel(bx + x, cy + 5);
      blush.addPixel(bx + x, cy + 6);
    }
  }
  canvas.fill(blush.and(body), C4.blush);
  const mouth = canvas.mask();
  if (pose.boo > 0.5) {
    mouth.addDisc(cx, cy + 9, 3.4);
    canvas.fill(mouth, C4.mouth);
  } else {
    mouth.addPixel(cx - 2, cy + 6).addPixel(cx - 1, cy + 7).addPixel(cx, cy + 7).addPixel(cx + 1, cy + 7).addPixel(cx + 2, cy + 6);
    canvas.fill(mouth, C4.line);
  }
}
function drawMarks(canvas, pose, k, marks) {
  const spots = canvas.mask();
  for (const [dx, dy] of MARKS[marks]) {
    const x = ORIGIN3 + round(dx * k) + round(pose.look / 2);
    const y = ORIGIN3 + round(dy * k) - round(3 * pose.boo * k);
    spots.addPixel(x, y).addPixel(x - 1, y).addPixel(x + 1, y).addPixel(x, y - 1).addPixel(x, y + 1);
  }
  canvas.fill(spots, C4.sparkle);
}
function renderSprite3(pose, traits) {
  const k = STAGE_SCALE[traits.stage];
  const canvas = new Canvas(LOCAL3, LOCAL3);
  const body = drawBody2(canvas, pose, k);
  drawArms(canvas, pose, k);
  drawMarks(canvas, pose, k, traits.marks);
  drawFace(canvas, pose, body, k, traits.stage);
  canvas.strengthenEdges([[C4.line, C4.rim]]);
  return canvas;
}
function spriteOffset3(pose) {
  return [round(pose.x) - ORIGIN3, round(pose.y) - ORIGIN3];
}
var prepare3 = perTraits((traits) => {
  const k = STAGE_SCALE[traits.stage];
  const poses = buildPoses3(traits);
  const sparkles = makeSparks(
    SPARKLES,
    FRAMES4,
    (birth) => {
      const pose = poses[birth];
      const side = birth % 2 === 0 ? -1 : 1;
      return [pose.x + side * (6 + birth % 11) * k, pose.y + SKIRT * k + 4];
    },
    { life: [16, 34], vx: [-0.12, 0.12], vy: [-0.1, 0.22] }
  );
  return { poses, sparkles };
});
function draw4(index, traits) {
  const { poses, sparkles } = prepare3(traits);
  const frame = new Canvas(WIDTH4, HEIGHT4);
  forEachSpark(sparkles, index, FRAMES4, (x, y, age) => {
    const dots = age < 0.5 ? [
      [x, y],
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1]
    ] : [[x, y]];
    for (const [px, py] of dots) {
      if (px >= MARGIN4 && px < WIDTH4 - MARGIN4 && py >= MARGIN4 && py < HEIGHT4 - MARGIN4) {
        frame.pixels[py * WIDTH4 + px] = C4.sparkle;
      }
    }
  });
  const pose = poses[index];
  const [ox, oy] = spriteOffset3(pose);
  renderSprite3(pose, traits).stampOnto(frame, ox, oy, MARGIN4);
  return frame.pixels;
}
var ghost = defineCritter({
  id: "ghost",
  name: "Ghost",
  blurb: "Floats about, leaves sparkles, and stops once a loop to say boo.",
  alt: "Animated pixel art of a friendly ghost floating around the frame, leaving sparkles and stopping to say boo",
  width: WIDTH4,
  height: HEIGHT4,
  frames: FRAMES4,
  delayMs: 60,
  poster: 12,
  colourNames: COLOUR_NAMES4,
  bodyColour: "body",
  accentColours: ["sparkle"],
  fixedColours: ["eye", "white", "blush"],
  edgeColours: ["rim", "sparkle"],
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
  draw: draw4
});

// src/critters/jellyfish.ts
var WIDTH5 = 180;
var HEIGHT5 = 120;
var FRAMES5 = 200;
var MARGIN5 = 2;
var PULSES = 8;
var MOTES = 30;
var LOCAL4 = 110;
var ORIGIN4 = LOCAL4 / 2;
var TOP2 = 34;
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
var STRIPES = [12, -12, 9];
var COLOUR_NAMES5 = [
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
var C5 = colourIndexes(COLOUR_NAMES5);
function buildPoses4({ mood, stage }) {
  const k = STAGE_SCALE[stage];
  const { x, y, vx } = roam(WAYPOINTS4, mood, FRAMES5);
  const tilt = smooth(vx.map((v) => clamp(v * 0.35, -0.3, 0.3)), 15);
  const blinks = blinkFrames(mood, [40, 120], FRAMES5);
  const pulses = cyclesFor(mood, PULSES);
  return Array.from({ length: FRAMES5 }, (_, i) => {
    const phase = TAU * pulses * i / FRAMES5;
    const squeeze = 0.5 - 0.5 * Math.cos(phase + 0.6 * Math.sin(phase));
    return {
      x: x[i],
      // Each squeeze pushes it up, then it sinks a little while relaxing.
      y: y[i] + 2.4 * k * Math.cos(phase - 0.9),
      squeeze,
      phase,
      drift: vx[i],
      tilt: tilt[i],
      blink: blinks.has(i)
    };
  });
}
function bellOutline(pose, k, lobes) {
  const rx = (18 - 3.5 * pose.squeeze) * k;
  const ry = (13 + 3 * pose.squeeze) * k;
  const cos = Math.cos(pose.tilt);
  const sin = Math.sin(pose.tilt);
  const turn = (x, y) => [
    ORIGIN4 + x * cos - y * sin,
    TOP2 + x * sin + y * cos
  ];
  const points = [];
  for (let n = 0; n <= 28; n++) {
    const a = Math.PI + n / 28 * Math.PI;
    points.push(turn(rx * Math.cos(a), ry * Math.sin(a)));
  }
  const steps = lobes * 4;
  for (let n = 1; n < steps; n++) {
    const f = n / steps;
    const x = rx - 2 * rx * f;
    const scallop = Math.abs(Math.sin(Math.PI * lobes * f));
    const ripple = 0.8 * k * Math.sin(pose.phase * 2 + f * TAU);
    points.push(turn(x, k + 2.6 * k * scallop + ripple));
  }
  return points;
}
function drawTentacles(canvas, pose, k, count) {
  const near = canvas.mask();
  const far = canvas.mask();
  const rx = (15 - 3 * pose.squeeze) * k;
  for (let t = 0; t < count; t++) {
    const f = t / (count - 1) - 0.5;
    const length = (30 + 6 * Math.abs(Math.sin(t * 1.7)) - 5 * pose.squeeze) * k;
    const points = [];
    for (let n = 0; n <= 14; n++) {
      const s = n / 14;
      const wave = s * 3.4 * k * Math.sin(pose.phase - 3.4 * s + t * 1.3);
      const trail = (-pose.drift * 7 * s * s + pose.tilt * -8 * s) * k;
      points.push([ORIGIN4 + f * 2 * rx * (1 - 0.25 * s) + wave + trail, TOP2 + 2 * k + s * length]);
    }
    (t % 2 === 0 ? near : far).addLine(points);
  }
  canvas.fill(far, C5.tentacleLo);
  canvas.fill(near, C5.tentacle);
}
function drawArms2(canvas, pose, k) {
  const arms = canvas.mask();
  const shade2 = canvas.mask();
  for (const [f, reach] of [
    [-0.42, 22],
    [0.4, 24],
    [0, 27]
  ]) {
    const length = (reach - 4 * pose.squeeze) * k;
    for (let n = 0; n <= 18; n++) {
      const s = n / 18;
      const wave = s * 2.2 * k * Math.sin(pose.phase - 2.6 * s + f * 6);
      const trail = (-pose.drift * 5 * s * s + pose.tilt * -6 * s) * k;
      const frill = 0.8 * k * Math.sin(n * 1.9 + pose.phase);
      const x = ORIGIN4 + f * 12 * k * (1 - 0.3 * s) + wave + trail + frill;
      const y = TOP2 + k + s * length;
      arms.addDisc(x, y, (2.5 - 1.7 * s) * k);
      if (n % 3 === 0) shade2.addDisc(x + 0.6, y, 0.9 * k);
    }
  }
  canvas.sticker(arms, C5.arm, C5.line);
  canvas.fill(shade2.and(arms), C5.armLo);
}
function drawBell(canvas, pose, traits, k) {
  const bell = canvas.mask().addPolygon(bellOutline(pose, k, traits.stage < 2 ? 6 : LOBES));
  canvas.sticker(bell, C5.bell, C5.line);
  canvas.fill(bell.minus(bell.moved(0, -Math.max(2, round(3 * k)))), C5.bellLo);
  canvas.fill(bell.minus(bell.moved(-1, 2)), C5.bellHi);
  const cos = Math.cos(pose.tilt);
  const sin = Math.sin(pose.tilt);
  const place = (x, y) => [
    round(ORIGIN4 + x * cos - y * sin),
    round(TOP2 + x * sin + y * cos)
  ];
  const wide = 1 - 0.18 * pose.squeeze;
  const inner = canvas.mask();
  const [ix, iy] = place(0, (-8 - 2 * pose.squeeze) * k);
  inner.addDisc(ix, iy, 7.2 * wide * k);
  canvas.fill(inner.and(bell), C5.inner);
  const spots = canvas.mask();
  for (const dx of [-5.2, -1.8, 1.8, 5.2]) {
    const [sx, sy] = place(dx * wide * k, (-10 - 2 * pose.squeeze + Math.abs(dx) * 0.5) * k);
    spots.addDisc(sx, sy, 1.5 * k);
  }
  canvas.fill(spots.and(bell), C5.spot);
  const stripes = canvas.mask();
  for (const across of STRIPES.slice(0, traits.marks)) {
    const [x0, y0] = place(across * wide * k, -9.5 * k);
    const [x1, y1] = place(across * wide * k, -4 * k);
    for (let thick = 0; thick < 2; thick++) {
      stripes.addLine([
        [x0 + thick, y0],
        [x1 + thick, y1]
      ]);
    }
  }
  canvas.fill(stripes.and(bell), C5.spot);
  const face = canvas.mask();
  const eye = (dx) => {
    const [ex, ey] = place(dx * wide * k, -3.4 * k);
    if (pose.blink) {
      face.addPixel(ex - 1, ey + 1).addPixel(ex, ey + 1);
    } else {
      face.addPixel(ex - 1, ey).addPixel(ex, ey).addPixel(ex - 1, ey + 1).addPixel(ex, ey + 1);
    }
    return [ex, ey];
  };
  const [lx, ly] = eye(-6);
  const [rx, ry] = eye(6);
  canvas.fill(face, C5.eye);
  if (!pose.blink) {
    const glint = canvas.mask().addPixel(lx - 1, ly).addPixel(rx - 1, ry);
    canvas.fill(glint, C5.white);
  }
  const blush = canvas.mask();
  for (const dx of [-10, 10]) {
    const [bx, by] = place(dx * wide * k, -1.4 * k);
    blush.addPixel(bx - 1, by).addPixel(bx, by).addPixel(bx + 1, by);
  }
  canvas.fill(blush.and(bell), C5.blush);
  const smile = canvas.mask();
  const [mx, my] = place(0, -1.6 * k);
  smile.addPixel(mx - 2, my).addPixel(mx - 1, my + 1).addPixel(mx, my + 1).addPixel(mx + 1, my + 1).addPixel(mx + 2, my);
  canvas.fill(smile, C5.line);
}
function renderSprite4(pose, traits) {
  const k = STAGE_SCALE[traits.stage];
  const canvas = new Canvas(LOCAL4, LOCAL4);
  drawTentacles(canvas, pose, k, traits.stage < 2 ? 5 : TENTACLES);
  drawArms2(canvas, pose, k);
  drawBell(canvas, pose, traits, k);
  canvas.strengthenEdges([[C5.line, C5.rim]]);
  return canvas;
}
function spriteOffset4(pose) {
  return [round(pose.x) - ORIGIN4, round(pose.y) - (TOP2 - 16)];
}
var prepare4 = perTraits((traits) => {
  const k = STAGE_SCALE[traits.stage];
  const poses = buildPoses4(traits);
  const motes = makeSparks(
    MOTES,
    FRAMES5,
    (birth) => {
      const pose = poses[birth];
      const [ox, oy] = spriteOffset4(pose);
      const side = birth % 2 === 0 ? -1 : 1;
      return [ORIGIN4 + ox + side * (8 + birth % 13) * k, TOP2 + oy + 2];
    },
    { life: [18, 40], vx: [-0.14, 0.14], vy: [0.12, 0.34] }
  );
  return { poses, motes };
});
function draw5(index, traits) {
  const { poses, motes } = prepare4(traits);
  const frame = new Canvas(WIDTH5, HEIGHT5);
  forEachSpark(motes, index, FRAMES5, (x, y) => {
    if (x >= MARGIN5 && x < WIDTH5 - MARGIN5 && y >= MARGIN5 && y < HEIGHT5 - MARGIN5) {
      frame.pixels[y * WIDTH5 + x] = C5.mote;
    }
  });
  const pose = poses[index];
  const [ox, oy] = spriteOffset4(pose);
  renderSprite4(pose, traits).stampOnto(frame, ox, oy, MARGIN5);
  return frame.pixels;
}
var jellyfish = defineCritter({
  id: "jellyfish",
  name: "Jellyfish",
  blurb: "Pulses gently across the frame, shedding little specks of glow.",
  alt: "Animated pixel art of a smiling jellyfish pulsing as it drifts around the frame, trailing long tentacles",
  width: WIDTH5,
  height: HEIGHT5,
  frames: FRAMES5,
  delayMs: 60,
  poster: 24,
  colourNames: COLOUR_NAMES5,
  bodyColour: "bell",
  accentColours: ["spot", "arm", "armLo", "tentacle", "tentacleLo", "mote"],
  fixedColours: ["eye", "white", "blush"],
  edgeColours: ["rim", "tentacle", "tentacleLo", "mote"],
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
  draw: draw5
});

// src/critters/robot.ts
var WIDTH6 = 180;
var HEIGHT6 = 120;
var FRAMES6 = 200;
var MARGIN6 = 2;
var BOBS2 = 6;
var SWAY_CYCLES2 = 3;
var GLOW_CYCLES = 5;
var JET_CYCLES = 20;
var ARM_CYCLES = 6;
var PINGS = 3;
var SPARKS = 34;
var LOCAL5 = 90;
var ORIGIN5 = LOCAL5 / 2;
var BEEP_START = 104;
var BEEP_END = 130;
var WAYPOINTS5 = [
  [40, 66],
  [70, 48],
  [104, 62],
  [138, 46],
  [146, 74],
  [112, 80],
  [90, 62],
  [60, 78],
  [34, 72]
];
var MARKS2 = [[], [0], [-3, 3], [-4, 0, 4]];
var EYE_GAP2 = [2, 3, 3, 4];
var EYE_WIDTH = [1, 2, 2, 2];
var EYE_HEIGHT = [2, 3, 3, 4];
var SMALL_HEART = ["XX.XX", "XXXXX", ".XXX.", "..X.."];
var BIG_HEART = [".XX.XX.", "XXXXXXX", "XXXXXXX", ".XXXXX.", "..XXX..", "...X..."];
var COLOUR_NAMES6 = [
  "rim",
  "line",
  "body",
  "bodyHi",
  "bodyLo",
  "steel",
  "steelLo",
  "screen",
  "eye",
  "white",
  "heart",
  "glow",
  "glowHi"
];
var C6 = colourIndexes(COLOUR_NAMES6);
function buildPoses5({ mood, stage }) {
  const k = STAGE_SCALE[stage];
  const { x, y, vx } = roam(WAYPOINTS5, mood, FRAMES6);
  const look = smooth(vx.map((v) => clamp(v * 3.4, -3 * k, 3 * k)), 13);
  const lean = smooth(vx.map((v) => clamp(v * 1.8, -2 * k, 2 * k)), 21);
  const blinks = blinkFrames(mood, [30, 60, 170], FRAMES6);
  const bobs = cyclesFor(mood, BOBS2);
  const sway = cyclesFor(mood, SWAY_CYCLES2);
  const glow = cyclesFor(mood, GLOW_CYCLES);
  const jet = cyclesFor(mood, JET_CYCLES);
  const arm = cyclesFor(mood, ARM_CYCLES);
  return Array.from({ length: FRAMES6 }, (_, i) => {
    const beeping = i >= BEEP_START && i <= BEEP_END;
    const progress = beeping ? (i - BEEP_START) / (BEEP_END - BEEP_START) : 0;
    const hop = beeping ? 5 * k * Math.sin(Math.PI * progress) : 0;
    return {
      x: x[i],
      y: y[i] + 2.4 * k * Math.sin(TAU * bobs * i / FRAMES6) - hop,
      look: look[i],
      lean: lean[i],
      wiggle: beeping ? 1.5 * k * Math.sin(TAU * PINGS * progress) : 0,
      sway: 1.6 * k * Math.sin(TAU * sway * i / FRAMES6),
      beep: beeping ? clamp(Math.min(i - BEEP_START, BEEP_END - i) / 4, 0, 1) : 0,
      ping: beeping ? progress * PINGS % 1 : -1,
      jet: TAU * jet * i / FRAMES6,
      flicker: i % 2 === 0 ? 0 : 1,
      arm: TAU * arm * i / FRAMES6,
      lit: beeping || Math.sin(TAU * glow * i / FRAMES6) > 0,
      blink: blinks.has(i)
    };
  });
}
function roundRect(mask, x0, y0, x1, y1, radius) {
  for (let y = y0; y < y1; y++) {
    const fromEdge = Math.min(y - y0, y1 - 1 - y);
    const inset = fromEdge >= radius ? 0 : round(radius - Math.sqrt(radius * radius - (radius - fromEdge - 0.5) ** 2));
    for (let x = x0 + inset; x < x1 - inset; x++) mask.addPixel(x, y);
  }
  return mask;
}
function shade(canvas, shape, low, high) {
  canvas.fill(shape.minus(shape.moved(-2, -2)), low);
  canvas.fill(shape.minus(shape.moved(1, 2)), high);
}
function renderSprite5(pose, traits) {
  const { stage, marks } = traits;
  const k = STAGE_SCALE[stage];
  const s = (v) => round(v * k);
  const canvas = new Canvas(LOCAL5, LOCAL5);
  const headX = ORIGIN5 + round(pose.lean / 2) + round(pose.wiggle);
  const baseX = ORIGIN5 - round(pose.lean / 2);
  const box = (centre, half, top, bottom, radius2) => roundRect(canvas.mask(), centre - s(half), ORIGIN5 + s(top), centre + s(half), ORIGIN5 + s(bottom), Math.max(1, s(radius2)));
  const padBottom = ORIGIN5 + s(19);
  const flameLength = Math.max(2, round((3 + 1.5 * Math.sin(pose.jet)) * k));
  const flame = canvas.mask();
  const core = canvas.mask();
  for (let row = 0; row < flameLength; row++) {
    const half = Math.round(s(3) * (1 - row / flameLength));
    for (let x = -half; x <= half; x++) flame.addPixel(baseX + x, padBottom + 1 + row);
    if (row < flameLength - 1 && (row > 0 || pose.flicker === 0)) core.addPixel(baseX, padBottom + 1 + row);
  }
  canvas.fill(flame, C6.glow);
  canvas.fill(core, C6.glowHi);
  const pad = box(baseX, 7, 16, 19, 1.5);
  canvas.sticker(pad, C6.steel, C6.line);
  canvas.fill(pad.minus(pad.moved(0, -1)), C6.steelLo);
  const body = box(baseX, 9, 2, 16, 4);
  canvas.sticker(body, C6.body, C6.line);
  shade(canvas, body, C6.bodyLo, C6.bodyHi);
  const panel = box(baseX, 5, 6, 13, 1);
  canvas.fill(panel, C6.steel);
  canvas.fill(panel.minus(panel.moved(0, -1)), C6.steelLo);
  const lights = canvas.mask();
  const lightSize = stage < 2 ? 1 : 2;
  for (const dx of MARKS2[marks]) {
    const x = baseX + s(dx) - (lightSize === 2 ? 1 : 0);
    const y = ORIGIN5 + s(9) - (lightSize === 2 ? 1 : 0);
    for (let n = 0; n < lightSize; n++) for (let m = 0; m < lightSize; m++) lights.addPixel(x + n, y + m);
  }
  canvas.fill(lights, C6.glow);
  const arms = canvas.mask();
  for (const side of [-1, 1]) {
    const shoulderX = baseX + side * s(10);
    const shoulderY = ORIGIN5 + s(6);
    const swing = 1.3 * k * Math.sin(pose.arm + (side > 0 ? Math.PI : 0));
    const handX = baseX + side * s(13.5 + 4 * pose.beep);
    const handY = ORIGIN5 + s(14) + round(swing) - round(9 * k * pose.beep);
    const steps = 8;
    for (let n = 0; n <= steps; n++) {
      const t = n / steps;
      arms.addDisc(shoulderX + (handX - shoulderX) * t, shoulderY + (handY - shoulderY) * t, Math.max(1.2, 2.1 * k));
    }
  }
  canvas.sticker(arms, C6.steel, C6.line);
  canvas.fill(arms.minus(arms.moved(-1, -1)), C6.steelLo);
  const ears = canvas.mask();
  for (const side of [-1, 1]) {
    ears.add(
      roundRect(
        canvas.mask(),
        side > 0 ? headX + s(13) : headX - s(16),
        ORIGIN5 + s(-11),
        side > 0 ? headX + s(16) : headX - s(13),
        ORIGIN5 + s(-4),
        1
      )
    );
  }
  canvas.sticker(ears, C6.steel, C6.line);
  canvas.fill(ears.minus(ears.moved(-1, 0)), C6.steelLo);
  const head = box(headX, 14, -17, 3, 5);
  canvas.sticker(head, C6.body, C6.line);
  shade(canvas, head, C6.bodyLo, C6.bodyHi);
  const screen = box(headX, 10, -13, -1, 2);
  canvas.fill(screen, C6.screen);
  drawFace2(canvas, pose, headX, s, stage);
  const tipX = headX + round(pose.sway);
  const tipY = ORIGIN5 + s(-25);
  const stalk = canvas.mask().addLine([
    [headX, ORIGIN5 + s(-17)],
    [tipX, tipY]
  ]);
  canvas.sticker(stalk, C6.steel, C6.line);
  const radius = Math.max(1.6, 2.8 * k) + pose.beep * k;
  const tip = canvas.mask().addDisc(tipX, tipY, radius);
  canvas.sticker(tip, C6.glow, C6.line);
  if (pose.lit) canvas.fill(canvas.mask().addDisc(tipX, tipY, Math.max(0.9, 1.1 * k)), C6.glowHi);
  if (pose.ping >= 0) {
    const ring = canvas.mask();
    const reach = radius + 2 + 3.5 * k * pose.ping;
    for (let n = 0; n < 8; n++) {
      const angle = Math.PI * n / 4;
      ring.addPixel(tipX + round(Math.cos(angle) * reach), tipY + round(Math.sin(angle) * reach));
    }
    canvas.fill(ring, C6.glow);
  }
  canvas.strengthenEdges([[C6.line, C6.rim]]);
  return canvas;
}
function drawFace2(canvas, pose, headX, s, stage) {
  const cx = headX + round(pose.look);
  const top = ORIGIN5 + s(-9);
  const width = EYE_WIDTH[stage];
  const height = EYE_HEIGHT[stage];
  const gap = EYE_GAP2[stage];
  if (pose.beep > 0.5) {
    const art = stage < 2 ? SMALL_HEART : BIG_HEART;
    const heart = canvas.mask();
    const glint = canvas.mask();
    art.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] === "X") heart.addPixel(headX - (row.length >> 1) + x, top - 1 + y);
      }
    });
    glint.addPixel(headX - (art[0].length >> 1) + 1, top);
    canvas.fill(heart, C6.heart);
    canvas.fill(glint, C6.white);
    return;
  }
  const eyes = canvas.mask();
  const glints = canvas.mask();
  for (const side of [-1, 1]) {
    const left = side < 0 ? cx - gap - width + 1 : cx + gap;
    if (pose.blink) {
      for (let x = 0; x < width; x++) eyes.addPixel(left + x, top + (height >> 1));
      continue;
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) eyes.addPixel(left + x, top + y);
    if (stage >= 2) glints.addPixel(left, top);
  }
  canvas.fill(eyes, C6.eye);
  canvas.fill(glints, C6.white);
  if (stage >= 1) {
    const mouth = canvas.mask();
    const y = top + height + (stage < 2 ? 1 : 2);
    if (stage < 2) {
      for (let x = -1; x <= 1; x++) mouth.addPixel(cx + x, y);
    } else {
      mouth.addPixel(cx - 2, y - 1).addPixel(cx - 1, y).addPixel(cx, y).addPixel(cx + 1, y).addPixel(cx + 2, y - 1);
    }
    canvas.fill(mouth, C6.eye);
  }
}
function spriteOffset5(pose) {
  return [round(pose.x) - ORIGIN5, round(pose.y) - ORIGIN5];
}
var prepare5 = perTraits((traits) => {
  const k = STAGE_SCALE[traits.stage];
  const poses = buildPoses5(traits);
  const sparks = makeSparks(
    SPARKS,
    FRAMES6,
    (birth) => {
      const pose = poses[birth];
      return [pose.x + (birth % 5 - 2) * k, pose.y + 24 * k];
    },
    { life: [8, 16], vx: [-0.12, 0.12], vy: [0.3, 0.6] }
  );
  return { poses, sparks };
});
function draw6(index, traits) {
  const { poses, sparks } = prepare5(traits);
  const frame = new Canvas(WIDTH6, HEIGHT6);
  forEachSpark(sparks, index, FRAMES6, (x, y, age) => {
    const dots = age < 0.5 ? [[x, y], [x, y + 1]] : [[x, y]];
    for (const [px, py] of dots) {
      if (px >= MARGIN6 && px < WIDTH6 - MARGIN6 && py >= MARGIN6 && py < HEIGHT6 - MARGIN6) {
        frame.pixels[py * WIDTH6 + px] = C6.glow;
      }
    }
  });
  const pose = poses[index];
  const [ox, oy] = spriteOffset5(pose);
  renderSprite5(pose, traits).stampOnto(frame, ox, oy, MARGIN6);
  return frame.pixels;
}
var robot = defineCritter({
  id: "robot",
  name: "Little robot",
  blurb: "Hovers about, and stops once a loop to beep and show a heart.",
  alt: "Animated pixel art of a little hovering robot with a screen for a face, drifting around the frame and stopping to beep and show a heart",
  width: WIDTH6,
  height: HEIGHT6,
  frames: FRAMES6,
  delayMs: 60,
  poster: 12,
  colourNames: COLOUR_NAMES6,
  bodyColour: "body",
  accentColours: ["glow", "glowHi"],
  fixedColours: ["steel", "steelLo", "screen", "eye", "white", "heart"],
  edgeColours: ["rim", "glow"],
  colourways: [
    {
      id: "cobalt",
      name: "Cobalt",
      colours: {
        rim: "#4d6ad0",
        line: "#26346e",
        body: "#7ea6ff",
        bodyHi: "#b9d0ff",
        bodyLo: "#5379d9",
        steel: "#c9d0dc",
        steelLo: "#8d97ab",
        screen: "#141c2e",
        eye: "#7dffe3",
        white: "#ffffff",
        heart: "#ff6b9a",
        glow: "#f58a2a",
        glowHi: "#ffe3a8"
      }
    },
    {
      id: "copper",
      name: "Copper",
      colours: {
        rim: "#bf6234",
        line: "#6e3320",
        body: "#f2a074",
        bodyHi: "#ffd2b4",
        bodyLo: "#d77548",
        steel: "#d6d2cc",
        steelLo: "#9b948b",
        screen: "#1f1a1c",
        eye: "#fff27a",
        white: "#ffffff",
        heart: "#ff6b9a",
        glow: "#1fb5a8",
        glowHi: "#b8fff2"
      }
    },
    {
      id: "lemon",
      name: "Lemon",
      colours: {
        rim: "#b08a14",
        line: "#6b5410",
        body: "#ffd84a",
        bodyHi: "#fff0a0",
        bodyLo: "#e5ad22",
        steel: "#cfd3d8",
        steelLo: "#8f959e",
        screen: "#1c1a2e",
        eye: "#ff9ee6",
        white: "#ffffff",
        heart: "#ff6b9a",
        glow: "#8a63e8",
        glowHi: "#ddd0ff"
      }
    }
  ],
  draw: draw6
});

// src/critters/index.ts
var critters = [dragon, axolotl, jellyfish, ghost, robot];
function findCritter(id) {
  return critters.find((critter) => critter.id === id);
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
function encodeGif(critter, colourway, traits = DEFAULT_TRAITS) {
  const { width, height, frames, delayMs } = critter;
  const palette = paletteOf(critter, colourway);
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
    const pixels = critter.frame(index, traits);
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

// src/site/links.ts
var WORKFLOW_PATH = ".github/workflows/critter.yml";

// src/action/activity.ts
var API = "https://api.github.com";
async function graphql(request, query) {
  const response = await request.fetch(`${API}/graphql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${request.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { login: request.login } })
  });
  if (!response.ok) throw new Error(`GitHub's GraphQL API answered ${response.status}`);
  return await response.json();
}
function userOrNull(result) {
  const unexpected = result.errors?.find((error) => error.type !== "NOT_FOUND");
  if (unexpected) throw new Error(unexpected.message);
  return result.data?.user ?? null;
}
var CALENDAR_QUERY = `query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionYears
      contributionCalendar { weeks { contributionDays { date contributionCount } } }
    }
  }
}`;
function yearWindow(year, now, from = `${year}-01-01T00:00:00Z`) {
  return { year, from, to: year === now.getUTCFullYear() ? now.toISOString() : `${year}-12-31T23:59:59Z` };
}
function totalsQuery(windows) {
  const aliases = windows.map(
    ({ year, from, to }) => `    y${year}: contributionsCollection(from: "${from}", to: "${to}") {
      contributionCalendar { totalContributions }
    }`
  );
  return `query($login: String!) {
  user(login: $login) {
${aliases.join("\n")}
  }
}`;
}
async function sumContributions(request, windows) {
  if (windows.length === 0) return 0;
  const result = await graphql(
    request,
    totalsQuery(windows)
  );
  const user = userOrNull(result);
  if (!user) throw new Error("GitHub stopped finding the user between two requests");
  return Object.values(user).reduce((sum, year) => sum + year.contributionCalendar.totalContributions, 0);
}
function lifetimeContributions(request, years) {
  return sumContributions(request, years.map((year) => yearWindow(year, request.now)));
}
function contributionsSince(request, since) {
  const start = since < request.now ? since : request.now;
  const windows = [yearWindow(start.getUTCFullYear(), request.now, start.toISOString())];
  for (let year = start.getUTCFullYear() + 1; year <= request.now.getUTCFullYear(); year++) {
    windows.push(yearWindow(year, request.now));
  }
  return sumContributions(request, windows);
}
async function languagesOf(request) {
  const response = await request.fetch(
    `${API}/users/${encodeURIComponent(request.login)}/repos?per_page=100&type=owner&sort=pushed`,
    { headers: { Authorization: `Bearer ${request.token}`, Accept: "application/vnd.github+json" } }
  );
  if (!response.ok) throw new Error(`GitHub's repository list answered ${response.status}`);
  return topLanguages(await response.json());
}
async function readActivity(request) {
  const calendar = userOrNull(await graphql(request, CALENDAR_QUERY));
  if (!calendar) return null;
  const { contributionYears, contributionCalendar } = calendar.contributionsCollection;
  const [lifetime, languages] = await Promise.all([
    lifetimeContributions(request, contributionYears),
    languagesOf(request)
  ]);
  return {
    activity: {
      lifetimeContributions: lifetime,
      days: contributionCalendar.weeks.flatMap((week) => week.contributionDays)
    },
    languages
  };
}
async function listCommits(request, url) {
  const response = await request.fetch(url, {
    headers: { Authorization: `Bearer ${request.token}`, Accept: "application/vnd.github+json" }
  });
  if (!response.ok) throw new Error(`GitHub's commit list answered ${response.status}`);
  return { commits: await response.json(), link: response.headers.get("link") ?? "" };
}
async function workflowAdded(request, env) {
  const repo = env.GITHUB_REPOSITORY;
  if (!repo) throw new Error("GITHUB_REPOSITORY isn't set");
  const ref = env.GITHUB_WORKFLOW_REF ?? "";
  const path = ref.startsWith(`${repo}/`) && ref.includes("@") ? ref.slice(repo.length + 1, ref.indexOf("@")) : WORKFLOW_PATH;
  const newest = await listCommits(request, `${API}/repos/${repo}/commits?path=${encodeURIComponent(path)}&per_page=1`);
  const last = /<([^>]+)>;\s*rel="last"/.exec(newest.link)?.[1];
  const oldest = last ? (await listCommits(request, last)).commits[0] : newest.commits[0];
  return oldest ? new Date(oldest.commit.committer.date) : request.now;
}
async function readEggContributions(request, env) {
  return contributionsSince(request, await workflowAdded(request, env));
}

// src/action/keepalive.ts
var KEEP_ALIVE_AFTER_DAYS = 50;
var KEEP_ALIVE_MESSAGE = "critter: keep the nightly run active";
function needsKeepAlive(latestCommit, now) {
  return now.getTime() - latestCommit.getTime() >= KEEP_ALIVE_AFTER_DAYS * 24 * 60 * 60 * 1e3;
}

// src/action/readme.ts
var START = "<!-- git-critters:start -->";
var END = "<!-- git-critters:end -->";
var KIT_URL = "https://github.com/aryamantepal/git-critters";
function escapeAttribute(text) {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
function critterBlock(critter, gifPath) {
  return [
    START,
    '<p align="center">',
    `  <img src="${escapeAttribute(gifPath)}" width="${critter.width * SCALE}" alt="${escapeAttribute(critter.alt)}" />`,
    "  <br />",
    `  <sub>Made with <a href="${KIT_URL}">git-critters</a></sub>`,
    "</p>",
    END
  ].join("\n");
}
var OTHER_CREATURES = ["github.com/yalongwastaken/git-koi"];
function otherCreature(readme) {
  for (const match of readme.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/gi)) {
    const html = match[0];
    if (/<img\b/i.test(html) && OTHER_CREATURES.some((repo) => html.includes(repo))) {
      return { start: match.index, end: match.index + html.length };
    }
  }
  return null;
}
function hasOtherCreature(readme) {
  return !(readme.includes(START) && readme.includes(END)) && otherCreature(readme) !== null;
}
var OTHER_CREATURE_LEFTOVERS = "This takes the place of your git-koi koi. Its workflow will keep redrawing a GIF nobody sees, so delete .github/workflows/koi.yml and the koi folder.";
function withCritterBlock(readme, block) {
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start !== -1 && end > start) {
    return readme.slice(0, start) + block + readme.slice(end + END.length);
  }
  const other = otherCreature(readme);
  if (other) return readme.slice(0, other.start) + block + readme.slice(other.end);
  return readme.trim() === "" ? `${block}
` : `${block}

${readme}`;
}

// src/action/main.ts
var SURPRISE = "surprise";
function input(name) {
  return (process.env[`INPUT_${name.toUpperCase()}`] ?? "").trim();
}
function fail(message) {
  console.log(`::error::${message}`);
  process.exit(1);
}
function flag(name) {
  const value = (input(name) || "false").toLowerCase();
  if (value !== "true" && value !== "false") fail(`${name} must be true or false, not "${input(name)}".`);
  return value === "true";
}
function git(...args) {
  return (0, import_node_child_process.execFileSync)("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}
function useBotIdentity() {
  git("config", "user.name", "github-actions[bot]");
  git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");
}
async function lookUp(login, now, forEgg) {
  try {
    const request = { login, token: input("token"), now, fetch };
    const look = await readActivity(request);
    if (!look) {
      console.log(`::warning::GitHub has no user called ${login}, so there's no activity to draw from.`);
      return null;
    }
    return { look, sinceAdded: forEgg ? await readEggContributions(request, process.env) : 0 };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.log(`::warning::Couldn't read ${login}'s activity from GitHub: ${reason.replace(/\s+/g, " ")}`);
    return null;
  }
}
async function main() {
  const surprise = input("critter") === SURPRISE;
  const picked = surprise ? void 0 : findCritter(input("critter"));
  if (!surprise && !picked) {
    fail(`Unknown critter "${input("critter")}". Choose from: ${[...critters.map((c) => c.id), SURPRISE].join(", ")}.`);
  }
  const activity = flag("activity");
  const eggOn = flag("egg") || surprise;
  if (eggOn && !activity) {
    fail(
      `${surprise ? `critter: ${SURPRISE}` : "egg: true"} needs activity: true, since the egg hatches from your contributions.`
    );
  }
  const colour = input("colour");
  if (colour === LANGUAGES_COLOURWAY && !activity) {
    fail(`colour: ${LANGUAGES_COLOURWAY} draws from your languages, so it needs activity: true.`);
  }
  const fixed = colour !== "" && colour !== LANGUAGES_COLOURWAY;
  if (fixed && surprise) {
    fail(
      `critter: ${SURPRISE} can't use the fixed colour "${colour}", since each colour belongs to one critter. Use colour: ${LANGUAGES_COLOURWAY}, or leave colour out.`
    );
  }
  if (fixed && picked && !picked.colourways.some((way) => way.id === colour)) {
    fail(
      `${picked.name} doesn't come in "${colour}". Choose from: ${picked.colourways.map((way) => way.id).join(", ")}${activity ? `, or ${LANGUAGES_COLOURWAY}` : ""}.`
    );
  }
  const gifPath = input("output") || "critter.gif";
  if (gifPath.startsWith("/") || gifPath.split("/").includes("..")) {
    fail(`output must be a path inside the repository, not "${gifPath}".`);
  }
  const readmeName = (0, import_node_fs.readdirSync)(".").find((name) => /^readme(\.md)?$/i.test(name)) ?? "README.md";
  const readme = (0, import_node_fs.existsSync)(readmeName) ? (0, import_node_fs.readFileSync)(readmeName, "utf8") : "";
  const now = /* @__PURE__ */ new Date();
  let plan;
  if (!activity) {
    const critter = picked;
    const way = fixed ? colour : critter.colourways[0].id;
    plan = {
      critter,
      colourway: way,
      traits: DEFAULT_TRAITS,
      message: `critter: draw the ${way} ${critter.id}`,
      added: `Added the ${way} ${critter.id}`
    };
  } else {
    const login = input("login");
    if (!login) fail("login is empty, so there's no one to draw the critter for.");
    const reading = await lookUp(login, now, eggOn);
    if (!reading && (0, import_node_fs.existsSync)(gifPath)) {
      console.log("Leaving the critter as it was, and trying again at the next run.");
      return;
    }
    if (eggOn && (!reading || !hasHatched(reading.sinceAdded))) {
      const message = `critter: draw the egg for ${yesterday(now)}`;
      if (reading) {
        console.log(`Drawing the egg: ${reading.sinceAdded} of ${HATCH_AFTER} contributions.`);
        plan = {
          critter: egg,
          colourway: languageColourway(egg, reading.look.languages),
          traits: { stage: crackLevelFor(reading.sinceAdded), marks: 0, mood: moodFor(reading.look.activity.days, now) },
          message,
          added: "Added the egg"
        };
      } else {
        console.log("Drawing an uncracked egg for now.");
        plan = { critter: egg, colourway: egg.colourways[0].id, traits: FRESH_EGG, message, added: "Added the egg" };
      }
    } else {
      const critter = picked ?? findCritter(surpriseFor(login));
      let colourway = fixed ? colour : critter.colourways[0].id;
      let traits = DEFAULT_TRAITS;
      if (reading) {
        traits = traitsFor(reading.look.activity, now);
        if (!fixed) colourway = languageColourway(critter, reading.look.languages);
        console.log(
          `Drawing from ${login}'s activity: stage ${traits.stage}, ${traits.marks} marks, ${traits.mood}${fixed ? "" : `, coloured by ${reading.look.languages.join(" and ") || "the default colours"}`}.`
        );
      } else {
        console.log("Drawing the default critter for now.");
      }
      const hatching = eggOn && readme.includes(egg.alt);
      const article = /^[aeiou]/i.test(critter.name) ? "an" : "a";
      plan = {
        critter,
        colourway,
        traits,
        message: hatching ? `critter: the egg hatched into ${article} ${critter.name.toLowerCase()}` : `critter: draw the ${critter.id} for ${yesterday(now)}`,
        added: `Added the ${critter.id}`
      };
    }
  }
  (0, import_node_fs.mkdirSync)((0, import_node_path.dirname)(gifPath), { recursive: true });
  (0, import_node_fs.writeFileSync)(gifPath, encodeGif(plan.critter, plan.colourway, plan.traits));
  (0, import_node_fs.writeFileSync)(readmeName, withCritterBlock(readme, critterBlock(plan.critter, gifPath)));
  if (hasOtherCreature(readme)) console.log(`::notice::${OTHER_CREATURE_LEFTOVERS}`);
  git("add", "--force", "--", gifPath, readmeName);
  if (git("diff", "--cached", "--name-only").trim() === "") {
    console.log("The critter is already up to date, so there's nothing to commit.");
    if (activity && needsKeepAlive(new Date(git("log", "-1", "--format=%cI").trim()), now)) {
      useBotIdentity();
      git("commit", "--quiet", "--allow-empty", "--message", KEEP_ALIVE_MESSAGE);
      git("push", "--quiet");
      console.log("The last commit is getting old, so this made an empty one to keep the nightly run active.");
    }
    return;
  }
  useBotIdentity();
  git("commit", "--quiet", "--message", plan.message);
  git("push", "--quiet");
  console.log(`${plan.added} to ${readmeName}.`);
}
main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
