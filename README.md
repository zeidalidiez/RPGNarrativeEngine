# RPG Narrative Engine

RPG Narrative Engine is a free, open-source, prose-first game engine for branching stories and text RPGs. It is being built around readable source files, deterministic game logic, strong authoring tools, accessible player interfaces, and creator-owned projects that do not require an account or hosted service.

The editor will use Tauri 2. Electron is not and will not be part of this project.

## Current status

The repository has its foundation and the first executable contracts. The workspace, strict TypeScript toolchain, focused Linux CI, package boundaries, policy checks, build reporting, application shells, and first-party module boundaries exist. Stable IDs/namespaces, semantic versions and compatibility intervals, UTF-16 source spans, diagnostics, safe source-edit descriptions, story lexical primitives, strict expression operations/functions, TypeScript APIs, JSON Schemas, and valid/invalid fixtures are implemented. A shared generated Lezer parser now builds recoverable concrete syntax trees for story files and precedence-correct standalone expressions, with source-ranged line-character and indentation issues. Valid expressions also normalize into an immutable, Lezer-independent AST with decoded literals and exact source spans. The normalized story AST, compiler, runtime, editor UI, player, and public showcase are not implemented yet.

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
pnpm policy
pnpm size
pnpm run licenses
pnpm run sbom
```

`pnpm check` runs the complete current verification chain. Generated size, license, and CycloneDX reports are written beneath `build/reports/` and are intentionally ignored by Git. The explicit `run` in `pnpm run licenses` is required because pnpm also has a built-in `licenses` command.

## Repository shape

- `apps/` contains the editor and browser playground application boundaries.
- `packages/` contains narrowly owned engine, compiler, runtime, player, exporter, SDK, and tooling packages.
- `modules/` contains opt-in first-party RPG systems.
- `examples/showcase/` is reserved for the public reference game and eventual GitHub Pages deployment.
- `templates/` will contain creator project templates and the generated Tauri game shell.
- `tests/` contains unit, integration, end-to-end, accessibility, determinism, and conformance suites.
- `docs/` contains contracts, architecture decisions, and authoring/implementation documentation.

Packages may import other workspace packages only through declared public exports. A repository policy check rejects dependency cycles, undocumented internal imports, and any Electron dependency or import.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). This is a passion project: clear code, useful tests, honest documentation, and respect for creator/player ownership matter more than process theater.

## License

Engine code, editor code, CLI code, SDKs, and code templates are released under the [MIT License](./LICENSE). Sample prose and assets may use separately documented permissive terms when they are added.
