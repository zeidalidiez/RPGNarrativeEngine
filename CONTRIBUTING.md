# Contributing

Thank you for helping build RPG Narrative Engine. This is a free, open-source passion project. Contributions can be small or ambitious; they need to preserve the engine's explicit contracts and creator/player ownership.

## Before changing code

Read `README.md`, `AI.md`, the relevant part of `BUILD_PLAN.md`, and the corresponding specification section. Use Node 24.18.0 and pnpm 11.15.0, then install with the frozen lockfile.

## Expectations

- Keep code in the package that owns its semantics.
- Declare workspace dependencies and import only their documented exports.
- Add focused tests for behavior and failure cases.
- Update `README.md` and `AI.md` whenever a meaningful feature or architectural behavior changes.
- Update contract documentation when public semantics change.
- Preserve deterministic, offline-capable, accessible behavior.
- Never introduce Electron, mandatory accounts, hidden telemetry, DRM, or a required hosted backend.
- Do not commit generated `dist/`, `build/`, coverage, browser, or test-report output.

Run this before submitting changes:

```sh
pnpm check
```

Open a normal, ready-for-review pull request with a clear description of the behavior and verification. A particular change does not need to fit an artificial size limit; it does need to be understandable, internally consistent, and honest about incomplete work.
