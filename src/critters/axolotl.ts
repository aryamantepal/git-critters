import { bandPositions, drawBands, drawLimb, drawTube, forEachSpark, makeSparks, tubeMask } from "../engine/body.ts";
import type { Spark, Spine } from "../engine/body.ts";
import { Canvas, flipArt, parseArt } from "../engine/canvas.ts";
import type { Art } from "../engine/canvas.ts";
import { colourIndexes, defineCritter } from "../engine/critter.ts";
import type { Point } from "../engine/mask.ts";
import { clamp, openSpline, project, round, smooth, TAU, yawFromTravel } from "../engine/motion.ts";
import type { View } from "../engine/motion.ts";
import { blinkFrames, cyclesFor, perTraits, roam, STAGE_SCALE } from "../engine/traits.ts";
import type { Traits } from "../engine/traits.ts";

const WIDTH = 180;
const HEIGHT = 120;
const FRAMES = 200;
const MARGIN = 2;
const SWIM_CYCLES = 14;
const GILL_CYCLES = 9;
const BUBBLES = 22;
const LOCAL = 130;
const ORIGIN = LOCAL / 2;
const REST_YAW = (12 * Math.PI) / 180;

const WAYPOINTS: readonly Point[] = [
  [46, 74],
  [76, 42],
  [112, 58],
  [134, 36],
  [138, 76],
  [110, 90],
  [78, 72],
  [58, 92],
  [38, 56],
];

const COLOUR_NAMES = [
  "rim",
  "line",
  "body",
  "bodyHi",
  "bodyLo",
  "belly",
  "bellyLo",
  "fin",
  "gill",
  "gillHi",
  "blush",
  "eye",
  "white",
  "toe",
  "bubble",
] as const;
const C = colourIndexes(COLOUR_NAMES);

const ART_KEY = {
  o: C.body,
  h: C.bodyHi,
  s: C.bodyLo,
  c: C.belly,
  d: C.bellyLo,
  b: C.blush,
  k: C.eye,
  w: C.white,
  n: C.line,
};

const HEAD_SIDE = parseArt(
  `
.........oooooo.........
......oooohhhhhooo......
....ooohhhhhhhhhhooo....
...oohhhhhhhhhooooooo...
..ooohhhoooooooooooooo..
..oooooooooooowkkoooooo.
.ooooooooooooookkkoooooo
.ooooooooooooookkkoooooo
.ooooooooobbbooooooooooo
.sooooooonnooooooooooooo
.ssooooooooonnnnnnnnnnnn
..ssssooocccccccccccccc.
...ssssscccccccccccccc..
.....ssdddddddddddddd...
........dddddddddd......
`,
  ART_KEY,
);
const HEAD_SIDE_ANCHOR: Point = [6, 8];

const HEAD_FRONT = parseArt(
  `
........ooooooo........
.....ooohhhhhhhooo.....
...oohhhhhhhhhhhhhoo...
..oohhhhhhhhhhhhhhhoo..
.ooooooooooooooooooooo.
.oookkoooooooooookkooo.
ooookwoooooooooookwoooo
ooookkoooooooooookkoooo
oobbbooooooooooooobbboo
.ooooonooooooooonooooo.
.sooooonnnnnnnnnooooos.
..ssoooocccccccooooss..
....ssssdddddddssss....
`,
  ART_KEY,
);
const HEAD_FRONT_ANCHOR: Point = [11, 8];

function withEyeShut(art: Art): Art {
  const pixels = art.pixels.slice();
  const columns = new Set<number>();
  for (let y = 5; y < 8; y++) {
    for (let x = 0; x < art.width; x++) {
      const at = y * art.width + x;
      if (pixels[at] === C.white || pixels[at] === C.eye) {
        pixels[at] = C.body;
        columns.add(x);
      }
    }
  }
  for (const x of columns) pixels[6 * art.width + x] = C.line;
  return { ...art, pixels };
}

const HEADS = {
  side: HEAD_SIDE,
  sideLeft: flipArt(HEAD_SIDE),
  blink: withEyeShut(HEAD_SIDE),
  blinkLeft: flipArt(withEyeShut(HEAD_SIDE)),
  front: HEAD_FRONT,
};

// (forward, up, radius) from the back of the head to the tip of the tail.
const SPINE = [
  [13, 1, 5.2],
  [8, 0, 6.2],
  [1, 0, 6.6],
  [-6, 0, 5.8],
  [-13, 0, 3.9],
  [-20, 0.5, 2.5],
  [-27, 1, 1.5],
  [-33, 2, 0.7],
];
const SAMPLES = 70;
const HIP = 3 / 7;
// The spine at each stage, re-sampled from the scaled points.
const SPINES = STAGE_SCALE.map((k) => openSpline(SPINE.map(([x, y, r]) => [x * k, y * k, r * k]), SAMPLES));
const SPINE_U = Float64Array.from({ length: SAMPLES }, (_, i) => i / (SAMPLES - 1));
const TAIL_WEIGHT = SPINE_U.map((u) => clamp((u - HIP * 0.5) / (1 - HIP * 0.5), 0, 1) ** 1.4);
const SPECKLES = [0.2, 0.3, 0.42, 0.52, 0.62];
// The first band sits this far along the spine, and the others follow about 4 pixels apart.
const BANDS_FROM = 0.28;
const BAND_GAP = 0.09;
const LIMB_OFFSET = 5;

// Gill stalks on each side of the head: [angle up from straight back, length].
const GILLS: readonly Point[] = [
  [1.3, 12],
  [0.85, 14],
  [0.4, 13],
];

interface Pose {
  x: number;
  y: number;
  swim: number;
  gill: number;
  blink: boolean;
  view: View;
}

function buildPoses({ mood }: Traits): Pose[] {
  const { x, y, vx, vy } = roam(WAYPOINTS, mood, FRAMES);
  const yaw = yawFromTravel(vx, REST_YAW, 0.6, 9);
  const pitch = smooth(vy.map((v) => clamp(-v * 0.3, -0.28, 0.28)), 11);
  const blinks = blinkFrames(mood, [20, 96, 150], FRAMES);
  const swim = cyclesFor(mood, SWIM_CYCLES);
  const gill = cyclesFor(mood, GILL_CYCLES);
  return Array.from({ length: FRAMES }, (_, i) => ({
    x: x[i],
    y: y[i],
    swim: (TAU * swim * i) / FRAMES,
    gill: (TAU * gill * i) / FRAMES,
    blink: blinks.has(i),
    view: { yaw: yaw[i], pitch: pitch[i], elevation: 0.22, origin: ORIGIN },
  }));
}

function animatedSpine(pose: Pose, k: number, stage: number): Spine {
  const [SPINE_X, SPINE_Y, SPINE_R] = SPINES[stage];
  const y = new Float64Array(SAMPLES);
  const z = new Float64Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) {
    const tail = TAIL_WEIGHT[i];
    y[i] = SPINE_Y[i] + tail * 5 * k * Math.sin(pose.swim - 4.2 * SPINE_U[i]);
    z[i] = tail * 2 * k * Math.sin(pose.swim + 1 - 4.2 * SPINE_U[i]);
  }
  return { x: SPINE_X, y, z, radius: SPINE_R };
}

const TUBE = { fill: C.body, low: C.bodyLo, high: C.bodyHi, belly: C.belly, bellyLow: C.bellyLo };

/** The body with a paddle-shaped fin along its back and tail, inside one outline. */
function drawBody(canvas: Canvas, pose: Pose, spine: Spine, k: number): void {
  const fin = canvas.mask();
  for (let i = 0; i < SAMPLES; i++) {
    const u = SPINE_U[i];
    if (u < 0.34) continue;
    const [sx, sy] = project(pose.view, spine.x[i], spine.y[i], spine.z[i]);
    // The fin widens along the tail, then comes to a soft point at the tip.
    const taper = 1 - 0.7 * clamp((u - 0.85) / 0.15, 0, 1) ** 2;
    fin.addDisc(sx, sy, spine.radius[i] + (1 + 3.6 * clamp((u - 0.34) / 0.25, 0, 1)) * taper * k);
  }
  const body = tubeMask(canvas, pose.view, spine, () => true);
  canvas.fill(canvas.mask().add(fin).add(body).grown(), C.line);
  canvas.fill(fin, C.fin);
  drawTube(canvas, pose.view, spine, TUBE, () => true, (i) => SPINE_U[i] < 0.6);
}

/** Thin stalks with little side branches, so they read as ferns rather than blobs. */
function drawGills(canvas: Canvas, pose: Pose, side: number, root: Point, k: number): void {
  const stalks = canvas.mask();
  const branches = canvas.mask();
  GILLS.forEach(([angle, fullLength], g) => {
    const length = fullLength * k;
    const steps = 14;
    let previous: Point | undefined;
    for (let n = 0; n <= steps; n++) {
      const s = n / steps;
      const wave = 1.6 * k * s * Math.sin(pose.gill + 2.2 * g - 2.5 * s + side);
      const point = project(
        pose.view,
        root[0] - k - s * length * Math.cos(angle) * 0.9,
        root[1] + 5 * k + s * length * Math.sin(angle) + wave,
        side * (5 * k + s * length * 0.6),
      );
      if (previous) stalks.addLine([previous, point]);
      previous = point;
      if (n % 3 === 2) {
        const [x, y] = [round(point[0]), round(point[1])];
        // Branch sideways from a stalk that runs up, otherwise up and down.
        if (Math.abs(Math.sin(angle)) > 0.7) branches.addPixel(x - 1, y).addPixel(x + 1, y);
        else branches.addPixel(x, y - 1).addPixel(x, y + 1);
      }
    }
  });
  canvas.fill(branches, C.gillHi);
  canvas.fill(stalks, C.gill);
}

function drawHead(canvas: Canvas, pose: Pose, joint: Point): void {
  const cosYaw = Math.cos(pose.view.yaw);
  let art: Art;
  let anchorX: number;
  let anchorY: number;
  if (Math.abs(cosYaw) > 0.5) {
    [anchorX, anchorY] = HEAD_SIDE_ANCHOR;
    if (cosYaw < 0) {
      art = pose.blink ? HEADS.blinkLeft : HEADS.sideLeft;
      anchorX = art.width - 1 - anchorX;
    } else {
      art = pose.blink ? HEADS.blink : HEADS.side;
    }
  } else {
    art = HEADS.front;
    [anchorX, anchorY] = HEAD_FRONT_ANCHOR;
  }
  const [hx, hy] = project(pose.view, joint[0], joint[1], 0);
  canvas.stampArt(art, round(hx) - anchorX, round(hy) - anchorY, C.line);
}

function renderSprite(pose: Pose, traits: Traits): Canvas {
  const k = STAGE_SCALE[traits.stage];
  const canvas = new Canvas(LOCAL, LOCAL);
  const spine = animatedSpine(pose, k, traits.stage);
  const cosYaw = Math.cos(pose.view.yaw);
  const sinYaw = Math.sin(pose.view.yaw);
  const joint: Point = [spine.x[0], spine.y[0]];
  const paddle = Math.sin(pose.swim * 0.5);

  const parts: [number, () => void][] = [];
  const speckles = () => {
    const spots = canvas.mask();
    for (const u of SPECKLES) {
      const i = Math.trunc(u * (SAMPLES - 1));
      const [sx, sy] = project(pose.view, spine.x[i], spine.y[i] + spine.radius[i] * 0.45, spine.z[i]);
      spots.addDisc(sx, sy, 0.8);
    }
    canvas.fill(spots, C.bodyLo);
  };
  parts.push([
    0,
    () => {
      drawBody(canvas, pose, spine, k);
      speckles();
      drawBands(
        canvas,
        pose.view,
        spine,
        bandPositions(BANDS_FROM, BAND_GAP, k, traits.marks),
        tubeMask(canvas, pose.view, spine, () => true),
        C.gill,
      );
    },
  ]);
  for (const side of [1, -1]) {
    const z = side * LIMB_OFFSET * k;
    const near = side * cosYaw > 0;
    const limb = { fill: near ? C.body : C.bodyLo, claw: C.toe, line: C.line };
    const beat = side * paddle * 2;
    const arm = [
      [8, -4],
      [10 + beat * 0.5, -7],
      [12 + beat, -8.5],
    ].map(([x, y]) => [x * k, y * k]);
    const leg = [
      [-6, -3.5],
      [-8 - beat * 0.5, -6.5],
      [-10 - beat, -8.5],
    ].map(([x, y]) => [x * k, y * k]);
    parts.push([8 * sinYaw + z * cosYaw, () => drawLimb(canvas, pose.view, arm, z, 2 * k, 1.1 * k, limb)]);
    parts.push([-6 * sinYaw + z * cosYaw, () => drawLimb(canvas, pose.view, leg, z, 2.3 * k, 1.2 * k, limb)]);
    // Facing the viewer both sets show beside the head; side-on the far set sits behind the body.
    parts.push([side * cosYaw * 16 + sinYaw * 13, () => drawGills(canvas, pose, side, joint, k)]);
  }
  parts.push([12, () => drawHead(canvas, pose, joint)]);

  parts.sort((a, b) => a[0] - b[0]);
  for (const [, draw] of parts) draw();

  canvas.strengthenEdges([[C.line, C.rim]]);
  return canvas;
}

function spriteOffset(pose: Pose, k: number): Point {
  const glide = 1.2 * k * Math.sin(pose.swim * 0.5);
  return [round(pose.x) - ORIGIN, round(pose.y + glide) - ORIGIN];
}

const prepare = perTraits((traits): { poses: Pose[]; bubbles: Spark[] } => {
  const k = STAGE_SCALE[traits.stage];
  const poses = buildPoses(traits);
  const bubbles = makeSparks(
    BUBBLES,
    FRAMES,
    (birth) => {
      const pose = poses[birth];
      const [ox, oy] = spriteOffset(pose, k);
      const [hx, hy] = project(pose.view, 30 * k, 2 * k, 0);
      return [hx + ox, hy + oy];
    },
    { life: [22, 44], vx: [-0.12, 0.12], vy: [-0.55, -0.3] },
  );
  return { poses, bubbles };
});

function draw(index: number, traits: Traits): Uint8Array {
  const { poses, bubbles } = prepare(traits);
  const frame = new Canvas(WIDTH, HEIGHT);
  forEachSpark(bubbles, index, FRAMES, (x, y, age) => {
    const inFrame = (px: number, py: number) =>
      px >= MARGIN && px < WIDTH - MARGIN && py >= MARGIN && py < HEIGHT - MARGIN;
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
      if (inFrame(px, py)) frame.pixels[py * WIDTH + px] = C.bubble;
    }
  });
  const pose = poses[index];
  const [ox, oy] = spriteOffset(pose, STAGE_SCALE[traits.stage]);
  renderSprite(pose, traits).stampOnto(frame, ox, oy, MARGIN);
  return frame.pixels;
}

export const axolotl = defineCritter({
  id: "axolotl",
  name: "Axolotl",
  blurb: "Swims around smiling, with feathery gills and a trail of bubbles.",
  alt: "Animated pixel art of a smiling axolotl with feathery gills, swimming around the frame and blowing bubbles",
  width: WIDTH,
  height: HEIGHT,
  frames: FRAMES,
  delayMs: 60,
  poster: 30,
  colourNames: COLOUR_NAMES,
  bodyColour: "body",
  accentColours: ["gill", "gillHi", "bubble"],
  fixedColours: ["eye", "white", "blush"],
  edgeColours: ["rim", "gill", "gillHi", "bubble"],
  colourways: [
    {
      id: "blossom",
      name: "Blossom",
      colours: {
        rim: "#c0507e",
        line: "#6e2348",
        body: "#ffa8c6",
        bodyHi: "#ffd0e0",
        bodyLo: "#ec7ea6",
        belly: "#fff0f4",
        bellyLo: "#ffd3e0",
        fin: "#ffc7da",
        gill: "#e0407f",
        gillHi: "#ff7fb0",
        blush: "#ff7fa8",
        eye: "#2a1020",
        white: "#ffffff",
        toe: "#fff0f4",
        bubble: "#4fa8e0",
      },
    },
    {
      id: "gold",
      name: "Gold",
      colours: {
        rim: "#b57a12",
        line: "#6b4408",
        body: "#ffd35c",
        bodyHi: "#ffe89a",
        bodyLo: "#eeb02f",
        belly: "#fff8dc",
        bellyLo: "#ffe9a8",
        fin: "#ffe48a",
        gill: "#e8691f",
        gillHi: "#ff9a4d",
        blush: "#ff9d5c",
        eye: "#2c1a06",
        white: "#ffffff",
        toe: "#fff8dc",
        bubble: "#3f9fd8",
      },
    },
    {
      id: "dusk",
      name: "Dusk",
      colours: {
        rim: "#7a68c4",
        line: "#2c2358",
        body: "#6c5bb0",
        bodyHi: "#9484d6",
        bodyLo: "#51428f",
        belly: "#c9bff0",
        bellyLo: "#a699de",
        fin: "#8d7dd0",
        gill: "#d65ca8",
        gillHi: "#f28ccb",
        blush: "#b86bc4",
        eye: "#100a24",
        white: "#ffffff",
        toe: "#c9bff0",
        bubble: "#4fa8e0",
      },
    },
  ],
  draw,
});
