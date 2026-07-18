# Semantic version and compatibility contract

Status: Implemented foundation contract

## Exact versions

Engine, project, module, plugin, format, and API versions use exact Semantic Versioning 2.0.0 strings. A canonical version contains `major.minor.patch`, followed by optional prerelease and build identifiers.

- Core and numeric prerelease identifiers do not contain leading zeroes.
- A `v` prefix, range operator, surrounding whitespace, missing component, or underscore is invalid.
- Parsing never trims or repairs a version.
- Core numbers are compared as arbitrary-length decimal integers, so comparison does not lose precision in JavaScript.
- Prerelease precedence follows SemVer 2.0.0. A release has greater precedence than a prerelease of the same core version.
- Build metadata is preserved but ignored for precedence and compatibility. For example, `1.2.3+linux` and `1.2.3+windows` have equal precedence.

The exact-version schema is `schemas/semantic-version.schema.json`. `SemanticVersion` is a branded string; `semanticVersionParts` exposes core, prerelease, and build identifiers without converting unbounded core numbers to JavaScript numbers.

## Compatibility intervals

Internal compatibility checks use a structured interval with an inclusive `minimum`, an exclusive `before` bound, and an explicit `includePrerelease` flag. Either bound may be omitted. This avoids silently giving npm, Cargo, or another ecosystem's range-string grammar authority over engine files.

`compatibleSemanticVersionRange` creates the normal upper bound from a minimum:

| Minimum | `semver` interval      | Reason                                             |
| ------- | ---------------------- | -------------------------------------------------- |
| `1.2.3` | `>=1.2.3` and `<2.0.0` | Stable major versions carry compatibility.         |
| `0.2.3` | `>=0.2.3` and `<0.3.0` | Before 1.0, the minor component is the API line.   |
| `0.0.4` | `>=0.0.4` and `<0.0.5` | At 0.0, only the current patch line is compatible. |

Callers can explicitly request same-major, same-minor, or same-patch behavior when a format has a stricter published rule. Prereleases are excluded by default. A compatibility range whose minimum is itself a prerelease includes prereleases so development builds can advance toward the release within the same interval. Its exclusive upper bound ends in `-0`, which prevents a prerelease of the next compatibility line from entering the range.

Project and plugin manifests may later add a human-friendly TOML spelling only if it lowers into this same structured interval without changing the result. Unknown or ambiguous range syntax must fail rather than be guessed.
