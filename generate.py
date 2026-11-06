#!/usr/bin/env python3
"""Render an original pixel-art dragon flying around a transparent frame.

    python generate.py [output.gif]

The dragon is a small 3D skeleton (spine, wings, limbs) projected onto a low
resolution grid, then scaled up with nearest-neighbour so every pixel stays a
crisp square. All motion repeats exactly over FRAMES, so the last frame flows
into the first, and nothing is random, so re-running writes the same file.
"""

import math
import sys
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageDraw

WIDTH, HEIGHT = 180, 120  # logical pixels
SCALE = 4
MARGIN = 2  # logical pixels the sprite must keep from the frame's edge
FRAMES = 200
DELAY_MS = 60
FLAP_CYCLES = 24  # whole wing beats per loop
SWAY_CYCLES = 12  # whole tail sways per loop
EMBERS = 44  # sparks shed per loop
TAU = 2 * math.pi

# The body's flight path: a closed curve through these points, in logical pixels.
WAYPOINTS = np.array(
    [
        (44, 92),
        (72, 62),
        (104, 78),
        (137, 50),
        (140, 88),
        (110, 96),
        (82, 84),
        (92, 52),
        (66, 47),
        (40, 62),
    ],
    dtype=float,
)

COLOURS = {
    "clear": "#000000",  # index 0 is the transparent index
    "rim": "#b4451a",  # silhouette edge: must read on light and dark pages
    "line": "#5e2110",  # lines between parts of the body
    "orange": "#f58a2c",
    "orange_hi": "#ffb65c",
    "orange_lo": "#d4641f",
    "cream": "#ffe6ad",
    "cream_lo": "#f0bd7a",
    "wing_hi": "#e65a45",
    "wing": "#c93a3c",
    "wing_lo": "#9c2a3c",
    "wing_far": "#a02f3e",
    "wing_far_lo": "#7f2536",
    "horn": "#fff3d0",
    "horn_lo": "#e3c48c",
    "eye": "#2a1408",
    "white": "#ffffff",
    "fire_red": "#e9401c",
    "fire_orange": "#ff8a1f",
    "fire_yellow": "#ffd23d",
    "fire_core": "#fff6c2",
}
INDEX = {name: i for i, name in enumerate(COLOURS)}

ART_KEY = {
    "o": "orange",
    "h": "orange_hi",
    "s": "orange_lo",
    "c": "cream",
    "d": "cream_lo",
    "f": "wing",
    "g": "wing_lo",
    "i": "horn",
    "j": "horn_lo",
    "k": "eye",
    "n": "line",
    "w": "white",
}

HEAD_SIDE = """
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
"""
HEAD_SIDE_ANCHOR = (9, 10)  # the pixel that sits on the end of the neck
HEAD_SIDE_EYE_ROWS = (5, 8)

HEAD_FRONT = """
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
"""
HEAD_FRONT_ANCHOR = (10, 11)

# (forward, up, radius) from the base of the skull to the tip of the tail.
SPINE = np.array(
    [
        (15.0, 14.0, 3.0),
        (12.0, 9.0, 3.8),
        (7.5, 3.0, 6.2),
        (1.0, 0.5, 7.2),
        (-6.0, -0.5, 6.0),
        (-12.5, -2.0, 4.4),
        (-19.0, -3.0, 3.2),
        (-25.5, -2.5, 2.3),
        (-30.5, 1.5, 1.6),
        (-32.5, 7.0, 1.1),
    ]
)
SPINE_SAMPLES = 90
CHEST = 2 / 9  # fractions of the way along SPINE
HIP = 4 / 9
SPIKES_AT = (0.1, 0.18, 0.55, 0.66, 0.77)

# Wing bones as (along the body, out along the span).
WING_WRIST = (8.0, 15.0)
WING_TIPS = [(0.0, 34.0), (-14.0, 31.0), (-24.0, 22.0), (-28.0, 10.0)]
WING_ROOT = (-15.0, 0.0)
WING_DROOP = 0.22  # the trailing edge hangs below the leading edge
SHOULDER = (3.0, 6.0, 3.0)

ARM = [(7.0, -3.0), (10.0, -6.0), (13.0, -6.5)]
LEG = [(-6.0, -3.5), (-10.0, -8.0), (-15.0, -9.5)]
LIMB_OFFSET = 4.5  # how far the limbs sit from the body's centre line

REST_YAW = math.radians(14)  # a little three-quarter, so both wings show
ELEVATION = 0.25  # how far above the dragon the viewer sits
LOCAL = 140  # size of the canvas each sprite is drawn on
ORIGIN = LOCAL // 2


@dataclass
class Pose:
    t: float  # loop time in [0, 1)
    x: float  # body position in the frame
    y: float
    vx: float  # logical pixels per frame
    yaw: float  # REST_YAW faces right, pi/2 faces the viewer, pi - REST_YAW faces left
    pitch: float
    flap: float  # wing beat phase in radians
    lift: float  # 0.45 when gliding, 1 when climbing
    sway: float  # tail phase in radians
    blink: bool


def catmull_rom(p0, p1, p2, p3, f):
    return 0.5 * (
        2 * p1
        + (p2 - p0) * f
        + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f**2
        + (3 * p1 - p0 - 3 * p2 + p3) * f**3
    )


def closed_spline(points, t):
    """A closed curve through `points`, with t in [0, 1)."""
    n = len(points)
    i, f = divmod(t * n, 1.0)
    return catmull_rom(*(points[(int(i) + k) % n] for k in (-1, 0, 1, 2)), f)


def open_spline(points, samples):
    """An open curve through `points`, sampled evenly from end to end."""
    n = len(points)
    out = []
    for u in np.linspace(0, n - 1, samples):
        i = min(int(u), n - 2)
        controls = (points[min(max(i + k, 0), n - 1)] for k in (-1, 0, 1, 2))
        out.append(catmull_rom(*controls, u - i))
    return np.array(out)


def smooth(values, width):
    """Smooth a periodic series without breaking its periodicity."""
    kernel = np.hanning(width + 2)[1:-1]
    kernel /= kernel.sum()
    wrapped = np.concatenate([values[-width:], values, values[:width]])
    return np.convolve(wrapped, kernel, mode="same")[width:-width]


def build_poses():
    times = np.arange(FRAMES) / FRAMES
    path = np.array([closed_spline(WAYPOINTS, t) for t in times])
    x, y = path[:, 0], path[:, 1]
    vx = (np.roll(x, -1) - np.roll(x, 1)) / 2
    vy = (np.roll(y, -1) - np.roll(y, 1)) / 2

    # Facing follows horizontal travel, turning through a view of the face.
    yaw = smooth(math.pi / 2 - (math.pi / 2 - REST_YAW) * np.clip(vx / 0.7, -1, 1), 7)
    pitch = smooth(np.clip(-vy * 0.24, -0.3, 0.3), 9)
    climb = smooth(np.clip(-vy / 1.2, -1, 1), 9)

    # Beat faster on the way up, keeping a whole number of beats per loop.
    rate = 1 + 0.4 * climb
    rate *= FLAP_CYCLES / rate.sum()
    flap = TAU * np.cumsum(rate)
    lift = np.clip(0.75 + 0.35 * climb, 0.45, 1.0)

    blinks = {f for start in (28, 36, 128) for f in range(start, start + 3)}
    return [
        Pose(
            t=times[i],
            x=x[i],
            y=y[i],
            vx=vx[i],
            yaw=yaw[i],
            pitch=pitch[i],
            flap=flap[i],
            lift=lift[i],
            sway=TAU * SWAY_CYCLES * times[i],
            blink=i in blinks,
        )
        for i in range(FRAMES)
    ]


def project(pose, x, y, z=0.0):
    """Model space (x forward, y up, z toward the viewer) to sprite pixels."""
    cp, sp = math.cos(pose.pitch), math.sin(pose.pitch)
    px, py = x * cp - y * sp, x * sp + y * cp
    cy, sy = math.cos(pose.yaw), math.sin(pose.yaw)
    depth = px * sy + z * cy
    return px * cy - z * sy + ORIGIN, -py + ELEVATION * depth + ORIGIN


def empty_mask():
    return np.zeros((LOCAL, LOCAL), bool)


def dilate(mask):
    """Grow a mask by one pixel, without corners, for clean pixel-art outlines."""
    grown = mask.copy()
    grown[1:, :] |= mask[:-1, :]
    grown[:-1, :] |= mask[1:, :]
    grown[:, 1:] |= mask[:, :-1]
    grown[:, :-1] |= mask[:, 1:]
    return grown


def moved_up(mask, rows):
    return np.roll(mask, -rows, axis=0)


def discs(xs, ys, radii):
    mask = empty_mask()
    for x, y, r in zip(np.atleast_1d(xs), np.atleast_1d(ys), np.atleast_1d(radii)):
        x0, x1 = int(x - r - 1), int(x + r + 2)
        y0, y1 = int(y - r - 1), int(y + r + 2)
        gy, gx = np.ogrid[y0:y1, x0:x1]
        mask[y0:y1, x0:x1] |= (gx - x) ** 2 + (gy - y) ** 2 <= r * r
    return mask


def polygon(points):
    image = Image.new("1", (LOCAL, LOCAL))
    ImageDraw.Draw(image).polygon([tuple(p) for p in points], fill=1)
    return np.array(image, dtype=bool)


def polyline(points):
    image = Image.new("1", (LOCAL, LOCAL))
    ImageDraw.Draw(image).line([tuple(p) for p in points], fill=1)
    return np.array(image, dtype=bool)


def load_art(text):
    rows = text.strip("\n").split("\n")
    art = np.zeros((len(rows), len(rows[0])), np.uint8)
    for j, row in enumerate(rows):
        for i, ch in enumerate(row):
            if ch != ".":
                art[j, i] = INDEX[ART_KEY[ch]]
    return art


def with_eye_shut(art):
    art = art.copy()
    first, last = HEAD_SIDE_EYE_ROWS
    rows = art[first:last]
    eye = (rows == INDEX["white"]) | (rows == INDEX["eye"])
    columns = np.nonzero(eye.any(axis=0))[0]
    rows[eye] = INDEX["orange"]
    rows[1, columns] = INDEX["line"]
    return art


SIDE_ART = load_art(HEAD_SIDE)
SIDE_ART_BLINK = with_eye_shut(SIDE_ART)
FRONT_ART = load_art(HEAD_FRONT)

_dense_spine = open_spline(SPINE, SPINE_SAMPLES)
SPINE_X, SPINE_Y, SPINE_R = _dense_spine.T
SPINE_U = np.linspace(0, 1, SPINE_SAMPLES)


def animated_spine(pose):
    """The spine this frame, in model space: the tail sways and the neck nods."""
    tail = np.clip((SPINE_U - HIP) / (1 - HIP), 0, 1) ** 1.5
    neck = np.clip((CHEST - SPINE_U) / CHEST, 0, 1)
    y = SPINE_Y + tail * 3.2 * np.sin(pose.sway - 3 * tail)
    y = y + neck * np.sin(pose.flap + 1.2)
    z = tail * 2.5 * np.sin(pose.sway + 1)
    return SPINE_X, y, z


def tail_tip(pose):
    x, y, z = animated_spine(pose)
    return project(pose, x[-1], y[-1], z[-1])


def draw_chain(canvas, pose, select):
    """Draw part of the spine as a shaded tube with a cream belly."""
    x, y, z = animated_spine(pose)
    dx, dy = np.gradient(x), np.gradient(y)
    length = np.hypot(dx, dy)
    belly_x, belly_y = -dy / length, dx / length

    sx, sy = project(pose, x, y, z)
    body = discs(sx[select], sy[select], SPINE_R[select])
    canvas[dilate(body)] = INDEX["line"]
    canvas[body] = INDEX["orange"]
    canvas[body & ~moved_up(body, 2)] = INDEX["orange_lo"]
    canvas[body & ~moved_up(body, -1)] = INDEX["orange_hi"]

    with_belly = select & (SPINE_U < 0.82)
    bx, by = project(
        pose, x + belly_x * SPINE_R * 0.72, y + belly_y * SPINE_R * 0.72, z
    )
    belly = body & discs(bx[with_belly], by[with_belly], SPINE_R[with_belly] * 0.6)
    canvas[belly] = INDEX["cream"]
    canvas[belly & ~moved_up(body, 1)] = INDEX["cream_lo"]


def draw_spikes(canvas, pose):
    x, y, z = animated_spine(pose)
    dx, dy = np.gradient(x), np.gradient(y)
    length = np.hypot(dx, dy)
    along_x, along_y = dx / length, dy / length  # toward the tail
    back_x, back_y = along_y, -along_x
    mask = empty_mask()
    for u in SPIKES_AT:
        j = int(u * (SPINE_SAMPLES - 1))
        r = SPINE_R[j]
        height = 1.4 + r * 0.3
        half_width = 1.0 + r * 0.14
        base = [
            (
                x[j] + back_x[j] * r * 0.7 + s * along_x[j] * half_width,
                y[j] + back_y[j] * r * 0.7 + s * along_y[j] * half_width,
            )
            for s in (-1, 1)
        ]
        tip = (
            x[j] + back_x[j] * (r + height) + along_x[j] * height * 0.5,
            y[j] + back_y[j] * (r + height) + along_y[j] * height * 0.5,
        )
        mask |= polygon([project(pose, *p, z[j]) for p in (base[0], tip, base[1])])
    canvas[dilate(mask)] = INDEX["line"]
    canvas[mask] = INDEX["wing"]


def draw_wing(canvas, pose, side):
    """A bat-like wing: an arm, fingers fanning from the wrist, scalloped skin."""
    # Full strokes under power; held high and nearly still when gliding.
    power = min(max((pose.lift - 0.45) / 0.25, 0.0), 1.0)
    power = power * power * (3 - 2 * power)
    amplitude = math.radians(12 + 38 * power)
    centre = math.radians(46 - 24 * power)
    inner = centre + amplitude * math.sin(pose.flap)
    # The outer half lags the inner half, so each beat ripples out to the tip.
    outer = centre + math.radians(6) + 1.15 * amplitude * math.sin(pose.flap - 0.85)

    def point(along, span):
        span_in, span_out = min(span, WING_WRIST[1]), max(0.0, span - WING_WRIST[1])
        up = span_in * math.sin(inner) + span_out * math.sin(outer)
        out = span_in * math.cos(inner) + span_out * math.cos(outer)
        return project(
            pose,
            SHOULDER[0] + along,
            SHOULDER[1] + up + min(along, 0.0) * WING_DROOP,
            side * (SHOULDER[2] + out),
        )

    near = side * math.cos(pose.yaw) > 0
    shades = (
        ("wing_hi", "wing", "wing_hi", "wing")
        if near
        else ("wing_far", "wing_far_lo", "wing_far", "wing_far_lo")
    )
    bone = INDEX["orange" if near else "orange_lo"]

    shoulder = point(0, 0)
    wrist = point(*WING_WRIST)
    tips = [point(*tip) for tip in WING_TIPS]
    scallops = []
    for (a0, s0), (a1, s1) in zip(WING_TIPS, WING_TIPS[1:] + [WING_ROOT]):
        mid_a, mid_s = (a0 + a1) / 2, (s0 + s1) / 2
        scallops.append(
            point(
                mid_a + (WING_WRIST[0] - mid_a) * 0.28,
                mid_s + (WING_WRIST[1] - mid_s) * 0.28,
            )
        )

    panels = [
        polygon([wrist, tips[i], scallops[i], tips[i + 1]])
        for i in range(len(tips) - 1)
    ]
    panels.append(polygon([wrist, tips[-1], scallops[-1], point(*WING_ROOT), shoulder]))
    skin = empty_mask()
    for panel in panels:
        skin |= panel

    along_arm = np.linspace(0, 1, 8)
    arm = discs(
        shoulder[0] + (wrist[0] - shoulder[0]) * along_arm,
        shoulder[1] + (wrist[1] - shoulder[1]) * along_arm,
        1.9 - 0.9 * along_arm,
    )
    fingers = empty_mask()
    for tip in tips:
        fingers |= polyline([wrist, tip])

    # Seen edge-on the fingers would collapse into stripes, so leave them out.
    edge_on = abs(tips[0][1] - wrist[1]) < 4
    outlined = skin | arm
    canvas[dilate(outlined)] = INDEX["line"]
    for panel, shade in zip(panels, shades):
        canvas[panel] = INDEX[shades[1] if edge_on else shade]
    if not edge_on:
        canvas[dilate(fingers) & ~dilate(outlined)] = INDEX["line"]
        canvas[fingers] = bone
    canvas[arm] = bone


def draw_limb(canvas, pose, side, points, r0, r1):
    near = side * math.cos(pose.yaw) > 0
    dense = open_spline(np.array(points), 10)
    sx, sy = project(pose, dense[:, 0], dense[:, 1], side * LIMB_OFFSET)
    limb = discs(sx, sy, np.linspace(r0, r1, 10))

    dx, dy = sx[-1] - sx[-3], sy[-1] - sy[-3]
    length = math.hypot(dx, dy) or 1.0
    dx, dy = dx / length, dy / length
    claws = empty_mask()
    for spread in (-1.2, 0.0, 1.2):
        cx = sx[-1] + dx * (r1 + 1.2) - dy * spread
        cy = sy[-1] + dy * (r1 + 1.2) + dx * spread
        claws[round(cy), round(cx)] = True

    canvas[dilate(limb | claws)] = INDEX["line"]
    canvas[limb] = INDEX["orange" if near else "orange_lo"]
    canvas[claws] = INDEX["horn" if near else "horn_lo"]


def draw_head(canvas, pose):
    """Hand-drawn head art, held level like a real animal's as the body pitches."""
    x, y, z = animated_spine(pose)
    hx, hy = project(pose, x[0], y[0], z[0])
    if abs(math.cos(pose.yaw)) > 0.5:
        art = SIDE_ART_BLINK if pose.blink else SIDE_ART
        ax, ay = HEAD_SIDE_ANCHOR
        if math.cos(pose.yaw) < 0:
            art = art[:, ::-1]
            ax = art.shape[1] - 1 - ax
    else:
        art = FRONT_ART
        ax, ay = HEAD_FRONT_ANCHOR
    y0, x0 = round(hy) - ay, round(hx) - ax
    mask = empty_mask()
    mask[y0 : y0 + art.shape[0], x0 : x0 + art.shape[1]] = art > 0
    canvas[dilate(mask)] = INDEX["line"]
    canvas[mask] = art[art > 0]


def draw_flame(canvas, pose):
    """Nested tongues of fire that lean away from the direction of travel."""
    ox, oy = tail_tip(pose)
    lean = -float(np.clip(pose.vx * 0.22, -1.1, 1.1))
    # (sideways reach, length, whole flickers per loop, phase)
    tongues = [(0.0, 1.0, 31, 0.0), (-2.4, 0.62, 43, 1.7), (2.2, 0.7, 37, 3.1)]
    layers = (
        ("fire_red", 1.0),
        ("fire_orange", 0.72),
        ("fire_yellow", 0.46),
        ("fire_core", 0.22),
    )
    for colour, size in layers:
        mask = empty_mask()
        for sideways, length, cycles, phase in tongues:
            flicker = 0.85 + 0.15 * math.sin(TAU * cycles * pose.t + phase)
            reach = 16 * length * flicker * size**0.6
            for k in np.linspace(0, 1, 14):
                wiggle = k * 1.3 * math.sin(TAU * (cycles + 11) * pose.t - 5 * k + phase)
                cx = ox + k * (lean * reach + sideways) + wiggle
                cy = oy + (1 - size) * 2 - k * reach
                mask |= discs(cx, cy, 4.2 * size * (1 - k) ** 0.75 + 0.35)
        canvas[mask] = INDEX[colour]


def render_sprite(pose):
    canvas = np.zeros((LOCAL, LOCAL), np.uint8)
    cos_yaw, sin_yaw = math.cos(pose.yaw), math.sin(pose.yaw)

    # Painter's algorithm: each part is (depth, draw), drawn far to near.
    parts = [(-0.5, lambda: draw_spikes(canvas, pose))]
    if abs(cos_yaw) > 0.5:
        tail_depth = 0.0
        chains = [(tail_depth, np.ones(SPINE_SAMPLES, bool))]
    else:
        # Facing the viewer, the tail passes behind the body and the neck in front.
        tail_depth = -8.0
        chains = [
            (tail_depth, SPINE_U >= HIP),
            (0.0, (SPINE_U >= CHEST) & (SPINE_U <= HIP + 0.02)),
            (8.0, SPINE_U <= CHEST + 0.02),
        ]
    for depth, select in chains:
        parts.append((depth, lambda s=select: draw_chain(canvas, pose, s)))
    for side in (1, -1):
        wing_depth = side * cos_yaw * 15 - sin_yaw * 5
        parts.append((wing_depth, lambda s=side: draw_wing(canvas, pose, s)))
        arm_depth = ARM[0][0] * sin_yaw + side * LIMB_OFFSET * cos_yaw
        parts.append(
            (arm_depth, lambda s=side: draw_limb(canvas, pose, s, ARM, 2.3, 1.3))
        )
        leg_depth = LEG[0][0] * sin_yaw + side * LIMB_OFFSET * cos_yaw
        parts.append(
            (leg_depth, lambda s=side: draw_limb(canvas, pose, s, LEG, 3.6, 1.6))
        )
    parts.append((12.0, lambda: draw_head(canvas, pose)))
    parts.append((tail_depth + 0.5, lambda: draw_flame(canvas, pose)))

    for _, draw in sorted(parts, key=lambda part: part[0]):
        draw()

    # GIF transparency is all or nothing, so the outermost pixels alone decide
    # how the sprite reads against the page. Keep them strong on both themes.
    open_air = dilate(canvas == 0)
    canvas[(canvas == INDEX["line"]) & open_air] = INDEX["rim"]
    for bright in ("fire_yellow", "fire_core"):
        canvas[(canvas == INDEX[bright]) & open_air] = INDEX["fire_red"]
    return canvas


def sprite_offset(pose):
    """Where the sprite sits in the frame. Whole pixels only, so it never shimmers."""
    bob = 1.5 * pose.lift * math.sin(pose.flap)
    return round(pose.x) - ORIGIN, round(pose.y + bob) - ORIGIN


def ember_tracks(poses):
    """Sparks shed by the flame: (birth frame, life, x, y, vx, vy)."""
    tracks = []
    for e in range(EMBERS):
        # Golden-ratio style sequences spread the sparks out without randomness.
        birth = (e * FRAMES // EMBERS + round(((e * 0.618034) % 1.0) * 4)) % FRAMES
        life = 8 + round(((e * 0.754878) % 1.0) * 9)
        vx = (((e * 0.569840) % 1.0) - 0.5) * 0.7
        vy = -0.35 - ((e * 0.438744) % 1.0) * 0.45
        ox, oy = sprite_offset(poses[birth])
        tip_x, tip_y = tail_tip(poses[birth])
        tracks.append((birth, life, tip_x + ox, tip_y + oy - 6, vx, vy))
    return tracks


def draw_embers(frame, index, tracks):
    for birth, life, x0, y0, vx, vy in tracks:
        age = (index - birth) % FRAMES
        if age < life:
            x, y = round(x0 + vx * age), round(y0 + vy * age)
            if MARGIN <= x < WIDTH - MARGIN and MARGIN <= y < HEIGHT - MARGIN:
                frame[y, x] = INDEX["fire_orange" if age < life / 2 else "fire_red"]


def render_frames():
    poses = build_poses()
    tracks = ember_tracks(poses)
    frames = []
    for i, pose in enumerate(poses):
        frame = np.zeros((HEIGHT, WIDTH), np.uint8)
        draw_embers(frame, i, tracks)
        sprite = render_sprite(pose)
        ys, xs = np.nonzero(sprite)
        ox, oy = sprite_offset(pose)
        fx, fy = xs + ox, ys + oy
        if (
            fx.min() < MARGIN
            or fy.min() < MARGIN
            or fx.max() >= WIDTH - MARGIN
            or fy.max() >= HEIGHT - MARGIN
        ):
            sys.exit(
                f"frame {i}: sprite spans x {fx.min()}..{fx.max()}, "
                f"y {fy.min()}..{fy.max()}, outside the {WIDTH}x{HEIGHT} frame"
            )
        frame[fy, fx] = sprite[ys, xs]
        frames.append(frame)
    return frames


def save_gif(frames, path):
    palette = []
    for colour in COLOURS.values():
        palette += [int(colour[k : k + 2], 16) for k in (1, 3, 5)]
    size = (WIDTH * SCALE, HEIGHT * SCALE)
    images = []
    for frame in frames:
        big = frame.repeat(SCALE, axis=0).repeat(SCALE, axis=1)
        image = Image.frombytes("P", size, big.tobytes())
        image.putpalette(palette)
        images.append(image)
    images[0].save(
        path,
        save_all=True,
        append_images=images[1:],
        duration=DELAY_MS,
        loop=0,
        disposal=2,  # clear each frame before the next, so nothing trails behind
        transparency=0,
        background=0,
        optimize=False,
    )


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "dragon.gif"
    save_gif(render_frames(), path)
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
