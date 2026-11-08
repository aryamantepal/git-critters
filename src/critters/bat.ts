import { Canvas } from "../engine/canvas.ts";
import { colourIndexes, defineCritter } from "../engine/critter.ts";
import type { Mask, Point } from "../engine/mask.ts";
import { clamp, round, smooth, TAU } from "../engine/motion.ts";
import { blinkFrames, cyclesFor, perTraits, roam, STAGE_SCALE } from "../engine/traits.ts";
import type { Traits } from "../engine/traits.ts";

const WIDTH = 180;
const HEIGHT = 120;
const FRAMES = 200;
const MARGIN = 2;
const FLAPS = 24; // whole wingbeats per loop
const SWINGS = 5; // whole swings while it hangs
const LOCAL = 120;
const ORIGIN = LOCAL / 2;
// Where its feet are, and so the line it flips around, in full-size pixels below the middle of the body.
const FEET = 14;

// The signature moment: it lands on a twig, wraps itself in its wings, flips to hang by its feet,
// swings, then flips back and flies off. Each window is [start, end] frames of one smooth step.
const PIN: Window = [78, 100];
const UNPIN: Window = [172, 190];
const TWIG: Window = [86, 100];
const UNTWIG: Window = [174, 186];
const FOLD: Window = [92, 108];
const UNFOLD: Window = [158, 172];
const FLIP: Window = [102, 116];
const UNFLIP: Window = [150, 164];
const SWING_IN: Window = [110, 120];
const SWING_OUT: Window = [144, 154];
const SWING_FROM = 112;
const HANG_MID = 134;

type Window = readonly [number, number];

const WAYPOINTS: readonly Point[] = [
  [52, 52],
  [76, 40],
  [104, 50],
  [128, 40],
  [132, 62],
  [108, 66],
  [88, 54],
  [66, 68],
  [50, 64],
];

// Forehead dots between the ears at full size, as [across, up] from the middle of the body.
const MARKS: readonly (readonly Point[])[] = [
  [],
  [[0, -7.5]],
  [
    [-3.5, -7],
    [3.5, -7],
  ],
  [
    [-5.5, -6.5],
    [0, -8],
    [5.5, -6.5],
  ],
];
// The face by stage, in whole pixels that don't grow with the bat: a small face needs smaller eyes
// closer together. `y` is the eye's height above the middle of the body.
const FACE = [
  { gap: 3, rx: 1.4, ry: 1.7, y: -1.2, nose: 3 },
  { gap: 4, rx: 1.6, ry: 2, y: -1.8, nose: 3.8 },
  { gap: 4, rx: 1.8, ry: 2.3, y: -2.2, nose: 4.1 },
  { gap: 5, rx: 1.8, ry: 2.4, y: -2.5, nose: 4.3 },
] as const;

const COLOUR_NAMES = [
  "rim", // silhouette edge: must read on light and dark pages
  "line",
  "body",
  "bodyHi",
  "bodyLo",
  "belly",
  "earIn",
  "wing",
  "wingLo",
  "eye",
  "white",
  "blush",
  "nose",
  "perch",
  "mark",
] as const;
const C = colourIndexes(COLOUR_NAMES);

interface Pose {
  x: number;
  y: number;
  look: number;
  /** Wing angle in radians, up positive. */
  flap: number;
  /** How far the wingtips lag behind the wrist. */
  lag: number;
  /** 0 spread, 1 wrapped round the body. */
  fold: number;
  /** 0 upright, 1 upside down. */
  hang: number;
  /** Swing about its feet, in radians. */
  swing: number;
  /** How much of the twig is out. */
  twig: number;
  blink: boolean;
}

function step([from, to]: Window, i: number): number {
  const t = clamp((i - from) / (to - from), 0, 1);
  return t * t * (3 - 2 * t);
}

function buildPoses({ mood, stage }: Traits): Pose[] {
  const k = STAGE_SCALE[stage];
  const path = roam(WAYPOINTS, mood, FRAMES);
  const look = smooth(path.vx.map((v) => clamp(v * 2.4, -3 * k, 3 * k)), 13);
  const blinks = blinkFrames(mood, [24, 58, 170], FRAMES);
  const flaps = cyclesFor(mood, FLAPS);
  const swings = cyclesFor(mood, SWINGS);
  const breaths = cyclesFor(mood, 9);
  const swingLength = SWING_OUT[1] - SWING_FROM;
  return Array.from({ length: FRAMES }, (_, i) => {
    const pin = step(PIN, i) - step(UNPIN, i);
    const fold = step(FOLD, i) - step(UNFOLD, i);
    const hang = step(FLIP, i) - step(UNFLIP, i);
    const twig = step(TWIG, i) - step(UNTWIG, i);
    const swingSize = step(SWING_IN, i) - step(SWING_OUT, i);
    const beat = (TAU * flaps * i) / FRAMES;
    const stay = Math.min(1, Math.max(pin, 0));
    return {
      x: path.x[i] + (path.x[HANG_MID] - path.x[i]) * stay,
      y:
        path.y[i] +
        (path.y[HANG_MID] - path.y[i]) * stay +
        (1 - stay) * 1.6 * k * Math.sin(beat + 0.6) -
        8 * k * hang +
        // It breathes while it hangs.
        1.1 * k * hang * Math.sin((TAU * breaths * i) / FRAMES),
      look: look[i] * (1 - stay),
      flap: (0.62 * Math.sin(beat) + 0.12) * (1 - fold),
      lag: 0.5 * Math.sin(beat - 1.15) * (1 - fold),
      fold,
      hang,
      swing:
        0.32 * swingSize * Math.sin((TAU * swings * (i - SWING_FROM)) / swingLength) +
        0.06 * swingSize * Math.sin((TAU * (swings + 1) * (i - SWING_FROM)) / swingLength + 1),
      twig,
      blink: blinks.has(i),
    };
  });
}

type Pt = readonly [number, number];

/** Where a point on the bat lands on the sprite, once it has flipped and swung about its feet. */
interface Place {
  (x: number, y: number, dx?: number, dy?: number): Pt;
}

function makePlace(pose: Pose, k: number): Place {
  const pivot = FEET * k;
  const squash = Math.cos(Math.PI * pose.hang);
  const cos = Math.cos(pose.swing);
  const sin = Math.sin(pose.swing);
  // dx and dy are whole pixels that don't grow with the bat, such as the size of an eye.
  return (x, y, dx = 0, dy = 0) => {
    const down = (y * k + dy - pivot) * squash;
    const across = x * k + dx;
    return [ORIGIN + across * cos - down * sin, ORIGIN + pivot + across * sin + down * cos];
  };
}

function polygon(mask: Mask, points: readonly Pt[]): void {
  mask.addPolygon(points.map(([x, y]): Pt => [Math.round(x), Math.round(y)]));
}

function ellipse(place: Place, cx: number, cy: number, rx: number, ry: number): Pt[] {
  return Array.from({ length: 32 }, (_, i) => place(cx + rx * Math.cos((TAU * i) / 32), cy + ry * Math.sin((TAU * i) / 32)));
}

// A wing is its shoulder, wrist, three fingertips and the dips of membrane between them. Spread
// out, as a right wing at full size; the left is its mirror.
const SHOULDER: Pt = [9, -2];
const WRIST: Pt = [24, -15];
const SPREAD: readonly Pt[] = [
  SHOULDER,
  WRIST,
  [37, -8], // tips
  [32, -2],
  [33, 4],
  [27, 4],
  [24, 10],
  [17, 7],
  [11, 9],
];
const TIPS = [2, 4, 6];
// Wrapped round the belly, with the fingertips pointing down the cloak.
const WRAPPED: readonly Pt[] = [
  [12.5, 6],
  [-1.5, 6.5],
  [-1.5, 15],
  [1.5, 12.5],
  [4.5, 15.5],
  [7.5, 13],
  [10.5, 15],
  [12.5, 12],
  [13.5, 9.5],
];

function wingPoints(pose: Pose): Pt[] {
  const [sx, sy] = SHOULDER;
  const turn = (p: Pt, about: Pt, angle: number): Pt => {
    const dx = p[0] - about[0];
    const dy = p[1] - about[1];
    return [
      about[0] + dx * Math.cos(angle) + dy * Math.sin(angle),
      about[1] - dx * Math.sin(angle) + dy * Math.cos(angle),
    ];
  };
  const shoulder: Pt = [sx, sy];
  const wrist = turn(WRIST, shoulder, pose.flap);
  const spread = SPREAD.map((p, i): Pt => {
    if (i === 0) return p;
    if (i === 1) return wrist;
    // The tips and the membrane between them swing about the wrist, a beat late.
    return turn(turn(p, shoulder, pose.flap), wrist, pose.lag);
  });
  return spread.map(([x, y], i): Pt => {
    const [wx, wy] = WRAPPED[i];
    return [x + (wx - x) * pose.fold, y + (wy - y) * pose.fold];
  });
}

function drawTwig(canvas: Canvas, pose: Pose, k: number): void {
  if (pose.twig <= 0.02) return;
  const row = ORIGIN + round(FEET * k);
  const half = round(20 * k * pose.twig);
  const twig = canvas.mask();
  for (let y = row - 1; y <= row + 1; y++) for (let x = ORIGIN - half; x <= ORIGIN + half; x++) twig.addPixel(x, y);
  canvas.sticker(twig, C.perch, C.line);
  canvas.fill(twig.minus(twig.moved(0, -1)), C.line);
}

function drawBody(canvas: Canvas, place: Place): Mask {
  const body = canvas.mask();
  polygon(body, ellipse(place, 0, 0, 13, 11.5));
  const ears = canvas.mask();
  const earsInside = canvas.mask();
  for (const side of [-1, 1]) {
    polygon(ears, [place(side * 3.5, -8), place(side * 6.5, -24), place(side * 13, -8.5)]);
    polygon(earsInside, [place(side * 6, -10.5), place(side * 7.4, -19.5), place(side * 10.6, -10)]);
    // Cheek fluff.
    polygon(ears, [place(side * 11, 2), place(side * 16.5, 5.5), place(side * 11, 8)]);
  }
  const feet = canvas.mask();
  for (const side of [-1, 1]) {
    polygon(feet, [place(side * 4.5 - 1.5, 10), place(side * 4.5 + 1.5, 10), place(side * 4.5 + 1.5, FEET), place(side * 4.5 - 1.5, FEET)]);
  }
  canvas.sticker(feet, C.bodyLo, C.line);
  const shape = canvas.mask().add(body).add(ears);
  canvas.sticker(shape, C.body, C.line);
  canvas.fill(shape.minus(shape.moved(-2, -2)), C.bodyLo);
  canvas.fill(shape.minus(shape.moved(1, 2)), C.bodyHi);
  canvas.fill(earsInside.and(ears), C.earIn);
  // The muzzle.
  const muzzle = canvas.mask();
  polygon(muzzle, ellipse(place, 0, 4, 6.5, 4.4));
  canvas.fill(muzzle.and(body), C.belly);
  return body;
}

function drawWings(canvas: Canvas, pose: Pose, place: Place): void {
  const right = wingPoints(pose);
  // The far wing goes down first, so the near one overlaps it when they wrap.
  for (const side of [-1, 1]) {
    const points = right.map(([x, y]) => place(side * x, y));
    const wing = canvas.mask();
    polygon(wing, points);
    canvas.sticker(wing, C.wing, C.line);
    const bones = canvas.mask();
    const wrist = points[1];
    for (const tip of TIPS) {
      const [tx, ty] = points[tip];
      bones.addLine([
        [Math.round(wrist[0]), Math.round(wrist[1])],
        [Math.round(tx), Math.round(ty)],
      ]);
    }
    canvas.fill(bones.and(wing), C.wingLo);
  }
}

function drawFace(canvas: Canvas, pose: Pose, place: Place, body: Mask, stage: number): void {
  const k = STAGE_SCALE[stage];
  const look = round(pose.look);
  const { gap, rx, ry, y, nose: noseDrop } = FACE[stage];
  const eyes = canvas.mask();
  const glints = canvas.mask();
  for (const side of [-1, 1]) {
    const cx = (side * gap + look) / k;
    const cy = y / k;
    if (pose.blink) {
      const [bx, by] = place(cx, cy);
      eyes.addPixel(round(bx) - 1, round(by)).addPixel(round(bx), round(by)).addPixel(round(bx) + 1, round(by));
      continue;
    }
    polygon(
      eyes,
      Array.from({ length: 16 }, (_, i) => place(cx, cy, rx * Math.cos((TAU * i) / 16), ry * Math.sin((TAU * i) / 16))),
    );
    const [gx, gy] = place(cx, cy, -rx / 2, -ry / 2);
    glints.addPixel(round(gx), round(gy));
  }
  canvas.fill(eyes, C.eye);
  canvas.fill(glints, C.white);

  const [nx, ny] = place(look / k, (y + noseDrop) / k);
  const column = round(nx);
  const row = round(ny);
  const down = Math.cos(Math.PI * pose.hang) < 0 ? -1 : 1;

  const blush = canvas.mask();
  for (const side of [-1, 1]) {
    const [bx, by] = place((side * (gap + 3.5) + look) / k, (y + noseDrop - 1) / k);
    for (let x = -1; x <= 1; x++) blush.addPixel(round(bx) + x, round(by));
  }
  canvas.fill(blush.and(body), C.blush);

  const nose = canvas.mask();
  for (let x = stage < 2 ? 0 : -1; x <= (stage < 2 ? 0 : 1); x++) nose.addPixel(column + x, row);
  canvas.fill(nose, C.nose);

  // A tiny open mouth, with two fangs once it is big enough to show them.
  const mouth = canvas.mask();
  const fangs = canvas.mask();
  if (stage < 2) {
    for (let x = -1; x <= 1; x++) mouth.addPixel(column + x, row + 2 * down);
  } else {
    for (let x = -2; x <= 2; x++) mouth.addPixel(column + x, row + 2 * down);
    for (let x = -1; x <= 1; x++) mouth.addPixel(column + x, row + 3 * down);
    fangs.addPixel(column - 1, row + 2 * down).addPixel(column + 1, row + 2 * down);
  }
  canvas.fill(mouth.and(body), C.line);
  canvas.fill(fangs.and(body), C.white);
}

function drawMarks(canvas: Canvas, pose: Pose, place: Place, marks: number, big: boolean): void {
  const spots = canvas.mask();
  for (const [dx, dy] of MARKS[marks]) {
    const [px, py] = place(dx, dy, round(pose.look / 2));
    const x = round(px);
    const y = round(py);
    spots.addPixel(x, y);
    if (big) spots.addPixel(x - 1, y).addPixel(x + 1, y).addPixel(x, y - 1).addPixel(x, y + 1);
  }
  canvas.fill(spots, C.mark);
}

function renderSprite(pose: Pose, traits: Traits): Canvas {
  const k = STAGE_SCALE[traits.stage];
  const canvas = new Canvas(LOCAL, LOCAL);
  const place = makePlace(pose, k);
  drawTwig(canvas, pose, k);
  const body = drawBody(canvas, place);
  drawWings(canvas, pose, place);
  drawMarks(canvas, pose, place, traits.marks, traits.stage >= 2);
  drawFace(canvas, pose, place, body, traits.stage);
  canvas.strengthenEdges([[C.line, C.rim]]);
  return canvas;
}

const prepare = perTraits((traits): Pose[] => buildPoses(traits));

function draw(index: number, traits: Traits): Uint8Array {
  const pose = prepare(traits)[index];
  const frame = new Canvas(WIDTH, HEIGHT);
  renderSprite(pose, traits).stampOnto(frame, round(pose.x) - ORIGIN, round(pose.y) - ORIGIN, MARGIN);
  return frame.pixels;
}

export const bat = defineCritter({
  id: "bat",
  name: "Bat",
  blurb: "Flaps about, and once a loop wraps up in its wings and hangs upside down from a twig.",
  alt: "Animated pixel art of a cute bat flapping around the frame, then landing on a twig, wrapping itself in its wings and swinging upside down",
  width: WIDTH,
  height: HEIGHT,
  frames: FRAMES,
  delayMs: 60,
  poster: 12,
  colourNames: COLOUR_NAMES,
  bodyColour: "body",
  accentColours: ["wing", "wingLo", "mark"],
  fixedColours: ["eye", "white", "blush", "earIn", "nose", "perch"],
  edgeColours: ["rim"],
  colourways: [
    {
      id: "dusk",
      name: "Dusk",
      colours: {
        rim: "#7e6bc4",
        line: "#2d2054",
        body: "#6b55a8",
        bodyHi: "#8b75c8",
        bodyLo: "#4f3d86",
        belly: "#d9cdf5",
        earIn: "#f2a6c6",
        wing: "#4a3a8c",
        wingLo: "#2f2362",
        eye: "#150d33",
        white: "#ffffff",
        blush: "#f58fb4",
        nose: "#e8749f",
        perch: "#8a6a4a",
        mark: "#ffd866",
      },
    },
    {
      id: "cocoa",
      name: "Cocoa",
      colours: {
        rim: "#a8693f",
        line: "#4a2a18",
        body: "#a8693f",
        bodyHi: "#c68a5c",
        bodyLo: "#85502f",
        belly: "#f6dcbd",
        earIn: "#f2a6a0",
        wing: "#d99a62",
        wingLo: "#8a5230",
        eye: "#2a140a",
        white: "#ffffff",
        blush: "#f58f84",
        nose: "#c9505a",
        perch: "#8a6a4a",
        mark: "#ffe08a",
      },
    },
    {
      id: "mist",
      name: "Mist",
      colours: {
        rim: "#5f7f9e",
        line: "#26384d",
        body: "#8aa3bd",
        bodyHi: "#aac0d6",
        bodyLo: "#6a86a4",
        belly: "#eaf2f9",
        earIn: "#f4b3c8",
        wing: "#6d88a8",
        wingLo: "#3f5873",
        eye: "#14212f",
        white: "#ffffff",
        blush: "#f79cb5",
        nose: "#e8749f",
        perch: "#8a6a4a",
        mark: "#fff0a8",
      },
    },
  ],
  draw,
});
