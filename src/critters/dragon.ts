import { drawLimb, drawTube, forEachSpark, makeSparks } from "../engine/body.ts";
import type { Spark, Spine } from "../engine/body.ts";
import { Canvas, flipArt, parseArt } from "../engine/canvas.ts";
import type { Art } from "../engine/canvas.ts";
import { colourIndexes, defineCritter } from "../engine/critter.ts";
import type { Point } from "../engine/mask.ts";
import {
  clamp,
  cumulativePhase,
  flightPath,
  gradient,
  openSpline,
  project,
  round,
  smooth,
  TAU,
  yawFromTravel,
} from "../engine/motion.ts";
import type { View } from "../engine/motion.ts";

const WIDTH = 180;
const HEIGHT = 120;
const FRAMES = 200;
const MARGIN = 2;
const FLAP_CYCLES = 24;
const SWAY_CYCLES = 12;
const EMBERS = 44;
const LOCAL = 140; // size of the canvas each sprite is drawn on
const ORIGIN = LOCAL / 2;
const ELEVATION = 0.25;
const REST_YAW = (14 * Math.PI) / 180; // a little three-quarter, so both wings show

const WAYPOINTS: readonly Point[] = [
  [44, 92],
  [72, 62],
  [104, 78],
  [137, 50],
  [140, 88],
  [110, 96],
  [82, 84],
  [92, 52],
  [66, 47],
  [40, 62],
];

const COLOUR_NAMES = [
  "rim", // silhouette edge: must read on light and dark pages
  "line", // lines between parts of the body
  "body",
  "bodyHi",
  "bodyLo",
  "belly",
  "bellyLo",
  "wingHi",
  "wing",
  "wingLo",
  "wingFar",
  "wingFarLo",
  "horn",
  "hornLo",
  "eye",
  "white",
  "fireOuter",
  "fireMid",
  "fireInner",
  "fireCore",
] as const;
const C = colourIndexes(COLOUR_NAMES);

const ART_KEY = {
  o: C.body,
  h: C.bodyHi,
  s: C.bodyLo,
  c: C.belly,
  d: C.bellyLo,
  f: C.wing,
  g: C.wingLo,
  i: C.horn,
  j: C.hornLo,
  k: C.eye,
  n: C.line,
  w: C.white,
};

const HEAD_SIDE = parseArt(
  `
ff........................
.fff.....ooooo............
..ffff.oohhhhhoo..........
...ffffohhnnhhhoo.........
fff.gggoooonnnhooo........
.ffffgooooowwknnooooo.ii..
..fffgooooowkkkooooooiij..
...gggooooowkkkoooooooooo.
.....ggooooooooooooooooono
......gooooonnoooooooooooo
......sooooooonnnnnnnnnnnn
.......sssoooocccccwcccc..
.........ssssccccccccccc..
...........sssddddddddd...
..............dddddd......
`,
  ART_KEY,
);
const HEAD_SIDE_ANCHOR: Point = [9, 10]; // the pixel that sits on the end of the neck
const HEAD_SIDE_EYE_ROWS = [5, 8] as const;

const HEAD_FRONT = parseArt(
  `
.....................
f...................f
ff.....ooooooo.....ff
.ff..oohhhhhhhoo..ff.
.fffoohhhhhhhhhoofff.
..ggoooohhhhhoooogg..
f.ggonnnooooonnnogg.f
.ffgowkkooooowkkogff.
..fgokkkooiookkkogf..
...goohhhhihhhhoog...
....oohhnhhhnhhoo....
....sohhhhhhhhhos....
.....sooooooooos.....
.....ssnnnnnnnss.....
......scccccccs......
.......ddddddd.......
`,
  ART_KEY,
);
const HEAD_FRONT_ANCHOR: Point = [10, 11];

function withEyeShut(art: Art): Art {
  const pixels = art.pixels.slice();
  const [first, last] = HEAD_SIDE_EYE_ROWS;
  const columns = new Set<number>();
  for (let y = first; y < last; y++) {
    for (let x = 0; x < art.width; x++) {
      const at = y * art.width + x;
      if (pixels[at] === C.white || pixels[at] === C.eye) {
        pixels[at] = C.body;
        columns.add(x);
      }
    }
  }
  for (const x of columns) pixels[(first + 1) * art.width + x] = C.line;
  return { ...art, pixels };
}

const HEADS = {
  side: HEAD_SIDE,
  sideLeft: flipArt(HEAD_SIDE),
  blink: withEyeShut(HEAD_SIDE),
  blinkLeft: flipArt(withEyeShut(HEAD_SIDE)),
  front: HEAD_FRONT,
};

// (forward, up, radius) from the base of the skull to the tip of the tail.
const SPINE = [
  [15.0, 14.0, 3.0],
  [12.0, 9.0, 3.8],
  [7.5, 3.0, 6.2],
  [1.0, 0.5, 7.2],
  [-6.0, -0.5, 6.0],
  [-12.5, -2.0, 4.4],
  [-19.0, -3.0, 3.2],
  [-25.5, -2.5, 2.3],
  [-30.5, 1.5, 1.6],
  [-32.5, 7.0, 1.1],
];
const SAMPLES = 90;
const CHEST = 2 / 9; // fractions of the way along SPINE
const HIP = 4 / 9;
const SPIKES_AT = [0.1, 0.18, 0.55, 0.66, 0.77];
const [SPINE_X, SPINE_Y, SPINE_R] = openSpline(SPINE, SAMPLES);
const SPINE_U = Float64Array.from({ length: SAMPLES }, (_, i) => i / (SAMPLES - 1));
const TAIL_WEIGHT = SPINE_U.map((u) => clamp((u - HIP) / (1 - HIP), 0, 1) ** 1.5);
const NECK_WEIGHT = SPINE_U.map((u) => clamp((CHEST - u) / CHEST, 0, 1));

// Wing bones as (along the body, out along the span).
const WING_WRIST: Point = [8, 15];
const WING_TIPS: readonly Point[] = [
  [0, 34],
  [-14, 31],
  [-24, 22],
  [-28, 10],
];
const WING_ROOT: Point = [-15, 0];
const WING_DROOP = 0.22; // the trailing edge hangs below the leading edge
const SHOULDER = [3, 6, 3] as const;

const ARM = [
  [7, -3],
  [10, -6],
  [13, -6.5],
];
const LEG = [
  [-6, -3.5],
  [-10, -8],
  [-15, -9.5],
];
const LIMB_OFFSET = 4.5; // how far the limbs sit from the body's centre line

interface Pose {
  t: number;
  x: number;
  y: number;
  vx: number;
  flap: number;
  /** 0.45 when gliding, 1 when climbing. */
  lift: number;
  sway: number;
  blink: boolean;
  view: View;
}

function buildPoses(): Pose[] {
  const { x, y, vx, vy } = flightPath(WAYPOINTS, FRAMES);
  const yaw = yawFromTravel(vx, REST_YAW, 0.7, 7);
  const pitch = smooth(vy.map((v) => clamp(-v * 0.24, -0.3, 0.3)), 9);
  const climb = smooth(vy.map((v) => clamp(-v / 1.2, -1, 1)), 9);
  // Beat faster on the way up, keeping a whole number of beats per loop.
  const flap = cumulativePhase(climb.map((c) => 1 + 0.4 * c), FLAP_CYCLES);
  const blinks = new Set([28, 29, 30, 36, 37, 38, 128, 129, 130]);
  return Array.from({ length: FRAMES }, (_, i) => ({
    t: i / FRAMES,
    x: x[i],
    y: y[i],
    vx: vx[i],
    flap: flap[i],
    lift: clamp(0.75 + 0.35 * climb[i], 0.45, 1),
    sway: (TAU * SWAY_CYCLES * i) / FRAMES,
    blink: blinks.has(i),
    view: { yaw: yaw[i], pitch: pitch[i], elevation: ELEVATION, origin: ORIGIN },
  }));
}

/** The spine this frame, in model space: the tail sways and the neck nods. */
function animatedSpine(pose: Pose): Spine {
  const y = new Float64Array(SAMPLES);
  const z = new Float64Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) {
    const tail = TAIL_WEIGHT[i];
    y[i] =
      SPINE_Y[i] +
      tail * 3.2 * Math.sin(pose.sway - 3 * tail) +
      NECK_WEIGHT[i] * Math.sin(pose.flap + 1.2);
    z[i] = tail * 2.5 * Math.sin(pose.sway + 1);
  }
  return { x: SPINE_X, y, z, radius: SPINE_R };
}

function tailTip(pose: Pose, spine: Spine): Point {
  const last = SAMPLES - 1;
  return project(pose.view, spine.x[last], spine.y[last], spine.z[last]);
}

const TUBE = { fill: C.body, low: C.bodyLo, high: C.bodyHi, belly: C.belly, bellyLow: C.bellyLo, line: C.line };

function drawChain(canvas: Canvas, pose: Pose, spine: Spine, include: (u: number) => boolean): void {
  drawTube(canvas, pose.view, spine, TUBE, (i) => include(SPINE_U[i]), (i) => SPINE_U[i] < 0.82);
}

function drawSpikes(canvas: Canvas, pose: Pose, spine: Spine): void {
  const { x, y, z } = spine;
  const dx = gradient(x);
  const dy = gradient(y);
  const mask = canvas.mask();
  for (const u of SPIKES_AT) {
    const j = Math.trunc(u * (SAMPLES - 1));
    const length = Math.hypot(dx[j], dy[j]);
    const alongX = dx[j] / length; // toward the tail
    const alongY = dy[j] / length;
    const backX = alongY;
    const backY = -alongX;
    const r = SPINE_R[j];
    const height = 1.4 + r * 0.3;
    const halfWidth = 1 + r * 0.14;
    const corner = (side: number) =>
      project(
        pose.view,
        x[j] + backX * r * 0.7 + side * alongX * halfWidth,
        y[j] + backY * r * 0.7 + side * alongY * halfWidth,
        z[j],
      );
    const tip = project(
      pose.view,
      x[j] + backX * (r + height) + alongX * height * 0.5,
      y[j] + backY * (r + height) + alongY * height * 0.5,
      z[j],
    );
    mask.addPolygon([corner(-1), tip, corner(1)]);
  }
  canvas.sticker(mask, C.wing, C.line);
}

/** A bat-like wing: an arm, fingers fanning from the wrist, scalloped skin. */
function drawWing(canvas: Canvas, pose: Pose, side: number): void {
  // Full strokes under power; held high and nearly still when gliding.
  let power = clamp((pose.lift - 0.45) / 0.25, 0, 1);
  power = power * power * (3 - 2 * power);
  const amplitude = ((12 + 38 * power) * Math.PI) / 180;
  const centre = ((46 - 24 * power) * Math.PI) / 180;
  const inner = centre + amplitude * Math.sin(pose.flap);
  // The outer half lags the inner half, so each beat ripples out to the tip.
  const outer = centre + (6 * Math.PI) / 180 + 1.15 * amplitude * Math.sin(pose.flap - 0.85);

  const point = ([along, span]: Point): Point => {
    const spanIn = Math.min(span, WING_WRIST[1]);
    const spanOut = Math.max(0, span - WING_WRIST[1]);
    const up = spanIn * Math.sin(inner) + spanOut * Math.sin(outer);
    const out = spanIn * Math.cos(inner) + spanOut * Math.cos(outer);
    return project(
      pose.view,
      SHOULDER[0] + along,
      SHOULDER[1] + up + Math.min(along, 0) * WING_DROOP,
      side * (SHOULDER[2] + out),
    );
  };

  const near = side * Math.cos(pose.view.yaw) > 0;
  const shades = near
    ? [C.wingHi, C.wing, C.wingHi, C.wing]
    : [C.wingFar, C.wingFarLo, C.wingFar, C.wingFarLo];

  const shoulder = point([0, 0]);
  const wrist = point(WING_WRIST);
  const tips = WING_TIPS.map(point);
  const scallops = [...WING_TIPS.keys()].map((i) => {
    const [a0, s0] = WING_TIPS[i];
    const [a1, s1] = WING_TIPS[i + 1] ?? WING_ROOT;
    const midA = (a0 + a1) / 2;
    const midS = (s0 + s1) / 2;
    return point([midA + (WING_WRIST[0] - midA) * 0.28, midS + (WING_WRIST[1] - midS) * 0.28]);
  });

  const last = tips.length - 1;
  const panels = tips.map((tip, i) =>
    i < last
      ? canvas.mask().addPolygon([wrist, tip, scallops[i], tips[i + 1]])
      : canvas.mask().addPolygon([wrist, tip, scallops[i], point(WING_ROOT), shoulder]),
  );
  const arm = canvas.mask();
  for (let k = 0; k < 8; k++) {
    const f = k / 7;
    arm.addDisc(
      shoulder[0] + (wrist[0] - shoulder[0]) * f,
      shoulder[1] + (wrist[1] - shoulder[1]) * f,
      1.9 - 0.9 * f,
    );
  }
  const outlined = canvas.mask().add(arm);
  for (const panel of panels) outlined.add(panel);
  const fingers = canvas.mask();
  for (const tip of tips) fingers.addLine([wrist, tip]);

  // Seen edge-on the fingers would collapse into stripes, so leave them out.
  const edgeOn = Math.abs(tips[0][1] - wrist[1]) < 4;
  const bone = near ? C.body : C.bodyLo;
  const outline = outlined.grown();
  canvas.fill(outline, C.line);
  panels.forEach((panel, i) => canvas.fill(panel, edgeOn ? shades[1] : shades[i]));
  if (!edgeOn) {
    canvas.fill(fingers.grown().minus(outline), C.line);
    canvas.fill(fingers, bone);
  }
  canvas.fill(arm, bone);
}

/** Hand-drawn head art, held level like a real animal's as the body pitches. */
function drawHead(canvas: Canvas, pose: Pose, spine: Spine): void {
  const [hx, hy] = project(pose.view, spine.x[0], spine.y[0], spine.z[0]);
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
  canvas.stampArt(art, round(hx) - anchorX, round(hy) - anchorY, C.line);
}

/** Nested tongues of fire that lean away from the direction of travel. */
function drawFlame(canvas: Canvas, pose: Pose, spine: Spine): void {
  const [ox, oy] = tailTip(pose, spine);
  const lean = -clamp(pose.vx * 0.22, -1.1, 1.1);
  // [sideways reach, length, whole flickers per loop, phase]
  const tongues = [
    [0, 1, 31, 0],
    [-2.4, 0.62, 43, 1.7],
    [2.2, 0.7, 37, 3.1],
  ];
  const layers = [
    [C.fireOuter, 1],
    [C.fireMid, 0.72],
    [C.fireInner, 0.46],
    [C.fireCore, 0.22],
  ];
  for (const [colour, size] of layers) {
    const mask = canvas.mask();
    for (const [sideways, length, cycles, phase] of tongues) {
      const flicker = 0.85 + 0.15 * Math.sin(TAU * cycles * pose.t + phase);
      const reach = 16 * length * flicker * size ** 0.6;
      for (let n = 0; n < 14; n++) {
        const k = n / 13;
        const wiggle = k * 1.3 * Math.sin(TAU * (cycles + 11) * pose.t - 5 * k + phase);
        mask.addDisc(
          ox + k * (lean * reach + sideways) + wiggle,
          oy + (1 - size) * 2 - k * reach,
          4.2 * size * (1 - k) ** 0.75 + 0.35,
        );
      }
    }
    canvas.fill(mask, colour);
  }
}

function renderSprite(pose: Pose): Canvas {
  const canvas = new Canvas(LOCAL, LOCAL);
  const spine = animatedSpine(pose);
  const cosYaw = Math.cos(pose.view.yaw);
  const sinYaw = Math.sin(pose.view.yaw);

  // Painter's algorithm: each part is [depth, draw], drawn far to near.
  const parts: [number, () => void][] = [[-0.5, () => drawSpikes(canvas, pose, spine)]];
  let tailDepth: number;
  if (Math.abs(cosYaw) > 0.5) {
    tailDepth = 0;
    parts.push([0, () => drawChain(canvas, pose, spine, () => true)]);
  } else {
    // Facing the viewer, the tail passes behind the body and the neck in front.
    tailDepth = -8;
    parts.push([-8, () => drawChain(canvas, pose, spine, (u) => u >= HIP)]);
    parts.push([0, () => drawChain(canvas, pose, spine, (u) => u >= CHEST && u <= HIP + 0.02)]);
    parts.push([8, () => drawChain(canvas, pose, spine, (u) => u <= CHEST + 0.02)]);
  }
  for (const side of [1, -1]) {
    parts.push([side * cosYaw * 15 - sinYaw * 5, () => drawWing(canvas, pose, side)]);
    const near = side * cosYaw > 0;
    const limb = { fill: near ? C.body : C.bodyLo, claw: near ? C.horn : C.hornLo, line: C.line };
    const z = side * LIMB_OFFSET;
    parts.push([ARM[0][0] * sinYaw + z * cosYaw, () => drawLimb(canvas, pose.view, ARM, z, 2.3, 1.3, limb)]);
    parts.push([LEG[0][0] * sinYaw + z * cosYaw, () => drawLimb(canvas, pose.view, LEG, z, 3.6, 1.6, limb)]);
  }
  parts.push([12, () => drawHead(canvas, pose, spine)]);
  parts.push([tailDepth + 0.5, () => drawFlame(canvas, pose, spine)]);

  parts.sort((a, b) => a[0] - b[0]);
  for (const [, draw] of parts) draw();

  canvas.strengthenEdges([
    [C.line, C.rim],
    [C.fireInner, C.fireOuter],
    [C.fireCore, C.fireOuter],
  ]);
  return canvas;
}

function spriteOffset(pose: Pose): Point {
  const bob = 1.5 * pose.lift * Math.sin(pose.flap);
  return [round(pose.x) - ORIGIN, round(pose.y + bob) - ORIGIN];
}

let prepared: { poses: Pose[]; embers: Spark[] } | undefined;

function prepare() {
  if (!prepared) {
    const poses = buildPoses();
    const embers = makeSparks(
      EMBERS,
      FRAMES,
      (birth) => {
        const [ox, oy] = spriteOffset(poses[birth]);
        const [tipX, tipY] = tailTip(poses[birth], animatedSpine(poses[birth]));
        return [tipX + ox, tipY + oy - 6];
      },
      { life: [8, 17], vx: [-0.35, 0.35], vy: [-0.8, -0.35] },
    );
    prepared = { poses, embers };
  }
  return prepared;
}

function draw(index: number): Uint8Array {
  const { poses, embers } = prepare();
  const frame = new Canvas(WIDTH, HEIGHT);
  forEachSpark(embers, index, FRAMES, (x, y, age) => {
    if (x >= MARGIN && x < WIDTH - MARGIN && y >= MARGIN && y < HEIGHT - MARGIN) {
      frame.pixels[y * WIDTH + x] = age < 0.5 ? C.fireMid : C.fireOuter;
    }
  });
  const pose = poses[index];
  const [ox, oy] = spriteOffset(pose);
  renderSprite(pose).stampOnto(frame, ox, oy, MARGIN);
  return frame.pixels;
}

export const dragon = defineCritter({
  id: "dragon",
  name: "Dragon",
  blurb: "Flaps, soars and turns to look at you, with a flame for a tail tip.",
  alt: "Animated pixel art of a dragon with a flaming tail, flapping its wings as it wanders around the frame",
  width: WIDTH,
  height: HEIGHT,
  frames: FRAMES,
  delayMs: 60,
  poster: 46,
  colourNames: COLOUR_NAMES,
  colourways: [
    {
      id: "ember",
      name: "Ember",
      colours: {
        rim: "#b4451a",
        line: "#5e2110",
        body: "#f58a2c",
        bodyHi: "#ffb65c",
        bodyLo: "#d4641f",
        belly: "#ffe6ad",
        bellyLo: "#f0bd7a",
        wingHi: "#e65a45",
        wing: "#c93a3c",
        wingLo: "#9c2a3c",
        wingFar: "#a02f3e",
        wingFarLo: "#7f2536",
        horn: "#fff3d0",
        hornLo: "#e3c48c",
        eye: "#2a1408",
        white: "#ffffff",
        fireOuter: "#e9401c",
        fireMid: "#ff8a1f",
        fireInner: "#ffd23d",
        fireCore: "#fff6c2",
      },
    },
    {
      id: "frost",
      name: "Frost",
      colours: {
        rim: "#2f6fb0",
        line: "#173a6b",
        body: "#59a8e8",
        bodyHi: "#a7dcff",
        bodyLo: "#3a7fc9",
        belly: "#e6f6ff",
        bellyLo: "#b5dcf2",
        wingHi: "#6f7fe0",
        wing: "#4f5bc4",
        wingLo: "#3b3f99",
        wingFar: "#434aa8",
        wingFarLo: "#33377f",
        horn: "#f2fbff",
        hornLo: "#b9d6e8",
        eye: "#0f2240",
        white: "#ffffff",
        fireOuter: "#2a7de1",
        fireMid: "#45b4f5",
        fireInner: "#a8ecff",
        fireCore: "#f0fdff",
      },
    },
    {
      id: "moss",
      name: "Moss",
      colours: {
        rim: "#3f7d2a",
        line: "#1f4316",
        body: "#6fbf3f",
        bodyHi: "#a6e070",
        bodyLo: "#4d9a2b",
        belly: "#f2f5c2",
        bellyLo: "#d3dc8a",
        wingHi: "#2fa98c",
        wing: "#1f8a78",
        wingLo: "#176b66",
        wingFar: "#1c7a6e",
        wingFarLo: "#155a58",
        horn: "#fbf7d6",
        hornLo: "#d7cf94",
        eye: "#16240c",
        white: "#ffffff",
        fireOuter: "#2f9e2f",
        fireMid: "#67c93a",
        fireInner: "#c8f25a",
        fireCore: "#f6ffd0",
      },
    },
  ],
  draw,
});
