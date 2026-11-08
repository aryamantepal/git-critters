import { forEachSpark, makeSparks } from "../engine/body.ts";
import type { Spark } from "../engine/body.ts";
import { Canvas } from "../engine/canvas.ts";
import { colourIndexes, defineCritter } from "../engine/critter.ts";
import type { Mask, Point } from "../engine/mask.ts";
import { clamp, round, scatter, smooth, TAU } from "../engine/motion.ts";
import { blinkFrames, cyclesFor, perTraits, roam, STAGE_SCALE } from "../engine/traits.ts";
import type { Traits } from "../engine/traits.ts";

const WIDTH = 180;
const HEIGHT = 120;
const FRAMES = 200;
const MARGIN = 2;
const HOPS = 8; // whole hops per loop
const BREATHS = 7;
const SWAYS = 5;
const LOCAL = 90;
const ORIGIN = LOCAL / 2;
const CAP_WIDTH = 18;
const CAP_HEIGHT = 13;
const CAP_RIM = -3; // where the edge of the cap sits, from the middle of the sprite
const STEM_TOP = -4;
const FEET = 13; // the soles of its feet
const AMBIENT_SPORES = 20;
const BURST_SPORES = 30;
const SPORE_DRAG = 0.93;
const CLOUD_FRAMES = 9;

// It walks to the middle of the frame, crouches, hops and puffs out its spores.
const ANCHOR: Point = [92, 66];
const HOLD_FROM = 94;
const HOLD_TO = 134;
const HOLD_EASE = 18;
const CROUCH = 98;
const LAUNCH = 108;
const PEAK = 114;
const LAND = 122;
const SETTLED = 132;
const BURST = 111;
const GLOW_FROM = 106;
const GLOW_TO = 128;

const WAYPOINTS: readonly Point[] = [
  [44, 56],
  [74, 38],
  [108, 50],
  [140, 40],
  [148, 70],
  [116, 80],
  [88, 62],
  [58, 80],
  [34, 70],
];

// The big spots on the cap at full size, as [across, up, across-radius, up-radius] from the middle.
const SPOTS: readonly (readonly number[])[] = [
  [-9, -8.5, 3.6, 2.8],
  [4, -11.5, 2.8, 2.2],
  [11, -6.5, 3.2, 2.4],
];
// Freckles that come with marks, at full size, as [across, up].
const MARKS: readonly (readonly Point[])[] = [
  [],
  [[-2, -6.5]],
  [
    [-2, -6.5],
    [-15, -5.5],
  ],
  [
    [-2, -6.5],
    [-15, -5.5],
    [16, -4.5],
  ],
];
// How far apart the eyes sit, by stage: a small face needs them closer.
const EYE_GAP = [1, 2, 2, 3];

const COLOUR_NAMES = [
  "rim",
  "line",
  "cap",
  "capHi",
  "capLo",
  "spot",
  "spotHi",
  "stem",
  "stemHi",
  "stemLo",
  "eye",
  "white",
  "blush",
  "mouth",
  "spore",
] as const;
const C = colourIndexes(COLOUR_NAMES);

interface Pose {
  x: number;
  y: number;
  /** Where it's looking: negative is left, positive is right. */
  look: number;
  /** How far the cap tips the way it's going. */
  lean: number;
  /** 1 standing, below 1 squashed, above 1 stretched. */
  tall: number;
  /** Eyes squeezed shut for the push. */
  squeeze: boolean;
  /** Mouth open for the puff. */
  open: boolean;
  /** The spots light up. */
  glow: boolean;
  blink: boolean;
  /** Flips every frame, so the biggest spot always sparkles a little. */
  twinkle: boolean;
}

const smoothstep = (t: number) => t * t * (3 - 2 * t);
const between = (i: number, from: number, to: number) => clamp((i - from) / (to - from), 0, 1);

/** 0 when it's wandering, 1 while it's parked in the middle for the puff. */
function holdAt(i: number): number {
  return smoothstep(between(i, HOLD_FROM - HOLD_EASE, HOLD_FROM)) * (1 - smoothstep(between(i, HOLD_TO, HOLD_TO + HOLD_EASE)));
}

/** How squashed and how high it is through the crouch, the spring and the landing. */
function puffAt(i: number): { tall: number; lift: number } {
  if (i < CROUCH || i >= SETTLED) return { tall: 1, lift: 0 };
  if (i < LAUNCH) return { tall: 1 - 0.22 * smoothstep(between(i, CROUCH, LAUNCH)), lift: 0 };
  if (i < PEAK) {
    const t = between(i, LAUNCH, PEAK);
    return { tall: 0.78 + 0.4 * smoothstep(t), lift: 1 - (1 - t) ** 2 };
  }
  if (i < LAND) {
    const t = between(i, PEAK, LAND);
    return { tall: 1.18 - 0.3 * smoothstep(t), lift: 1 - t * t };
  }
  const t = between(i, LAND, SETTLED);
  return { tall: 1 - 0.12 * Math.cos(t * TAU * 1.5) * (1 - t), lift: 0 };
}

function buildPoses({ mood, stage }: Traits): Pose[] {
  const k = STAGE_SCALE[stage];
  const roamed = roam(WAYPOINTS, mood, FRAMES);
  const x = roamed.x.map((v, i) => v + (ANCHOR[0] - v) * holdAt(i));
  const y = roamed.y.map((v, i) => v + (ANCHOR[1] - v) * holdAt(i));
  const vx = x.map((_, i) => (x[(i + 1) % FRAMES] - x[(i + FRAMES - 1) % FRAMES]) / 2);
  const look = smooth(vx.map((v) => clamp(v * 2.4, -2 * k, 2 * k)), 13);
  const lean = smooth(vx.map((v) => clamp(v * 1.2, -2 * k, 2 * k)), 21);
  const blinks = blinkFrames(mood, [30, 62, 170], FRAMES);
  const hops = cyclesFor(mood, HOPS);
  const breaths = cyclesFor(mood, BREATHS);
  const sways = cyclesFor(mood, SWAYS);
  return Array.from({ length: FRAMES }, (_, i) => {
    const free = 1 - holdAt(i);
    const phase = (hops * i) / FRAMES;
    const air = 4 * (phase % 1) * (1 - (phase % 1));
    const puff = puffAt(i);
    return {
      x: x[i],
      y: y[i] - free * 6 * k * air - puff.lift * 7 * k + 0.9 * k * Math.sin((TAU * sways * i) / FRAMES),
      look: look[i],
      lean: lean[i],
      tall: (1 + free * (0.1 * (2 * Math.sqrt(air) - 1)) + 0.035 * Math.sin((TAU * breaths * i) / FRAMES)) * puff.tall,
      squeeze: i >= CROUCH + 2 && i < BURST,
      open: i >= LAUNCH && i < LAND,
      glow: i >= GLOW_FROM && i < GLOW_TO,
      blink: blinks.has(i),
      twinkle: i % 2 === 0,
    };
  });
}

function addEllipse(mask: Mask, cx: number, cy: number, rx: number, ry: number): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) mask.addPixel(x, y);
    }
  }
}

function drawStem(canvas: Canvas, pose: Pose, k: number): Mask {
  const stem = canvas.mask();
  const base = FEET * k;
  const sx = 1 / Math.sqrt(pose.tall);
  const top = STEM_TOP * k;
  const bottom = 11 * k;
  for (let row = Math.floor(top * 0.5 - 12 * k); row <= base + 1; row++) {
    const y = base - (base - row) / pose.tall;
    if (y < top || y > bottom) continue;
    const t = (y - top) / (bottom - top);
    const round2 = Math.max(0, y - (bottom - 2.2 * k)) * 0.9;
    const half = ((6.6 + 1.8 * t * t) * k - round2) * sx;
    for (let x = Math.ceil(-half); x <= half; x++) stem.addPixel(ORIGIN + x, ORIGIN + row);
  }
  const feet = canvas.mask();
  for (const side of [-1, 1]) {
    addEllipse(feet, ORIGIN + side * 4.4 * k * sx, ORIGIN + base - 1.2 * k, Math.max(1.6, 2.6 * k) * sx, Math.max(1.3, 1.8 * k));
  }
  canvas.sticker(stem.add(feet), C.stem, C.line);
  canvas.fill(feet.minus(stem), C.stemLo);
  canvas.fill(stem.minus(stem.moved(-2, 0)), C.stemLo);
  canvas.fill(stem.minus(stem.moved(1, 1)), C.stemHi);
  return stem;
}

function drawCap(canvas: Canvas, pose: Pose, stem: Mask, k: number): Mask {
  const cap = canvas.mask();
  const base = FEET * k;
  const sx = 1 / Math.sqrt(pose.tall);
  const rim = CAP_RIM * k;
  const height = CAP_HEIGHT * k;
  const width = CAP_WIDTH * k;
  const shift = round(pose.lean);
  for (let row = Math.floor(rim - height * 1.4); row <= rim + 2 * k + 1; row++) {
    const y = base - (base - row) / pose.tall;
    if (y > rim || rim - y > height) continue;
    const dome = Math.sqrt(Math.max(0, 1 - ((rim - y) / height) ** 2));
    const half = width * dome * sx;
    for (let x = Math.ceil(-half); x <= half; x++) {
      const across = Math.abs(x) / (width * sx);
      // The underside curves down at the edges, so the cap overhangs the stem.
      if (y <= rim - 2.4 * k * (1 - across * across)) cap.addPixel(ORIGIN + x + shift, ORIGIN + row);
    }
  }
  // Shade the stem just under the cap before the cap is drawn over it.
  canvas.fill(stem.and(cap.moved(0, Math.max(2, round(3 * k)))), C.stemLo);
  canvas.sticker(cap, C.cap, C.line);
  canvas.fill(cap.minus(cap.moved(-2, -2)), C.capLo);
  canvas.fill(cap.minus(cap.moved(1, 2)), C.capHi);
  // The underside of the rim, a little darker than the rest.
  canvas.fill(cap.minus(cap.moved(0, -2)), C.capLo);
  return cap;
}

function drawSpots(canvas: Canvas, pose: Pose, cap: Mask, k: number, marks: number): void {
  const base = FEET * k;
  const sx = 1 / Math.sqrt(pose.tall);
  const shift = round(pose.lean);
  const spots = canvas.mask();
  const place = (across: number, up: number, rx: number, ry: number) => {
    const row = base - (base - up * k) * pose.tall;
    addEllipse(spots, ORIGIN + across * k * sx + shift, ORIGIN + row, Math.max(1.2, rx * k) * sx, Math.max(1, ry * k * pose.tall));
  };
  for (const [across, up, rx, ry] of SPOTS) place(across, up, rx, ry);
  for (const [across, up] of MARKS[marks]) place(across, up, 1.1, 0.9);
  // Spots stay a pixel inside the cap, so they never touch its outline.
  const inside = cap.minus(cap.grown().minus(cap)).minus(cap.minus(cap.moved(-1, -1))).minus(cap.minus(cap.moved(1, 1)));
  const visible = spots.and(inside);
  if (pose.glow) {
    canvas.fill(visible.grown().and(cap).minus(visible), C.spot);
    canvas.fill(visible, C.spotHi);
  } else {
    canvas.fill(visible, C.spot);
    canvas.fill(visible.minus(visible.moved(1, 1)), C.spotHi);
  }
  const [across, up] = SPOTS[0];
  const twinkle = canvas.mask().addPixel(ORIGIN + round(across * k * sx) + shift, ORIGIN + round(base - (base - up * k) * pose.tall));
  canvas.fill(twinkle.and(visible), pose.twinkle === pose.glow ? C.spot : C.spotHi);
}

function drawFace(canvas: Canvas, pose: Pose, stem: Mask, k: number, stage: number): void {
  const cx = ORIGIN + round(pose.look);
  const base = FEET * k;
  const cy = ORIGIN + round(base - (base - 2.4 * k) * pose.tall);
  const gap = EYE_GAP[stage];
  const tall = stage === 0 ? 2 : 3;
  const eyes = canvas.mask();
  const glints = canvas.mask();
  for (const side of [-1, 1]) {
    const left = side < 0 ? cx - gap - 2 : cx + gap;
    if (pose.squeeze) {
      // Happy squeezed eyes, a little chevron.
      if (side < 0) eyes.addPixel(left, cy + 1).addPixel(left + 1, cy);
      else eyes.addPixel(left, cy).addPixel(left + 1, cy + 1);
      continue;
    }
    if (pose.blink) {
      eyes.addPixel(left, cy + 1).addPixel(left + 1, cy + 1);
      continue;
    }
    for (let y = 0; y < tall; y++) {
      eyes.addPixel(left, cy + y).addPixel(left + 1, cy + y);
    }
    glints.addPixel(left, cy);
  }
  canvas.fill(eyes.and(stem), C.eye);
  canvas.fill(glints.and(stem), C.white);

  const blush = canvas.mask();
  for (const side of [-1, 1]) {
    const bx = side < 0 ? cx - gap - 4 : cx + gap + 3;
    blush.addPixel(bx, cy + tall).addPixel(bx + 1, cy + tall);
  }
  if (stage > 0) canvas.fill(blush.and(stem), C.blush);

  const mouth = canvas.mask();
  const my = cy + tall + (stage === 0 ? 1 : 2);
  if (pose.open) {
    mouth.addPixel(cx - 1, my).addPixel(cx, my).addPixel(cx - 1, my + 1).addPixel(cx, my + 1);
    canvas.fill(mouth.and(stem), C.mouth);
  } else if (stage > 0) {
    mouth.addPixel(cx - 1, my).addPixel(cx, my + 1).addPixel(cx + 1, my);
    canvas.fill(mouth.and(stem), C.mouth);
  } else {
    mouth.addPixel(cx, my);
    canvas.fill(mouth.and(stem), C.mouth);
  }
}

function renderSprite(pose: Pose, traits: Traits): Canvas {
  const k = STAGE_SCALE[traits.stage];
  const canvas = new Canvas(LOCAL, LOCAL);
  const stem = drawStem(canvas, pose, k);
  drawFace(canvas, pose, stem, k, traits.stage);
  const cap = drawCap(canvas, pose, stem, k);
  drawSpots(canvas, pose, cap, k, traits.marks);
  canvas.strengthenEdges([[C.line, C.rim]]);
  return canvas;
}

function spriteOffset(pose: Pose): Point {
  return [round(pose.x) - ORIGIN, round(pose.y) - ORIGIN];
}

interface Burst {
  birth: number;
  life: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** Spores thrown up and out of the cap that slow down and drift. */
function makeBurst(poses: readonly Pose[], k: number): Burst[] {
  return Array.from({ length: BURST_SPORES }, (_, n) => {
    const birth = BURST + (n % 3);
    const pose = poses[birth];
    const angle = -Math.PI * (0.04 + 0.92 * ((n * 0.618034) % 1));
    const speed = (0.7 + 1.9 * ((n * 7) % 11) / 10) * k;
    return {
      birth,
      life: 36 + round(scatter(n + 1, 0.56984) * 28),
      x: pose.x + Math.cos(angle) * 4 * k,
      y: pose.y - 14 * k + Math.sin(angle) * 3 * k,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
    };
  });
}

function burstAt(spore: Burst, age: number): Point {
  const travelled = (1 - SPORE_DRAG ** age) / (1 - SPORE_DRAG);
  return [round(spore.x + spore.vx * travelled), round(spore.y + spore.vy * travelled + 0.012 * age * age)];
}

const prepare = perTraits((traits): { poses: Pose[]; ambient: Spark[]; burst: Burst[] } => {
  const k = STAGE_SCALE[traits.stage];
  const poses = buildPoses(traits);
  const ambient = makeSparks(
    AMBIENT_SPORES,
    FRAMES,
    (birth) => {
      const pose = poses[birth];
      const side = birth % 2 === 0 ? -1 : 1;
      return [pose.x + side * (3 + (birth % 9)) * k, pose.y - 14 * k];
    },
    { life: [22, 40], vx: [-0.2, 0.2], vy: [-0.5, -0.2] },
  );
  return { poses, ambient, burst: makeBurst(poses, k) };
});

function draw(index: number, traits: Traits): Uint8Array {
  const { poses, ambient, burst } = prepare(traits);
  const frame = new Canvas(WIDTH, HEIGHT);
  const put = (x: number, y: number) => {
    if (x >= MARGIN && x < WIDTH - MARGIN && y >= MARGIN && y < HEIGHT - MARGIN) frame.pixels[y * WIDTH + x] = C.spore;
  };
  forEachSpark(ambient, index, FRAMES, (x, y, age) => {
    put(x, y);
    if (age < 0.5) put(x, y - 1);
  });
  for (const spore of burst) {
    const age = (index - spore.birth + FRAMES) % FRAMES;
    if (age >= spore.life) continue;
    const [x, y] = burstAt(spore, age);
    put(x, y);
    if (age < spore.life * 0.5) {
      put(x - 1, y);
      put(x + 1, y);
      put(x, y - 1);
      put(x, y + 1);
    }
  }
  // A puff of fog at the moment the spores leave.
  const since = index - BURST;
  if (since >= 0 && since < CLOUD_FRAMES) {
    const k = STAGE_SCALE[traits.stage];
    const { x, y } = poses[BURST];
    const radius = (3 + since * 0.9) * k + 1;
    for (let dy = -Math.ceil(radius); dy <= Math.ceil(radius); dy++) {
      for (let dx = -Math.ceil(radius * 1.5); dx <= Math.ceil(radius * 1.5); dx++) {
        if ((dx / 1.5) ** 2 + dy ** 2 <= radius * radius && (dx + dy + since) % 2 === 0) {
          put(round(x) + dx, round(y - 14 * k) + dy);
        }
      }
    }
  }
  const pose = poses[index];
  const [ox, oy] = spriteOffset(pose);
  renderSprite(pose, traits).stampOnto(frame, ox, oy, MARGIN);
  return frame.pixels;
}

export const mushroom = defineCritter({
  id: "mushroom",
  name: "Mushroom",
  blurb: "Hops about, and once a loop stops to puff out a cloud of sparkly spores.",
  alt: "Animated pixel art of a mushroom with a spotted cap hopping around the frame, then stopping to puff out a cloud of sparkly spores",
  width: WIDTH,
  height: HEIGHT,
  frames: FRAMES,
  delayMs: 60,
  poster: 118,
  colourNames: COLOUR_NAMES,
  bodyColour: "cap",
  accentColours: ["spot", "spotHi", "spore"],
  fixedColours: ["stem", "stemHi", "stemLo", "eye", "white", "blush", "mouth"],
  edgeColours: ["rim", "spore"],
  colourways: [
    {
      id: "umber",
      name: "Umber",
      colours: {
        rim: "#8f5a33",
        line: "#4a2a16",
        cap: "#a8683a",
        capHi: "#c68850",
        capLo: "#7c4826",
        spot: "#f1dfbb",
        spotHi: "#fff7e4",
        stem: "#efe1ca",
        stemHi: "#fcf6ea",
        stemLo: "#d4be9f",
        eye: "#2d1b10",
        white: "#ffffff",
        blush: "#f0a08a",
        mouth: "#7a4330",
        spore: "#cf9a55",
      },
    },
    {
      id: "glowcap",
      name: "Glowcap",
      colours: {
        rim: "#2a9e92",
        line: "#0f2a3a",
        cap: "#245770",
        capHi: "#32798f",
        capLo: "#173d52",
        spot: "#4cecd0",
        spotHi: "#dffff8",
        stem: "#d3e8ea",
        stemHi: "#effafa",
        stemLo: "#a9c8cd",
        eye: "#10283a",
        white: "#ffffff",
        blush: "#8fe0d6",
        mouth: "#2c6070",
        spore: "#2fc2ab",
      },
    },
    {
      id: "amethyst",
      name: "Amethyst",
      colours: {
        rim: "#7a58b3",
        line: "#35205a",
        cap: "#8059b8",
        capHi: "#9e7cd2",
        capLo: "#5c3d90",
        spot: "#f6dcff",
        spotHi: "#ffffff",
        stem: "#f1e6ee",
        stemHi: "#fdf8fb",
        stemLo: "#d6c3d3",
        eye: "#2a1844",
        white: "#ffffff",
        blush: "#f2a3bf",
        mouth: "#6e3f78",
        spore: "#b98be6",
      },
    },
  ],
  draw,
});
