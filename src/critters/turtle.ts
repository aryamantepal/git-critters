import { forEachSpark, makeSparks } from "../engine/body.ts";
import type { Spark } from "../engine/body.ts";
import { Canvas } from "../engine/canvas.ts";
import { colourIndexes, defineCritter } from "../engine/critter.ts";
import type { Mask, Point } from "../engine/mask.ts";
import { clamp, cumulativePhase, round, smooth, TAU } from "../engine/motion.ts";
import { blinkFrames, cyclesFor, perTraits, roam, STAGE_SCALE } from "../engine/traits.ts";
import type { Traits } from "../engine/traits.ts";

const WIDTH = 180;
const HEIGHT = 120;
const FRAMES = 200;
const MARGIN = 2;
const BUBBLES = 20;
const LOCAL = 80;
const ORIGIN = LOCAL / 2;
const SHELL_RX = 17;
const SHELL_RY = 12;
const PLASTRON = 3;
// How far it walks in one step, in frame pixels. Steps are counted from the distance covered.
const STRIDE = 9;
const TAIL_WAGS = 7;

// The frames where it ducks into its shell and pops back out: the duck, a hold, the pop, then the grin.
const DUCK_START = 92;
const DUCK_END = 102;
const POP_START = 114;
const POP_END = 121;
const HOP_END = 130;
const HAPPY_START = 117;
const HAPPY_END = 150;
// It stands still from just before the duck until the hop is over, easing in and out.
const STILL_FROM = 96;
const STILL_TO = 130;
const STILL_EASE = 8;

const WAYPOINTS: readonly Point[] = [
  [58, 70],
  [78, 46],
  [108, 40],
  [130, 58],
  [116, 84],
  [84, 88],
];

// Studs on the shell at full size, as [across, up] from the middle of the shell's base.
const MARKS: readonly (readonly Point[])[] = [
  [],
  [[0, -7]],
  [
    [-6, -4],
    [6, -4],
  ],
  [
    [-9, -4],
    [0, -8],
    [9, -4],
  ],
];
// The middle of each shell plate at full size, as [across, up].
const PLATES: readonly Point[] = [
  [-12, -8],
  [0, -8],
  [12, -8],
  [-18, -2.5],
  [-6, -2.5],
  [6, -2.5],
  [18, -2.5],
];

const COLOUR_NAMES = [
  "rim",
  "line",
  "shell",
  "shellHi",
  "shellLo",
  "scute",
  "scuteHi",
  "plastron",
  "plastronLo",
  "skin",
  "skinHi",
  "skinLo",
  "eye",
  "white",
  "blush",
  "mouth",
  "bubble",
] as const;
const C = colourIndexes(COLOUR_NAMES);

interface Pose {
  x: number;
  y: number;
  facing: 1 | -1;
  /** How far the head is out: 0 inside the shell, 1 normal, a little over for the pop. */
  out: number;
  /** How far the legs reach: 0 tucked in, 1 standing. */
  legs: number;
  /** The walking step, in radians. */
  step: number;
  wag: number;
  happy: boolean;
  blink: boolean;
}

const ease = (t: number) => {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
};

/** How far into its shell it has gone: 0 out, 1 all the way in. */
function tuck(i: number): number {
  if (i < POP_START) return ease((i - DUCK_START) / (DUCK_END - DUCK_START));
  return 1 - ease((i - POP_START) / (POP_END - POP_START));
}

/** The head shoots out past where it started, then settles. */
function headOut(i: number): number {
  const tucked = tuck(i);
  const overshoot = i >= POP_START ? 0.16 * Math.sin(Math.PI * clamp((i - POP_START) / (HOP_END - POP_START), 0, 1)) : 0;
  return 1 - tucked + overshoot * (1 - tucked);
}

/** Time speeds along the path except while it is still, so the loop still closes. */
function pace(): Float64Array {
  const rate = new Float64Array(FRAMES);
  for (let i = 0; i < FRAMES; i++) {
    const into = ease((i - STILL_FROM) / STILL_EASE);
    const out = ease((STILL_TO - i) / STILL_EASE);
    rate[i] = 1 - Math.min(into, out);
  }
  return rate;
}

/** Where the path is at the (fractional) frame `at`, wrapping round. */
function sample(values: Float64Array, at: number): number {
  const n = values.length;
  const low = Math.floor(at);
  const f = at - low;
  return values[((low % n) + n) % n] * (1 - f) + values[(((low + 1) % n) + n) % n] * f;
}

function buildPoses({ mood }: Traits): Pose[] {
  const path = roam(WAYPOINTS, mood, FRAMES);
  const rate = pace();
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
  const speed = new Float64Array(FRAMES);
  for (let i = 0; i < FRAMES; i++) {
    const next = (i + 1) % FRAMES;
    const previous = (i - 1 + FRAMES) % FRAMES;
    vx[i] = (x[next] - x[previous]) / 2;
    speed[i] = Math.hypot(x[next] - x[i], y[next] - y[i]);
  }
  const heading = smooth(vx, 9);
  // It faces the way it walks, and keeps facing that way while it stands still.
  const facing = new Array<1 | -1>(FRAMES);
  const first = heading.findIndex((v) => Math.abs(v) > 0.05);
  let face: 1 | -1 = heading[first] > 0 ? 1 : -1;
  for (let n = 0; n < FRAMES; n++) {
    const i = (first + n) % FRAMES;
    if (Math.abs(heading[i]) > 0.05) face = heading[i] > 0 ? 1 : -1;
    facing[i] = face;
  }
  const distance = speed.reduce((s, v) => s + v, 0);
  const steps = Math.max(1, round(distance / STRIDE));
  const step = cumulativePhase(speed, steps);
  const blinks = blinkFrames(mood, [30, 64, 168], FRAMES);
  const wags = cyclesFor(mood, TAIL_WAGS);
  return Array.from({ length: FRAMES }, (_, i) => {
    const hop = i >= POP_START && i <= HOP_END ? Math.sin((Math.PI * (i - POP_START)) / (HOP_END - POP_START)) : 0;
    // Shut in its shell it trembles, which keeps every frame different while it stands still.
    const tremble = tuck(i) > 0.95 ? [0, 1, 0, -1][i % 4] : 0;
    return {
      x: x[i] + tremble,
      y: y[i] - 5 * hop,
      facing: facing[i],
      out: headOut(i),
      legs: 1 - ease((tuck(i) - 0.15) / 0.6),
      step: step[i],
      wag: (TAU * wags * i) / FRAMES,
      happy: i >= HAPPY_START && i <= HAPPY_END,
      blink: blinks.has(i) && tuck(i) === 0,
    };
  });
}

interface Shell {
  dome: Mask;
  plastron: Mask;
}

function shellMasks(canvas: Canvas, k: number): Shell {
  const dome = canvas.mask();
  const plastron = canvas.mask();
  const rx = SHELL_RX * k;
  const ry = Math.max(4, round(SHELL_RY * k));
  const base = Math.max(2, round(PLASTRON * k));
  for (let y = -ry; y < 0; y++) {
    const half = Math.floor(rx * Math.sqrt(Math.max(0, 1 - ((y + 0.5) / ry) ** 2)) + 0.5);
    for (let x = -half; x <= half; x++) dome.addPixel(ORIGIN + x, ORIGIN + y);
  }
  for (let row = 0; row < base; row++) {
    const half = Math.floor(rx - 1.5 - (row === base - 1 ? 2 : 0));
    for (let x = -half; x <= half; x++) plastron.addPixel(ORIGIN + x, ORIGIN + row);
  }
  return { dome, plastron };
}

function drawShell(canvas: Canvas, k: number): Mask {
  const { dome, plastron } = shellMasks(canvas, k);
  const whole = canvas.mask().add(dome).add(plastron);
  canvas.sticker(whole, C.shell, C.line);

  // Plates: each pixel belongs to its nearest plate, and the pixels between two plates are the seams.
  const plates = canvas.mask();
  const seams = canvas.mask();
  // A small shell gets fewer, wider plates, or the seams would take over.
  const spread = Math.max(k, 0.8);
  const centres = PLATES.map(([dx, dy]): Point => [ORIGIN + dx * spread, ORIGIN + dy * k]);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (!dome.bits[y * canvas.width + x]) continue;
      let best = Infinity;
      let next = Infinity;
      for (const [cx, cy] of centres) {
        const d = Math.hypot(x - cx, y - cy);
        if (d < best) {
          next = best;
          best = d;
        } else if (d < next) next = d;
      }
      if (next - best < (k < 0.7 ? 0.9 : 1.3)) seams.addPixel(x, y);
      else plates.addPixel(x, y);
    }
  }
  const inner = dome
    .moved(1, 0)
    .and(dome.moved(-1, 0))
    .and(dome.moved(0, 1))
    .and(dome.moved(0, -1));
  const rim = dome.minus(inner);
  canvas.fill(plates.and(inner), C.scute);
  canvas.fill(seams.and(inner), C.shellLo);
  // The edge of each plate catches the light on its upper left.
  canvas.fill(plates.and(inner).minus(plates.moved(1, 1)), C.scuteHi);
  canvas.fill(rim, C.shell);
  canvas.fill(dome.minus(dome.moved(1, 2)), C.shellHi);

  canvas.fill(plastron, C.plastron);
  canvas.fill(plastron.minus(plastron.moved(0, -1)), C.plastronLo);
  canvas.fill(plastron.minus(plastron.moved(0, 1)), C.shellLo);
  return dome;
}

function drawStuds(canvas: Canvas, k: number, marks: number): void {
  const studs = canvas.mask();
  for (const [dx, dy] of MARKS[marks]) {
    const x = ORIGIN + round(dx * k);
    const y = ORIGIN + round(dy * k);
    studs.addPixel(x, y).addPixel(x - 1, y).addPixel(x + 1, y);
    if (k >= 0.7) studs.addPixel(x, y - 1).addPixel(x, y + 1);
  }
  canvas.fill(studs, C.white);
}

function drawLegs(canvas: Canvas, pose: Pose, k: number, near: boolean): void {
  if (pose.legs < 0.2) return;
  const legs = canvas.mask();
  const radius = Math.max(1.5, 2.6 * k);
  for (const front of [1, -1]) {
    const hipX = (near ? 11 : 7) * k * front;
    // Opposite corners step together.
    const phase = pose.step + (near === (front === 1) ? 0 : Math.PI);
    const swing = 3.5 * k * Math.sin(phase);
    const lift = 1.7 * k * Math.max(0, Math.cos(phase));
    const reach = (5.6 * k - lift) * pose.legs;
    const hipY = -1.5 * k;
    for (let n = 0; n <= 4; n++) {
      const s = n / 4;
      legs.addDisc(ORIGIN + hipX + swing * s, ORIGIN + hipY + reach * s + 0.5, radius * (1 - 0.15 * s));
    }
  }
  canvas.sticker(legs, near ? C.skin : C.skinLo, C.line);
  if (near) canvas.fill(legs.minus(legs.moved(0, 1)), C.skinHi);
}

function drawTail(canvas: Canvas, pose: Pose, k: number): void {
  const tail = canvas.mask();
  const wag = 1.4 * k * Math.sin(pose.wag) * pose.legs;
  const reach = (6 + 1.5 * pose.legs) * k;
  tail.addPolygon([
    [ORIGIN - 13 * k, ORIGIN - 3 * k],
    [ORIGIN - 13 * k - reach, ORIGIN - 0.5 * k + wag],
    [ORIGIN - 13 * k, ORIGIN + 1.5 * k],
  ]);
  canvas.sticker(tail, C.skinLo, C.line);
}

function drawHead(canvas: Canvas, pose: Pose, k: number): void {
  const out = pose.out;
  const bob = 0.7 * k * Math.sin(pose.step * 2 + 1) * clamp(out, 0, 1);
  const hx = ORIGIN + (7 + 15 * out) * k;
  const hy = ORIGIN - 3.5 * k + bob;
  const skin = canvas.mask();
  skin.addDisc(hx, hy, 5.4 * k);
  skin.addDisc(hx + 3.6 * k, hy + 1 * k, 3.9 * k);
  for (let n = 0; n <= 4; n++) {
    const s = n / 4;
    skin.addDisc(ORIGIN + 10 * k + (hx - ORIGIN - 10 * k) * s, ORIGIN - 3 * k + (hy - ORIGIN + 3 * k) * s, 3.6 * k);
  }
  canvas.sticker(skin, C.skin, C.line);
  canvas.fill(skin.minus(skin.moved(0, 1)), C.skinHi);
  canvas.fill(skin.minus(skin.moved(0, -1)), C.skinLo);
  if (out < 0.55) return;

  const ex = round(hx + 1.8 * k);
  const ey = round(hy - 2.4 * k);
  const eyes = canvas.mask();
  const glint = canvas.mask();
  const tall = k < 0.8 ? 2 : 3;
  if (pose.happy) {
    eyes.addPixel(ex, ey + 1).addPixel(ex + 1, ey + 1).addPixel(ex - 1, ey + 2).addPixel(ex + 2, ey + 2);
  } else if (pose.blink) {
    eyes.addPixel(ex, ey + 1).addPixel(ex + 1, ey + 1);
  } else {
    for (let y = 0; y < tall; y++) eyes.addPixel(ex, ey + y).addPixel(ex + 1, ey + y);
    glint.addPixel(ex, ey);
  }
  canvas.fill(eyes, C.eye);
  canvas.fill(glint, C.white);

  const blush = canvas.mask();
  const cheek = ex - (k < 0.8 ? 2 : 3);
  for (let x = 0; x < (k < 0.8 ? 2 : 3); x++) blush.addPixel(cheek + x, ey + tall + 1).addPixel(cheek + x, ey + tall + 2);
  canvas.fill(blush.and(skin), C.blush);

  const mouth = canvas.mask();
  const mx = round(hx + 6.2 * k);
  const my = round(hy + 2.6 * k);
  if (pose.happy) {
    for (let x = -2; x <= 0; x++) mouth.addPixel(mx + x, my).addPixel(mx + x, my + 1);
    canvas.fill(mouth.and(skin), C.mouth);
  } else {
    mouth.addPixel(mx - 2, my).addPixel(mx - 1, my + 1).addPixel(mx, my + 1).addPixel(mx + 1, my);
    canvas.fill(mouth, C.line);
  }
}

function mirror(canvas: Canvas): Canvas {
  const flipped = new Canvas(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 1; x < canvas.width; x++) {
      flipped.pixels[y * canvas.width + x] = canvas.pixels[y * canvas.width + canvas.width - x];
    }
  }
  return flipped;
}

function renderSprite(pose: Pose, traits: Traits): Canvas {
  const k = STAGE_SCALE[traits.stage];
  const canvas = new Canvas(LOCAL, LOCAL);
  drawLegs(canvas, pose, k, false);
  drawTail(canvas, pose, k);
  drawHead(canvas, pose, k);
  drawLegs(canvas, pose, k, true);
  drawShell(canvas, k);
  drawStuds(canvas, k, traits.marks);
  canvas.strengthenEdges([[C.line, C.rim]]);
  return pose.facing < 0 ? mirror(canvas) : canvas;
}

function spriteOffset(pose: Pose): Point {
  return [round(pose.x) - ORIGIN, round(pose.y) - ORIGIN];
}

const prepare = perTraits((traits): { poses: Pose[]; bubbles: Spark[] } => {
  const k = STAGE_SCALE[traits.stage];
  const poses = buildPoses(traits);
  const bubbles = makeSparks(
    BUBBLES,
    FRAMES,
    (birth) => {
      const pose = poses[birth];
      return [pose.x + ((birth * 7) % 9 - 4) * k * 1.2, pose.y - (SHELL_RY + 3) * k];
    },
    { life: [24, 44], vx: [-0.1, 0.1], vy: [-0.5, -0.28] },
  );
  return { poses, bubbles };
});

function draw(index: number, traits: Traits): Uint8Array {
  const { poses, bubbles } = prepare(traits);
  const frame = new Canvas(WIDTH, HEIGHT);
  forEachSpark(bubbles, index, FRAMES, (x, y, age) => {
    const dots: Point[] =
      age < 0.45
        ? [[x, y]]
        : [
            [x - 1, y],
            [x + 1, y],
            [x, y - 1],
            [x, y + 1],
          ];
    for (const [px, py] of dots) {
      if (px >= MARGIN && px < WIDTH - MARGIN && py >= MARGIN && py < HEIGHT - MARGIN) {
        frame.pixels[py * WIDTH + px] = C.bubble;
      }
    }
  });
  const pose = poses[index];
  const [ox, oy] = spriteOffset(pose);
  renderSprite(pose, traits).stampOnto(frame, ox, oy, MARGIN);
  return frame.pixels;
}

export const turtle = defineCritter({
  id: "turtle",
  name: "Turtle",
  blurb: "Plods along under a patterned shell, and once a loop ducks inside and pops out grinning.",
  alt: "Animated pixel art of a turtle with a patterned shell, walking around the frame and once a loop ducking into its shell and popping out grinning",
  width: WIDTH,
  height: HEIGHT,
  frames: FRAMES,
  delayMs: 60,
  poster: 20,
  colourNames: COLOUR_NAMES,
  bodyColour: "shell",
  accentColours: ["scute", "scuteHi", "bubble"],
  fixedColours: ["eye", "white", "blush", "plastron", "plastronLo"],
  edgeColours: ["rim", "bubble"],
  colourways: [
    {
      id: "pond",
      name: "Pond",
      colours: {
        rim: "#3f8f55",
        line: "#1d4a2c",
        shell: "#2f7d4f",
        shellHi: "#58a870",
        shellLo: "#1f5a3a",
        scute: "#8fc95a",
        scuteHi: "#bde57e",
        plastron: "#f1e3a8",
        plastronLo: "#d4bf7a",
        skin: "#a6cf70",
        skinHi: "#c4e290",
        skinLo: "#76a24b",
        eye: "#1d2b1a",
        white: "#ffffff",
        blush: "#f59a8a",
        mouth: "#7a3b2c",
        bubble: "#4fa8e0",
      },
    },
    {
      id: "honey",
      name: "Honey",
      colours: {
        rim: "#b07a2c",
        line: "#5e3a12",
        shell: "#9a5e22",
        shellHi: "#c88a42",
        shellLo: "#6f4012",
        scute: "#f0b64a",
        scuteHi: "#ffd985",
        plastron: "#f1e3a8",
        plastronLo: "#d4bf7a",
        skin: "#d8b676",
        skinHi: "#ecd29a",
        skinLo: "#b08a4c",
        eye: "#2c1a06",
        white: "#ffffff",
        blush: "#f59a8a",
        mouth: "#7a3b2c",
        bubble: "#3f9fd8",
      },
    },
    {
      id: "blueberry",
      name: "Blueberry",
      colours: {
        rim: "#5a6fd0",
        line: "#26307a",
        shell: "#4a5fb8",
        shellHi: "#7388dc",
        shellLo: "#34428c",
        scute: "#a9b9ff",
        scuteHi: "#d2dcff",
        plastron: "#f1e3a8",
        plastronLo: "#d4bf7a",
        skin: "#8fb0e8",
        skinHi: "#b4cbf4",
        skinLo: "#6288c8",
        eye: "#141a3a",
        white: "#ffffff",
        blush: "#f59a8a",
        mouth: "#7a3b2c",
        bubble: "#e0708c",
      },
    },
  ],
  draw,
});
