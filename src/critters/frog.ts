import { forEachSpark, makeSparks } from "../engine/body.ts";
import type { Spark } from "../engine/body.ts";
import { Canvas } from "../engine/canvas.ts";
import { colourIndexes, defineCritter } from "../engine/critter.ts";
import type { Mask, Point } from "../engine/mask.ts";
import { clamp, round, TAU } from "../engine/motion.ts";
import { blinkFrames, cyclesFor, perTraits, roam, STAGE_SCALE } from "../engine/traits.ts";
import type { Mood, Traits } from "../engine/traits.ts";

const WIDTH = 180;
const HEIGHT = 120;
const FRAMES = 200;
const MARGIN = 2;
const PAD_RX = 22;
const PAD_RY = 7;
const BOBS = 3; // whole bobs of each pad per loop
const BREATHS = 12;
const BUZZ = 16; // whole circles the fly buzzes per loop
const GLANCES = 2;

// The pads, in the order it visits them. The first is where it catches the fly.
const PADS: readonly Point[] = [
  [120, 96],
  [120, 56],
  [66, 56],
  [66, 96],
];
// Which way each pad's notch points, as an angle round the pad.
const NOTCH = [0.5, 2.3, 3.7, 5.4];

// Hops, in the frames after the fly is gone and before it comes back round.
const HOPS_FROM = 148;
const ARRIVE = 100;
const SPAN = FRAMES - HOPS_FROM + ARRIVE;
const FLIGHT = 10;
const CROUCH = 4;
const HOPS: Readonly<Record<Mood, number>> = { resting: 0, steady: 4, lively: 8 };

// The fly: it drops in, buzzes, and is caught on the tongue.
const FLY_ENTER = 84;
const FLY_HOVER = 100;
const MOUTH_OPEN = 116;
const TONGUE_HIT = 120;
const FLY_GONE = 126;
const GULP_FROM = 127;
const GULP_END = 142;
const FLY_START: Point = [86, 3];
// How the fly drifts about while it hovers, from the middle of where it hovers.
const DRIFT: readonly Point[] = [
  [-8, -2],
  [0, -7],
  [8, -3],
  [7, 5],
  [0, 2],
  [-7, 6],
];

const BUBBLES = 60;

// Spots on the forehead at full size, as [across, up].
const MARKS: readonly (readonly Point[])[] = [
  [],
  [[0, 20]],
  [
    [-4, 19],
    [4, 19],
  ],
  [
    [-5.5, 18],
    [0, 21],
    [5.5, 18],
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
  "spot",
  "eye",
  "white",
  "blush",
  "mouth",
  "tongue",
  "bug",
  "pad",
  "padLo",
  "water",
] as const;
const C = colourIndexes(COLOUR_NAMES);

interface Pose {
  /** Where its feet are. */
  x: number;
  y: number;
  /** -1 squatting, 0 sitting, 1 stretched out mid-hop. */
  stretch: number;
  look: Point;
  /** 0 shut, 1 wide open. */
  mouth: number;
  /** 0 normally, rising to 1 as it swallows. */
  gulp: number;
  breath: number;
  shut: boolean;
  /** How far the tongue is out, from 0 to 1. */
  tongue: number;
  fly: Point | null;
  /** The fly is on the end of the tongue. */
  stuck: boolean;
  flap: boolean;
}

interface Stance {
  from: number;
  to: number;
  /** How far through a hop it is, or -1 if it's sitting. */
  t: number;
  stretch: number;
  /** Whether it's about to hop or in the air, and so looking where it's going. */
  heading: boolean;
}

const smoothstep = (t: number) => t * t * (3 - 2 * t);
const squash = (since: number) => (since < 4 ? -(1 - since / 4) : 0);

function stanceAt(index: number, hops: number): Stance {
  const sit = (stretch: number, heading = false): Stance => ({ from: 0, to: 0, t: -1, stretch, heading });
  if (hops === 0) return sit(0);
  const u = (index - HOPS_FROM + FRAMES) % FRAMES;
  if (u >= SPAN) return sit(squash(u - SPAN));
  const length = SPAN / hops;
  const j = Math.floor(u / length);
  const w = u - j * length;
  const leave = length - FLIGHT;
  const from = j % PADS.length;
  const to = (j + 1) % PADS.length;
  if (w < leave) {
    const crouch = w - (leave - CROUCH) + 1;
    return { from, to, t: -1, stretch: crouch > 0 ? -crouch / CROUCH : j > 0 ? squash(w) : 0, heading: crouch > 0 };
  }
  const t = (w - leave) / FLIGHT;
  return { from, to, t, stretch: clamp(2 * Math.sin(Math.PI * t) - 0.6, -0.6, 1), heading: true };
}

function buildPoses(traits: Traits): { poses: Pose[]; caught: Point } {
  const k = STAGE_SCALE[traits.stage];
  const { mood } = traits;
  const hops = HOPS[mood];
  const drift = roam(DRIFT, mood, FRAMES);
  const bobs = cyclesFor(mood, BOBS);
  const breaths = cyclesFor(mood, BREATHS);
  const glances = cyclesFor(mood, GLANCES);
  const buzz = cyclesFor(mood, BUZZ);
  const blinks = blinkFrames(mood, [20, 66, 176], FRAMES);

  const padAt = (pad: number, i: number): Point => [
    PADS[pad][0],
    PADS[pad][1] + 1 + round(Math.sin((TAU * bobs * i) / FRAMES + pad * 1.9)),
  ];
  const hoverAt = (i: number): Point => {
    const a = (TAU * buzz * i) / FRAMES;
    const r = 2 + 1.2 * k;
    return [PADS[0][0] - 20 * k + drift.x[i] + r * Math.cos(a), PADS[0][1] - 26 * k + drift.y[i] + 0.7 * r * Math.sin(a)];
  };
  const flyAt = (i: number): Point => {
    const hover = hoverAt(i);
    if (i >= FLY_HOVER) return hover;
    const e = smoothstep((i - FLY_ENTER) / (FLY_HOVER - FLY_ENTER));
    return [FLY_START[0] + (hover[0] - FLY_START[0]) * e, FLY_START[1] + (hover[1] - FLY_START[1]) * e];
  };
  const [hx, hy] = flyAt(TONGUE_HIT);
  const caught: Point = [round(hx), round(hy)];

  const poses = Array.from({ length: FRAMES }, (_, i): Pose => {
    const stance = stanceAt(i, hops);
    let x: number;
    let y: number;
    if (stance.t < 0) {
      [x, y] = padAt(stance.from, i);
    } else {
      const [x0, y0] = padAt(stance.from, i);
      const [x1, y1] = padAt(stance.to, i);
      x = x0 + (x1 - x0) * stance.t;
      y = y0 + (y1 - y0) * stance.t - (8 + 3 * k) * 4 * stance.t * (1 - stance.t);
    }

    const glance = Math.sin((TAU * glances * i) / FRAMES);
    let look: Point = [glance > 0.6 ? 1 : glance < -0.6 ? -1 : 0, 0];
    if (stance.heading) {
      const dx = PADS[stance.to][0] - PADS[stance.from][0];
      const dy = PADS[stance.to][1] - PADS[stance.from][1];
      look = [Math.sign(dx), dy < -10 ? -1 : dy > 10 ? 1 : 0];
    }

    const flyOn = i >= FLY_ENTER && i < FLY_GONE;
    const stuck = i > TONGUE_HIT && i < FLY_GONE;
    const fly = flyOn && !stuck ? flyAt(i) : null;
    if (fly || stuck) {
      const [fx, fy] = fly ?? caught;
      if (i >= FLY_HOVER - 4) {
        const dx = fx - x;
        const dy = fy - (y - 24 * k);
        look = [Math.abs(dx) > 6 ? Math.sign(dx) : 0, dy < -6 ? -1 : dy > 6 ? 1 : 0];
      }
    }

    const out = i >= MOUTH_OPEN + 1 && i <= FLY_GONE;
    const half = i === MOUTH_OPEN || i === FLY_GONE + 1;
    const gulp = i >= GULP_FROM && i <= GULP_END ? Math.sin((Math.PI * (i - GULP_FROM)) / (GULP_END - GULP_FROM)) : 0;
    let tongue = 0;
    if (i > MOUTH_OPEN && i <= TONGUE_HIT) tongue = (i - MOUTH_OPEN) / (TONGUE_HIT - MOUTH_OPEN);
    else if (stuck) tongue = 1 - (i - TONGUE_HIT) / (FLY_GONE - TONGUE_HIT);
    return {
      x,
      y,
      stretch: stance.stretch,
      look,
      mouth: out ? 1 : half ? 0.5 : 0,
      gulp,
      breath: Math.sin((TAU * breaths * i) / FRAMES),
      shut: blinks.has(i) || gulp > 0.35,
      tongue,
      fly,
      stuck,
      flap: i % 2 === 0,
    };
  });
  return { poses, caught };
}

function ellipse(mask: Mask, cx: number, cy: number, rx: number, ry: number): Mask {
  const x0 = Math.max(0, Math.floor(cx - rx - 1));
  const x1 = Math.min(mask.width, Math.ceil(cx + rx + 2));
  const y0 = Math.max(0, Math.floor(cy - ry - 1));
  const y1 = Math.min(mask.height, Math.ceil(cy + ry + 2));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      if (nx * nx + ny * ny <= 1) mask.bits[y * mask.width + x] = 1;
    }
  }
  return mask;
}

function drawBubbles(canvas: Canvas, bubbles: readonly Spark[], index: number): void {
  forEachSpark(bubbles, index, FRAMES, (x, y, age) => {
    const dots: Point[] = age < 0.5 ? [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]] : [[x, y]];
    for (const [px, py] of dots) {
      if (px >= MARGIN && px < WIDTH - MARGIN && py >= MARGIN && py < HEIGHT - MARGIN) canvas.pixels[py * WIDTH + px] = C.water;
    }
  });
}

function drawPad(canvas: Canvas, pad: number, index: number, bobs: number): void {
  const [cx, baseY] = PADS[pad];
  const cy = baseY + round(Math.sin((TAU * bobs * index) / FRAMES + pad * 1.9));
  const shape = ellipse(canvas.mask(), cx, cy, PAD_RX, PAD_RY);
  // A wedge is missing, the way a lily pad's is.
  for (let y = cy - PAD_RY; y <= cy + PAD_RY; y++) {
    for (let x = cx - PAD_RX; x <= cx + PAD_RX; x++) {
      const nx = (x - cx) / PAD_RX;
      const ny = (y - cy) / PAD_RY;
      if (nx * nx + ny * ny < 0.02) continue;
      const turn = Math.abs(Math.atan2(ny, nx) - NOTCH[pad]);
      if (Math.min(turn, TAU - turn) < 0.17) shape.bits[y * canvas.width + x] = 0;
    }
  }
  canvas.fill(shape, C.pad);
  canvas.fill(shape.minus(shape.moved(0, -1)), C.padLo);
}

function drawFrog(canvas: Canvas, pose: Pose, traits: Traits): Point {
  const k = STAGE_SCALE[traits.stage];
  const s = pose.stretch;
  const wf = 1 - 0.1 * s;
  const hf = 1 + 0.16 * s;
  const leap = Math.max(0, s);
  const ax = round(pose.x);
  const ay = round(pose.y);
  const across = (n: number) => round(n * k * wf);
  const up = (n: number) => n * k * hf;
  const mask = () => canvas.mask();
  const sink = pose.gulp > 0.2 ? Math.max(1, round(1.3 * k)) : 0;

  const bodyRy = 12 * k * hf;
  const body = ellipse(mask(), ax, ay - bodyRy, 15 * k * wf, bodyRy);
  const eyeY = round(ay - up(24.5)) + sink;
  const eyes = mask();
  const thighs = mask();
  const feet = mask();
  const arms = mask();
  const hands = mask();
  for (const side of [-1, 1]) {
    eyes.addDisc(ax + side * across(9.5), eyeY, 6 * k);
    ellipse(thighs, ax + side * across(14 + 1.5 * leap), ay - up(8 - 3 * leap), 7.5 * k * wf, 8 * k * hf);
    ellipse(feet, ax + side * across(17 + 3 * leap), ay - up(1.5 - 8 * leap), (7 - 1.5 * leap) * k * wf, Math.max(1.4, 2.5 * k));
    ellipse(arms, ax + side * across(9), ay - up(4), Math.max(1.5, 2.8 * k), 5 * k * hf);
    ellipse(hands, ax + side * across(9.5), ay - up(0.8), 4 * k, Math.max(1.2, 1.8 * k));
  }
  const silhouette = mask().add(body).add(eyes).add(thighs).add(feet).add(arms).add(hands);
  canvas.sticker(silhouette, C.body, C.line);
  canvas.fill(silhouette.minus(silhouette.moved(-1, -2)), C.bodyLo);
  canvas.fill(silhouette.minus(silhouette.moved(1, 2)), C.bodyHi);

  const pulse = 0.6 * k * pose.breath + 2.2 * k * pose.gulp;
  const belly = ellipse(mask(), ax, ay - up(3.5), 10.5 * k * wf, 4.5 * k * hf + pulse).and(body);
  canvas.fill(belly, C.belly);
  canvas.fill(belly.minus(belly.moved(0, -1)), C.bellyLo);

  for (const limb of [thighs, feet, arms, hands]) {
    canvas.sticker(limb, C.body, C.line);
    canvas.fill(limb.minus(limb.moved(-1, -1)), C.bodyLo);
    canvas.fill(limb.minus(limb.moved(1, 1)), C.bodyHi);
  }

  const spots = mask();
  for (const [dx, dy] of MARKS[traits.marks]) spots.addDisc(ax + round(dx * k * wf), round(ay - up(dy)), Math.max(1.2, 1.6 * k));
  canvas.fill(spots.and(body), C.spot);

  const cheeks = mask();
  for (const side of [-1, 1]) {
    const cx = ax + side * across(12);
    const cy = round(ay - up(15));
    for (let x = -1; x <= 1; x++) cheeks.addPixel(cx + x, cy).addPixel(cx + x, cy + 1);
  }
  canvas.fill(cheeks.and(body), C.blush);

  const whiteR = Math.max(2.1, 3.7 * k);
  const pupil = k >= 0.85 ? 3 : 2;
  for (const side of [-1, 1]) {
    const ex = ax + side * across(9.5);
    const sclera = mask().addDisc(ex, eyeY, whiteR);
    // A small face has no room for a ring round the eye.
    const ring = k >= 0.7;
    if (pose.shut) {
      if (ring) canvas.sticker(sclera, C.body, C.line);
      const lid = mask();
      for (let x = -Math.trunc(whiteR); x <= Math.trunc(whiteR); x++) lid.addPixel(ex + x, eyeY + 1);
      canvas.fill(lid.and(sclera), C.line);
      continue;
    }
    if (ring) canvas.sticker(sclera, C.white, C.line);
    else canvas.fill(sclera, C.white);
    const dark = mask();
    const left = ex - Math.floor(pupil / 2) + pose.look[0];
    const top = eyeY - Math.floor(pupil / 2) + pose.look[1];
    for (let y = 0; y < pupil; y++) for (let x = 0; x < pupil; x++) dark.addPixel(left + x, top + y);
    canvas.fill(dark.and(sclera), C.eye);
    if (pupil === 3) canvas.fill(mask().addPixel(left, top), C.white);
  }

  // A wide mouth that curls up at the ends.
  const half = Math.max(5, round(13 * k * wf));
  const baseY = ay - round(11 * k * hf);
  const gape = 5 * k * hf * pose.mouth;
  const lip = mask();
  const inside = mask();
  for (let x = -half; x <= half; x++) {
    const f = (x / half) ** 2;
    const top = baseY - round(3 * k * f);
    lip.addPixel(ax + x, top);
    const rows = round(gape * (1 - f));
    if (rows > 0) {
      for (let r = 1; r < rows; r++) inside.addPixel(ax + x, top + r);
      lip.addPixel(ax + x, top + rows);
    }
  }
  canvas.fill(inside, C.mouth);
  canvas.fill(lip, C.line);
  return [ax, baseY + round(gape / 2)];
}

function drawTongue(canvas: Canvas, pose: Pose, root: Point, caught: Point, k: number): Point | null {
  if (pose.tongue <= 0) return null;
  const tipX = round(root[0] + (caught[0] - root[0]) * pose.tongue);
  const tipY = round(root[1] + (caught[1] - root[1]) * pose.tongue);
  const line = canvas.mask().addLine([root, [tipX, tipY]]);
  const tongue = canvas.mask().add(line).add(line.moved(0, 1));
  if (k >= 0.85) tongue.add(line.moved(1, 0));
  tongue.addDisc(tipX, tipY, k >= 0.85 ? 1.5 : 1);
  canvas.fill(tongue, C.tongue);
  return [tipX, tipY];
}

function drawFly(canvas: Canvas, x: number, y: number, flap: boolean): void {
  const wings: Point[] = flap
    ? [[-2, -1], [-2, -2], [2, -1], [2, -2]]
    : [[-1, -1], [-1, -2], [1, -1], [1, -2]];
  const bug: Point[] = [[-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1], ...wings];
  for (const [dx, dy] of bug) {
    const px = x + dx;
    const py = y + dy;
    if (px >= MARGIN && px < WIDTH - MARGIN && py >= MARGIN && py < HEIGHT - MARGIN) canvas.pixels[py * WIDTH + px] = C.bug;
  }
}

// Bubbles rise from the water beside the pads. They don't depend on the traits.
const bubbles = makeSparks(
  BUBBLES,
  FRAMES,
  (birth) => {
    const [px, py] = PADS[birth % PADS.length];
    const side = Math.floor(birth / PADS.length) % 2 === 0 ? -1 : 1;
    return [px + side * (PAD_RX + 3 + (birth % 5)), py + 4];
  },
  { life: [12, 26], vx: [-0.04, 0.04], vy: [-0.9, -0.5] },
);

const prepare = perTraits(buildPoses);

function draw(index: number, traits: Traits): Uint8Array {
  const { poses, caught } = prepare(traits);
  const pose = poses[index];
  const k = STAGE_SCALE[traits.stage];
  const canvas = new Canvas(WIDTH, HEIGHT);
  const bobs = cyclesFor(traits.mood, BOBS);
  drawBubbles(canvas, bubbles, index);
  PADS.forEach((_, pad) => drawPad(canvas, pad, index, bobs));
  const root = drawFrog(canvas, pose, traits);
  const tip = drawTongue(canvas, pose, root, caught, k);
  if (pose.fly) drawFly(canvas, round(pose.fly[0]), round(pose.fly[1]), pose.flap);
  else if (pose.stuck && tip) drawFly(canvas, tip[0], tip[1], pose.flap);
  canvas.strengthenEdges([[C.line, C.rim]]);
  return canvas.pixels;
}

export const frog = defineCritter({
  id: "frog",
  name: "Frog",
  blurb: "Hops between lily pads, and once a loop flicks its tongue at a passing fly.",
  alt: "Animated pixel art of a round frog with big eyes hopping between lily pads and catching a fly with its tongue",
  width: WIDTH,
  height: HEIGHT,
  frames: FRAMES,
  delayMs: 60,
  poster: 108,
  colourNames: COLOUR_NAMES,
  bodyColour: "body",
  accentColours: ["spot"],
  fixedColours: ["eye", "white", "blush", "mouth", "tongue", "bug", "pad", "padLo", "water"],
  edgeColours: ["rim", "pad", "padLo", "tongue", "bug", "water"],
  colourways: [
    {
      id: "meadow",
      name: "Meadow",
      colours: {
        rim: "#3e8f2c",
        line: "#1e4a1c",
        body: "#86d14e",
        bodyHi: "#b4ec7d",
        bodyLo: "#55a533",
        belly: "#f1f7b4",
        bellyLo: "#cfdc86",
        spot: "#f0a830",
        eye: "#1b2a14",
        white: "#ffffff",
        blush: "#ff9a8a",
        mouth: "#7a2a3a",
        tongue: "#e8607c",
        bug: "#7d6bb8",
        pad: "#3aa874",
        padLo: "#258a5a",
        water: "#5ba8d4",
      },
    },
    {
      id: "cobalt",
      name: "Cobalt",
      colours: {
        rim: "#2d5db5",
        line: "#172d66",
        body: "#4a86e8",
        bodyHi: "#86b4ff",
        bodyLo: "#2f62bd",
        belly: "#dce9ff",
        bellyLo: "#a9c4f0",
        spot: "#ffd23f",
        eye: "#1b2a14",
        white: "#ffffff",
        blush: "#ff9a8a",
        mouth: "#7a2a3a",
        tongue: "#e8607c",
        bug: "#7d6bb8",
        pad: "#3aa874",
        padLo: "#258a5a",
        water: "#5ba8d4",
      },
    },
    {
      id: "tomato",
      name: "Tomato",
      colours: {
        rim: "#c24a24",
        line: "#6b2412",
        body: "#f0743e",
        bodyHi: "#ffa070",
        bodyLo: "#c8501f",
        belly: "#ffe6c2",
        bellyLo: "#f1c28c",
        spot: "#8c2a1a",
        eye: "#1b2a14",
        white: "#ffffff",
        blush: "#ff9a8a",
        mouth: "#7a2a3a",
        tongue: "#e8607c",
        bug: "#7d6bb8",
        pad: "#3aa874",
        padLo: "#258a5a",
        water: "#5ba8d4",
      },
    },
  ],
  draw,
});
