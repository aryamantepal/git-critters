// The egg a critter starts as. It isn't listed in `critters`, since nobody picks it as a species.
// Its traits mean something different: `stage` is the crack level, 0 uncracked, 1 a first crack,
// 2 more cracks, 3 big cracks with light showing through. `marks` is ignored, and `mood` sets how
// lively the rocking is, with a little hop when lively.
import { Canvas } from "../engine/canvas.ts";
import { colourIndexes, defineCritter } from "../engine/critter.ts";
import type { Mask, Point } from "../engine/mask.ts";
import { round, TAU } from "../engine/motion.ts";
import { cyclesFor } from "../engine/traits.ts";
import type { Mood, Traits } from "../engine/traits.ts";

const WIDTH = 180;
const HEIGHT = 120;
const FRAMES = 96;
const MARGIN = 2;
const LOCAL_WIDTH = 56;
const LOCAL_HEIGHT = 64;
const MIDDLE = 28; // the column down the middle of the shell
const TOP = 5; // the shell's first row
const SHELL_HEIGHT = 50;
const SHELL_HALF_WIDTH = 21;
const BOTTOM = TOP + SHELL_HEIGHT - 1;
// Where the bottom of the outline sits in the frame.
const FLOOR = 90;
const ACTIVE = 0.62; // the share of each burst spent rocking, the rest is still
const TWINKLE = [0, 1, 2, 3, 2, 1];
const GLOW_BEAT = 24;

// How far the top of the egg leans, in pixels, at the widest rock.
const LEAN: Readonly<Record<Mood, number>> = { resting: 2.5, steady: 3.5, lively: 4.5 };
const HOP = 4;

const COLOUR_NAMES = ["rim", "shell", "shellHi", "shellLo", "speck", "crack", "glow", "gleam"] as const;
const C = colourIndexes(COLOUR_NAMES);

// Speckles as [across, down, width, height] from the middle of the top of the shell.
const SPECKS: readonly (readonly [number, number, number, number])[] = [
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
  [3, 42, 2, 1],
];

// Cracks from the middle of the top of the shell. From level `from` up they are drawn,
// and at level 3 the ones that `glow` have light showing through.
const CRACKS: readonly { from: number; glow: boolean; points: readonly Point[] }[] = [
  { from: 1, glow: true, points: [[1, 3], [4, 7], [2, 10], [6, 14]] },
  { from: 2, glow: true, points: [[6, 14], [5, 18], [9, 22]] },
  { from: 2, glow: false, points: [[-15, 30], [-10, 28], [-9, 33], [-4, 31]] },
  { from: 2, glow: false, points: [[12, 36], [9, 38], [10, 42]] },
  { from: 3, glow: true, points: [[-19, 27], [-13, 22], [-8, 29], [-2, 21], [4, 30], [10, 22], [19, 28]] },
];

interface Pose {
  /** How far the top of the egg leans to the right, in pixels. */
  lean: number;
  /** How far it is off the ground. */
  hop: number;
  twinkle: number;
  glowing: boolean;
}

function poseAt(index: number, mood: Mood): Pose {
  const bursts = cyclesFor(mood, 2);
  const length = FRAMES / bursts;
  const at = (index % length) / length;
  const swing = at < ACTIVE ? Math.sin((Math.PI * at) / ACTIVE) ** 2 * Math.sin((TAU * 2 * at) / ACTIVE) : 0;
  const hopAt = (at - 0.7) / 0.24;
  return {
    lean: LEAN[mood] * swing,
    hop: mood === "lively" && hopAt > 0 && hopAt < 1 ? HOP * Math.sin(Math.PI * hopAt) : 0,
    twinkle: TWINKLE[index % TWINKLE.length],
    glowing: Math.sin((TAU * index) / GLOW_BEAT) > 0,
  };
}

function shellMask(canvas: Canvas): Mask {
  const shell = canvas.mask();
  for (let row = 0; row < SHELL_HEIGHT; row++) {
    const s = ((row + 0.5) / SHELL_HEIGHT) * 2 - 1;
    // Wider at the bottom than the top, and a little flat underneath, so it sits.
    const half = SHELL_HALF_WIDTH * Math.sqrt(1 - s * s) * (1 + 0.14 * s);
    for (let x = 0; x < LOCAL_WIDTH; x++) if (Math.abs(x + 0.5 - MIDDLE) <= half) shell.addPixel(x, TOP + row);
  }
  return shell;
}

function stroke(mask: Mask, points: readonly Point[]): Mask {
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let n = 0; n <= steps; n++) {
      mask.addPixel(MIDDLE + round(x0 + ((x1 - x0) * n) / steps), TOP + round(y0 + ((y1 - y0) * n) / steps));
    }
  }
  return mask;
}

/** The shell, upright and without its outline. */
function drawShell(level: number, pose: Pose): Canvas {
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

function draw(index: number, traits: Traits): Uint8Array {
  const pose = poseAt(index, traits.mood);
  const upright = drawShell(traits.stage, pose);

  // Rocking shifts whole rows, with the bottom staying put, so every detail stays crisp.
  const rocked = new Canvas(LOCAL_WIDTH, LOCAL_HEIGHT);
  for (let y = TOP; y <= BOTTOM; y++) {
    const shift = round((pose.lean * (BOTTOM - y)) / SHELL_HEIGHT);
    for (let x = 0; x < LOCAL_WIDTH; x++) {
      const colour = upright.pixels[y * LOCAL_WIDTH + x];
      if (colour) rocked.pixels[y * LOCAL_WIDTH + x + shift] = colour;
    }
  }

  const sprite = new Canvas(LOCAL_WIDTH, LOCAL_HEIGHT);
  const solid = sprite.mask();
  rocked.pixels.forEach((colour, i) => (solid.bits[i] = colour ? 1 : 0));
  sprite.fill(solid.grown(), C.rim);
  rocked.pixels.forEach((colour, i) => {
    if (colour) sprite.pixels[i] = colour;
  });

  const frame = new Canvas(WIDTH, HEIGHT);
  sprite.stampOnto(frame, WIDTH / 2 - MIDDLE, FLOOR - (BOTTOM + 1) - round(pose.hop), MARGIN);
  return frame.pixels;
}

/** What to draw when there's nothing to go on: no cracks, the usual rocking. */
export const FRESH_EGG: Traits = { stage: 0, marks: 0, mood: "steady" };

export const egg = defineCritter({
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
        gleam: "#ffffff",
      },
    },
  ],
  draw,
});
