# Showcase project

This is the playable beginning of the public reference game described in `BUILD_PLAN.md`. Its seven-scene lighthouse story runs through the real compiler, deterministic runtime, and production player; it demonstrates dialogue, interpolation, choices, conditions, calls, effects, multiple endings, chronological history, and manual/quick/automatic saves with JSON import and export. It is an ordinary manifest-backed engine project. `pnpm build:showcase:pages` sends it through the shared release web exporter, verifies the repository-relative artifact, and reproduces the folder deployed to [GitHub Pages](https://zeidalidiez.github.io/RPGNarrativeEngine/). The published build is an offline-capable PWA with an explicit update prompt.

It is not yet the complete RPG showcase. World exploration, combat, inventory, progression, themes, audio, localization fixtures, and the Systems Gallery will arrive with their corresponding engine systems.
