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
const PULSES = 8; // whole pulses per loop
const MOTES = 30;
const LOCAL = 110;
const ORIGIN = LOCAL / 2;
const TOP = 34; // where the bell sits on the local canvas
const LOBES = 8;
const TENTACLES = 7;

// The bell's centre: a slow drift across the frame.
const WAYPOINTS: readonly Point[] = [
  [38, 28],
  [66, 18],
  [96, 36],
  [128, 22],
  [146, 44],
  [116, 56],
  [84, 48],
  [52, 58],
];

const COLOUR_NAMES = [
  "rim",
  "line",
  "bell",
  "bellHi",
  "bellLo",
  "inner",
  "spot",
  "arm",
  "armLo",
  "tentacle",
  "tentacleLo",
  "eye",
  "white",
  "blush",
  "mote",
] as const;
const C = colourIndexes(COLOUR_NAMES);

interface Pose {
  x: number;
  y: number;
  /** 0 relaxed, 1 fully squeezed. */
  squeeze: number;
  phase: number;
  drift: number;
  tilt: number;
  blink: boolean;
}

function buildPoses(): Pose[] {
  const { x, y, vx } = flightPath(WAYPOINTS, FRAMES);
  const tilt = smooth(vx.map((v) => clamp(v * 0.35, -0.3, 0.3)), 15);
  const blinks = new Set([40, 41, 42, 120, 121, 122]);
  return Array.from({ length: FRAMES }, (_, i) => {
    const phase = (TAU * PULSES * i) / FRAMES;
    // A quick squeeze followed by a slower relax.
    const squeeze = 0.5 - 0.5 * Math.cos(phase + 0.6 * Math.sin(phase));
    return {
      x: x[i],
      // Each squeeze pushes it up, then it sinks a little while relaxing.
      y: y[i] + 2.4 * Math.cos(phase - 0.9),
      squeeze,
      phase,
      drift: vx[i],
      tilt: tilt[i],
      blink: blinks.has(i),
    };
  });
}

function bellOutline(pose: Pose): Point[] {
  const rx = 18 - 3.5 * pose.squeeze;
  const ry = 13 + 3 * pose.squeeze;
  const cos = Math.cos(pose.tilt);
  const sin = Math.sin(pose.tilt);
  const turn = (x: number, y: number): Point => [
    ORIGIN + x * cos - y * sin,
    TOP + x * sin + y * cos,
  ];
  const points: Point[] = [];
  for (let n = 0; n <= 28; n++) {
    const a = Math.PI + (n / 28) * Math.PI;
    points.push(turn(rx * Math.cos(a), ry * Math.sin(a)));
  }
  // The scalloped margin, right to left, rippling as it pulses.
  const steps = LOBES * 4;
  for (let n = 1; n < steps; n++) {
    const f = n / steps;
    const x = rx - 2 * rx * f;
    const scallop = Math.abs(Math.sin(Math.PI * LOBES * f));
    const ripple = 0.8 * Math.sin(pose.phase * 2 + f * TAU);
    points.push(turn(x, 1 + 2.6 * scallop + ripple));
  }
  return points;
}

function drawTentacles(canvas: Canvas, pose: Pose): void {
  const near = canvas.mask();
  const far = canvas.mask();
  const rx = 15 - 3 * pose.squeeze;
  for (let t = 0; t < TENTACLES; t++) {
    const f = t / (TENTACLES - 1) - 0.5;
    const length = 30 + 6 * Math.abs(Math.sin(t * 1.7)) - 5 * pose.squeeze;
    const points: Point[] = [];
    for (let k = 0; k <= 14; k++) {
      const s = k / 14;
      const wave = s * 3.4 * Math.sin(pose.phase - 3.4 * s + t * 1.3);
      const trail = -pose.drift * 7 * s * s + pose.tilt * -8 * s;
      points.push([ORIGIN + f * 2 * rx * (1 - 0.25 * s) + wave + trail, TOP + 2 + s * length]);
    }
    (t % 2 === 0 ? near : far).addLine(points);
  }
  canvas.fill(far, C.tentacleLo);
  canvas.fill(near, C.tentacle);
}

/** Thicker, frilly arms hanging from the middle of the bell. */
function drawArms(canvas: Canvas, pose: Pose): void {
  const arms = canvas.mask();
  const shade = canvas.mask();
  for (const [f, reach] of [
    [-0.42, 22],
    [0.4, 24],
    [0, 27],
  ]) {
    const length = reach - 4 * pose.squeeze;
    for (let k = 0; k <= 18; k++) {
      const s = k / 18;
      const wave = s * 2.2 * Math.sin(pose.phase - 2.6 * s + f * 6);
      const trail = -pose.drift * 5 * s * s + pose.tilt * -6 * s;
      const frill = 0.8 * Math.sin(k * 1.9 + pose.phase);
      const x = ORIGIN + f * 12 * (1 - 0.3 * s) + wave + trail + frill;
      const y = TOP + 1 + s * length;
      arms.addDisc(x, y, 2.5 - 1.7 * s);
      if (k % 3 === 0) shade.addDisc(x + 0.6, y, 0.9);
    }
  }
  canvas.sticker(arms, C.arm, C.line);
  canvas.fill(shade.and(arms), C.armLo);
}

function drawBell(canvas: Canvas, pose: Pose): void {
  const bell = canvas.mask().addPolygon(bellOutline(pose));
  canvas.sticker(bell, C.bell, C.line);
  canvas.fill(bell.minus(bell.moved(0, -3)), C.bellLo);
  canvas.fill(bell.minus(bell.moved(-1, 2)), C.bellHi);

  const cos = Math.cos(pose.tilt);
  const sin = Math.sin(pose.tilt);
  const place = (x: number, y: number): Point => [
    round(ORIGIN + x * cos - y * sin),
    round(TOP + x * sin + y * cos),
  ];
  const wide = 1 - 0.18 * pose.squeeze;

  // The glowing inner dome, with four little lobes.
  const inner = canvas.mask();
  const [ix, iy] = place(0, -8 - 2 * pose.squeeze);
  inner.addDisc(ix, iy, 7.2 * wide);
  canvas.fill(inner.and(bell), C.inner);
  const spots = canvas.mask();
  for (const dx of [-5.2, -1.8, 1.8, 5.2]) {
    const [sx, sy] = place(dx * wide, -10 - 2 * pose.squeeze + Math.abs(dx) * 0.5);
    spots.addDisc(sx, sy, 1.5);
  }
  canvas.fill(spots.and(bell), C.spot);

  // A small friendly face near the margin.
  const face = canvas.mask();
  const eye = (dx: number) => {
    const [ex, ey] = place(dx * wide, -3.4);
    if (pose.blink) {
      face.addPixel(ex - 1, ey + 1).addPixel(ex, ey + 1);
    } else {
      face.addPixel(ex - 1, ey).addPixel(ex, ey).addPixel(ex - 1, ey + 1).addPixel(ex, ey + 1);
    }
    return [ex, ey] as const;
  };
  const [lx, ly] = eye(-6);
  const [rx, ry] = eye(6);
  canvas.fill(face, C.eye);
  if (!pose.blink) {
    const glint = canvas.mask().addPixel(lx - 1, ly).addPixel(rx - 1, ry);
    canvas.fill(glint, C.white);
  }
  const blush = canvas.mask();
  for (const dx of [-10, 10]) {
    const [bx, by] = place(dx * wide, -1.4);
    blush.addPixel(bx - 1, by).addPixel(bx, by).addPixel(bx + 1, by);
  }
  canvas.fill(blush.and(bell), C.blush);
  const smile = canvas.mask();
  const [mx, my] = place(0, -1.6);
  smile.addPixel(mx - 2, my).addPixel(mx - 1, my + 1).addPixel(mx, my + 1).addPixel(mx + 1, my + 1).addPixel(mx + 2, my);
  canvas.fill(smile, C.line);
}

function renderSprite(pose: Pose): Canvas {
  const canvas = new Canvas(LOCAL, LOCAL);
  drawTentacles(canvas, pose);
  drawArms(canvas, pose);
  drawBell(canvas, pose);
  canvas.strengthenEdges([[C.line, C.rim]]);
  return canvas;
}

function spriteOffset(pose: Pose): Point {
  return [round(pose.x) - ORIGIN, round(pose.y) - (TOP - 16)];
}

let prepared: { poses: Pose[]; motes: Spark[] } | undefined;

function prepare() {
  if (!prepared) {
    const poses = buildPoses();
    const motes = makeSparks(
      MOTES,
      FRAMES,
      (birth) => {
        const pose = poses[birth];
        const [ox, oy] = spriteOffset(pose);
        const side = birth % 2 === 0 ? -1 : 1;
        return [ORIGIN + ox + side * (8 + (birth % 13)), TOP + oy + 2];
      },
      { life: [18, 40], vx: [-0.14, 0.14], vy: [0.12, 0.34] },
    );
    prepared = { poses, motes };
  }
  return prepared;
}

function draw(index: number): Uint8Array {
  const { poses, motes } = prepare();
  const frame = new Canvas(WIDTH, HEIGHT);
  forEachSpark(motes, index, FRAMES, (x, y) => {
    if (x >= MARGIN && x < WIDTH - MARGIN && y >= MARGIN && y < HEIGHT - MARGIN) {
      frame.pixels[y * WIDTH + x] = C.mote;
    }
  });
  const pose = poses[index];
  const [ox, oy] = spriteOffset(pose);
  renderSprite(pose).stampOnto(frame, ox, oy, MARGIN);
  return frame.pixels;
}

export const jellyfish = defineCritter({
  id: "jellyfish",
  name: "Jellyfish",
  blurb: "Pulses gently across the frame, shedding little specks of glow.",
  alt: "Animated pixel art of a smiling jellyfish pulsing as it drifts around the frame, trailing long tentacles",
  width: WIDTH,
  height: HEIGHT,
  frames: FRAMES,
  delayMs: 60,
  poster: 24,
  colourNames: COLOUR_NAMES,
  colourways: [
    {
      id: "lagoon",
      name: "Lagoon",
      colours: {
        rim: "#2a86b8",
        line: "#134a6e",
        bell: "#7fdcf5",
        bellHi: "#c8f4ff",
        bellLo: "#4fb8e0",
        inner: "#b5efff",
        spot: "#3fa0d8",
        arm: "#a8e8fa",
        armLo: "#6cc8ea",
        tentacle: "#2f9ed0",
        tentacleLo: "#2f86c0",
        eye: "#0e2a44",
        white: "#ffffff",
        blush: "#ff9db8",
        mote: "#35a4d8",
      },
    },
    {
      id: "orchid",
      name: "Orchid",
      colours: {
        rim: "#9a55c8",
        line: "#532878",
        bell: "#d6a8f7",
        bellHi: "#f0dcff",
        bellLo: "#b57ee6",
        inner: "#ecd2ff",
        spot: "#a05ad8",
        arm: "#e2c0fb",
        armLo: "#c592ee",
        tentacle: "#a25fd6",
        tentacleLo: "#8c4cc4",
        eye: "#2a1244",
        white: "#ffffff",
        blush: "#ff8fc0",
        mote: "#a866de",
      },
    },
    {
      id: "coral",
      name: "Coral",
      colours: {
        rim: "#d4603f",
        line: "#7a2f1c",
        bell: "#ffb199",
        bellHi: "#ffdccf",
        bellLo: "#f58c6f",
        inner: "#ffd4c4",
        spot: "#e8694a",
        arm: "#ffc8b6",
        armLo: "#fa9f85",
        tentacle: "#e0694a",
        tentacleLo: "#cf5a3d",
        eye: "#3a140a",
        white: "#ffffff",
        blush: "#f0607a",
        mote: "#e56f4f",
      },
    },
  ],
  draw,
});
