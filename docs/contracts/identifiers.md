# C-01: Identifier and namespace contract

Status: Implemented foundation contract

## Canonical grammar

A stable ID is an exact, case-sensitive ASCII string between 1 and 128 characters:

```text
^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$
```

- Lowercase ASCII letters, digits, hyphens, and underscores are ordinary segment characters.
- Dots separate non-empty namespace segments. They cannot appear first, last, or consecutively.
- A segment may begin or end with a digit, hyphen, or underscore. This is intentional; the contract does not invent an identifier-start restriction absent from the language specification.
- Uppercase and non-ASCII characters are invalid. Validation never trims, lowercases, transliterates, or Unicode-normalizes authored IDs.
- Comparison and duplicate detection use exact code-unit equality. Because uppercase is invalid, case-only aliases cannot enter canonical data.

The published JSON Schema is `schemas/stable-id.schema.json`; the TypeScript contract and validators are exported by `@rpgnarrativeengine/contracts`.

## Identity and kinds

The same grammar is branded into project, scene, content, voice, variant, asset, transition, entity, actor, module, plugin, command, event, effect, and localization ID types. Branding prevents accidental cross-kind assignment in TypeScript but does not change serialized strings.

Display names, filenames, source order, and localized labels are never identity. Editor-created IDs use `suggestStableId` only as a visible suggestion; the compiler never applies it implicitly.

Examples:

| Value                      | Result  | Reason                                |
| -------------------------- | ------- | ------------------------------------- |
| `start`                    | Valid   | One ordinary segment.                 |
| `station.arrival`          | Valid   | Two non-empty namespace segments.     |
| `shared.train-rumble`      | Valid   | Hyphens are allowed inside a segment. |
| `2v2_tutorial`             | Valid   | Digits and underscores are allowed.   |
| `Mara`                     | Invalid | Uppercase is not canonical.           |
| `.start`, `start.`, `a..b` | Invalid | Namespace segments cannot be empty.   |
| `café`                     | Invalid | Canonical IDs are ASCII.              |

## Namespace ownership

`rpgne` and every `rpgne.*` ID are reserved for first-party engine and module content. Ordinary project/plugin validation rejects that namespace. Code declaring first-party IDs must opt into it explicitly with `allowReservedNamespace: true`; merely loading an untrusted project or plugin never enables that option.

A plugin's globally unique reverse-domain plugin ID is its root namespace. For example, plugin `org.example.weather` may own `org.example.weather.thunder`. Ownership is exact-root-or-descendant matching; the visually similar `org.example.weathered` is not owned by it.

Unqualified project IDs and project-chosen namespaces are project-owned. A duplicate canonical ID within a kind's project-wide registry is an error even when declarations come from different files. Cross-kind reuse is allowed only when the consuming contract explicitly maintains separate registries; callers may not assume that a scene ID and asset ID share a registry.

## Rename migrations

A migration maps one old branded ID to one new ID of the same kind. Chains are valid and resolve to their final target. These are invalid:

- More than one target for the same source ID.
- An ID mapped to itself.
- Any direct or indirect cycle.

Several old IDs may intentionally converge on one current ID. Migration validation and resolution are deterministic and never silently choose between duplicate source mappings.
