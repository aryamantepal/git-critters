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
const STEPS = 18; // whole waddles per loop, each a step with either foot
const LOCAL = 96;
const ORIGIN_X = LOCAL / 2;
const GROUND = 72; // where its feet stand in the sprite
const ROCK = 0.13; // how far it tips over each foot, in radians
// The frames where it stops to cheer: hops with its flippers up. A resting penguin doesn't.
const CHEER_START = 116;
const CHEER_END = 146;
const HOPS = 2;
const CHEER_FLAPS = 4;
// How far it rocks and swings its flippers as it walks, by mood: a resting one barely shuffles.
const GAIT: Readonly<Record<Mood, number>> = { resting: 0.45, steady: 1, lively: 1 };
const SWING: Readonly<Record<Mood, number>> = { resting: 0.5, steady: 1, lively: 1.8 };
// How high it hops when it cheers, at full size.
const HOP_HEIGHT: Readonly<Record<Mood, number>> = { resting: 0, steady: 6, lively: 8 };
// How many puffs of snow its feet kick up over a loop, by mood. None while it stands to cheer.
const SNOW: Readonly<Record<Mood, number>> = { resting: 24, steady: 44, lively: 64 };
// How far out from between its feet the snow flies off, at full size: just past its feet, so its body doesn't hide it.
const KICK_OUT = 11;

// Its walk on the ice, by where its feet touch the ground.
const WAYPOINTS: readonly Point[] = [
  [46, 84],
  [72, 70],
  [104, 76],
  [134, 68],
  [140, 90],
  [110, 100],
  [84, 92],
  [56, 100],
];

// Body measurements at full size, as [across, up] from between its feet, with up negative.
const BODY_MID = -16;
const BODY_RX = 13;
const BODY_RY = 18;
const HEAD_Y = -36;
const HEAD_R = 10.5;
const BELLY_Y = -13;
const BELLY_RX = 9.5;
const BELLY_RY = 13.5;
const SHOULDER: Point = [10.5, -26];
const FLIPPER_LENGTH = 15;
const FLIPPER_WIDTH = 3.3;
const EYE_Y = -38;
const BEAK_Y = -32.5;
// How far apart the eyes sit, in pixels, by stage: a small face needs them closer.
const EYE_GAP = [3, 4, 4, 5];
// How far the face slides the way it looks, by stage: a small head has no room, so only the pupils move.
const FACE_SLIDE = [0, 0, 0.6, 0.6];

// Spots on the belly at full size, in the same body coordinates.
const MARKS: readonly (readonly Point[])[] = [
  [],
  [[0, -17]],
  [
    [-4, -19],
    [4, -19],
  ],
  [
    [-4.5, -20],
    [4.5, -20],
    [0, -12],
  ],
];

const COLOUR_NAMES = [
  "rim",
  "line",
  "body",
  "bodyHi",
  "bodyLo",
  "belly",
  "bellyLo",
  "eye",
  "white",
  "beak",
  "beakLo",
  "blush",
  "snow",
] as const;
const C = colourIndexes(COLOUR_NAMES);

interface Pose {
  x: number;
  y: number;
  /** How far the body tips over its feet. Positive leans right. */
  rock: number;
  /** How far the body rises off its feet mid-step, at full size. */
  bob: number;
  /** How far the whole penguin is off the ground, at full size. */
  hop: number;
  /** How far each foot is lifted, left then right, at full size. */
  lift: readonly [number, number];
  /** Each flipper's angle out from hanging straight down, left then right. */
  flap: readonly [number, number];
  /** Where it's looking: negative is left, positive is right. */
  look: number;
  blink: boolean;
  /** Which way it's going, in pixels a frame, so snow can fly the other way. */
  travel: Point;
  /** Whether it's walking rather than stopped to cheer. */
  walking: boolean;
}

function cheerAt(mood: Mood, i: number): number {
  if (mood === "resting" || i < CHEER_START || i > CHEER_END) return 0;
  return clamp(Math.min(i - CHEER_START, CHEER_END - i) / 4, 0, 1);
}

/** Where `values` is at the (fractional) frame `at`, wrapping round. */
function sample(values: Float64Array, at: number): number {
  const n = values.length;
  const low = Math.floor(at);
  const f = at - low;
  return values[((low % n) + n) % n] * (1 - f) + values[(((low + 1) % n) + n) % n] * f;
}

/** The roam path, held still while it cheers, and sped up elsewhere so the loop still closes. */
function walkPath(mood: Mood, cheer: Float64Array): Flight {
  const path = roam(WAYPOINTS, mood, FRAMES);
  const rate = cheer.map((c) => 1 - c);
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
  const cheers = Float64Array.from({ length: FRAMES }, (_, i) => cheerAt(mood, i));
  const { x, y, vx, vy } = walkPath(mood, cheers);
  // It steps faster when it's going faster, but never stops waddling.
  const step = cumulativePhase(
    vx.map((v, i) => 0.25 + Math.hypot(v, vy[i])),
    cyclesFor(mood, STEPS),
  );
  const look = smooth(vx.map((v) => clamp(v * 3, -2, 2)), 13);
  const blinks = blinkFrames(mood, [24, 70, 168], FRAMES);
  const span = CHEER_END - CHEER_START;
  const hops = cyclesFor(mood, HOPS);
  const flaps = cyclesFor(mood, CHEER_FLAPS);
  const gait = GAIT[mood];
  const swing = SWING[mood];
  return Array.from({ length: FRAMES }, (_, i) => {
    const cheer = cheers[i];
    const walk = 1 - cheer;
    const s = Math.sin(step[i]);
    const into = (i - CHEER_START) / span;
    const hop = cheer > 0 ? HOP_HEIGHT[mood] * cheer * Math.abs(Math.sin(Math.PI * hops * into)) : 0;
    const raised = 1.75 + 0.3 * Math.sin(TAU * flaps * into);
    // The flippers swing a quarter step behind the rock, to keep its balance. That keeps
    // something moving at the top of each rock, where the body is all but still.
    const balance = Math.cos(step[i]);
    const flipper = (side: number) => (0.34 + (0.12 * side * s + 0.16 * balance) * swing) * walk + raised * cheer;
    return {
      x: x[i],
      y: y[i],
      rock: ROCK * gait * s * walk,
      bob: 1.2 * gait * Math.abs(s) * walk,
      hop,
      lift: [2.5 * gait * Math.max(0, s) * walk, 2.5 * gait * Math.max(0, -s) * walk],
      flap: [flipper(-1), flipper(1)],
      look: look[i],
      blink: blinks.has(i),
      travel: [vx[i], vy[i]],
      walking: cheer === 0,
    };
  });
}

/** Where the body is drawn on this frame: its scale, its tilt, and the point it tips around. */
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
    py: GROUND - (pose.bob + pose.hop) * k,
  };
}

/** A sprite pixel in full-size body coordinates. */
function toBody(at: Placement, x: number, y: number): Point {
  const dx = x - at.px;
  const dy = y - at.py;
  return [(dx * at.cos + dy * at.sin) / at.k, (-dx * at.sin + dy * at.cos) / at.k];
}

/** A point in full-size body coordinates, in sprite pixels. */
function toSprite(at: Placement, u: number, v: number): Point {
  const su = u * at.k;
  const sv = v * at.k;
  return [at.px + su * at.cos - sv * at.sin, at.py + su * at.sin + sv * at.cos];
}

/** Every sprite pixel whose body coordinates pass `inside`. */
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

function insideBody(u: number, v: number): boolean {
  if (u * u + (v - HEAD_Y) ** 2 <= HEAD_R * HEAD_R) return true;
  if (v > 0) return false;
  // An egg, a little wider low down, cut flat where it stands.
  const t = (v - BODY_MID) / BODY_RY;
  if (Math.abs(t) > 1) return false;
  return Math.abs(u) <= BODY_RX * Math.sqrt(1 - t * t) * (1 + 0.1 * t);
}

function insideBelly(u: number, v: number): boolean {
  return (u / BELLY_RX) ** 2 + ((v - BELLY_Y) / BELLY_RY) ** 2 <= 1;
}

function insideFlipper(side: number, angle: number): (u: number, v: number) => boolean {
  const du = side * Math.sin(angle);
  const dv = Math.cos(angle);
  const half = FLIPPER_LENGTH / 2;
  return (u, v) => {
    const ru = u - side * SHOULDER[0];
    const rv = v - SHOULDER[1];
    const along = ru * du + rv * dv;
    const across = -ru * dv + rv * du;
    return ((along - half) / half) ** 2 + (across / FLIPPER_WIDTH) ** 2 <= 1;
  };
}

function drawFlippers(canvas: Canvas, pose: Pose, at: Placement): void {
  for (const [n, side] of [-1, 1].entries()) {
    const flipper = shapeMask(canvas, at, insideFlipper(side, pose.flap[n]));
    canvas.sticker(flipper, C.body, C.line);
    canvas.fill(flipper.minus(flipper.moved(-1, -1)), C.bodyLo);
  }
}

function drawBody(canvas: Canvas, at: Placement): { body: Mask; belly: Mask } {
  const body = shapeMask(canvas, at, insideBody);
  canvas.sticker(body, C.body, C.line);
  canvas.fill(body.minus(body.moved(-2, -2)), C.bodyLo);
  canvas.fill(body.minus(body.moved(1, 2)), C.bodyHi);
  const belly = shapeMask(canvas, at, insideBelly).and(body);
  canvas.fill(belly, C.belly);
  canvas.fill(belly.minus(body.moved(-2, -2)), C.bellyLo);
  return { body, belly };
}

function drawFeet(canvas: Canvas, pose: Pose, k: number): void {
  for (const [n, side] of [-1, 1].entries()) {
    const foot = canvas.mask();
    const cx = ORIGIN_X + side * 5 * k;
    const cy = GROUND + (1 - pose.hop - pose.lift[n]) * k;
    for (let y = Math.floor(cy - 3); y <= cy + 3; y++) {
      for (let x = Math.floor(cx - 6); x <= cx + 6; x++) {
        if (((x - cx) / (4.5 * k)) ** 2 + ((y - cy) / Math.max(1.5, 2.2 * k)) ** 2 <= 1) foot.addPixel(x, y);
      }
    }
    canvas.sticker(foot, C.beak, C.line);
    canvas.fill(foot.minus(foot.moved(0, -1)), C.beakLo);
  }
}

function drawFace(canvas: Canvas, pose: Pose, at: Placement, body: Mask, stage: number): void {
  // The head is small, so the face only slides a little, if at all, and the pupils do the rest.
  const slide = pose.look * FACE_SLIDE[stage];
  const [ex, ey] = toSprite(at, slide, EYE_Y);
  const cx = round(ex);
  const top = round(ey) - 2;
  const gap = EYE_GAP[stage];
  const rings = canvas.mask();
  const pupils = canvas.mask();
  const glance = pose.look > 1 ? 1 : pose.look < -1 ? -1 : 0;
  for (const side of [-1, 1]) {
    const left = cx + side * gap - 2;
    if (pose.blink) {
      rings.addPixel(left, top + 2).addPixel(left + 1, top + 1).addPixel(left + 2, top + 1).addPixel(left + 3, top + 2);
      continue;
    }
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const corner = (y === 0 || y === 3) && (x === 0 || x === 3);
        if (!corner) rings.addPixel(left + x, top + y);
      }
    }
    for (let y = 1; y < 3; y++) for (let x = 1; x < 3; x++) pupils.addPixel(left + x + glance, top + y);
  }
  canvas.fill(rings.and(body), C.white);
  canvas.fill(pupils.and(body), C.eye);

  const blush = canvas.mask();
  for (const side of [-1, 1]) {
    const bx = side < 0 ? cx - gap - 1 : cx + gap;
    blush.addPixel(bx, top + 4).addPixel(bx + side, top + 4);
  }
  canvas.fill(blush.and(body), C.blush);

  const [bx, by] = toSprite(at, slide, BEAK_Y);
  const beakX = round(bx);
  const beakY = Math.max(round(by), top + 4);
  const wide = stage >= 2 ? 2 : 1;
  const beak = canvas.mask();
  const tip = canvas.mask();
  for (let x = -wide; x <= wide; x++) beak.addPixel(beakX + x, beakY);
  for (let x = 1 - wide; x <= wide - 1; x++) beak.addPixel(beakX + x, beakY + 1);
  tip.addPixel(beakX, beakY + wide);
  canvas.fill(beak.and(body), C.beak);
  canvas.fill(tip.and(body), C.beakLo);
}

function drawMarks(canvas: Canvas, at: Placement, belly: Mask, marks: number): void {
  const spots = canvas.mask();
  for (const [u, v] of MARKS[marks]) {
    const [sx, sy] = toSprite(at, u, v);
    // A 2x2 spot, centred on its point.
    const x = round(sx + 0.5);
    const y = round(sy + 0.5);
    spots.addPixel(x, y).addPixel(x - 1, y).addPixel(x, y - 1).addPixel(x - 1, y - 1);
  }
  canvas.fill(spots.and(belly), C.body);
}

function renderSprite(pose: Pose, traits: Traits): Canvas {
  const k = STAGE_SCALE[traits.stage];
  const at = placementOf(pose, k);
  const canvas = new Canvas(LOCAL, LOCAL);
  drawFlippers(canvas, pose, at);
  const { body, belly } = drawBody(canvas, at);
  drawMarks(canvas, at, belly, traits.marks);
  drawFace(canvas, pose, at, body, traits.stage);
  drawFeet(canvas, pose, k);
  canvas.strengthenEdges([[C.line, C.rim]]);
  return canvas;
}

/** Puffs of snow kicked up from its feet, flying back the way it came. */
function kickSnow(poses: readonly Pose[], { mood, stage }: Traits): Spark[] {
  const k = STAGE_SCALE[stage];
  // How much of its pace is across the frame. Walking straight up or down, the snow flies off
  // either side, and more slowly.
  const across = (birth: number) => {
    const [vx, vy] = poses[birth].travel;
    return vx / (Math.hypot(vx, vy) || 1);
  };
  const side = (birth: number) => (Math.abs(across(birth)) > 0.3 ? -Math.sign(across(birth)) : birth % 2 === 0 ? -1 : 1);
  const sparks = makeSparks(
    SNOW[mood],
    FRAMES,
    (birth) => {
      const pose = poses[birth];
      return [pose.x + side(birth) * KICK_OUT * k, pose.y + 1];
    },
    { life: [12, 22], vx: [0.15, 0.5], vy: [-0.25, -0.05] },
  );
  return sparks
    .filter((spark) => poses[spark.birth].walking)
    .map((spark) => ({ ...spark, vx: side(spark.birth) * spark.vx * Math.max(0.4, Math.abs(across(spark.birth))) }));
}

function drawSnow(frame: Canvas, snow: readonly Spark[], index: number): void {
  const inside = ([px, py]: Point) => px >= MARGIN && px < WIDTH - MARGIN && py >= MARGIN && py < HEIGHT - MARGIN;
  forEachSpark(snow, index, FRAMES, (x, y, age) => {
    if (age >= 0.6) {
      // It thins to a single flake before it's gone.
      if (inside([x, y])) frame.pixels[y * WIDTH + x] = C.snow;
      return;
    }
    // A fresh puff is a cross with a white glint in the middle. It's drawn whole or not at
    // all, so the glint never meets the page, where white wouldn't show.
    const arms: Point[] = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];
    if (!arms.every(inside)) return;
    for (const [px, py] of arms) frame.pixels[py * WIDTH + px] = C.snow;
    frame.pixels[y * WIDTH + x] = C.white;
  });
}

const prepare = perTraits((traits): { poses: Pose[]; snow: Spark[] } => {
  const poses = buildPoses(traits);
  return { poses, snow: kickSnow(poses, traits) };
});

function draw(index: number, traits: Traits): Uint8Array {
  const { poses, snow } = prepare(traits);
  const pose = poses[index];
  const frame = new Canvas(WIDTH, HEIGHT);
  drawSnow(frame, snow, index);
  renderSprite(pose, traits).stampOnto(frame, round(pose.x) - ORIGIN_X, round(pose.y) - GROUND, MARGIN);
  return frame.pixels;
}

export const penguin = defineCritter({
  id: "penguin",
  name: "Penguin",
  blurb: "Waddles about on the ice kicking up snow, and stops once a loop to hop and cheer. Resting, it just shuffles and blinks.",
  alt: "Animated pixel art of a round penguin waddling around the frame, rocking from foot to foot and kicking up snow, then stopping to hop on the spot with its flippers up",
  width: WIDTH,
  height: HEIGHT,
  frames: FRAMES,
  delayMs: 60,
  poster: 12,
  colourNames: COLOUR_NAMES,
  bodyColour: "body",
  accentColours: ["beak", "beakLo"],
  fixedColours: ["belly", "bellyLo", "eye", "white", "blush", "snow"],
  edgeColours: ["rim", "snow"],
  colourways: [
    {
      id: "tuxedo",
      name: "Tuxedo",
      colours: {
        rim: "#6b7894",
        line: "#10141d",
        body: "#263247",
        bodyHi: "#3c4c68",
        bodyLo: "#1a2333",
        belly: "#f4f6fa",
        bellyLo: "#cfd6e2",
        eye: "#10141d",
        white: "#ffffff",
        beak: "#f6c445",
        beakLo: "#d08a1f",
        blush: "#f49ab0",
        snow: "#8fb3d9",
      },
    },
    {
      id: "ice",
      name: "Ice",
      colours: {
        rim: "#5a86c2",
        line: "#0e1f3d",
        body: "#2d5a8f",
        bodyHi: "#4a7fbd",
        bodyLo: "#1f4170",
        belly: "#e8f8ff",
        bellyLo: "#b5dcef",
        eye: "#0e1f3d",
        white: "#ffffff",
        beak: "#62d4ea",
        beakLo: "#2a9fbf",
        blush: "#f4a6c0",
        snow: "#7fb0dc",
      },
    },
    {
      id: "gentoo",
      name: "Gentoo",
      colours: {
        rim: "#7a7a8c",
        line: "#15151c",
        body: "#383844",
        bodyHi: "#51515f",
        bodyLo: "#25252e",
        belly: "#fbfbf8",
        bellyLo: "#d9d9d2",
        eye: "#15151c",
        white: "#ffffff",
        beak: "#ff7a2f",
        beakLo: "#d4521a",
        blush: "#f79a8a",
        snow: "#9fb4c8",
      },
    },
  ],
  draw,
});
