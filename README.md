# RPG Narrative Engine

RPG Narrative Engine is a free, open-source, prose-first game engine for branching stories and text RPGs. It is being built around readable source files, deterministic game logic, strong authoring tools, accessible player interfaces, and creator-owned projects that do not require an account or hosted service.

The desktop editor uses Tauri 2. Electron is not and will not be part of this project.

## Current status

The first complete playable path now works. A creator `project.toml` is validated into a typed manifest, its `[story].files` globs safely discover canonically ordered story sources, and those files compile together into a serializable, platform-neutral instruction format with project-wide scene/reference validation. The headless runtime executes state changes, expressions, branches, calls, choices, effects, scene transitions, and endings; and the browser player renders the result with safe semantic DOM. The player retains recent narration and speakers as a composed text stage, gives the current exchange visual priority, preserves conversation context around choices and endings, and reflows the same chronological HTML into a narrow-screen reading order. `random()` expressions and future module mechanics use independent, deterministic named random streams rather than `Math.random`. The save system now records exact execution and random state together with chronological transcript and read history. Save-enabled players expose a visible History panel, three manual slots, quick save/load, action-based autosave, and validated JSON import/export. Old schema-1 saves migrate into the current schema, and declared deterministic migrations can move compatible saves between canonical game builds without partially mutating a live playthrough.

The creator app opens in a visual **Scene Builder**, not the raw text editor: its project-wide scene navigator and structured cards create and edit narration, dialogue, choices, state/actions, endings, and nested conditional branches through labeled controls. Conditions can be assembled as one rule or grouped **All**/**Any** rules, with advanced expressions still available when needed. The editable **Story Map** displays the real project graph and can create, rename, duplicate, position, and safely delete scenes; add, retarget, or remove choice/jump/call connections, including removable nested-branch connections; and open any node in the card editor. Dragged or explicitly entered map positions are creator-only data stored separately in `.rpgne/editor.json`, so layout never changes game behavior or ships in game output. Scene lifecycle source transactions update declarations, content IDs, incoming references, project entry scenes, and map metadata together. Visible **Undo** and **Redo** controls plus standard keyboard shortcuts restore those whole-project transactions as one action in both browser and native hosts; Advanced Source typing bursts coalesce into useful steps instead of one step per character. **Advanced Source** remains an optional escape hatch, and every visual story operation updates the same canonical, portable story files. The same Creator Studio now runs inside a Tauri 2 desktop shell with protected native project opening, durable multi-file save transactions, recovery, external-change detection, and filesystem watching. The GUI Build workspace and matching `rpgne build` command create the same deterministic web-folder, ZIP, single-HTML, and optional offline-PWA outputs. `templates/first-story` is a working two-file starter project, and the ordinary `examples/showcase` project is built and deployed unchanged to the [live GitHub Pages demo](https://zeidalidiez.github.io/RPGNarrativeEngine/). That ten-scene reference story now demonstrates the text-first presentation directly: ornate narration, retained multi-speaker duets, speaker-specific frame geometry and color, urgent/radio/memory/command/quiet/wry/steady/relieved/distant effects, route-colored choices, and styled endings, without depending on character portraits or illustrated backgrounds. It also exercises rich text, deterministic weather, conditional routes, calls, effects, and three endings. Player settings/auto-advance/skip-read, creator-configurable theme authoring, the RPG module stack, desktop installers, and native game packages remain to be built.

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
pnpm build:showcase:pages
pnpm policy
pnpm size
pnpm run licenses
pnpm run sbom
```

`pnpm check` runs the complete current verification chain. `pnpm build:showcase:pages` reproduces and verifies the exact static folder deployed by GitHub Pages at `examples/showcase/build/web/folder/`; it does not use a special demo runtime. `pnpm editor:dev` additionally requires a current Rust toolchain and the native prerequisites documented by Tauri for your operating system. The current native build creates the host executable but deliberately does not create installers yet. Generated size, license, and CycloneDX reports are written beneath `build/reports/` and are intentionally ignored by Git. The explicit `run` in `pnpm run licenses` is required because pnpm also has a built-in `licenses` command.

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
