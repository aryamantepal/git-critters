## Description

<!-- Describe your changes. If this adds a new critter, please include a rendered GIF preview in both light and dark mode! -->

Fixes # <!-- issue number if applicable -->

## Type of Change

- [ ] 🎨 New critter design
- [ ] 🐛 Bug fix (non-breaking change fixing an issue)
- [ ] 💡 Feature enhancement (Action, site preview, or tooling)
- [ ] 📝 Documentation update

## Checklist

- [ ] My code adheres to the project guidelines in [CONTRIBUTING.md](CONTRIBUTING.md).
- [ ] `npm test` passes locally.
- [ ] `npm run typecheck` passes with no errors.
- [ ] If adding a critter:
  - [ ] Motion completes a whole number of cycles and loops seamlessly without jumps.
  - [ ] Outline is clearly visible on both light mode and dark mode (`#0d1117`).
  - [ ] Total GIF file size remains under 1 MB.
  - [ ] Added to the list in `src/critters/index.ts`.
- [ ] If changing the engine or Action runner, I ran `npm run build` to update `dist/action.cjs`.
