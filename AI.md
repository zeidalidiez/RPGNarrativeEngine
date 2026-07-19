# AI implementation handoff

Last updated: 2026-07-18

This file is the current implementation map for AI agents and human contributors. Update it whenever meaningful code changes. Remove or rewrite stale statements instead of accumulating a historical log here; Git already provides the history.

## Current implementation state

The repository now has a runnable browser-game path in addition to its contracts and parser:

- `@rpgnarrativeengine/compiler` lowers normalized story ASTs into the versioned types owned by `@rpgnarrativeengine/ir`. It compiles narration/dialogue and safe inline content, expressions, conditionals, adjacent choice groups, `@set`, `@goto`, `@call`, `@return`, and `@ending`. Other commands are retained as host effects. Compilation rejects malformed command arguments, duplicate scenes, invalid start scenes, and missing scene references.
- `@rpgnarrativeengine/project` parses full TOML with pinned `smol-toml`, validates the stable project identity, exact version, entry scene, locale, story globs, distribution/player/feature/build settings, rejects absolute/traversing paths, finds a single selected `project.toml`, removes a browser directory-selection prefix, and de-duplicates paths. It returns both every normalized selected text file and the matching `.story` files in Unicode-code-point path order so browser and future filesystem hosts can preserve editable project buffers. `[story].files` supports path segments, `*`, `**`, and `?`; broader shell expansion syntax is rejected explicitly.
- `compileStoryProject` compiles those ordered files into one project-global scene graph. Syntax and command issues retain their source path; cross-file duplicate scenes and broken references fail together instead of being hidden by file boundaries. The original `compileStory` remains the single-source convenience API used by the scratchpad.
- `@rpgnarrativeengine/runtime` is a deterministic, DOM-independent interpreter. It owns flat dotted-path narrative variables, strict expression evaluation, nested instruction frames, scene call continuations, conditional/choice execution, state mutation, effect dispatch, explicit and natural completion, restart, and a small player-facing view union. It uses an execution budget to stop non-yielding loops.
- `@rpgnarrativeengine/player` mounts an accessible browser player with no framework dependency. It creates semantic DOM without `innerHTML`, renders the supported rich-text nodes, exposes native-button choices/continue/restart controls, focuses the active control, and reports runtime failures inside the player.
- `@rpgnarrativeengine/exporter-web` turns one compiled game bundle into a static HTTP folder, deterministic uncompressed ZIP, or direct-open single HTML. Folder and single-file outputs use the same generated production player bundle, default responsive player CSS, canonical game JSON, and SHA-256 content identity. Folder output uses only relative/self-hosted files and a restrictive CSP; single HTML inlines the exact hashed CSS/JavaScript under a hash-based CSP and embeds escaped JSON without requiring a server. ZIP entries use UTF-8 names, fixed timestamps, CRC-32, canonical path order, and no host metadata.
- `@rpgnarrativeengine/build` is the working shared GUI/CLI-neutral build-service surface. `buildWebProject` validates and loads project buffers, resolves configured or explicit one-run `bundle`/web targets and profile overrides without rewriting source, compiles the story graph once, checks cancellation between phases, emits progress, and returns browser/host-neutral output bytes. Its canonical layout currently includes `bundle/game-bundle.json`, `web/folder`, web ZIP/HTML artifacts, `artifact-manifest.json`, `build-report.json`, and `checksums.sha256`; all artifact records cite one canonical bundle hash. PWA, notices/SBOM composition, richer structured failures/logs, and native targets remain pending.
- `@rpgnarrativeengine/cli` now exposes the real `rpgne` executable and filesystem adapter for `rpgne build`. It discovers root `project.toml` plus ordinary `.story` files without following symlinks or reading the configured output directory, calls the same build service as the GUI, and writes the complete canonical output tree. Output overrides must remain project-relative; existing symlink components are rejected. A project-local exclusive lock prevents concurrent promotion, files are written to a sibling staging directory, the previous output is moved to a recoverable backup, promotion uses same-filesystem renames, and failures before promotion leave the last successful output untouched. The command supports repeated `bundle`/`web`/`web-zip`/`web-single` targets, configured `all`, development/release profile overrides, output overrides, clean replacement semantics, text/JSON reports, progress, and a distinct partial exit when configured native targets are unavailable. `create`, `dev`, `lint`, and `test` remain pending CLI commands.
- `examples/showcase/story/lighthouse.story` is a seven-scene reference story exercising dialogue, interpolation, state, choice conditions, branches, calls/returns, effects, transitions, and multiple endings. The Vite app compiles it from source in the browser and mounts the real player. Its production build uses relative asset URLs so the output can be served from a GitHub Pages project path.
- `apps/playground` is a working creator-facing browser application. Its scratch mode edits, locally persists, imports, and downloads a standalone `.story` file. Project mode accepts a selected directory, strips its browser upload prefix through the project loader, keeps `project.toml` and all selected story sources as switchable in-memory buffers, initially opens the file declaring the manifest entry scene, reloads the edited manifest/globs on every run, and compiles the selected story sources together. Both modes compile on demand or with Ctrl/Cmd+Enter and mount the production player for preview. Project-aware diagnostics show file/line/column, switch to the failing buffer, select the exact source range, and preserve edits while moving among files. Its GUI Build project dialog derives defaults from the edited manifest, exposes explicit ZIP and single-HTML choices without rewriting source, reports progress and the canonical bundle hash, and downloads the requested artifacts plus their manifest. This is not filesystem-backed save yet: the directory picker is read-only and Download file exports only the active source buffer.
- `templates/first-story` is the first ordinary creator template and proves manifest entry-scene selection plus cross-file scene references. `examples/showcase/project.toml` makes the public demo a normal manifest-backed project even though its current Vite entry imports the story source directly.

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

The shared contracts and story language currently provide:

- C-01 stable ID grammar, branded ID kinds, reserved first-party namespace enforcement, editor-only ID suggestions, namespace ownership checks, and deterministic rename migration validation/resolution.
- Half-open source positions/spans using zero-based UTF-16 offsets and one-based lines/columns with fixed LF/CRLF semantics.
- C-04 diagnostic code ranges, severities, source/related locations, deterministic serialization, release severity policy, and conflict-checked expected-text source edits.
- Exact SemVer 2.0.0 parsing and precedence without JavaScript integer precision loss, structured compatibility intervals, prerelease policy, and conventional stable/pre-1.0 upper-bound derivation.
- Published stable-ID, semantic-version, and diagnostic JSON Schemas plus valid/invalid fixtures checked with Ajv 2020.
- C-02 syntax is fixed in `docs/contracts/story-language.md` and Build Plan sections 11.8-11.9. `@rpgnarrativeengine/language` implements variable-path, finite-number, exact-duration, and quoted-string lexical primitives plus the shared Lezer grammar, generated parser, indentation/context tokenizer, recoverable CST, and source-ranged character/indentation/parse issues. Valid files normalize into a deeply immutable AST for scenes, trivia, generic commands, conditionals, choices, narration/dialogue, and safe inline text. Normalization validates stable IDs, dialogue variants, and block markers; rebases embedded choice/`@if`/interpolation expressions to file coordinates; separates comments and content IDs from rendered text; models explicit continuation breaks; decodes documented escapes; supports emphasis, strong text, language spans, and pronunciation hints; and rejects unsafe HTML/tags, nested engine spans, malformed dialogue/markup, shorthand-target/body conflicts, and nested v1 choices. The compiler currently owns the executable semantics for core commands; a reusable command-schema layer and formatter remain pending.
- C-03 publishes executable operator precedence, strict typed arithmetic/equality/short-circuit behavior, pure standard functions, module namespace roots, and seeded-random metadata. The same Lezer grammar exposes a standalone expression top rule with tested precedence, calls, booleans, and recovery ranges. Valid expressions normalize into a deeply immutable public AST that is independent of Lezer node shapes; it preserves raw literals, decodes validated values, and attaches shared C-01 UTF-16 source spans. Resolution and type checking remain pending. Random execution remains intentionally absent until C-08 vectors define it.
- `source-span-map.ts` indexes logical line breaks once and maps arbitrary AST ranges without allocating a position for every source character. Its LF, CRLF, lone-CR, and UTF-16 behavior must stay identical to `@rpgnarrativeengine/contracts`.

There is not yet a story formatter, full static type checker, save format, RPG behavior module, full desktop editor, native shell, PWA exporter, or native exporter. Empty entry points outside the runnable path still establish buildable boundaries only and must not be described as implemented product features.

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
- Parsing: Lezer Generator 1.8.0, Lezer LR 1.4.10, and Lezer Common 1.5.2.

Dependencies are exact, not range-prefixed. Update them intentionally and commit the resulting lockfile.

## Package ownership

`packages/` owns engine-level concepts:

- `contracts`: public primitives shared by multiple packages. It currently owns stable IDs, semantic versions and compatibility intervals, source locations, diagnostics, safe text-edit descriptions, their schemas, and their fixtures.
- `language`: owns the story/expression grammar, CST/AST, formatting, and language services. It currently implements lexical contract helpers, executable expression primitives/metadata, the shared generated Lezer CST parser, the normalized expression AST/source mapper, and story/dialogue/safe-inline AST normalization. Command semantics, formatting, and higher language services remain pending.
- `project`: currently owns typed `project.toml` parsing/validation, safe normalized paths, deterministic story glob discovery, and browser/host-neutral file loading. Lockfiles, asset catalogs, migrations, and filesystem adapters remain pending.
- `ir`: currently owns the TypeScript shape of version-1 compiled games, expressions, inline content, scenes, choices, and instructions. JSON schema/readers/migrations remain pending.
- `compiler`: currently parses and lowers either one story source or an ordered multi-file project into IR, validates project-global scene identity/references, retains file paths on compiler issues, and gives core flow commands executable meaning. Full symbol resolution, typing, broader analysis, structured diagnostics, and module lowering remain pending.
- `module-sdk`: first-party module lifecycle, transactions, events, and capabilities.
- `runtime`: currently owns the deterministic narrative interpreter, variable state, expression execution, call/control stacks, effects, and player-facing projection. Scheduling, RNG, save serialization, migrations, module transactions, and replay logs remain pending.
- `player`: currently owns the dependency-free semantic DOM player. Themed components, backlog/history, settings, save/load UI, audio controls, and localization UI remain pending.
- `audio`, `theme`, `plugin-sdk`, `editor-source`: their named narrow domains.
- `build`: currently owns browser/host-neutral web build orchestration, progress/cancellation checks, artifact metadata, checksums, and canonical output layout. Atomic filesystem staging, target discovery beyond web, and richer failure results remain pending.
- `exporter-web`: currently owns static folder, deterministic ZIP, single-HTML assembly, default exported-player presentation, CSP generation, and web artifact hashing. PWA and declared asset inlining/copying remain pending.
- `cli`: currently owns the Node filesystem adapter, safe atomic output promotion, argument parsing, console reporting, and `rpgne build` executable. Other planned commands remain pending.
- `exporter-desktop` and `exporter-mobile`: their named adapters/targets remain package boundaries only.
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

Run `pnpm check` before committing. For focused work on the runnable path, `pnpm --filter @rpgnarrativeengine/showcase... build` builds the compiler, IR, runtime, player, and demo in dependency order. The complete check performs:

1. Formatting verification.
2. All workspace builds, which create the package declarations required for clean-checkout typed module resolution.
3. Typed linting against those public package declarations.
4. Package-boundary/cycle and no-Electron policies.
5. Workspace and tool-script type checking.
6. Unit, integration, e2e, accessibility, determinism, and conformance command surfaces.
7. Raw/gzip size reporting.
8. Installed dependency license inventory.
9. CycloneDX 1.6 SBOM generation.

Some suites intentionally have no domain fixtures yet and use their test runner's explicit pass-with-no-tests option. Replace that state with real tests as each subsystem arrives; never add meaningless assertions merely to make a suite nonempty.

`pnpm lint` first builds package/module declarations and then runs `lint:source`; do not remove that prerequisite while workspace package exports point at `dist`. CI starts from a clean checkout with no ignored `dist` folders, while a developer's tree may retain them and otherwise hide unresolved-type lint failures.

Ordinary generated build output belongs in `dist/`, `build/`, `coverage/`, `playwright-report/`, or `test-results/` and is ignored. Do not commit it. `packages/build` is the source package named `build`, so ignore/lint/format/policy rules explicitly exempt that directory while continuing to ignore generated build directories. Two deterministic generated sources are committed for clean checkouts: `packages/language/src/story-parser.generated*.ts` comes from `story.grammar`, and `packages/exporter-web/src/web-player-bundle.generated.ts` comes from `pnpm --filter @rpgnarrativeengine/exporter-web generate:player`. Never edit either by hand.

## Immediate next implementation order

Build outward from the working path rather than returning to contract-only work:

1. Add runtime save snapshots and deterministic RNG, then expose save/load in the player.
2. Add PWA output, structured build logs/failures, notices/SBOM composition, and target discovery through the same working GUI/CLI service.
3. Move the working playground and Build project surfaces into the Tauri editor shell with filesystem-backed project open/save, output-folder actions, and source conflict handling.
4. Continue command schemas, static typing, formatting, localization, modules, and native Tauri targets as those working paths require them.
