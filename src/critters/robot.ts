import { forEachSpark, makeSparks } from "../engine/body.ts";
import type { Spark } from "../engine/body.ts";
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
const BOBS = 6; // whole bobs per loop
const SWAY_CYCLES = 3;
const GLOW_CYCLES = 5;
const JET_CYCLES = 20;
const ARM_CYCLES = 6;
const PINGS = 3;
const SPARKS = 34;
const LOCAL = 90;
const ORIGIN = LOCAL / 2;
// The frames where it stops to beep and show a heart.
const BEEP_START = 104;
const BEEP_END = 130;

const WAYPOINTS: readonly Point[] = [
  [40, 66],
  [70, 48],
  [104, 62],
  [138, 46],
  [146, 74],
  [112, 80],
  [90, 62],
  [60, 78],
  [34, 72],
];

// Lights on the chest panel at full size, as across from the middle.
const MARKS: readonly (readonly number[])[] = [[], [0], [-3, 3], [-4, 0, 4]];
// How far from the middle each eye sits, by stage, and how big it is.
const EYE_GAP = [2, 3, 3, 4];
const EYE_WIDTH = [1, 2, 2, 2];
const EYE_HEIGHT = [2, 3, 3, 4];

const SMALL_HEART = ["XX.XX", "XXXXX", ".XXX.", "..X.."];
const BIG_HEART = [".XX.XX.", "XXXXXXX", "XXXXXXX", ".XXXXX.", "..XXX..", "...X..."];

const COLOUR_NAMES = [
  "rim",
  "line",
  "body",
  "bodyHi",
  "bodyLo",
  "steel",
  "steelLo",
  "screen",
  "eye",
  "white",
  "heart",
  "glow",
  "glowHi",
] as const;
const C = colourIndexes(COLOUR_NAMES);

interface Pose {
  x: number;
  y: number;
  /** Where it's looking: negative is left, positive is right. */
  look: number;
  /** The head leans with the way it's going and the base trails behind. */
  lean: number;
  /** A happy shake of the head during the beep. */
  wiggle: number;
  /** How far the antenna tip has swayed. */
  sway: number;
  /** 0 normally, rising to 1 mid-beep. */
  beep: number;
  /** How far through one expanding ring of light, from 0 to 1, or -1 when there's none. */
  ping: number;
  jet: number;
  /** The jet's hottest pixel goes out on every other frame, so it never holds still. */
  flicker: 0 | 1;
  arm: number;
  lit: boolean;
  blink: boolean;
}

function buildPoses({ mood, stage }: Traits): Pose[] {
  const k = STAGE_SCALE[stage];
  const { x, y, vx } = roam(WAYPOINTS, mood, FRAMES);
  const look = smooth(vx.map((v) => clamp(v * 3.4, -3 * k, 3 * k)), 13);
  const lean = smooth(vx.map((v) => clamp(v * 1.8, -2 * k, 2 * k)), 21);
  const blinks = blinkFrames(mood, [30, 60, 170], FRAMES);
  const bobs = cyclesFor(mood, BOBS);
  const sway = cyclesFor(mood, SWAY_CYCLES);
  const glow = cyclesFor(mood, GLOW_CYCLES);
  const jet = cyclesFor(mood, JET_CYCLES);
  const arm = cyclesFor(mood, ARM_CYCLES);
  return Array.from({ length: FRAMES }, (_, i) => {
    const beeping = i >= BEEP_START && i <= BEEP_END;
    const progress = beeping ? (i - BEEP_START) / (BEEP_END - BEEP_START) : 0;
    const hop = beeping ? 5 * k * Math.sin(Math.PI * progress) : 0;
    return {
      x: x[i],
      y: y[i] + 2.4 * k * Math.sin((TAU * bobs * i) / FRAMES) - hop,
      look: look[i],
      lean: lean[i],
      wiggle: beeping ? 1.5 * k * Math.sin(TAU * PINGS * progress) : 0,
      sway: 1.6 * k * Math.sin((TAU * sway * i) / FRAMES),
      beep: beeping ? clamp(Math.min(i - BEEP_START, BEEP_END - i) / 4, 0, 1) : 0,
      ping: beeping ? (progress * PINGS) % 1 : -1,
      jet: (TAU * jet * i) / FRAMES,
      flicker: i % 2 === 0 ? 0 : 1,
      arm: (TAU * arm * i) / FRAMES,
      lit: beeping || Math.sin((TAU * glow * i) / FRAMES) > 0,
      blink: blinks.has(i),
    };
  });
}

/** A rectangle with rounded corners, from (x0, y0) up to but not including (x1, y1). */
function roundRect(mask: Mask, x0: number, y0: number, x1: number, y1: number, radius: number): Mask {
  for (let y = y0; y < y1; y++) {
    const fromEdge = Math.min(y - y0, y1 - 1 - y);
    const inset =
      fromEdge >= radius ? 0 : round(radius - Math.sqrt(radius * radius - (radius - fromEdge - 0.5) ** 2));
    for (let x = x0 + inset; x < x1 - inset; x++) mask.addPixel(x, y);
  }
  return mask;
}

function shade(canvas: Canvas, shape: Mask, low: number, high: number): void {
  canvas.fill(shape.minus(shape.moved(-2, -2)), low);
  canvas.fill(shape.minus(shape.moved(1, 2)), high);
}

function renderSprite(pose: Pose, traits: Traits): Canvas {
  const { stage, marks } = traits;
  const k = STAGE_SCALE[stage];
  const s = (v: number) => round(v * k);
  const canvas = new Canvas(LOCAL, LOCAL);
  const headX = ORIGIN + round(pose.lean / 2) + round(pose.wiggle);
  const baseX = ORIGIN - round(pose.lean / 2);
  const box = (centre: number, half: number, top: number, bottom: number, radius: number): Mask =>
    roundRect(canvas.mask(), centre - s(half), ORIGIN + s(top), centre + s(half), ORIGIN + s(bottom), Math.max(1, s(radius)));

  // The hover pad, with its jet underneath.
  const padBottom = ORIGIN + s(19);
  const flameLength = Math.max(2, round((3 + 1.5 * Math.sin(pose.jet)) * k));
  const flame = canvas.mask();
  const core = canvas.mask();
  for (let row = 0; row < flameLength; row++) {
    const half = Math.round(s(3) * (1 - row / flameLength));
    for (let x = -half; x <= half; x++) flame.addPixel(baseX + x, padBottom + 1 + row);
    if (row < flameLength - 1 && (row > 0 || pose.flicker === 0)) core.addPixel(baseX, padBottom + 1 + row);
  }
  canvas.fill(flame, C.glow);
  canvas.fill(core, C.glowHi);
  const pad = box(baseX, 7, 16, 19, 1.5);
  canvas.sticker(pad, C.steel, C.line);
  canvas.fill(pad.minus(pad.moved(0, -1)), C.steelLo);

  // The body, with a panel for the lights.
  const body = box(baseX, 9, 2, 16, 4);
  canvas.sticker(body, C.body, C.line);
  shade(canvas, body, C.bodyLo, C.bodyHi);
  const panel = box(baseX, 5, 6, 13, 1);
  canvas.fill(panel, C.steel);
  canvas.fill(panel.minus(panel.moved(0, -1)), C.steelLo);
  const lights = canvas.mask();
  const lightSize = stage < 2 ? 1 : 2;
  for (const dx of MARKS[marks]) {
    const x = baseX + s(dx) - (lightSize === 2 ? 1 : 0);
    const y = ORIGIN + s(9) - (lightSize === 2 ? 1 : 0);
    for (let n = 0; n < lightSize; n++) for (let m = 0; m < lightSize; m++) lights.addPixel(x + n, y + m);
  }
  canvas.fill(lights, C.glow);

  // The arms hang at its sides and go up for the beep.
  const arms = canvas.mask();
  for (const side of [-1, 1]) {
    const shoulderX = baseX + side * s(10);
    const shoulderY = ORIGIN + s(6);
    const swing = 1.3 * k * Math.sin(pose.arm + (side > 0 ? Math.PI : 0));
    const handX = baseX + side * s(13.5 + 4 * pose.beep);
    const handY = ORIGIN + s(14) + round(swing) - round(9 * k * pose.beep);
    const steps = 8;
    for (let n = 0; n <= steps; n++) {
      const t = n / steps;
      arms.addDisc(shoulderX + (handX - shoulderX) * t, shoulderY + (handY - shoulderY) * t, Math.max(1.2, 2.1 * k));
    }
  }
  canvas.sticker(arms, C.steel, C.line);
  canvas.fill(arms.minus(arms.moved(-1, -1)), C.steelLo);

  // The head, with its side pieces and a screen for a face.
  const ears = canvas.mask();
  for (const side of [-1, 1]) {
    ears.add(
      roundRect(
        canvas.mask(),
        side > 0 ? headX + s(13) : headX - s(16),
        ORIGIN + s(-11),
        side > 0 ? headX + s(16) : headX - s(13),
        ORIGIN + s(-4),
        1,
      ),
    );
  }
  canvas.sticker(ears, C.steel, C.line);
  canvas.fill(ears.minus(ears.moved(-1, 0)), C.steelLo);
  const head = box(headX, 14, -17, 3, 5);
  canvas.sticker(head, C.body, C.line);
  shade(canvas, head, C.bodyLo, C.bodyHi);

  const screen = box(headX, 10, -13, -1, 2);
  canvas.fill(screen, C.screen);
  drawFace(canvas, pose, headX, s, stage);

  // The antenna, which lights up and sends out rings during the beep.
  const tipX = headX + round(pose.sway);
  const tipY = ORIGIN + s(-25);
  const stalk = canvas.mask().addLine([
    [headX, ORIGIN + s(-17)],
    [tipX, tipY],
  ]);
  canvas.sticker(stalk, C.steel, C.line);
  const radius = Math.max(1.6, 2.8 * k) + pose.beep * k;
  const tip = canvas.mask().addDisc(tipX, tipY, radius);
  canvas.sticker(tip, C.glow, C.line);
  if (pose.lit) canvas.fill(canvas.mask().addDisc(tipX, tipY, Math.max(0.9, 1.1 * k)), C.glowHi);
  if (pose.ping >= 0) {
    const ring = canvas.mask();
    const reach = radius + 2 + 3.5 * k * pose.ping;
    for (let n = 0; n < 8; n++) {
      const angle = (Math.PI * n) / 4;
      ring.addPixel(tipX + round(Math.cos(angle) * reach), tipY + round(Math.sin(angle) * reach));
    }
    canvas.fill(ring, C.glow);
  }

  canvas.strengthenEdges([[C.line, C.rim]]);
  return canvas;
}

function drawFace(canvas: Canvas, pose: Pose, headX: number, s: (v: number) => number, stage: number): void {
  const cx = headX + round(pose.look);
  const top = ORIGIN + s(-9);
  const width = EYE_WIDTH[stage];
  const height = EYE_HEIGHT[stage];
  const gap = EYE_GAP[stage];

  if (pose.beep > 0.5) {
    const art = stage < 2 ? SMALL_HEART : BIG_HEART;
    const heart = canvas.mask();
    const glint = canvas.mask();
    art.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] === "X") heart.addPixel(headX - (row.length >> 1) + x, top - 1 + y);
      }
    });
    glint.addPixel(headX - (art[0].length >> 1) + 1, top);
    canvas.fill(heart, C.heart);
    canvas.fill(glint, C.white);
    return;
  }

  const eyes = canvas.mask();
  const glints = canvas.mask();
  for (const side of [-1, 1]) {
    const left = side < 0 ? cx - gap - width + 1 : cx + gap;
    if (pose.blink) {
      for (let x = 0; x < width; x++) eyes.addPixel(left + x, top + (height >> 1));
      continue;
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) eyes.addPixel(left + x, top + y);
    if (stage >= 2) glints.addPixel(left, top);
  }
  canvas.fill(eyes, C.eye);
  canvas.fill(glints, C.white);

  if (stage >= 1) {
    const mouth = canvas.mask();
    const y = top + height + (stage < 2 ? 1 : 2);
    if (stage < 2) {
      for (let x = -1; x <= 1; x++) mouth.addPixel(cx + x, y);
    } else {
      mouth.addPixel(cx - 2, y - 1).addPixel(cx - 1, y).addPixel(cx, y).addPixel(cx + 1, y).addPixel(cx + 2, y - 1);
    }
    canvas.fill(mouth, C.eye);
  }
}

function spriteOffset(pose: Pose): Point {
  return [round(pose.x) - ORIGIN, round(pose.y) - ORIGIN];
}

const prepare = perTraits((traits): { poses: Pose[]; sparks: Spark[] } => {
  const k = STAGE_SCALE[traits.stage];
  const poses = buildPoses(traits);
  const sparks = makeSparks(
    SPARKS,
    FRAMES,
    (birth) => {
      const pose = poses[birth];
      return [pose.x + ((birth % 5) - 2) * k, pose.y + 24 * k];
    },
    { life: [8, 16], vx: [-0.12, 0.12], vy: [0.3, 0.6] },
  );
  return { poses, sparks };
});

function draw(index: number, traits: Traits): Uint8Array {
  const { poses, sparks } = prepare(traits);
  const frame = new Canvas(WIDTH, HEIGHT);
  forEachSpark(sparks, index, FRAMES, (x, y, age) => {
    const dots: Point[] = age < 0.5 ? [[x, y], [x, y + 1]] : [[x, y]];
    for (const [px, py] of dots) {
      if (px >= MARGIN && px < WIDTH - MARGIN && py >= MARGIN && py < HEIGHT - MARGIN) {
        frame.pixels[py * WIDTH + px] = C.glow;
      }
    }
  });
  const pose = poses[index];
  const [ox, oy] = spriteOffset(pose);
  renderSprite(pose, traits).stampOnto(frame, ox, oy, MARGIN);
  return frame.pixels;
}

export const robot = defineCritter({
  id: "robot",
  name: "Little robot",
  blurb: "Hovers about, and stops once a loop to beep and show a heart.",
  alt: "Animated pixel art of a little hovering robot with a screen for a face, drifting around the frame and stopping to beep and show a heart",
  width: WIDTH,
  height: HEIGHT,
  frames: FRAMES,
  delayMs: 60,
  poster: 12,
  colourNames: COLOUR_NAMES,
  bodyColour: "body",
  accentColours: ["glow", "glowHi"],
  fixedColours: ["steel", "steelLo", "screen", "eye", "white", "heart"],
  edgeColours: ["rim", "glow"],
  colourways: [
    {
      id: "cobalt",
      name: "Cobalt",
      colours: {
        rim: "#4d6ad0",
        line: "#26346e",
        body: "#7ea6ff",
        bodyHi: "#b9d0ff",
        bodyLo: "#5379d9",
        steel: "#c9d0dc",
        steelLo: "#8d97ab",
        screen: "#141c2e",
        eye: "#7dffe3",
        white: "#ffffff",
        heart: "#ff6b9a",
        glow: "#f58a2a",
        glowHi: "#ffe3a8",
      },
    },
    {
      id: "copper",
      name: "Copper",
      colours: {
        rim: "#bf6234",
        line: "#6e3320",
        body: "#f2a074",
        bodyHi: "#ffd2b4",
        bodyLo: "#d77548",
        steel: "#d6d2cc",
        steelLo: "#9b948b",
        screen: "#1f1a1c",
        eye: "#fff27a",
        white: "#ffffff",
        heart: "#ff6b9a",
        glow: "#1fb5a8",
        glowHi: "#b8fff2",
      },
    },
    {
      id: "lemon",
      name: "Lemon",
      colours: {
        rim: "#b08a14",
        line: "#6b5410",
        body: "#ffd84a",
        bodyHi: "#fff0a0",
        bodyLo: "#e5ad22",
        steel: "#cfd3d8",
        steelLo: "#8f959e",
        screen: "#1c1a2e",
        eye: "#ff9ee6",
        white: "#ffffff",
        heart: "#ff6b9a",
        glow: "#8a63e8",
        glowHi: "#ddd0ff",
      },
    },
  ],
  draw,
});
