# git-critters

Pixel-art critters for your GitHub profile README. Pick one, see how it looks on your own profile, and add it in one click.

**[Pick a critter](https://critters.aryamantepal.com)**

## How it works

1. On the site, you cycle through the critters and colours. The preview shows them on top of your real README, in GitHub's light and dark themes.
2. **Add to my profile** opens GitHub's new-file page with one small workflow already filled in.
3. You commit it. Choose "Create a new branch" on that screen if you'd rather review it as a pull request.
4. The workflow draws the critter, saves `critter.gif`, and adds it to the top of your README. Your existing text stays as it is.
5. Every night, just after midnight UTC, it runs again and redraws the critter from your public GitHub activity.

There's nothing to sign in to and no server. Everything on the site runs in your browser, and the workflow runs on your repo's own GitHub Actions with its built-in token.

### What your activity changes

You pick the species. Your activity decides how it looks.

| Activity | Changes | Levels |
| --- | --- | --- |
| Languages | Colour | Your most-used language across your public, non-fork repos sets the body colour, and the second sets the accents. Choosing a fixed colour overrides this. |
| Lifetime contributions | Size | Hatchling under 100, young from 100, grown from 1,000, elder from 5,000 |
| Longest streak in the past year | Marks | None under 7 days, one mark from 7, two from 30, three from 100 |
| Contributions yesterday (UTC) | Motion | Resting at 0, steady from 1, lively from 5 |

Marks follow the longest streak, not the current one, so missing a day doesn't take one away, though a streak stops counting once it's more than a year old. Days are UTC.

The site can't read contributions without a token, so its preview uses your real languages and lets you try each size, mark and motion. The real critter comes from your activity when the workflow runs.

If GitHub's data can't be read, the critter you already have stays and the run still passes, with a warning. On a first run it draws the default art.

Each night's run commits only when the GIF changes, which adds roughly 300 to 800 KB to your profile repo's history each time. If nothing has changed for 50 days, it makes an empty commit, because GitHub turns off scheduled workflows in public repos after 60 days without activity.

## Without the site

Add this to your profile repo (the one named after your username) as `.github/workflows/critter.yml`:

```yaml
# Draws a pixel-art critter from your GitHub activity and adds it to the top of this README.
# To swap it, change the last two lines and commit: https://critters.aryamantepal.com
name: Critter

on:
  push:
    paths: [.github/workflows/critter.yml]
  workflow_dispatch:
  schedule:
    - cron: "37 0 * * *" # just after midnight UTC, when yesterday's activity is complete

permissions:
  contents: write

concurrency: critter

jobs:
  critter:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: aryamantepal/git-critters@v1
        with:
          activity: true
          critter: dragon
          colour: languages
```

| `critter` | `colour` |
| --- | --- |
| `dragon` | `ember`, `frost`, `moss` |
| `axolotl` | `blossom`, `gold`, `dusk` |
| `jellyfish` | `lagoon`, `orchid`, `coral` |
| `ghost` | `moon`, `mint`, `peach` |

`colour: languages` colours the critter from your languages, and is what you get if you leave `colour` out while `activity` is on. A colour from the table always wins over languages, and size, marks and motion still apply.

To swap critters, change those two lines and commit. To remove it, delete the workflow, `critter.gif`, and the block between the `git-critters` comments in your README.

**To keep one fixed critter**, set `activity: false` (or remove the line) and delete the `schedule:` lines. Then it draws once, exactly as it always has, and `colour` has to be one from the table.

The workflow also takes `output`, the path to save the GIF to, which defaults to `critter.gif`, and `login` and `token`, which default to the repo's owner and the built-in token.

## Add a critter

A critter is one file in `src/critters/`, listed in `src/critters/index.ts`. It says what it's called and which colourways it comes in, and draws any frame on request as a grid of palette indexes. `src/engine/` has the parts for drawing and motion, and the existing critters show how they fit together. `src/critters/ghost.ts` is the simplest place to start.

The rules:

- Every critter must be an original design.
- Every motion must complete a whole number of cycles over the loop, so the last frame flows into the first.
- Draw from `Traits` (`stage`, `marks`, `mood`). `DEFAULT_TRAITS` must give the art you'd ship without them. Size is a re-render of the geometry at `STAGE_SCALE`, inside the same frame. Marks reuse colours you already have and are placed on the body, so they move with it and show at every stage. Mood sets whole-number cycles through `cyclesFor`, how far it roams through `roam`, and how long it keeps its eyes shut through `blinkFrames`. Keep the memo in `perTraits`, so only the latest traits are held.
- Say which colours are `accentColours` (they take the second language's hue), `fixedColours` (they never change), and `edgeColours` (they reach the silhouette), and which one is the `bodyColour`.
- Outlines have to show on both white and `#0d1117`, since GIF transparency is all or nothing.

The tests apply to every critter and colourway automatically, and again across the ends of each trait's range. They read GIFs back and check that they hold exactly what was drawn, never leave the frame, loop without a jump, show on both themes, and stay under 1 MB. They also check that every language's colours keep the outline showing. Each critter's GIF is byte-for-byte repeatable, and with the default traits all 12 colourways are locked to the hashes they had before traits existed.

## Develop

You need Node 24 or later.

```sh
npm ci
npm run dev        # the site, at http://127.0.0.1:8000
npm test
npm run typecheck
npm run render -- dragon ember out.gif   # one GIF, to look at closely
npm run render -- dragon ember out.gif stage=1 marks=2 mood=lively   # at other traits
npm run build      # rebuilds dist/action.cjs, which must be committed
```

The Action runs from the committed bundle, `dist/action.cjs`, so it needs no install step. `v1` is a tag that moves to the latest compatible release.

## Credit

The idea of drawing a creature from someone's activity comes from [git-koi](https://github.com/yalongwastaken/git-koi) by Anthony Yalong, which draws a koi from your GitHub activity. This is a separate implementation, with no code or art taken from it.

Language colours come from [github-linguist](https://github.com/github-linguist/linguist), which is MIT licensed.
