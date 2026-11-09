# Contributing to git-critters

Thank you for your interest in contributing to **git-critters**! We welcome new critters, art improvements, bug fixes, site enhancements, and documentation updates.

---

## How Contributing Works (Fork & Pull Request)

You do **not** need push access or collaborator permissions to contribute! Anyone on GitHub can contribute through the standard **Fork & Pull Request** workflow:

1. **Fork the repository**: Click the **Fork** button at the top right of [github.com/aryamantepal/git-critters](https://github.com/aryamantepal/git-critters) to create a copy under your account.
2. **Clone your fork**:
   ```bash
   git clone https://github.com/<your-username>/git-critters.git
   cd git-critters
   ```
3. **Create a branch**:
   ```bash
   git checkout -b add-critter-penguin
   ```
4. **Make your changes, test them, and commit**.
5. **Push to your fork**:
   ```bash
   git push origin add-critter-penguin
   ```
6. **Open a Pull Request**: Go to the original repository and click **Compare & pull request**. Our automated test suite will run on your PR, and a maintainer will review and merge it.

---

## Getting Started & Local Development

You need **Node 24** or later.

```bash
# Install dependencies
npm ci

# Run tests
npm test

# Run TypeScript typecheck
npm run typecheck

# Start local web preview (http://127.0.0.1:8000)
npm run dev

# Render a single GIF to inspect locally
npm run render -- dragon ember out.gif

# Render at specific trait levels
npm run render -- dragon ember out.gif stage=1 marks=2 mood=lively

# Rebuild the Action bundle (only if you change the engine or Action runner)
npm run build
```

---

## Adding a New Critter

Each critter is a single TypeScript file in `src/critters/` (take a look at `src/critters/ghost.ts` for the simplest example).

### 1. Structure
A critter defines:
- **`id`**: Unique lowercase alphanumeric slug (e.g., `'penguin'`).
- **`name`**: Display name (e.g., `'Penguin'`).
- **`colourways`**: Named colour schemes (e.g., `'ice'`, `'tuxedo'`).
- **`palette`**: Categorized colours:
  - `bodyColour`: Changes with the contributor's most-used language.
  - `accentColours`: Changes with their second most-used language.
  - `fixedColours`: Colours that never change (e.g. eyes, beaks, metal).
  - `edgeColours`: Colours that touch the transparent border/silhouette.
- **`drawFrame`**: Function that renders a single frame as a grid of palette indexes.

### 2. Design Rules
- **Originality**: Every critter must be an original design.
- **Seamless Looping**: Every motion must complete a whole number of cycles across the frame loop so the last frame seamlessly connects to the first.
- **Traits & Scaling**:
  - Implement `Traits` (`stage`, `marks`, `mood`).
  - `DEFAULT_TRAITS` must reproduce the base art.
  - `stage`: Scale geometry using `STAGE_SCALE` within the same frame size.
  - `marks`: Placed on the body so they move with the critter and remain visible at all stages.
  - `mood`: Adjust cycle counts via `cyclesFor`, roaming via `roam`, and eye blinking via `blinkFrames`.
- **Outline & Contrast**: Outlines must be clearly visible against both light backgrounds (white) and GitHub's dark theme (`#0d1117`), because GIF transparency is binary (no alpha blending).
- **File Size**: The resulting GIF across all colourways and trait permutations must remain under **1 MB**.
- **Registering**: Once written, add your critter to the `critters` list in `src/critters/index.ts`.
- **Egg / Surprise Pool**: New critters are *not* automatically added to `SURPRISE_POOL` in `src/activity/egg.ts` to preserve existing hashes for hatched critters. Maintainers will manage the surprise pool.

---

## Submitting a Pull Request

Before submitting:
1. Ensure `npm test` and `npm run typecheck` pass without errors.
2. Render your critter locally (`npm run render -- <id> <colourway> test.gif`) and check it in both light and dark mode.
3. If you touched the Action runner or engine files, run `npm run build` to update `dist/action.cjs`.
4. Keep your PR focused on a single critter or fix.

We are excited to see what you create! 🎨✨
