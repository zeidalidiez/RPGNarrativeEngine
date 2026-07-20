# RPG Narrative Engine

RPG Narrative Engine is a free, open-source, prose-first game engine for branching stories and text RPGs. It is being built around readable source files, deterministic game logic, strong authoring tools, accessible player interfaces, and creator-owned projects that do not require an account or hosted service.

The desktop editor uses Tauri 2. Electron is not and will not be part of this project.

## Current status

The first complete playable path now works. A creator `project.toml` is validated into a typed manifest, its `[story].files` globs safely discover canonically ordered story sources, and those files compile together into a serializable, platform-neutral instruction format with project-wide scene/reference validation. The headless runtime executes state changes, expressions, branches, calls, choices, effects, scene transitions, and endings; and the browser player renders the result with safe semantic DOM. `random()` expressions and future module mechanics use independent, deterministic named random streams rather than `Math.random`. Save-enabled web exports include visible **Save game** and **Load game** controls backed by a versioned runtime snapshot, including exact random-stream continuation. The creator app opens in a visual **Scene Builder**, not the raw text editor: its project-wide scene navigator and structured cards create and edit narration, dialogue, choices, state/actions, endings, and nested conditional branches through labeled controls. Conditions can be assembled as one rule or grouped **All**/**Any** rules, with advanced expressions still available when needed. The editable **Story Map** displays the real project graph and can create, rename, duplicate, position, and safely delete scenes; add, retarget, or remove choice/jump/call connections, including removable nested-branch connections; and open any node in the card editor. Dragged or explicitly entered map positions are creator-only data stored separately in `.rpgne/editor.json`, so layout never changes game behavior or ships in game output. Scene lifecycle source transactions update declarations, content IDs, incoming references, project entry scenes, and map metadata together. Visible **Undo** and **Redo** controls plus standard keyboard shortcuts restore those whole-project transactions as one action in both browser and native hosts; Advanced Source typing bursts coalesce into useful steps instead of one step per character. **Advanced Source** remains an optional escape hatch, and every visual story operation updates the same canonical, portable story files. The same Creator Studio now runs inside a Tauri 2 desktop shell: a native folder picker opens local projects, the header shows saved/unsaved/on-disk-conflict state, Ctrl/Cmd+S writes project sources, reload and close/open actions protect unsaved work, and focus/save checks prevent silently overwriting externally changed files. A successful native save marks the exact saved history state clean without deleting earlier undo or later redo entries. The GUI Build workspace creates deterministic web outputs and, in the desktop shell, safely promotes them into the configured project build directory with an **Open folder** action; the matching `rpgne build` command provides the same output tree from a terminal. `templates/first-story` is a working two-file starter project, and `examples/showcase` contains the GitHub Pages reference story. Player transcript/save history, save migration and auto-save, continuous filesystem watching, PWA output, desktop installers, and native game packages remain to be built.

The complete intended product is documented in:

- [Research and specification](./RPGNarrativeEngine-research-and-spec.md)
- [Dependency-ordered build plan](./BUILD_PLAN.md)
- [Implementation handoff for AI contributors](./AI.md)

Implemented public foundation contracts are indexed in [docs/contracts](./docs/contracts/README.md).

## Development setup

Use Node.js 24.18.0 LTS and pnpm 11.15.0. The exact versions are recorded in `.node-version`, `.nvmrc`, `package.json`, and CI.

Git normalizes repository text files to LF on every platform so formatting and generated hashes do not change between Windows, macOS, and Linux.

```sh
corepack enable
corepack prepare pnpm@11.15.0 --activate
pnpm install --frozen-lockfile
pnpm check
```

If your Node installation does not include Corepack, install the exact pnpm version through the supported method for your platform rather than using an unpinned global version.

Useful commands:

```sh
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm --filter @rpgnarrativeengine/showcase dev
pnpm --filter @rpgnarrativeengine/playground dev
pnpm editor:dev
pnpm editor:build
pnpm rpgne build templates/first-story --target all
pnpm build:reference
pnpm policy
pnpm size
pnpm run licenses
pnpm run sbom
```

`pnpm check` runs the complete current verification chain. `pnpm editor:dev` additionally requires a current Rust toolchain and the native prerequisites documented by Tauri for your operating system. The current native build creates the host executable but deliberately does not create installers yet. Generated size, license, and CycloneDX reports are written beneath `build/reports/` and are intentionally ignored by Git. The explicit `run` in `pnpm run licenses` is required because pnpm also has a built-in `licenses` command.

## Repository shape

- `apps/` contains the shared Creator Studio frontend and its working Tauri 2 desktop filesystem host.
- `packages/` contains narrowly owned engine, compiler, runtime, player, exporter, SDK, and tooling packages.
- `modules/` contains opt-in first-party RPG systems.
- `examples/showcase/` contains the playable public reference game and its static-site build.
- `templates/` contains the working First Story creator project; additional project templates and the generated Tauri game shell remain planned.
- `tests/` contains unit, integration, end-to-end, accessibility, determinism, and conformance suites.
- `docs/` contains contracts, architecture decisions, and authoring/implementation documentation.

Packages may import other workspace packages only through declared public exports. A repository policy check rejects dependency cycles, undocumented internal imports, and any Electron dependency or import.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). This is a passion project: clear code, useful tests, honest documentation, and respect for creator/player ownership matter more than process theater.

## License

Engine code, editor code, CLI code, SDKs, and code templates are released under the [MIT License](./LICENSE). Sample prose and assets may use separately documented permissive terms when they are added.
