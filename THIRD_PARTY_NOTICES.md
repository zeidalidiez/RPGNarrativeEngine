# Third-party notices

The repository foundation currently uses development dependencies for compilation, linting, formatting, testing, and bundling. They are not automatically part of a future game or editor distribution.

Run `pnpm run licenses` after installation to generate `build/reports/dependency-licenses.json`, an inventory taken from the exact installed lockfile state. Run `pnpm run sbom` to generate the matching CycloneDX build-environment report. Its components are required to reproduce this source workspace; they are not automatically runtime components of a future game. Release packaging will create artifact-specific notices and SBOMs so creators do not receive irrelevant development dependencies.

Every future bundled asset, font, sample, library, and binary must retain its required notices. Do not copy third-party material into this repository without recording its source and redistribution terms.
