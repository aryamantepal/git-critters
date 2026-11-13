import { Canvas } from "../engine/canvas.ts";
import { colourIndexes, defineCritter } from "../engine/critter.ts";
import type { Mask, Point } from "../engine/mask.ts";
import { clamp, cumulativePhase, round, TAU } from "../engine/motion.ts";
import type { Flight } from "../engine/motion.ts";
import { blinkFrames, cyclesFor, perTraits, roam, STAGE_SCALE } from "../engine/traits.ts";
import type { Mood, Traits } from "../engine/traits.ts";

const WIDTH = 180;
const HEIGHT = 120;
const FRAMES = 200;
const MARGIN = 2;
const LOCAL = 96;
const ORIGIN_X = LOCAL / 2;
const GROUND = 70; // where its paws touch the ground in the sprite
const TROTS = 16; // whole strides per loop
const SWAYS = 3; // whole slow sways of the tail per loop
const WAGS = 8; // whole quick wags per loop, when it's lively
const TURN = 0.05; // how fast it has to be going sideways before it turns to face that way
// Once a loop, a steady fox stops to tilt its head, and a lively one pounces. A resting one does neither.
// It happens on a straight run, so a lively fox never turns round mid-leap.
const EVENT_START = 104;
const EVENT_END = 136;
const POUNCE_HEIGHT = 12;
const TILT = 0.3;
// How far its legs swing, how far its tail sways, and how hard it wags, by mood.
const STRIDE: Readonly<Record<Mood, number>> = { resting: 0.5, steady: 1, lively: 1.2 };
const SWAY: Readonly<Record<Mood, number>> = { resting: 0.3, steady: 0.1, lively: 0.06 };
// How far the tail swings against the legs: a resting fox barely steps, so its tail does the moving.
const BALANCE: Readonly<Record<Mood, number>> = { resting: 0.2, steady: 0.14, lively: 0.17 };
const WAG: Readonly<Record<Mood, number>> = { resting: 0, steady: 0, lively: 0.14 };

// Its trot around the frame, by where its paws touch the ground.
const WAYPOINTS: readonly Point[] = [
  [50, 82],
  [90, 78],
  [130, 84],
  [134, 100],
  [92, 104],
  [52, 100],
];

// Measurements at full size, as [forward, up] from under its middle, with up negative.
const TORSO: readonly [number, number, number, number] = [-1, -15, 13, 6]; // centre, radii
const CHEST: readonly [number, number, number] = [9, -16, 6];
const NECK: Point = [11, -20];
const NECK_R = 4.5;
const HEAD: readonly [number, number, number] = [14, -25, 6];
const SNOUT_FROM = 14;
const SNOUT_TO = 25.5;
const SNOUT_Y = -23;
const SNOUT_HALF = 3.6;
const EARS: readonly (readonly [Point, Point, Point])[] = [
  [
    [8.5, -28],
    [10, -36.5],
    [13, -29],
  ],
  [
    [12, -29],
    [15.5, -38],
    [18, -29.5],
  ],
];
const EAR_TIP = -34; // above this, the ears are dark
const EYE: Point = [16.5, -26.5];
const NOSE: Point = [22.5, -22]; // well inside the snout, so it lands on it at any size; drawn at the snout's tip
const LEG_LENGTH = 11;
const LEG_R = 1.5;
const SOCK_FROM = 0.55; // how far down a leg its sock starts
// Hips, as [forward, up, phase]: diagonal pairs move together, as in a trot.
const NEAR_LEGS: readonly (readonly [number, number, number])[] = [
  [8, -11, 0],
  [-9, -11, Math.PI],
];
const FAR_LEGS: readonly (readonly [number, number, number])[] = [
  [6, -11, Math.PI],
  [-11, -11, 0],
];
const TAIL_BASE: Point = [-13, -17];
const TAIL_LENGTH = 21;
const TAIL_SAMPLES = 16;
const TAIL_TIP = 0.8; // past here, the tail is white

// Marks: a blaze on the forehead, then dark bands round the tail, as fractions along it.
const BLAZE: readonly [Point, Point] = [
  [13.5, -30],
  [16, -27],
];
const BANDS: readonly (readonly number[])[] = [[], [], [0.6], [0.6, 0.38]];
const BAND_HALF = 0.8; // half a band's width, in sprite pixels, so it shows at every size

const COLOUR_NAMES = [
  "rim",
  "line",
  "body",
  "bodyHi",
  "bodyLo",
  "cream",
  "creamLo",
  "sock",
  "eye",
  "white",
  "nose",
] as const;
const C = colourIndexes(COLOUR_NAMES);

interface Pose {
  x: number;
  y: number;
  facing: 1 | -1;
  /** The trot's phase. */
  step: number;
  /** How far its legs swing as it trots, 0 standing. */
  stride: number;
  /** How far its body rises mid-stride, at full size. */
  bob: number;
  /** How high it is mid-pounce, at full size. */
  hop: number;
  /** How far it tips nose up, mid-pounce. */
  pitch: number;
  /** How far its legs reach out for a pounce, 0 to 1. */
  reach: number;
  /** How far its head is tilted. */
  tilt: number;
  /** The tail's angle above level, pointing back. */
  tail: number;
  blink: boolean;
}

function eventAt(mood: Mood, i: number): number {
  if (mood === "resting" || i < EVENT_START || i > EVENT_END) return 0;
  return clamp(Math.min(i - EVENT_START, EVENT_END - i) / 4, 0, 1);
}

/** Where `values` is at the (fractional) frame `at`, wrapping round. */
function sample(values: Float64Array, at: number): number {
  const low = Math.floor(at);
  const f = at - low;
  return values[((low % FRAMES) + FRAMES) % FRAMES] * (1 - f) + values[(((low + 1) % FRAMES) + FRAMES) % FRAMES] * f;
}

/** The roam path, held still wherever `hold` is 1, and sped up elsewhere so the loop still closes. */
function holdPath(mood: Mood, hold: Float64Array): Flight {
  const path = roam(WAYPOINTS, mood, FRAMES);
  const rate = hold.map((h) => 1 - h);
  const total = rate.reduce((sum, v) => sum + v, 0);
  const progress = new Float64Array(FRAMES);
  let sum = 0;
  for (let i = 0; i < FRAMES; i++) {
    progress[i] = (sum * FRAMES) / total;
    sum += rate[i];
  }
  const x = progress.map((p) => sample(path.x, p));
  const y = progress.map((p) => sample(path.y, p));
  const vx = x.map((_, i) => (x[(i + 1) % FRAMES] - x[(i - 1 + FRAMES) % FRAMES]) / 2);
  const vy = y.map((_, i) => (y[(i + 1) % FRAMES] - y[(i - 1 + FRAMES) % FRAMES]) / 2);
  return { x, y, vx, vy };
}

/** Which way it faces: the way it's going, kept while it's going up or down the frame. */
function facingOf(vx: Float64Array): (1 | -1)[] {
  const out: (1 | -1)[] = new Array(FRAMES).fill(1);
  let face: 1 | -1 = 1;
  // Twice round, so the start of the loop knows which way the end was facing.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < FRAMES; i++) {
      if (vx[i] > TURN) face = 1;
      else if (vx[i] < -TURN) face = -1;
      out[i] = face;
    }
  }
  return out;
}

function buildPoses({ mood }: Traits): Pose[] {
  const events = Float64Array.from({ length: FRAMES }, (_, i) => eventAt(mood, i));
  // A steady fox stops to tilt its head; a pouncing one keeps going.
  const hold = mood === "steady" ? events : new Float64Array(FRAMES);
  const { x, y, vx, vy } = holdPath(mood, hold);
  const facing = facingOf(vx);
  const step = cumulativePhase(
    vx.map((v, i) => 0.3 + Math.hypot(v, vy[i])),
    cyclesFor(mood, TROTS),
  );
  const blinks = blinkFrames(mood, [40, 96, 172], FRAMES);
  const sways = cyclesFor(mood, SWAYS);
  const wags = cyclesFor(mood, WAGS);
  const span = EVENT_END - EVENT_START;
  return Array.from({ length: FRAMES }, (_, i) => {
    const event = events[i];
    const t = clamp((i - EVENT_START) / span, 0, 1);
    const pouncing = mood === "lively" ? event : 0;
    const tilting = mood === "steady" ? event : 0;
    const stride = STRIDE[mood] * (1 - tilting);
    // The tail swings a quarter stride behind the legs, to balance, and sways slowly on top.
    const balance = BALANCE[mood] * Math.cos(step[i]) * (1 - tilting);
    const sway = SWAY[mood] * Math.sin((TAU * sways * i) / FRAMES);
    const wag = WAG[mood] * Math.sin((TAU * wags * i) / FRAMES);
    // While its head is tilted, its tail swishes, a quarter turn behind the wobble of its head.
    const swish = 0.22 * tilting * Math.cos(TAU * 2 * t);
    const tail = (0.3 + balance + sway + wag + swish) * (1 - pouncing) + 0.08 * pouncing;
    return {
      x: x[i],
      y: y[i],
      facing: facing[i],
      step: step[i],
      stride,
      bob: 0.8 * Math.abs(Math.sin(step[i])) * stride,
      hop: mood === "lively" && i >= EVENT_START && i <= EVENT_END ? POUNCE_HEIGHT * Math.sin(Math.PI * t) : 0,
      pitch: 0.35 * Math.cos(Math.PI * t) * pouncing,
      reach: pouncing,
      tilt: tilting * (TILT + 0.12 * Math.sin(TAU * 2 * t)),
      tail,
      blink: blinks.has(i),
    };
  });
}

/** Where the fox is drawn on this frame: its scale, which way it faces, and its pitch. */
interface Placement {
  k: number;
  facing: 1 | -1;
  cos: number;
  sin: number;
  px: number;
  py: number;
}

function placementOf(pose: Pose, k: number): Placement {
  const angle = -pose.facing * pose.pitch;
  return {
    k,
    facing: pose.facing,
    cos: Math.cos(angle),
    sin: Math.sin(angle),
    px: ORIGIN_X,
    py: GROUND - (pose.bob + pose.hop) * k,
  };
}

/** A sprite pixel in full-size coordinates, facing right. */
function toBody(at: Placement, x: number, y: number): Point {
  const dx = x - at.px;
  const dy = y - at.py;
  return [(dx * at.cos + dy * at.sin) / (at.k * at.facing), (-dx * at.sin + dy * at.cos) / at.k];
}

/** A point in full-size coordinates, facing right, in sprite pixels. */
function toSprite(at: Placement, u: number, v: number): Point {
  const su = u * at.k * at.facing;
  const sv = v * at.k;
  return [at.px + su * at.cos - sv * at.sin, at.py + su * at.sin + sv * at.cos];
}

/** A point in the head's own coordinates, as if it weren't tilted. */
function untilt(u: number, v: number, tilt: number): Point {
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  const du = u - NECK[0];
  const dv = v - NECK[1];
  return [NECK[0] + du * c + dv * s, NECK[1] - du * s + dv * c];
}

/** A point on the untilted head, where it is once tilted. */
function tilted([u, v]: Point, tilt: number): Point {
  return untilt(u, v, -tilt);
}

/** The pixels whose full-size coordinates are `inside`, looking only at those in `within` if given. */
function shapeMask(canvas: Canvas, at: Placement, inside: (u: number, v: number) => boolean, within?: Mask): Mask {
  const mask = canvas.mask();
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (within && !within.bits[y * canvas.width + x]) continue;
      const [u, v] = toBody(at, x, y);
      if (inside(u, v)) mask.addPixel(x, y);
    }
  }
  return mask;
}

function inDisc(u: number, v: number, [cx, cy, r]: readonly [number, number, number]): boolean {
  return (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
}

function inTriangle(u: number, v: number, [a, b, c]: readonly [Point, Point, Point]): boolean {
  const side = (p: Point, q: Point) => (q[0] - p[0]) * (v - p[1]) - (q[1] - p[1]) * (u - p[0]);
  const d1 = side(a, b);
  const d2 = side(b, c);
  const d3 = side(c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

function inSnout(u: number, v: number): boolean {
  const s = (u - SNOUT_FROM) / (SNOUT_TO - SNOUT_FROM);
  if (s < 0 || s > 1) return false;
  return Math.abs(v - (SNOUT_Y + 1.2 * s)) <= SNOUT_HALF * (1 - s) + 0.6;
}

function inHead(u: number, v: number): boolean {
  return inDisc(u, v, HEAD) || inSnout(u, v) || EARS.some((ear) => inTriangle(u, v, ear));
}

function inTorso(u: number, v: number): boolean {
  const [cx, cy, rx, ry] = TORSO;
  return (
    ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2 <= 1 ||
    inDisc(u, v, CHEST) ||
    inDisc(u, v, [NECK[0], NECK[1], NECK_R])
  );
}

/** Points along the tail, with their radius, from its base to its tip. */
function tailSpine(angle: number): { u: number; v: number; r: number; t: number }[] {
  const points = [];
  let [u, v] = TAIL_BASE;
  const piece = TAIL_LENGTH / TAIL_SAMPLES;
  for (let j = 0; j <= TAIL_SAMPLES; j++) {
    const t = j / TAIL_SAMPLES;
    // Bushy in the middle, round at the tip, and drooping a little towards it.
    const r = 2.2 + 4.3 * Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.8;
    points.push({ u, v, r, t });
    const a = angle - 0.6 * t;
    u -= piece * Math.cos(a);
    v -= piece * Math.sin(a);
  }
  return points;
}

type Spine = ReturnType<typeof tailSpine>;

function inTail(spine: Spine): (u: number, v: number) => boolean {
  return (u, v) => spine.some((p) => (u - p.u) ** 2 + (v - p.v) ** 2 <= p.r * p.r);
}

/** How far along the tail a point is, 0 at its base to 1 at its tip, where it's nearest the spine. */
function alongTail(spine: Spine, u: number, v: number): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let j = 1; j < spine.length; j++) {
    const a = spine[j - 1];
    const b = spine[j];
    const du = b.u - a.u;
    const dv = b.v - a.v;
    const s = clamp(((u - a.u) * du + (v - a.v) * dv) / (du * du + dv * dv), 0, 1);
    const distance = (u - a.u - s * du) ** 2 + (v - a.v - s * dv) ** 2;
    if (distance < bestDistance) {
      best = a.t + s * (b.t - a.t);
      bestDistance = distance;
    }
  }
  return best;
}

/** Where a leg's paw lands: straight down from the hip, swung by the trot or stretched for a pounce. */
function pawOf(pose: Pose, [hx, hy, phase]: readonly [number, number, number]): Point {
  const front = hx > 0;
  const trot = 0.45 * pose.stride * Math.sin(pose.step + phase);
  const leap = front ? 0.9 : -0.8;
  const angle = trot * (1 - pose.reach) + leap * pose.reach;
  const lift = 1.8 * pose.stride * Math.max(0, Math.cos(pose.step + phase)) * (1 - pose.reach);
  return [hx + LEG_LENGTH * Math.sin(angle), hy + LEG_LENGTH * Math.cos(angle) - lift];
}

function drawLegs(
  canvas: Canvas,
  pose: Pose,
  at: Placement,
  legs: readonly (readonly [number, number, number])[],
  fill: number,
): void {
  for (const hip of legs) {
    const [hx, hy] = hip;
    const [fx, fy] = pawOf(pose, hip);
    const along = (u: number, v: number) => {
      const du = fx - hx;
      const dv = fy - hy;
      return clamp(((u - hx) * du + (v - hy) * dv) / (du * du + dv * dv), 0, 1);
    };
    const near = (u: number, v: number) => {
      const s = along(u, v);
      return (u - hx - s * (fx - hx)) ** 2 + (v - hy - s * (fy - hy)) ** 2 <= LEG_R * LEG_R;
    };
    const leg = shapeMask(canvas, at, near);
    canvas.sticker(leg, fill, C.line);
    canvas.fill(shapeMask(canvas, at, (u, v) => along(u, v) >= SOCK_FROM, leg), C.sock);
  }
}

function drawTail(canvas: Canvas, pose: Pose, at: Placement, marks: number): void {
  const spine = tailSpine(pose.tail);
  const tail = shapeMask(canvas, at, inTail(spine));
  canvas.sticker(tail, C.body, C.line);
  canvas.fill(tail.minus(tail.moved(0, -2)), C.bodyLo);
  canvas.fill(tail.minus(tail.moved(0, 1)), C.bodyHi);
  for (const band of BANDS[marks]) {
    const inBand = (u: number, v: number) => Math.abs(alongTail(spine, u, v) - band) * TAIL_LENGTH * at.k <= BAND_HALF;
    canvas.fill(shapeMask(canvas, at, inBand, tail), C.sock);
  }
  const tip = shapeMask(canvas, at, (u, v) => alongTail(spine, u, v) >= TAIL_TIP, tail);
  canvas.fill(tip, C.cream);
  canvas.fill(tip.minus(tail.moved(0, -1)), C.creamLo);
}

function drawBody(canvas: Canvas, pose: Pose, at: Placement, marks: number): Mask {
  const head = (u: number, v: number) => inHead(...untilt(u, v, pose.tilt));
  const body = shapeMask(canvas, at, (u, v) => inTorso(u, v) || head(u, v));
  canvas.sticker(body, C.body, C.line);
  canvas.fill(body.minus(body.moved(0, -2)), C.bodyLo);
  canvas.fill(body.minus(body.moved(0, 1)), C.bodyHi);

  // A cream chest, cheek and jaw.
  const cream = shapeMask(canvas, at, (u, v) => {
    if (inDisc(u, v, [10, -14, 4.2])) return true;
    const [hu, hv] = untilt(u, v, pose.tilt);
    return inDisc(hu, hv, [16, -22, 3.2]) || (inSnout(hu, hv) && hv > SNOUT_Y + 1.2 * ((hu - SNOUT_FROM) / (SNOUT_TO - SNOUT_FROM)));
  }, body);
  canvas.fill(cream, C.cream);
  canvas.fill(cream.minus(body.moved(0, -1)), C.creamLo);

  const tips = shapeMask(canvas, at, (u, v) => {
    const [hu, hv] = untilt(u, v, pose.tilt);
    return hv < EAR_TIP && EARS.some((ear) => inTriangle(hu, hv, ear));
  }, body);
  canvas.fill(tips, C.sock);

  if (marks > 0) {
    const [[u0, v0], [u1, v1]] = BLAZE;
    const blaze = shapeMask(canvas, at, (u, v) => {
      const [hu, hv] = untilt(u, v, pose.tilt);
      const s = clamp(((hu - u0) * (u1 - u0) + (hv - v0) * (v1 - v0)) / ((u1 - u0) ** 2 + (v1 - v0) ** 2), 0, 1);
      return (hu - u0 - s * (u1 - u0)) ** 2 + (hv - v0 - s * (v1 - v0)) ** 2 <= 1.3 ** 2 && inDisc(hu, hv, HEAD);
    }, body);
    canvas.fill(blaze, C.cream);
  }
  return body;
}

function drawFace(canvas: Canvas, pose: Pose, at: Placement, body: Mask, stage: number): void {
  const [ex, ey] = toSprite(at, ...tilted(EYE, pose.tilt));
  const x = round(ex);
  const y = round(ey);
  const eye = canvas.mask();
  const glint = canvas.mask();
  if (pose.blink) {
    eye.addPixel(x, y + 1).addPixel(x + 1, y + 1);
  } else {
    eye.addPixel(x, y).addPixel(x + 1, y).addPixel(x, y + 1).addPixel(x + 1, y + 1);
    if (stage >= 2) glint.addPixel(at.facing > 0 ? x + 1 : x, y);
  }
  canvas.fill(eye.and(body), C.eye);
  canvas.fill(glint.and(body), C.white);

  const [ax, ay] = toSprite(at, ...tilted(NOSE, pose.tilt));
  const ny = round(ay);
  let nx = round(ax);
  while (body.bits[ny * canvas.width + nx + at.facing]) nx += at.facing;
  const nose = canvas.mask().addPixel(nx, ny);
  if (stage >= 2) nose.addPixel(nx - at.facing, ny);
  canvas.fill(nose.and(body), C.nose);
}

function renderSprite(pose: Pose, traits: Traits): Canvas {
  const k = STAGE_SCALE[traits.stage];
  const at = placementOf(pose, k);
  const canvas = new Canvas(LOCAL, LOCAL);
  drawLegs(canvas, pose, at, FAR_LEGS, C.bodyLo);
  drawTail(canvas, pose, at, traits.marks);
  const body = drawBody(canvas, pose, at, traits.marks);
  drawFace(canvas, pose, at, body, traits.stage);
  drawLegs(canvas, pose, at, NEAR_LEGS, C.body);
  canvas.strengthenEdges([[C.line, C.rim]]);
  return canvas;
}

const prepare = perTraits(buildPoses);

function draw(index: number, traits: Traits): Uint8Array {
  const pose = prepare(traits)[index];
  const frame = new Canvas(WIDTH, HEIGHT);
  renderSprite(pose, traits).stampOnto(frame, round(pose.x) - ORIGIN_X, round(pose.y) - GROUND, MARGIN);
  return frame.pixels;
}

export const fox = defineCritter({
  id: "fox",
  name: "Fox",
  blurb: "Trots about swishing its bushy tail. Steady, it stops to tilt its head; lively, it pounces.",
  alt: "Animated pixel art of a fox with a bushy white-tipped tail trotting around the frame, stopping to tilt its head or leaping in a pounce",
  width: WIDTH,
  height: HEIGHT,
  frames: FRAMES,
  delayMs: 60,
  poster: 12,
  colourNames: COLOUR_NAMES,
  bodyColour: "body",
  accentColours: ["sock"],
  fixedColours: ["cream", "creamLo", "eye", "white", "nose"],
  edgeColours: ["rim"],
  colourways: [
    {
      id: "russet",
      name: "Russet",
      colours: {
        rim: "#b0603c",
        line: "#3a1c10",
        body: "#e8772e",
        bodyHi: "#f59a55",
        bodyLo: "#c45a1c",
        cream: "#fff4e6",
        creamLo: "#ead8c0",
        sock: "#3a2a26",
        eye: "#1e1410",
        white: "#ffffff",
        nose: "#1e1410",
      },
    },
    {
      id: "arctic",
      name: "Arctic",
      colours: {
        rim: "#7d93b5",
        line: "#2c3a55",
        body: "#bfcfe6",
        bodyHi: "#d6e1f1",
        bodyLo: "#9fb3d1",
        cream: "#ffffff",
        creamLo: "#e6edf7",
        sock: "#5d79a6",
        eye: "#24314d",
        white: "#ffffff",
        nose: "#3b4a6b",
      },
    },
    {
      id: "silver",
      name: "Silver",
      colours: {
        rim: "#9aa3b0",
        line: "#1c1f25",
        body: "#5d6470",
        bodyHi: "#7d8592",
        bodyLo: "#444a54",
        cream: "#e6e9ee",
        creamLo: "#c3c8d0",
        sock: "#23262c",
        eye: "#101216",
        white: "#ffffff",
        nose: "#101216",
      },
    },
  ],
  draw,
});
