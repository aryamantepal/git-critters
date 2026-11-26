import { forEachSpark, makeSparks } from "../engine/body.ts";
import type { Spark } from "../engine/body.ts";
import { Canvas } from "../engine/canvas.ts";
import { colourIndexes, defineCritter } from "../engine/critter.ts";
import type { Mask, Point } from "../engine/mask.ts";
import { clamp, cumulativePhase, round, smooth, TAU } from "../engine/motion.ts";
import type { Flight } from "../engine/motion.ts";
import { blinkFrames, cyclesFor, perTraits, roam, STAGE_SCALE } from "../engine/traits.ts";
import type { Mood, Traits } from "../engine/traits.ts";

const WIDTH = 180;
const HEIGHT = 120;
const FRAMES = 200;
const MARGIN = 2;
const STEPS = 16;
const LOCAL = 96;
const ORIGIN_X = LOCAL / 2;
const GROUND = 74;
const ROCK = 0.08;
// The frames where it pauses to puff up and gobble. A resting turkey stays calm.
const GOBBLE_START = 108;
const GOBBLE_END = 140;
const GOBBLES = 3;
const GAIT: Readonly<Record<Mood, number>> = { resting: 0.45, steady: 1, lively: 1 };
const LEAVES: Readonly<Record<Mood, number>> = { resting: 40, steady: 44, lively: 56 };

const WAYPOINTS: readonly Point[] = [
  [48, 84],
  [74, 70],
  [106, 76],
  [132, 68],
  [138, 88],
  [110, 98],
  [84, 90],
  [58, 98],
];

// Body measurements at full size, as [across, up] from between its feet, with up negative.
const BODY_MID = -14;
const BODY_RX = 13.5;
const BODY_RY = 13;
const HEAD_Y = -28;
const HEAD_R = 8.2;
const EYE_Y = -29.5;
const BEAK_Y = -25.5;
const EYE_GAP = [3, 3.5, 4, 4.5];
const FACE_SLIDE = [0, 0, 0.6, 0.7];
const FEATHERS = 7;

// Breast markings at full size, in the same body coordinates.
const MARKS: readonly (readonly Point[])[] = [
  [],
  [[0, -14]],
  [
    [-4, -15],
    [4, -15],
  ],
  [
    [-4.5, -16],
    [4.5, -16],
    [0, -11],
  ],
];

const COLOUR_NAMES = [
  "rim",
  "line",
  "body",
  "bodyHi",
  "bodyLo",
  "tail",
  "tailHi",
  "tailTip",
  "eye",
  "white",
  "beak",
  "beakLo",
  "wattle",
  "blush",
  "leaf",
] as const;
const C = colourIndexes(COLOUR_NAMES);

interface Pose {
  x: number;
  y: number;
  rock: number;
  bob: number;
  /** 0 normally, rising to 1 mid-gobble. */
  gobble: number;
  /** Oscillation during gobble for wattle/head bob. */
  trill: number;
  /** Gentle tail-feather breathing sway. */
  sway: number;
  lift: readonly [number, number];
  flap: readonly [number, number];
  look: number;
  blink: boolean;
  travel: Point;
  walking: boolean;
}

function gobbleAt(mood: Mood, i: number): number {
  if (mood === "resting" || i < GOBBLE_START || i > GOBBLE_END) return 0;
  return clamp(Math.min(i - GOBBLE_START, GOBBLE_END - i) / 4, 0, 1);
}

function sample(values: Float64Array, at: number): number {
  const n = values.length;
  const low = Math.floor(at);
  const f = at - low;
  return values[((low % n) + n) % n] * (1 - f) + values[(((low + 1) % n) + n) % n] * f;
}

function walkPath(mood: Mood, gobble: Float64Array): Flight {
  const path = roam(WAYPOINTS, mood, FRAMES);
  const rate = gobble.map((g) => 1 - g);
  const total = rate.reduce((sum, v) => sum + v, 0);
  const progress = new Float64Array(FRAMES);
  let sum = 0;
  for (let i = 0; i < FRAMES; i++) {
    progress[i] = (sum * FRAMES) / total;
    sum += rate[i];
  }
  const x = progress.map((p) => sample(path.x, p));
  const y = progress.map((p) => sample(path.y, p));
  const vx = new Float64Array(FRAMES);
  const vy = new Float64Array(FRAMES);
  for (let i = 0; i < FRAMES; i++) {
    const next = (i + 1) % FRAMES;
    const previous = (i - 1 + FRAMES) % FRAMES;
    vx[i] = (x[next] - x[previous]) / 2;
    vy[i] = (y[next] - y[previous]) / 2;
  }
  return { x, y, vx, vy };
}

function buildPoses({ mood }: Traits): Pose[] {
  const gobbles = Float64Array.from({ length: FRAMES }, (_, i) => gobbleAt(mood, i));
  const { x, y, vx, vy } = walkPath(mood, gobbles);
  const step = cumulativePhase(
    vx.map((v, i) => 0.25 + Math.hypot(v, vy[i])),
    cyclesFor(mood, STEPS),
  );
  const look = smooth(vx.map((v) => clamp(v * 3, -2, 2)), 13);
  const blinks = blinkFrames(mood, [28, 76, 166], FRAMES);
  const span = GOBBLE_END - GOBBLE_START;
  const trills = cyclesFor(mood, GOBBLES);
  const sways = cyclesFor(mood, 12);
  const gait = GAIT[mood];
  return Array.from({ length: FRAMES }, (_, i) => {
    const gobble = gobbles[i];
    const walk = 1 - gobble;
    const s = Math.sin(step[i]);
    const into = (i - GOBBLE_START) / span;
    const trill = gobble > 0 ? gobble * Math.sin(TAU * trills * into) : 0;
    const wingBase = 0.16 + 0.14 * gobble;
    const wingBeat = 0.1 * gait * s * walk + 0.16 * trill;
    return {
      x: x[i],
      y: y[i],
      rock: ROCK * gait * s * walk,
      bob: 1.1 * gait * Math.abs(s) * walk + 1.2 * Math.abs(trill),
      gobble,
      trill,
      sway: Math.sin((TAU * sways * i) / FRAMES),
      lift: [2.4 * gait * Math.max(0, s) * walk, 2.4 * gait * Math.max(0, -s) * walk],
      flap: [wingBase + wingBeat, wingBase - wingBeat],
      look: look[i],
      blink: blinks.has(i),
      travel: [vx[i], vy[i]],
      walking: gobble === 0,
    };
  });
}

interface Placement {
  k: number;
  cos: number;
  sin: number;
  px: number;
  py: number;
}

function placementOf(pose: Pose, k: number): Placement {
  return {
    k,
    cos: Math.cos(pose.rock),
    sin: Math.sin(pose.rock),
    px: ORIGIN_X,
    py: GROUND - pose.bob * k,
  };
}

function toBody(at: Placement, x: number, y: number): Point {
  const dx = x - at.px;
  const dy = y - at.py;
  return [(dx * at.cos + dy * at.sin) / at.k, (-dx * at.sin + dy * at.cos) / at.k];
}

function toSprite(at: Placement, u: number, v: number): Point {
  const su = u * at.k;
  const sv = v * at.k;
  return [at.px + su * at.cos - sv * at.sin, at.py + su * at.sin + sv * at.cos];
}

function shapeMask(canvas: Canvas, at: Placement, inside: (u: number, v: number) => boolean): Mask {
  const mask = canvas.mask();
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const [u, v] = toBody(at, x, y);
      if (inside(u, v)) mask.addPixel(x, y);
    }
  }
  return mask;
}

function addCapsule(mask: Mask, x0: number, y0: number, x1: number, y1: number, radius: number): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    mask.addDisc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius);
  }
}

function drawTailFan(canvas: Canvas, at: Placement, pose: Pose): void {
  const k = at.k;
  const fan = canvas.mask();
  const hi = canvas.mask();
  const tip = canvas.mask();
  const spread = 1.05 + 0.18 * pose.gobble + 0.12 * pose.sway;
  const pivotV = -15;
  const reach = 21 + 2.5 * pose.gobble;
  const width = 4.2 * k;

  for (let f = 0; f < FEATHERS; f++) {
    const angle = -spread + (2 * spread * f) / (FEATHERS - 1);
    const dirX = Math.sin(angle);
    const dirY = -Math.cos(angle);
    const [bx, by] = toSprite(at, dirX * 8, pivotV + dirY * 8);
    const [tx, ty] = toSprite(at, dirX * reach, pivotV + dirY * reach);
    const [mx, my] = toSprite(at, dirX * (reach - 3.5), pivotV + dirY * (reach - 3.5));
    const [ix, iy] = toSprite(at, dirX * (reach - 6.5), pivotV + dirY * (reach - 6.5));
    addCapsule(fan, bx, by, tx, ty, width);
    tip.addDisc(tx, ty, width * 0.92);
    hi.addDisc(mx, my, width * 0.78);
    hi.addDisc(ix, iy, width * 0.65);
  }
  canvas.sticker(fan, C.tail, C.line);
  canvas.fill(hi.and(fan), C.tailHi);
  canvas.fill(tip.and(fan), C.tailTip);
}

function insideBody(u: number, v: number, puff: number): boolean {
  if (u * u + (v - HEAD_Y) ** 2 <= HEAD_R * HEAD_R) return true;
  if (v > -2) return false;
  const rx = BODY_RX * (1 + 0.08 * puff);
  const t = (v - BODY_MID) / BODY_RY;
  if (Math.abs(t) > 1) return false;
  return Math.abs(u) <= rx * Math.sqrt(1 - t * t) * (1 + 0.12 * t);
}

function drawFeet(canvas: Canvas, pose: Pose, k: number): void {
  const feet = canvas.mask();
  for (const [side, lift] of [
    [-1, pose.lift[0]],
    [1, pose.lift[1]],
  ] as const) {
    const fx = ORIGIN_X + side * 6 * k;
    const fy = GROUND - lift * k;
    addCapsule(feet, fx, fy - 4 * k, fx, fy, 1.4 * k);
    addCapsule(feet, fx - 2.4 * k, fy, fx + 2.4 * k, fy, 1.3 * k);
  }
  canvas.sticker(feet, C.beak, C.line);
  canvas.fill(feet.minus(feet.moved(0, -1)), C.beakLo);
}

function drawWings(canvas: Canvas, at: Placement, pose: Pose): void {
  const wings = canvas.mask();
  const k = at.k;
  for (const [side, angle] of [
    [-1, pose.flap[0]],
    [1, pose.flap[1]],
  ] as const) {
    const sx = side * 11.5;
    const sy = -19;
    const ex = sx + side * (Math.sin(angle) * 9 + 2);
    const ey = sy + Math.cos(angle) * 9;
    const [x0, y0] = toSprite(at, sx, sy);
    const [x1, y1] = toSprite(at, ex, ey);
    addCapsule(wings, x0, y0, x1, y1, 3.3 * k);
  }
  canvas.sticker(wings, C.bodyLo, C.line);
}

function drawMarks(canvas: Canvas, at: Placement, marks: number): void {
  const spots = canvas.mask();
  for (const [u, v] of MARKS[marks]) {
    const [x, y] = toSprite(at, u, v);
    spots.addDisc(x, y, Math.max(1.2, 1.8 * at.k));
  }
  canvas.fill(spots, C.tailHi);
}

function drawFace(canvas: Canvas, at: Placement, pose: Pose, stage: number): void {
  const k = at.k;
  const slide = pose.look * FACE_SLIDE[stage];
  const [fx, fy] = toSprite(at, slide, EYE_Y);
  const cx = round(fx);
  const cy = round(fy);
  const gap = EYE_GAP[stage];

  const eyes = canvas.mask();
  const glints = canvas.mask();
  const tall = pose.gobble > 0.5 ? 4 : 3;
  for (const side of [-1, 1]) {
    const ex = round(cx + side * gap);
    if (pose.blink) {
      eyes.addPixel(ex - 1, cy + 1).addPixel(ex, cy + 1).addPixel(ex + 1, cy + 1);
      continue;
    }
    for (let dy = 0; dy < tall; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dy === tall - 1 && dx !== 0) continue;
        eyes.addPixel(ex + dx, cy + dy);
      }
    }
    glints.addPixel(ex - 1, cy);
  }
  canvas.fill(eyes, C.eye);
  canvas.fill(glints, C.white);

  const blush = canvas.mask();
  for (const side of [-1, 1]) {
    const bx = round(cx + side * (gap + (stage < 2 ? 2 : 3)));
    blush.addPixel(bx - 1, cy + 3).addPixel(bx, cy + 3).addPixel(bx + 1, cy + 3);
  }
  canvas.fill(blush, C.blush);

  // Wattle & snood, swaying slightly during gobble.
  const [bx, by] = toSprite(at, slide, BEAK_Y);
  const wattle = canvas.mask();
  const sway = pose.trill * 1.4 * k;
  addCapsule(wattle, bx + 1.5 * k, by + 1 * k, bx + 2 * k + sway, by + 5.2 * k, 1.5 * k);
  wattle.addDisc(bx + 0.5 * k + sway * 0.5, by - 1.5 * k, 1.3 * k);
  canvas.sticker(wattle, C.wattle, C.line);

  // Golden beak, opening slightly when gobbling.
  const beak = canvas.mask();
  const open = pose.gobble > 0.4 ? 1 : 0;
  addCapsule(beak, bx - 2 * k, by, bx + 2 * k, by, 1.4 * k);
  beak.addDisc(bx, by + 1.4 * k + open, 1.1 * k);
  canvas.sticker(beak, C.beak, C.line);
  canvas.fill(beak.minus(beak.moved(0, -1)), C.beakLo);
}

function renderSprite(pose: Pose, traits: Traits): Canvas {
  const k = STAGE_SCALE[traits.stage];
  const at = placementOf(pose, k);
  const canvas = new Canvas(LOCAL, LOCAL);
  drawTailFan(canvas, at, pose);
  drawFeet(canvas, pose, k);
  const body = shapeMask(canvas, at, (u, v) => insideBody(u, v, pose.gobble));
  canvas.sticker(body, C.body, C.line);
  canvas.fill(body.minus(body.moved(-2, -2)), C.bodyLo);
  canvas.fill(body.minus(body.moved(1, 2)), C.bodyHi);
  drawMarks(canvas, at, traits.marks);
  drawWings(canvas, at, pose);
  drawFace(canvas, at, pose, traits.stage);
  canvas.strengthenEdges([[C.line, C.rim]]);
  return canvas;
}

function kickLeaves(poses: Pose[], { mood, stage }: Traits): Spark[] {
  const k = STAGE_SCALE[stage];
  return makeSparks(
    LEAVES[mood],
    FRAMES,
    (birth) => {
      const pose = poses[birth];
      if (!pose.walking) return [-100, -100];
      const [vx, vy] = pose.travel;
      const speed = Math.hypot(vx, vy);
      const side = birth % 2 === 0 ? -1 : 1;
      const out = side * 6 * k;
      if (speed < 0.05) return [pose.x + out, pose.y - 2 * k];
      return [pose.x + out - (vx / speed) * 4 * k, pose.y - 2 * k - (vy / speed) * 2 * k];
    },
    { life: [18, 30], vx: [-0.45, 0.45], vy: [-0.85, -0.35] },
  );
}

function drawLeaves(frame: Canvas, leaves: Spark[], index: number): void {
  forEachSpark(leaves, index, FRAMES, (x, y, age) => {
    const px = round(x);
    const py = round(y);
    if (px < MARGIN || px >= WIDTH - MARGIN || py < MARGIN || py >= HEIGHT - MARGIN) return;
    frame.pixels[py * WIDTH + px] = C.leaf;
    if (age < 0.5 && px + 1 < WIDTH - MARGIN) {
      frame.pixels[py * WIDTH + px + 1] = C.leaf;
    }
  });
}

const prepare = perTraits((traits): { poses: Pose[]; leaves: Spark[] } => {
  const poses = buildPoses(traits);
  return { poses, leaves: kickLeaves(poses, traits) };
});

function draw(index: number, traits: Traits): Uint8Array {
  const { poses, leaves } = prepare(traits);
  const pose = poses[index];
  const frame = new Canvas(WIDTH, HEIGHT);
  drawLeaves(frame, leaves, index);
  renderSprite(pose, traits).stampOnto(frame, round(pose.x) - ORIGIN_X, round(pose.y) - GROUND, MARGIN);
  return frame.pixels;
}

export const turkey = defineCritter({
  id: "turkey",
  name: "Turkey",
  blurb: "Struts about fanning its tail feathers, kicking up autumn leaves, and pauses once a loop to puff up and gobble.",
  alt: "Animated pixel art of a plump turkey strutting around the frame, fanning its tail feathers and pausing to puff up and gobble",
  width: WIDTH,
  height: HEIGHT,
  frames: FRAMES,
  delayMs: 60,
  poster: 12,
  colourNames: COLOUR_NAMES,
  bodyColour: "body",
  accentColours: ["tail", "tailHi", "tailTip"],
  fixedColours: ["eye", "white", "beak", "beakLo", "wattle", "blush", "leaf"],
  edgeColours: ["rim", "leaf"],
  colourways: [
    {
      id: "autumn",
      name: "Autumn",
      colours: {
        rim: "#9c6449",
        line: "#2b160c",
        body: "#8b4a2b",
        bodyHi: "#aa623d",
        bodyLo: "#66321a",
        tail: "#d97724",
        tailHi: "#f4a640",
        tailTip: "#b83227",
        eye: "#1e0f08",
        white: "#ffffff",
        beak: "#f0b429",
        beakLo: "#c28412",
        wattle: "#d93829",
        blush: "#f49080",
        leaf: "#d4802a",
      },
    },
    {
      id: "heritage",
      name: "Heritage",
      colours: {
        rim: "#7d6e82",
        line: "#1b141e",
        body: "#4a3f4d",
        bodyHi: "#66586b",
        bodyLo: "#332a36",
        tail: "#c47c38",
        tailHi: "#e8ad58",
        tailTip: "#2f8a82",
        eye: "#140e17",
        white: "#ffffff",
        beak: "#eab338",
        beakLo: "#bd8318",
        wattle: "#cc3333",
        blush: "#e88b98",
        leaf: "#c96c3b",
      },
    },
    {
      id: "harvest",
      name: "Harvest",
      colours: {
        rim: "#946373",
        line: "#241118",
        body: "#6b3b4b",
        bodyHi: "#8a5265",
        bodyLo: "#4d2633",
        tail: "#d98a2b",
        tailHi: "#f5c156",
        tailTip: "#558c5a",
        eye: "#1a0b10",
        white: "#ffffff",
        beak: "#f2bc42",
        beakLo: "#c48b1b",
        wattle: "#e04038",
        blush: "#f5949e",
        leaf: "#cf8b30",
      },
    },
  ],
  draw,
});
