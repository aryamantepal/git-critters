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
// How far the tail swings against the legs, at full size: a resting fox barely steps, so its tail does the moving.
// Smaller, it swings wider, so its tip still travels as many pixels and something moves every frame.
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

// It's built from boxes, at full size in pixels, as [u0, v0, u1, v1]: forward, then up from
// under its middle, with up negative. Parts that turn have boxes in their own frame.
type Box = readonly [number, number, number, number];
const TORSO: Box = [-12, -18, 9, -9];
const SHOULDERS: Box = [5, -22, 12, -9];
const CHEST: Box = [7, -16, 12, -9];
// The head and everything on it turn together about the neck when it tilts.
const NECK: Point = [10, -21];
const HEAD: Box = [8, -30, 19, -19];
const SNOUT: Box = [19, -25, 25, -19];
const JAW: Box = [14, -22, 25, -19];
const EARS: readonly Box[] = [
  [9, -35, 12, -30],
  [14, -35, 17, -30],
];
const EAR_TIP = -33; // above this, the ears are dark
// The eye and nose are stamped as whole pixels where these points land, so they keep their size as it moves.
const EYE: Point = [16.5, -26.5]; // the eye's front top pixel
const NOSE: Point = [22.5, -23.5]; // well inside the snout, so it lands on it at any size; drawn at the snout's tip
const NOSE_SIZE: readonly Point[] = [[2, 1], [2, 1], [2, 2], [2, 2]]; // across by down, by stage
// A leg hangs from its hip, in its own frame: across, then down.
const LEG: Box = [-1.5, 0, 1.5, 10];
const SOCK_FROM = 6; // how far down a leg its sock starts
// Hips, as [forward, up, phase]: diagonal pairs move together, as in a trot.
const NEAR_LEGS: readonly (readonly [number, number, number])[] = [
  [8, -10, 0],
  [-8, -10, Math.PI],
];
const FAR_LEGS: readonly (readonly [number, number, number])[] = [
  [5, -10, Math.PI],
  [-11, -10, 0],
];
// The tail points back from its base, in its own frame: along (back is negative), then across.
// Its brush bends at a joint partway along, and is measured from there.
const TAIL_BASE: Point = [-12, -15];
const TAIL_ROOT: Box = [-8, -2.5, 0, 2.5];
const BRUSH_JOINT: Point = [-7, 0];
const TAIL_BRUSH: Box = [-18, -4.5, 0, 4.5];
const TAIL_TIP = -13; // past here, the brush is white

// Marks: a pale blaze along the top of its head, then dark bands round the brush, along it in its own frame.
// The blaze sits under the lit top edge of its head, so it never blends into the highlight.
const BLAZE: readonly [number, number] = [12.5, 19]; // where it starts and ends along its head
const BLAZE_DEPTH = 2.2; // how far down from the top of its head the blaze reaches, in sprite pixels
const BANDS: readonly (readonly number[])[] = [[], [], [-10.5], [-10.5, -4.5]];
const BAND_HALF = 0.9; // half a band's width, in sprite pixels, so it shows at every size

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
  /** How far its brush bends up from the rest of its tail. */
  flick: number;
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

function buildPoses({ mood, stage }: Traits): Pose[] {
  const swing = BALANCE[mood] / STAGE_SCALE[stage];
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
    const balance = swing * Math.cos(step[i]) * (1 - tilting);
    const sway = SWAY[mood] * Math.sin((TAU * sways * i) / FRAMES);
    const wag = WAG[mood] * Math.sin((TAU * wags * i) / FRAMES);
    // While its head is tilted, its tail swishes, a quarter turn behind the wobble of its head.
    const swish = 0.22 * tilting * Math.cos(TAU * 2 * t);
    const tail = (0.3 + balance + sway + wag + swish) * (1 - pouncing) + 0.08 * pouncing;
    // Its brush swings a quarter stride after that, so while the tail turns back, the brush is still moving.
    const flick = swing * Math.sin(step[i]) * (1 - tilting) * (1 - pouncing);
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
      flick,
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

/** A part that turns about `pivot`, in its parent's frame if it has one. A positive angle raises a part that points back. */
interface Joint {
  pivot: Point;
  angle: number;
  parent?: Joint;
}

const FIXED: Joint = { pivot: [0, 0], angle: 0 };

/** A point in full-size coordinates, in the part's own frame. */
function intoJoint({ pivot, angle, parent }: Joint, u: number, v: number): Point {
  const [pu, pv] = parent ? intoJoint(parent, u, v) : [u, v];
  const du = pu - pivot[0];
  const dv = pv - pivot[1];
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [du * c + dv * s, -du * s + dv * c];
}

/** A point in the part's own frame, in full-size coordinates. */
function outOfJoint({ pivot, angle, parent }: Joint, lu: number, lv: number): Point {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const u = pivot[0] + lu * c - lv * s;
  const v = pivot[1] + lu * s + lv * c;
  return parent ? outOfJoint(parent, u, v) : [u, v];
}

/** The pixels of one box. Only the pixels round its corners are tested, which keeps drawing quick. */
function boxMask(canvas: Canvas, at: Placement, joint: Joint, [u0, v0, u1, v1]: Box): Mask {
  const mask = canvas.mask();
  const corners = [
    [u0, v0],
    [u1, v0],
    [u0, v1],
    [u1, v1],
  ].map(([u, v]) => toSprite(at, ...outOfJoint(joint, u, v)));
  const left = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0]))) - 1);
  const right = Math.min(canvas.width - 1, Math.ceil(Math.max(...corners.map((c) => c[0]))) + 1);
  const top = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1]))) - 1);
  const bottom = Math.min(canvas.height - 1, Math.ceil(Math.max(...corners.map((c) => c[1]))) + 1);
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const [lu, lv] = intoJoint(joint, ...toBody(at, x, y));
      if (lu >= u0 && lu <= u1 && lv >= v0 && lv <= v1) mask.addPixel(x, y);
    }
  }
  return mask;
}

function boxesMask(canvas: Canvas, at: Placement, joint: Joint, boxes: readonly Box[]): Mask {
  const mask = canvas.mask();
  for (const box of boxes) mask.add(boxMask(canvas, at, joint, box));
  return mask;
}

/** A head box, measured from the neck it turns about rather than from under the fox's middle. */
function onHead([u0, v0, u1, v1]: Box): Box {
  return [u0 - NECK[0], v0 - NECK[1], u1 - NECK[0], v1 - NECK[1]];
}

/** Flat shading, like a lit block: a bright top edge and a darker underside. Returns the lit edge. */
function shade(canvas: Canvas, mask: Mask, fill: number, high: number, low: number): Mask {
  const lit = mask.minus(mask.moved(0, 1));
  canvas.fill(mask, fill);
  canvas.fill(mask.minus(mask.moved(0, -2)), low);
  canvas.fill(lit, high);
  return lit;
}

/** A leg's joint at its hip, and how far its paw is lifted: swung by the trot, or stretched for a pounce. */
function legOf(pose: Pose, [hx, hy, phase]: readonly [number, number, number]): { joint: Joint; lift: number } {
  const front = hx > 0;
  const trot = 0.45 * pose.stride * Math.sin(pose.step + phase);
  const leap = front ? 0.9 : -0.8;
  const swing = trot * (1 - pose.reach) + leap * pose.reach;
  const lift = 1.8 * pose.stride * Math.max(0, Math.cos(pose.step + phase)) * (1 - pose.reach) + 2 * pose.reach;
  // A leg hangs down, so it swings forward when its frame turns the other way.
  return { joint: { pivot: [hx, hy], angle: -swing }, lift };
}

function drawLegs(
  canvas: Canvas,
  pose: Pose,
  at: Placement,
  legs: readonly (readonly [number, number, number])[],
  fill: number,
): void {
  for (const hip of legs) {
    const { joint, lift } = legOf(pose, hip);
    const [u0, v0, u1, v1] = LEG;
    const leg = boxMask(canvas, at, joint, [u0, v0, u1, v1 - lift]);
    canvas.sticker(leg, fill, C.line);
    canvas.fill(boxMask(canvas, at, joint, [u0, SOCK_FROM, u1, v1 - lift]).and(leg), C.sock);
  }
}

function drawTail(canvas: Canvas, pose: Pose, at: Placement, marks: number): void {
  const joint: Joint = { pivot: TAIL_BASE, angle: pose.tail };
  const brush: Joint = { pivot: BRUSH_JOINT, angle: pose.flick, parent: joint };
  const tail = boxMask(canvas, at, joint, TAIL_ROOT).add(boxMask(canvas, at, brush, TAIL_BRUSH));
  canvas.sticker(tail, C.body, C.line);
  shade(canvas, tail, C.body, C.bodyHi, C.bodyLo);
  const half = BAND_HALF / at.k;
  for (const band of BANDS[marks]) {
    canvas.fill(boxMask(canvas, at, brush, [band - half, -5, band + half, 5]).and(tail), C.sock);
  }
  const tip = boxMask(canvas, at, brush, [TAIL_BRUSH[0] - 1, -5, TAIL_TIP, 5]).and(tail);
  canvas.fill(tip, C.cream);
  canvas.fill(tip.minus(tip.moved(0, -1)), C.creamLo);
}

function drawBody(canvas: Canvas, pose: Pose, at: Placement, marks: number): Mask {
  const head: Joint = { pivot: NECK, angle: pose.tilt };
  const body = boxesMask(canvas, at, FIXED, [TORSO, SHOULDERS]).add(boxesMask(canvas, at, head, [HEAD, SNOUT, ...EARS].map(onHead)));
  canvas.sticker(body, C.body, C.line);
  const lit = shade(canvas, body, C.body, C.bodyHi, C.bodyLo);

  const cream = boxMask(canvas, at, FIXED, CHEST).add(boxMask(canvas, at, head, onHead(JAW))).and(body);
  canvas.fill(cream, C.cream);
  canvas.fill(cream.minus(body.moved(0, -1)), C.creamLo);
  const tips = boxesMask(
    canvas,
    at,
    head,
    EARS.map(([u0, v0, u1]) => onHead([u0, v0, u1, EAR_TIP])),
  ).and(body);
  canvas.fill(tips, C.sock);
  if (marks > 0) {
    const top = HEAD[1];
    const blaze = boxMask(canvas, at, head, onHead([BLAZE[0], top, BLAZE[1], top + BLAZE_DEPTH / at.k]));
    canvas.fill(blaze.and(body).minus(lit), C.cream);
  }
  return body;
}

/** The sprite pixel a point on its head lands on. */
function headPixel(pose: Pose, at: Placement, [u, v]: Point): Point {
  const head: Joint = { pivot: NECK, angle: pose.tilt };
  const [x, y] = toSprite(at, ...outOfJoint(head, u - NECK[0], v - NECK[1]));
  return [round(x), round(y)];
}

function drawFace(canvas: Canvas, pose: Pose, at: Placement, body: Mask, stage: number): void {
  // A square eye, two pixels across, shut to its bottom row. Bigger, it gets a glint at its front.
  const [ex, ey] = headPixel(pose, at, EYE);
  const bx = ex - at.facing;
  const eye = canvas.mask();
  const glint = canvas.mask();
  if (pose.blink) {
    eye.addPixel(ex, ey + 1).addPixel(bx, ey + 1);
  } else {
    eye.addPixel(ex, ey).addPixel(bx, ey).addPixel(ex, ey + 1).addPixel(bx, ey + 1);
    if (stage >= 2) glint.addPixel(ex, ey);
  }
  canvas.fill(eye.and(body), C.eye);
  canvas.fill(glint.and(body), C.white);

  // The nose sits at the front of the snout, row by row, so it's the same size however the head turns.
  const [nx, ny] = headPixel(pose, at, NOSE);
  const [across, down] = NOSE_SIZE[stage];
  const nose = canvas.mask();
  for (let y = ny; y < ny + down; y++) {
    let front = nx;
    while (body.bits[y * canvas.width + front + at.facing]) front += at.facing;
    for (let n = 0; n < across; n++) nose.addPixel(front - n * at.facing, y);
  }
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
  blurb: "A blocky fox that trots about swishing its bushy tail. Steady, it stops to tilt its head; lively, it pounces.",
  alt: "Animated pixel art of a chunky, blocky fox with a white-tipped tail trotting around the frame, stopping to tilt its head or leaping in a pounce",
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
