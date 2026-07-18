# AI implementation handoff

Last updated: 2026-07-18

This file is the current implementation map for AI agents and human contributors. Update it whenever meaningful code changes. Remove or rewrite stale statements instead of accumulating a historical log here; Git already provides the history.

## Current implementation state

Build Stage 1 is implemented as a working repository foundation:

- pnpm monorepo with an exact pnpm version and Node 24.18.0 LTS pinned for CI.
- Strict TypeScript 6 configuration with a root tooling config and independent package configs.
- ESLint flat configuration, Prettier, Vitest, Playwright, and Vite application/library configs.
- One fast Linux GitHub Actions verification job. Do not add an operating-system matrix until native editor/exporter work creates real platform-specific behavior to test.
- `.gitattributes` normalizes repository text to LF on every platform; do not replace this with host-dependent line endings.
- All package, first-party module, editor, playground, and showcase boundaries from the build plan are present.
- Policy scripts enforce public workspace imports, declared workspace dependencies, an acyclic package graph, and the permanent Electron prohibition.
- Size, dependency-license, and CycloneDX 1.6 inventory commands write generated reports beneath `build/reports/`.
- Unit fixtures prove cycle detection and Electron dependency rejection.

Build Stage 2 has begun in `@rpgnarrativeengine/contracts`:

- C-01 stable ID grammar, branded ID kinds, reserved first-party namespace enforcement, editor-only ID suggestions, namespace ownership checks, and deterministic rename migration validation/resolution.
- Half-open source positions/spans using zero-based UTF-16 offsets and one-based lines/columns with fixed LF/CRLF semantics.
- C-04 diagnostic code ranges, severities, source/related locations, deterministic serialization, release severity policy, and conflict-checked expected-text source edits.
- Exact SemVer 2.0.0 parsing and precedence without JavaScript integer precision loss, structured compatibility intervals, prerelease policy, and conventional stable/pre-1.0 upper-bound derivation.
- Published stable-ID, semantic-version, and diagnostic JSON Schemas plus valid/invalid fixtures checked with Ajv 2020.

There is deliberately no story language, compiler, IR, runtime, player, RPG behavior, editor UI, native shell, exporter, or playable showcase yet. Other empty package entry points establish buildable boundaries only and must never be described as product features.

## Canonical documents

1. `RPGNarrativeEngine-research-and-spec.md` defines the intended product and acceptance requirements.
2. `BUILD_PLAN.md` fixes implementation semantics and dependency order.
3. This file describes what the repository actually implements now.

When they disagree about implemented status, this file and executable tests describe current reality; the spec and build plan still describe the required destination.

## Toolchain

- Node.js: 24.18.0 in `.node-version`, `.nvmrc`, and CI. `package.json` permits compatible Node 24–26 development runtimes.
- pnpm: exactly 11.15.0 through `packageManager` and engine metadata.
- TypeScript: 6.0.3. Do not move to TypeScript 7 until the selected `typescript-eslint` release supports it.
- Modules: native ESM.
- Browser/app bundling: Vite 8.
- Unit/integration tests: Vitest 4.
- Browser tests: Playwright 1.61.
- Formatting/linting: Prettier 3 and ESLint 10 with typed TypeScript rules.

Dependencies are exact, not range-prefixed. Update them intentionally and commit the resulting lockfile.

## Package ownership

`packages/` owns engine-level concepts:

- `contracts`: public primitives shared by multiple packages. It currently owns stable IDs, semantic versions and compatibility intervals, source locations, diagnostics, safe text-edit descriptions, their schemas, and their fixtures.
- `language`: grammar, CST/AST, formatting, and language services.
- `project`: project manifests, lockfiles, loaders, migrations, and paths.
- `ir`: versioned compiler output schemas/readers/writers.
- `compiler`: resolution, typing, analysis, and lowering.
- `module-sdk`: first-party module lifecycle, transactions, events, and capabilities.
- `runtime`: deterministic scheduler, state machine, effects, and saves.
- `player`: semantic Lit player components and player-facing state projection.
- `audio`, `theme`, `plugin-sdk`, `editor-source`: their named narrow domains.
- `build`, `cli`, and exporter packages: shared build orchestration and target adapters.
- `accessibility` and `testkit`: cross-cutting conformance checks and deterministic fixtures, not generic utility dumping grounds.

`modules/` owns opt-in world, party, inventory, economy, progression, combat, encounters, and quest mechanics. Modules must depend inward through documented SDK/contracts and cannot make core narrative execution require RPG systems.

Do not create generic `utils`, `common`, or `shared` packages. Put behavior in the narrowest semantic owner; only genuinely public cross-package primitives belong in `contracts`.

## Non-negotiable architecture rules

- Electron is permanently prohibited. Desktop applications and packaged games use Tauri 2.
- Canonical projects are ordinary local files; no mandatory account, cloud service, telemetry, or network dependency.
- Runtime logic is deterministic and headless. Presentation and audio acknowledge effects but never determine mechanics.
- Stable IDs are identity. Display labels are never identity.
- Project source remains human-readable, Git-friendly, and authoritative. Editor changes must round-trip without destroying unrelated text/comments/formatting.
- Story-only builds cannot pay for disabled RPG modules.
- Player behavior must remain usable without images, audio, pointer input, animation, or spatial layout.
- Public package imports go through declared exports. Do not import another workspace's `src/` or reach across directories with relative paths.
- `README.md` and this file change alongside meaningful implementation changes.

## Commands and evidence

Run `pnpm check` before committing. It currently performs:

1. Formatting verification.
2. Typed linting.
3. Package-boundary/cycle and no-Electron policies.
4. Workspace and tool-script type checking.
5. Unit, integration, e2e, accessibility, determinism, and conformance command surfaces.
6. All workspace builds and the showcase boundary build.
7. Raw/gzip size reporting.
8. Installed dependency license inventory.
9. CycloneDX 1.6 SBOM generation.

Some suites intentionally have no domain fixtures yet and use their test runner's explicit pass-with-no-tests option. Replace that state with real tests as each subsystem arrives; never add meaningless assertions merely to make a suite nonempty.

Generated output belongs in `dist/`, `build/`, `coverage/`, `playwright-report/`, or `test-results/` and is ignored. Do not commit it.

## Immediate next implementation order

Continue Build Stage 2 in `packages/contracts` and `docs/contracts`:

1. Define the complete C-02 story grammar and C-03 expression semantics as executable fixtures.
2. Add project manifest, feature, path, lockfile, and asset contracts.
3. Continue through the remaining contract corpus before dependent runtime/editor behavior.

Do not jump into editor screens or game mechanics before their contracts exist. This is a dependency constraint, not a request to reduce the project's scope.
