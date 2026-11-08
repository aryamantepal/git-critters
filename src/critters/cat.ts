import { Canvas } from "../engine/canvas.ts";
import { colourIndexes, defineCritter } from "../engine/critter.ts";
import type { Mask, Point } from "../engine/mask.ts";
import { clamp, flightPath, openSpline, round, smooth, TAU } from "../engine/motion.ts";
import type { Flight } from "../engine/motion.ts";
import { blinkFrames, cyclesFor, perTraits, roam, STAGE_SCALE } from "../engine/traits.ts";
import type { Traits } from "../engine/traits.ts";

const WIDTH = 180;
const HEIGHT = 120;
const FRAMES = 200;
const MARGIN = 2;
const LOCAL = 90;
const ORIGIN_X = LOCAL / 2;
// The row the paws rest on, in the sprite and in the frame.
const ORIGIN_Y = 76;
const FLOOR: Point = [WIDTH / 2, 96];
const BREATHS = 5; // whole breaths per loop
const FLICKS = 3; // whole waves of the tail per loop
// The slow blink: it shuts its eyes, hearts float up, and it opens them again.
const SLOW_START = 92;
const SLOW_END = 158;
const SLOW_RAMP = 16;
const HEARTS = [
  { start: SLOW_START + 18, side: 1 },
  { start: SLOW_START + 34, side: -1 },
];
const HEART_LIFE = 48;
const HEART_RISE = 26;
const TWITCHES = [34, 176];
const TAIL_SAMPLES = 40;

// Forehead stripes at full size, as [across, length] from the middle of the brow.
const MARKS: readonly (readonly Point[])[] = [
  [],
  [[0, 5]],
  [
    [-3, 4],
    [3, 4],
  ],
  [
    [-5, 3],
    [0, 5],
    [5, 3],
  ],
];
// The eyes by stage, since a small face has no room for big ones.
const EYE_WIDTH = [3, 3, 5, 5];
const EYE_HEIGHT = [3, 4, 4, 5];
const EYE_GAP = [4, 4, 5, 6];

const COLOUR_NAMES = [
  "rim",
  "line",
  "body",
  "bodyHi",
  "bodyLo",
  "bib",
  "earIn",
  "iris",
  "eye",
  "lid",
  "white",
  "nose",
  "ribbon",
  "bell",
  "heart",
  "wing",
] as const;
const C = colourIndexes(COLOUR_NAMES);

// From the root of the tail to its tip, as [across, up] from the middle of the paws.
const TAIL: readonly (readonly number[])[] = [
  [11, 5],
  [22, 5],
  [31, 10],
  [32, 18],
  [28, 24],
  [23, 25],
];
const TAIL_WEIGHT = [0, 0.1, 0.3, 0.55, 0.8, 1];
const RINGS = [0.46, 0.64, 0.82];

const HEART_ART = [".X.X.", "XXXXX", ".XXX.", "..X.."];

// Its path round the cat, in frame pixels.
const BUTTERFLY_PATH: readonly Point[] = [
  [36, 62],
  [46, 24],
  [90, 16],
  [134, 26],
  [146, 62],
  [134, 100],
  [96, 106],
  [50, 98],
];
// The wing shapes, one a frame, so the wings never hold still. "w" is a wing and "b" the body.
const FLAP: readonly (readonly string[])[] = [
  ["ww.b.ww", "wwwbwww", "wwwbwww", ".w.b.w."],
  [".w.b.w.", "wwwbwww", ".wwbww.", "..wbw.."],
  ["..wbw..", "..wbw..", "..wbw..", "...b..."],
  [".w.b.w.", "wwwbwww", ".wwbww.", "..wbw.."],
];
// It looks toward the butterfly once it is this far to one side.
const LOOK_FROM = 20;

interface Pose {
  /** How far the head and chest rise as it breathes, 0 or 1. */
  breath: number;
  tail: number;
  /** 0 normally, rising to 1 mid-way through the slow blink. */
  slow: number;
  /** 0 when an ear is still, 1 at the top of a twitch. */
  twitch: number;
  blink: boolean;
  /** Where the butterfly is in the frame, and which of its wing shapes. */
  fly: Point;
  flap: number;
  /** Which way its eyes follow the butterfly: -1, 0 or 1. */
  look: number;
}

/** The butterfly circles the cat. A resting cat only watches it flutter about in one corner. */
function butterflyPath(mood: Traits["mood"]): Flight {
  if (mood !== "resting") return roam(BUTTERFLY_PATH, mood, FRAMES);
  return flightPath(
    BUTTERFLY_PATH.map(([x, y]): Point => [34 + (x - 90) * 0.2, 44 + (y - 60) * 0.2]),
    FRAMES,
  );
}

function buildPoses({ mood }: Traits): Pose[] {
  const blinks = blinkFrames(mood, [24, 60, 188], FRAMES);
  const breaths = cyclesFor(mood, BREATHS);
  const flicks = cyclesFor(mood, FLICKS);
  const { x, y } = butterflyPath(mood);
  const gaze = smooth(x, 13);
  return Array.from({ length: FRAMES }, (_, i) => {
    const edge = Math.min(i - SLOW_START, SLOW_END - i);
    const twitch = Math.max(0, ...TWITCHES.map((at) => 1 - Math.abs(i - at) / 5));
    return {
      breath: Math.sin((TAU * breaths * i) / FRAMES) > 0.2 ? 1 : 0,
      tail: (TAU * flicks * i) / FRAMES,
      slow: i >= SLOW_START && i <= SLOW_END ? clamp(edge / SLOW_RAMP, 0, 1) : 0,
      twitch,
      blink: blinks.has(i),
      fly: [x[i], y[i]],
      flap: i % FLAP.length,
      look: Math.abs(gaze[i] - FLOOR[0]) < LOOK_FROM ? 0 : Math.sign(gaze[i] - FLOOR[0]),
    };
  });
}

function ellipse(mask: Mask, cx: number, cy: number, rx: number, ry: number): Mask {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) mask.addPixel(x, y);
    }
  }
  return mask;
}

function box(mask: Mask, x0: number, y0: number, x1: number, y1: number): Mask {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) mask.addPixel(x, y);
  return mask;
}

/** Fill a shape with a sticker outline, a lit top left and a shaded bottom right. */
function solid(canvas: Canvas, shape: Mask, colour: number): void {
  canvas.sticker(shape, colour, C.line);
  canvas.fill(shape.minus(shape.moved(-2, -2)), C.bodyLo);
  canvas.fill(shape.minus(shape.moved(1, 2)), C.bodyHi);
}

function drawTail(canvas: Canvas, pose: Pose, k: number, joy: number): void {
  const rows = TAIL.map(([x, y], i) => {
    const w = TAIL_WEIGHT[i];
    const wave = Math.sin(pose.tail - 1.1 * i) + 0.5 * Math.sin(2 * pose.tail - 1.9 * i + 1);
    // The tip curls in tighter when it's happy.
    return [(x + w * (4 * wave - 5 * joy)) * k, (y + w * (2.5 * Math.cos(pose.tail - 1.1 * i) + 1 * joy)) * k];
  });
  const [xs, ys] = openSpline(rows, TAIL_SAMPLES);
  const tail = canvas.mask();
  const spots: Point[] = [];
  for (let s = 0; s < TAIL_SAMPLES; s++) {
    const u = s / (TAIL_SAMPLES - 1);
    const px = ORIGIN_X + xs[s];
    const py = ORIGIN_Y - ys[s];
    spots.push([px, py]);
    tail.addDisc(px, py, (3.1 - 0.9 * u) * k);
  }
  canvas.sticker(tail, C.body, C.line);
  canvas.fill(tail.minus(tail.moved(-1, -1)), C.bodyLo);
  const rings = canvas.mask();
  for (const u of RINGS) {
    const at = Math.round(u * (TAIL_SAMPLES - 1));
    const [x0, y0] = spots[at - 1];
    const [x1, y1] = spots[at + 1];
    const length = Math.hypot(x1 - x0, y1 - y0) || 1;
    const [nx, ny] = [-(y1 - y0) / length, (x1 - x0) / length];
    const [cx, cy] = spots[at];
    const reach = 3.6 * k;
    rings.addLine([
      [cx - nx * reach, cy - ny * reach],
      [cx + nx * reach, cy + ny * reach],
    ]);
  }
  canvas.fill(rings.and(tail), C.bodyLo);
}

function drawBody(canvas: Canvas, k: number): void {
  const at = (x: number, y: number): Point => [ORIGIN_X + x * k, ORIGIN_Y - y * k];
  const floor = ORIGIN_Y;
  const belowFloor = () => box(canvas.mask(), 0, floor + 1, LOCAL - 1, LOCAL - 1);

  const torso = canvas.mask();
  ellipse(torso, ...at(0, 14), 15 * k, 17 * k);
  for (const side of [-1, 1]) ellipse(torso, ...at(side * 12, 9), 9.5 * k, 9.5 * k);
  const lower = torso.minus(belowFloor());
  solid(canvas, lower, C.body);

  const bib = canvas.mask().addPolygon([at(-6, 29), at(6, 29), at(8, 14), at(0, 8), at(-8, 14)]);
  canvas.fill(bib.and(lower), C.bib);

  const stripes = canvas.mask();
  for (const side of [-1, 1]) {
    for (const [y, length] of [
      [18, 4],
      [13, 5],
      [8, 4],
    ]) {
      const x = ORIGIN_X + round(side * 13 * k);
      const row = ORIGIN_Y - round(y * k);
      for (let n = 0; n < round(length * k); n++) stripes.addPixel(x + side * n * -1, row);
    }
  }
  canvas.fill(stripes.and(lower), C.bodyLo);

  for (const side of [-1, 1]) {
    const cx = ORIGIN_X + side * round(5.5 * k);
    const column = box(canvas.mask(), cx - 2, floor - round(19 * k), cx + 2, floor);
    const leg = ellipse(column, cx + side * 0.4, floor - 1.2 * k - 0.6, 3.2 * k + 1.4, 2.2 * k + 1).minus(belowFloor());
    canvas.sticker(leg, C.body, C.line);
    const sock = leg.and(box(canvas.mask(), 0, floor - round(5 * k), LOCAL - 1, floor));
    canvas.fill(sock, C.bib);
    canvas.fill(leg.minus(leg.moved(-1, -1)).minus(sock), C.bodyLo);
    canvas.fill(leg.minus(leg.moved(1, 1)).minus(sock), C.bodyHi);
    if (k > 0.6) {
      const toe = cx - (side > 0 ? 1 : 0);
      canvas.fill(canvas.mask().addPixel(toe, floor - 1).addPixel(toe, floor - 2).addPixel(toe + 2, floor - 1), C.line);
    }
  }
}

function drawCollar(canvas: Canvas, k: number): void {
  const top = ORIGIN_Y - round(26 * k);
  const thickness = Math.max(1, round(2.6 * k));
  const half = round(8 * k);
  const body = canvas.mask();
  for (let i = 0; i < canvas.pixels.length; i++) body.bits[i] = canvas.pixels[i] ? 1 : 0;
  canvas.fill(box(canvas.mask(), ORIGIN_X - half, top, ORIGIN_X + half, top + thickness - 1).and(body), C.ribbon);
  const size = k < 0.6 ? 1 : 2;
  canvas.fill(box(canvas.mask(), ORIGIN_X + 1 - size, top + thickness, ORIGIN_X, top + thickness + size - 1), C.bell);
}

function drawHead(canvas: Canvas, pose: Pose, traits: Traits, k: number): void {
  const { stage, marks } = traits;
  const lift = pose.breath;
  const cx = ORIGIN_X + (pose.slow > 0.5 ? 1 : 0);
  const cy = ORIGIN_Y - round(38 * k) - lift;
  const rx = 17 * k;
  const ry = 12.5 * k;

  const head = canvas.mask();
  ellipse(head, cx, cy, rx, ry);
  const ears = canvas.mask();
  const inner = canvas.mask();
  const back = pose.slow * 1.5 * k;
  for (const side of [-1, 1]) {
    // The right ear is the one that twitches.
    const jump = side > 0 ? pose.twitch : 0;
    const tipX = side * (14.5 - jump * 2) * k + side * back * 0.3;
    const tipY = (22 - jump * 3.5 - back) * k;
    ears.addPolygon([
      [cx + side * 16.5 * k, cy + 4 * k],
      [cx + tipX, cy - tipY],
      [cx + side * 3 * k, cy - 11 * k],
    ]);
    inner.addPolygon([
      [cx + side * 13.5 * k, cy - 2 * k],
      [cx + tipX * 0.9, cy - (tipY - 4.5 * k)],
      [cx + side * 7 * k, cy - 9.5 * k],
    ]);
  }
  const shape = canvas.mask().add(head).add(ears);
  solid(canvas, shape, C.body);
  canvas.fill(inner.and(shape), C.earIn);

  // The cream muzzle.
  const muzzle = ellipse(canvas.mask(), cx, cy + 4.6 * k + 0.6, 5.8 * k + 0.4, 3.6 * k + 0.4);
  canvas.fill(muzzle.and(head), C.bib);

  const brow = canvas.mask();
  for (const [across, length] of MARKS[marks]) {
    const x = cx + round(across * k);
    for (let n = 0; n < Math.max(2, round(length * k)); n++) brow.addPixel(x, cy - round(ry) + 1 + n);
  }
  canvas.fill(brow.and(head), C.bodyLo);

  drawEyes(canvas, pose, cx, cy, stage);

  const nose = canvas.mask();
  const noseY = cy + (stage < 2 ? 2 : 3);
  nose.addPixel(cx - 1, noseY).addPixel(cx, noseY).addPixel(cx + 1, noseY).addPixel(cx, noseY + 1);
  canvas.fill(nose, C.nose);

  const mouth = canvas.mask();
  const mouthY = noseY + 2;
  if (pose.slow > 0.5) {
    mouth.addPixel(cx - 3, mouthY - 1).addPixel(cx - 2, mouthY).addPixel(cx - 1, mouthY).addPixel(cx, mouthY - 1);
    mouth.addPixel(cx + 1, mouthY).addPixel(cx + 2, mouthY).addPixel(cx + 3, mouthY - 1);
  } else {
    mouth.addPixel(cx, mouthY - 1).addPixel(cx - 1, mouthY).addPixel(cx + 1, mouthY);
    if (stage > 1) mouth.addPixel(cx - 2, mouthY - 1).addPixel(cx + 2, mouthY - 1);
  }
  canvas.fill(mouth.and(head), C.line);

  const whiskers = canvas.mask();
  const lifted = pose.slow > 0.5 ? 1 : 0;
  const inset = round(rx) - 2;
  const length = 4 + round(5 * k);
  for (const side of [-1, 1]) {
    const x0 = cx + side * inset;
    const x1 = cx + side * (round(rx) + length);
    for (const [dy, tilt] of [
      [1, -2],
      [4, 1],
      [7, 4],
    ]) {
      const y0 = cy + round((dy - 1) * k) + 1;
      whiskers.addLine([
        [x0, y0],
        [x1, y0 + round(tilt * k) - lifted],
      ]);
    }
  }
  canvas.fill(whiskers.minus(head), C.line);
}

function drawEyes(canvas: Canvas, pose: Pose, cx: number, cy: number, stage: number): void {
  const w = EYE_WIDTH[stage];
  const h = EYE_HEIGHT[stage];
  const gap = EYE_GAP[stage];
  const iris = canvas.mask();
  const pupils = canvas.mask();
  const lids = canvas.mask();
  const glints = canvas.mask();
  for (const side of [-1, 1]) {
    const left = cx + side * gap - (w - 1) / 2 + pose.look;
    const top = cy - h;
    if (pose.slow > 0.67) {
      // Shut and smiling, like a slow blink: an arch with its ends lower.
      for (let x = 0; x < w; x++) lids.addPixel(left + x, top + 1 + (x === 0 || x === w - 1 ? 1 : 0));
      continue;
    }
    if (pose.blink) {
      for (let x = 0; x < w; x++) lids.addPixel(left + x, top + Math.ceil(h / 2));
      continue;
    }
    // Half shut, the top rows taken by the lid.
    const shut = pose.slow > 0.34 ? Math.ceil(h / 2) : 0;
    for (let y = shut; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const corner = w > 3 && (y === 0 || y === h - 1) && (x === 0 || x === w - 1);
        if (!corner) iris.addPixel(left + x, top + y);
      }
      pupils.addPixel(left + (w - 1) / 2, top + y);
    }
    if (shut) for (let x = 0; x < w; x++) lids.addPixel(left + x, top + shut - 1);
    else glints.addPixel(left + (w > 3 ? 1 : 0), top);
  }
  canvas.fill(iris, C.iris);
  canvas.fill(pupils, C.eye);
  canvas.fill(lids, C.lid);
  canvas.fill(glints, C.white);
}

function renderSprite(pose: Pose, traits: Traits): Canvas {
  const k = STAGE_SCALE[traits.stage];
  const canvas = new Canvas(LOCAL, LOCAL);
  drawTail(canvas, pose, k, pose.slow);
  drawBody(canvas, k);
  drawCollar(canvas, k);
  drawHead(canvas, pose, traits, k);
  canvas.strengthenEdges([[C.line, C.rim]]);
  return canvas;
}

const prepare = perTraits((traits) => buildPoses(traits));

function drawHearts(frame: Canvas, index: number, k: number): void {
  for (const { start, side } of HEARTS) {
    const age = (index - start + FRAMES) % FRAMES;
    if (age >= HEART_LIFE) continue;
    const drift = Math.sin((TAU * age) / 24) * 2;
    const x = FLOOR[0] + side * round(21 * k) + round(drift) - 2;
    const y = FLOOR[1] - round(46 * k) - round((HEART_RISE * age) / HEART_LIFE) - 2;
    HEART_ART.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++) {
        const px = x + dx;
        const py = y + dy;
        if (row[dx] === "X" && px >= MARGIN && px < WIDTH - MARGIN && py >= MARGIN && py < HEIGHT - MARGIN) {
          frame.pixels[py * WIDTH + px] = C.heart;
        }
      }
    });
  }
}

function drawButterfly(frame: Canvas, pose: Pose): void {
  const left = round(pose.fly[0]) - 3;
  const top = round(pose.fly[1]) - 1;
  FLAP[pose.flap].forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      if (row[dx] === ".") continue;
      const px = left + dx;
      const py = top + dy;
      if (px >= MARGIN && px < WIDTH - MARGIN && py >= MARGIN && py < HEIGHT - MARGIN) {
        frame.pixels[py * WIDTH + px] = row[dx] === "b" ? C.rim : C.wing;
      }
    }
  });
}

function draw(index: number, traits: Traits): Uint8Array {
  const poses = prepare(traits);
  const frame = new Canvas(WIDTH, HEIGHT);
  drawButterfly(frame, poses[index]);
  drawHearts(frame, index, STAGE_SCALE[traits.stage]);
  renderSprite(poses[index], traits).stampOnto(frame, FLOOR[0] - ORIGIN_X, FLOOR[1] - ORIGIN_Y, MARGIN);
  return frame.pixels;
}

export const cat = defineCritter({
  id: "cat",
  name: "Cat",
  blurb: "Sits flicking its tail and watching a butterfly, and once a loop gives a slow blink and floats up hearts.",
  alt: "Animated pixel art of a cat sitting with its tail flicking, watching a butterfly, then giving a slow blink and floating up little hearts",
  width: WIDTH,
  height: HEIGHT,
  frames: FRAMES,
  delayMs: 60,
  poster: 20,
  colourNames: COLOUR_NAMES,
  bodyColour: "body",
  accentColours: ["ribbon", "heart", "wing"],
  fixedColours: ["iris", "eye", "lid", "white", "nose", "earIn", "bell"],
  edgeColours: ["rim", "heart", "wing"],
  colourways: [
    {
      id: "marmalade",
      name: "Marmalade",
      colours: {
        rim: "#b4531a",
        line: "#5e2410",
        body: "#f0903a",
        bodyHi: "#ffb860",
        bodyLo: "#d06a1c",
        bib: "#fff0d4",
        earIn: "#ff9fa8",
        iris: "#8fd24e",
        eye: "#1c1010",
        lid: "#5e2410",
        white: "#ffffff",
        nose: "#ff8aa0",
        ribbon: "#d8404f",
        bell: "#ffd23f",
        heart: "#f2527a",
        wing: "#4a9be8",
      },
    },
    {
      id: "smoke",
      name: "Smoke",
      colours: {
        rim: "#5f6b80",
        line: "#272d3c",
        body: "#8f9aae",
        bodyHi: "#b6bfce",
        bodyLo: "#69748a",
        bib: "#eef1f6",
        earIn: "#f0a0b0",
        iris: "#e8b73a",
        eye: "#14121a",
        lid: "#272d3c",
        white: "#ffffff",
        nose: "#f0899b",
        ribbon: "#3a8fd0",
        bell: "#ffd23f",
        heart: "#f2527a",
        wing: "#e0902a",
      },
    },
    {
      id: "tuxedo",
      name: "Tuxedo",
      colours: {
        rim: "#7b8097",
        line: "#0c0c12",
        body: "#383845",
        bodyHi: "#56566a",
        bodyLo: "#1f1f2a",
        bib: "#f7f0e2",
        earIn: "#e8909c",
        iris: "#f2c53d",
        eye: "#0a0a0f",
        lid: "#f2c53d",
        white: "#ffffff",
        nose: "#f0899b",
        ribbon: "#e0453d",
        bell: "#ffd23f",
        heart: "#f2527a",
        wing: "#36b58f",
      },
    },
  ],
  draw,
});
