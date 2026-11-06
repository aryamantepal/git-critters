# git-critters

Pixel-art critters for your GitHub profile README. Pick one, see how it looks on your own profile, and add it in one click.

**[Pick a critter](https://aryamantepal.github.io/git-critters)**

## How it works

1. On the site, you cycle through the critters and colours. The preview shows them on top of your real README, in GitHub's light and dark themes.
2. **Add to my profile** opens GitHub's new-file page with one small workflow already filled in.
3. You commit it. Choose "Create a new branch" on that screen if you'd rather review it as a pull request.
4. The workflow draws the critter, saves `critter.gif`, and adds it to the top of your README. Your existing text stays as it is.

There's nothing to sign in to and no server. Everything on the site runs in your browser, and the workflow runs on your repo's own GitHub Actions.

## Without the site

Add this to your profile repo (the one named after your username) as `.github/workflows/critter.yml`:

```yaml
name: Critter

on:
  push:
    paths: [.github/workflows/critter.yml]
  workflow_dispatch:

permissions:
  contents: write

jobs:
  critter:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: aryamantepal/git-critters@v1
        with:
          critter: dragon
          colour: ember
```

| `critter` | `colour` |
| --- | --- |
| `dragon` | `ember`, `frost`, `moss` |
| `axolotl` | `blossom`, `gold`, `dusk` |
| `jellyfish` | `lagoon`, `orchid`, `coral` |
| `ghost` | `moon`, `mint`, `peach` |

To swap critters, change those two lines and commit. To remove it, delete the workflow, `critter.gif`, and the block between the `git-critters` comments in your README.

The workflow also takes `output`, the path to save the GIF to, which defaults to `critter.gif`.

## Add a critter

A critter is one file in `src/critters/`, listed in `src/critters/index.ts`. It says what it's called and which colourways it comes in, and draws any frame on request as a grid of palette indexes. `src/engine/` has the parts for drawing and motion, and the existing critters show how they fit together. `src/critters/ghost.ts` is the simplest place to start.

The rules:

- Every critter must be an original design.
- Every motion must complete a whole number of cycles over the loop, so the last frame flows into the first.
- Outlines have to show on both white and `#0d1117`, since GIF transparency is all or nothing.

The tests apply to every critter and colourway automatically. They read each GIF back and check that it holds exactly what was drawn, never leaves the frame, loops without a jump, shows on both themes, and stays under 1 MB. Each critter's GIF is byte-for-byte repeatable.

## Develop

You need Node 24 or later.

```sh
npm ci
npm run dev        # the site, at http://127.0.0.1:8000
npm test
npm run typecheck
npm run render -- dragon ember out.gif   # one GIF, to look at closely
npm run build      # rebuilds dist/action.cjs, which must be committed
```

The Action runs from the committed bundle, `dist/action.cjs`, so it needs no install step. `v1` is a tag that moves to the latest compatible release.

## Credit

Inspired by [git-koi](https://github.com/yalongwastaken/git-koi) by Anthony Yalong, which draws a koi from your GitHub activity.
