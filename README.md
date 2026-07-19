# RPG Narrative Engine

RPG Narrative Engine is a free, open-source, prose-first game engine for branching stories and text RPGs. It is being built around readable source files, deterministic game logic, strong authoring tools, accessible player interfaces, and creator-owned projects that do not require an account or hosted service.

The editor will use Tauri 2. Electron is not and will not be part of this project.

## Current status

The first complete playable path now works. A creator `project.toml` is validated into a typed manifest, its `[story].files` globs safely discover canonically ordered story sources, and those files compile together into a serializable, platform-neutral instruction format with project-wide scene/reference validation. The headless runtime executes state changes, expressions, branches, calls, choices, effects, scene transitions, and endings; and the browser player renders the result with safe semantic DOM. `templates/first-story` is a working two-file starter project. `examples/showcase` contains the manifest-backed branching story **The Light at Brinewatch**, which can be built as a static GitHub Pages site. `apps/playground` provides a creator-facing browser workspace for editing, opening, downloading, compiling, diagnosing, and playing `.story` source without a terminal. Save data, full desktop authoring workspaces, and packaged-game exporters remain to be built.

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
pnpm build:reference
pnpm policy
pnpm size
pnpm run licenses
pnpm run sbom
```

`pnpm check` runs the complete current verification chain. Generated size, license, and CycloneDX reports are written beneath `build/reports/` and are intentionally ignored by Git. The explicit `run` in `pnpm run licenses` is required because pnpm also has a built-in `licenses` command.

## Repository shape

- `apps/` contains the working browser story playground and the desktop editor application boundary.
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
