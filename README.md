# Dragon GIF generator

Draws the animated pixel-art dragon on [my GitHub profile](https://github.com/aryamantepal/aryamantepal): an original orange dragon with a flaming tail, flapping its wings and wandering around a transparent frame.

The GIF is a static asset. It uses no GitHub data and needs no scheduled job, so it only changes when you regenerate it.

## Regenerate the GIF

From the root of this repo:

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python generate.py dragon.gif
.venv/bin/python check.py dragon.gif --sheets previews
```

`check.py` reads the saved file back and fails if frames collapsed, pixels were left behind, the pixels aren't crisp, the loop has a jump, or the dragon leaves the frame. Look over `previews/sheet-light.png` and `previews/sheet-dark.png` as well, which show frames on GitHub's light and dark page colours.

To publish it, copy `dragon.gif` to the root of `aryamantepal/aryamantepal` on a branch and open a PR. The README there references it by relative path.

With the pinned dependencies, the same code writes a byte-identical file.

## Changing the art

Everything is in `generate.py`:

- `HEAD_SIDE` and `HEAD_FRONT` are the head sprites, drawn as text.
- `SPINE`, `WING_TIPS`, `ARM` and `LEG` set the body's shape.
- `WAYPOINTS` is the flight path.
- `COLOURS` is the palette. Pixels on the outline have to stay readable on both white and `#0d1117`, and `check.py` tests that.
- Motion must repeat over `FRAMES`, so use whole numbers of cycles per loop.
