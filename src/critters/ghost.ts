import { forEachSpark, makeSparks } from "../engine/body.ts";
import type { Spark } from "../engine/body.ts";
import { Canvas } from "../engine/canvas.ts";
import { colourIndexes, defineCritter } from "../engine/critter.ts";
import type { Point } from "../engine/mask.ts";
import { clamp, flightPath, round, smooth, TAU } from "../engine/motion.ts";

const WIDTH = 180;
const HEIGHT = 120;
const FRAMES = 200;
const MARGIN = 2;
const BOBS = 6; // whole bobs per loop
const HEM_CYCLES = 16;
const SPARKLES = 26;
const LOCAL = 90;
const ORIGIN = LOCAL / 2;
const RADIUS = 15;
const SKIRT = 20; // how far the body runs below the middle of the head
const HEM_LOBES = 4;
// The frames where it stops to say boo.
const BOO_START = 104;
const BOO_END = 130;

const WAYPOINTS: readonly Point[] = [
  [40, 50],
  [70, 30],
  [104, 44],
  [138, 26],
  [146, 62],
  [112, 78],
  [90, 58],
  [60, 76],
  [34, 70],
];

const COLOUR_NAMES = ["rim", "line", "body", "bodyHi", "bodyLo", "eye", "white", "blush", "mouth", "sparkle"] as const;
const C = colourIndexes(COLOUR_NAMES);

interface Pose {
  x: number;
  y: number;
  /** Where it's looking: negative is left, positive is right. */
  look: number;
  lean: number;
  hem: number;
  /** 0 normally, rising to 1 mid-boo. */
  boo: number;
  blink: boolean;
}

function buildPoses(): Pose[] {
  const { x, y, vx } = flightPath(WAYPOINTS, FRAMES);
  const look = smooth(vx.map((v) => clamp(v * 3.4, -4.5, 4.5)), 13);
  const lean = smooth(vx.map((v) => clamp(v * 1.8, -3, 3)), 21);
  const blinks = new Set([30, 31, 32, 60, 61, 62, 170, 171, 172]);
  return Array.from({ length: FRAMES }, (_, i) => {
    const edge = Math.min(i - BOO_START, BOO_END - i);
    const boo = i >= BOO_START && i <= BOO_END ? clamp(edge / 4, 0, 1) : 0;
    return {
      x: x[i],
      y: y[i] + 2.4 * Math.sin((TAU * BOBS * i) / FRAMES),
      look: look[i],
      lean: lean[i],
      hem: (TAU * HEM_CYCLES * i) / FRAMES,
      boo,
      blink: blinks.has(i),
    };
  });
}

function drawBody(canvas: Canvas, pose: Pose): void {
  const body = canvas.mask();
  const stretch = 3 * pose.boo;
  const flare = 2.6 + 1.4 * pose.boo;
  const skirt = SKIRT + stretch;
  for (let y = -RADIUS - round(stretch); y <= skirt + 4; y++) {
    const row = y + stretch;
    const down = Math.max(0, y) / skirt;
    const half = row < 0 ? Math.sqrt(Math.max(0, RADIUS * RADIUS - row * row)) : RADIUS + down * flare;
    // The hem trails behind as it moves.
    const shift = -pose.lean * down * down;
    for (let x = Math.trunc(-half - 6); x <= half + 6; x++) {
      const dx = x - shift;
      if (Math.abs(dx) > half) continue;
      // The wave rolls along the hem, and the corners tuck in so they stay round.
      const tuck = 4 * (Math.abs(dx) / half) ** 6;
      const hem = skirt - tuck + 2.2 * Math.sin((HEM_LOBES * Math.PI * (dx + half)) / (2 * half) + pose.hem);
      if (y <= hem) body.addPixel(ORIGIN + x, ORIGIN + y);
    }
  }
  canvas.sticker(body, C.body, C.line);
  canvas.fill(body.minus(body.moved(-2, -2)), C.bodyLo);
  canvas.fill(body.minus(body.moved(1, 2)), C.bodyHi);
}

function drawArms(canvas: Canvas, pose: Pose): void {
  const arms = canvas.mask();
  const lift = 5 + 16 * pose.boo;
  const wave = 1.2 * Math.sin(pose.hem * 0.5);
  for (const side of [-1, 1]) {
    const reach = RADIUS + 1.5 + 3 * pose.boo;
    arms.addDisc(ORIGIN + side * reach, ORIGIN + 9 - lift + 5 + side * wave, 3.3);
    arms.addDisc(ORIGIN + side * (reach - 2), ORIGIN + 11 - lift + 5 + side * wave, 3);
  }
  canvas.sticker(arms, C.body, C.line);
  canvas.fill(arms.minus(arms.moved(-1, -1)), C.bodyLo);
}

function drawFace(canvas: Canvas, pose: Pose): void {
  const cx = ORIGIN + round(pose.look);
  const cy = ORIGIN - 2 - round(3 * pose.boo);
  const eyes = canvas.mask();
  const glints = canvas.mask();
  const gap = 6;
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
  canvas.fill(eyes, C.eye);
  canvas.fill(glints, C.white);

  const blush = canvas.mask();
  for (const side of [-1, 1]) {
    const bx = cx + side * (gap + 4);
    for (let x = -1; x <= 1; x++) {
      blush.addPixel(bx + x, cy + 5);
      blush.addPixel(bx + x, cy + 6);
    }
  }
  canvas.fill(blush, C.blush);

  const mouth = canvas.mask();
  if (pose.boo > 0.5) {
    // A wide-open "boo".
    mouth.addDisc(cx, cy + 9, 3.4);
    canvas.fill(mouth, C.mouth);
  } else {
    mouth.addPixel(cx - 2, cy + 6).addPixel(cx - 1, cy + 7).addPixel(cx, cy + 7).addPixel(cx + 1, cy + 7).addPixel(cx + 2, cy + 6);
    canvas.fill(mouth, C.line);
  }
}

function renderSprite(pose: Pose): Canvas {
  const canvas = new Canvas(LOCAL, LOCAL);
  drawBody(canvas, pose);
  drawArms(canvas, pose);
  drawFace(canvas, pose);
  canvas.strengthenEdges([[C.line, C.rim]]);
  return canvas;
}

function spriteOffset(pose: Pose): Point {
  return [round(pose.x) - ORIGIN, round(pose.y) - ORIGIN];
}

let prepared: { poses: Pose[]; sparkles: Spark[] } | undefined;

function prepare() {
  if (!prepared) {
    const poses = buildPoses();
    const sparkles = makeSparks(
      SPARKLES,
      FRAMES,
      (birth) => {
        const pose = poses[birth];
        const side = birth % 2 === 0 ? -1 : 1;
        return [pose.x + side * (6 + (birth % 11)), pose.y + SKIRT + 4];
      },
      { life: [16, 34], vx: [-0.12, 0.12], vy: [-0.1, 0.22] },
    );
    prepared = { poses, sparkles };
  }
  return prepared;
}

function draw(index: number): Uint8Array {
  const { poses, sparkles } = prepare();
  const frame = new Canvas(WIDTH, HEIGHT);
  forEachSpark(sparkles, index, FRAMES, (x, y, age) => {
    const dots: Point[] =
      age < 0.5
        ? [
            [x, y],
            [x - 1, y],
            [x + 1, y],
            [x, y - 1],
            [x, y + 1],
          ]
        : [[x, y]];
    for (const [px, py] of dots) {
      if (px >= MARGIN && px < WIDTH - MARGIN && py >= MARGIN && py < HEIGHT - MARGIN) {
        frame.pixels[py * WIDTH + px] = C.sparkle;
      }
    }
  });
  const pose = poses[index];
  const [ox, oy] = spriteOffset(pose);
  renderSprite(pose).stampOnto(frame, ox, oy, MARGIN);
  return frame.pixels;
}

export const ghost = defineCritter({
  id: "ghost",
  name: "Ghost",
  blurb: "Floats about, leaves sparkles, and stops once a loop to say boo.",
  alt: "Animated pixel art of a friendly ghost floating around the frame, leaving sparkles and stopping to say boo",
  width: WIDTH,
  height: HEIGHT,
  frames: FRAMES,
  delayMs: 60,
  poster: 12,
  colourNames: COLOUR_NAMES,
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
        sparkle: "#9a86e8",
      },
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
        sparkle: "#3fb893",
      },
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
        sparkle: "#e0805a",
      },
    },
  ],
  draw,
});
