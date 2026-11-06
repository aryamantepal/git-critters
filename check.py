#!/usr/bin/env python3
"""Read a saved dragon GIF back from disk and test what actually got written.

    python check.py [dragon.gif] [--sheets DIR]

GIF encoders can quietly merge frames or leave pixels behind, so every test
here runs on the decoded file rather than on the frames held in memory.
--sheets also writes contact sheets on GitHub's light and dark page colours.
"""

import os
import sys

import numpy as np
from PIL import Image, ImageSequence

import generate

LIGHT = (255, 255, 255)
DARK = (0x0d, 0x11, 0x17)
MAX_BYTES = 1_000_000
MIN_EDGE_CONTRAST = 2.0


def luminance(rgb):
    channel = np.asarray(rgb, float) / 255
    linear = np.where(channel <= 0.03928, channel / 12.92, ((channel + 0.055) / 1.055) ** 2.4)
    return linear @ np.array([0.2126, 0.7152, 0.0722])


def contrast(rgb, page):
    a, b = luminance(rgb), luminance(page)
    return (np.maximum(a, b) + 0.05) / (np.minimum(a, b) + 0.05)


def edge_pixels(frame):
    """Opaque pixels that touch transparency: all that separates sprite from page."""
    solid = frame[:, :, 3] > 0
    air = ~solid
    touching = np.zeros_like(solid)
    touching[1:, :] |= air[:-1, :]
    touching[:-1, :] |= air[1:, :]
    touching[:, 1:] |= air[:, :-1]
    touching[:, :-1] |= air[:, 1:]
    return frame[solid & touching][:, :3]


def write_sheets(frames, directory, columns=5, rows=4):
    os.makedirs(directory, exist_ok=True)
    height, width = frames[0].shape[:2]
    cell_w, cell_h = width // 3, height // 3
    gap = 4
    size = (columns * (cell_w + gap) + gap, rows * (cell_h + gap) + gap)
    for name, page in (("light", LIGHT), ("dark", DARK)):
        sheet = Image.new("RGB", size, (128, 128, 128))
        for n in range(columns * rows):
            frame = Image.fromarray(frames[n * len(frames) // (columns * rows)])
            cell = Image.new("RGBA", (width, height), page + (255,))
            cell.alpha_composite(frame)
            cell = cell.resize((cell_w, cell_h), Image.NEAREST).convert("RGB")
            sheet.paste(cell, (gap + (n % columns) * (cell_w + gap), gap + (n // columns) * (cell_h + gap)))
        sheet.save(os.path.join(directory, f"sheet-{name}.png"))
    print(f"wrote contact sheets to {directory}")


def main():
    args = sys.argv[1:]
    sheets = None
    if "--sheets" in args:
        at = args.index("--sheets")
        sheets = args[at + 1]
        del args[at : at + 2]
    path = args[0] if args else "dragon.gif"

    failures = []

    def report(passed, message):
        print(("ok    " if passed else "FAIL  ") + message)
        if not passed:
            failures.append(message)

    size = os.path.getsize(path)
    with Image.open(path) as gif:
        decoded = [np.array(f.convert("RGBA")) for f in ImageSequence.Iterator(gif)]
        loop = gif.info.get("loop")
        delays = []
        for i in range(gif.n_frames):
            gif.seek(i)
            delays.append(gif.info.get("duration"))

    count = len(decoded)
    height, width = decoded[0].shape[:2]
    report(count > 1 and count == generate.FRAMES, f"{count} frames read back (expected {generate.FRAMES})")
    if failures:
        sys.exit("the frames did not survive saving, so nothing else can be tested")
    report(size < MAX_BYTES, f"{size:,} bytes, {width}x{height}")
    report(loop == 0, f"loops forever (loop={loop})")
    report(set(delays) == {generate.DELAY_MS}, f"every frame lasts {generate.DELAY_MS} ms ({count * generate.DELAY_MS / 1000:.1f} s loop)")

    # The file must hold exactly what was drawn, which also rules out ghost trails.
    palette = np.array(
        [[int(c[k : k + 2], 16) for k in (1, 3, 5)] for c in generate.COLOURS.values()],
        np.uint8,
    )
    expected = generate.render_frames()
    mismatched = 0
    for got, frame in zip(decoded, expected):
        big = frame.repeat(generate.SCALE, axis=0).repeat(generate.SCALE, axis=1)
        solid = big > 0
        same_alpha = np.array_equal(got[:, :, 3] > 0, solid)
        same_rgb = np.array_equal(got[:, :, :3][solid], palette[big[solid]])
        mismatched += not (same_alpha and same_rgb)
    report(mismatched == 0, f"{mismatched} frames differ from what was drawn (no collapse, no ghosts)")

    stack = np.stack(decoded)
    alpha_values = np.unique(stack[:, :, :, 3])
    report(set(alpha_values.tolist()) <= {0, 255}, f"alpha values are only {alpha_values.tolist()}")
    corners = stack[:, [0, 0, -1, -1], [0, -1, 0, -1], 3]
    report(not corners.any(), "corners are transparent in every frame")

    s = generate.SCALE
    blocks = stack[:, ::s, ::s].repeat(s, axis=1).repeat(s, axis=2)
    report(np.array_equal(blocks, stack), f"every {s}x{s} block is one solid colour (nearest-neighbour, no blur)")

    opaque = stack[stack[:, :, :, 3] > 0][:, :3]
    colours = np.unique(opaque, axis=0)
    report(len(colours) <= len(palette) - 1, f"{len(colours)} opaque colours, no blended in-betweens")

    # Motion, including across the seam from the last frame back to the first.
    changed = [
        int((decoded[i] != decoded[(i + 1) % count]).any(axis=2).sum())
        for i in range(count)
    ]
    report(min(changed) > 0, f"every frame differs from the next ({min(changed):,}..{max(changed):,} pixels change)")

    boxes = []
    for frame in decoded:
        ys, xs = np.nonzero(frame[:, :, 3])
        boxes.append((xs.min(), xs.max(), ys.min(), ys.max()))
    boxes = np.array(boxes)
    poses = generate.build_poses()
    bodies = np.array([generate.sprite_offset(p) for p in poses]) * s
    report(np.ptp(bodies[:, 0]) > width / 3 and np.ptp(bodies[:, 1]) > height / 8,
           f"body travels {np.ptp(bodies[:, 0])} px across and {np.ptp(bodies[:, 1])} px down the frame")
    steps = np.linalg.norm(bodies - np.roll(bodies, 1, axis=0), axis=1)
    report(steps[0] <= steps[1:].max() and changed[-1] <= max(changed[:-1]),
           f"seam is ordinary: last-to-first moves {steps[0]:.0f} px (largest other step {steps[1:].max():.0f}) "
           f"and changes {changed[-1]:,} pixels (largest other {max(changed[:-1]):,})")

    margins = tuple(
        int(m)
        for m in (boxes[:, 0].min(), width - 1 - boxes[:, 1].max(), boxes[:, 2].min(), height - 1 - boxes[:, 3].max())
    )
    report(min(margins) >= s, f"stays inside the frame in every frame (closest to edges L/R/T/B: {margins} px)")

    wrong_way = [
        i for i, p in enumerate(poses)
        if abs(p.vx) > 0.75 and np.cos(p.yaw) * p.vx <= 0
    ]
    report(not wrong_way, f"faces its direction of travel ({len(wrong_way)} frames moving sideways while facing away)")

    edges = np.unique(np.concatenate([edge_pixels(f) for f in decoded]), axis=0)
    if len(edges):
        worst = {name: float(contrast(edges, page).min()) for name, page in (("light", LIGHT), ("dark", DARK))}
        report(min(worst.values()) >= MIN_EDGE_CONTRAST,
               f"weakest silhouette contrast is {worst['light']:.2f}:1 on white, {worst['dark']:.2f}:1 on #0d1117")
    else:
        report(False, "no silhouette to test: nothing in the frame is transparent")

    if sheets:
        write_sheets(decoded, sheets)

    if failures:
        sys.exit(f"{len(failures)} check(s) failed")
    print("all checks passed")


if __name__ == "__main__":
    main()
