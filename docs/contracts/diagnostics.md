# C-04: Source locations and diagnostics contract

Status: Implemented foundation contract

## Source coordinates

Source spans are half-open: the start is inclusive and the end is exclusive. Positions contain:

- A zero-based UTF-16 code-unit offset, matching JavaScript strings, CodeMirror, and browser APIs.
- A one-based line.
- A one-based UTF-16 code-unit column.

LF, CRLF, and lone CR are accepted as line endings; CRLF counts as one logical break. The offset between CR and LF and the offset after LF can therefore share a visual line/column while retaining distinct absolute offsets. Astral Unicode characters occupy two UTF-16 offsets/columns. These rules prevent Node, browser, and editor adapters from inventing different coordinates.

A span end cannot precede its start by offset or line/column. Every diagnostic has a non-empty source file identifier and primary span. Project-relative path normalization is finalized by the project/path contract; diagnostics do not independently reinterpret filenames.

## Stable codes and ownership

Codes match `RPGNE` plus four digits from 1000 through 9999. Numeric ranges are owned as follows:

|     Range | Owner                                                        |
| --------: | ------------------------------------------------------------ |
| 1000–1999 | Story language, parser, formatter, and language services     |
| 2000–2999 | Project manifests, assets, lockfiles, and paths              |
| 3000–3999 | Resolution, type checking, analysis, and compiler lowering   |
| 4000–4999 | Runtime, state, effects, saves, and migrations               |
| 5000–5999 | Player, accessibility, theme, and audio presentation         |
| 6000–6999 | First-party RPG modules                                      |
| 7000–7999 | Plugin manifests, capabilities, compatibility, and isolation |
| 8000–8999 | Editor, CLI, build service, and exporters                    |
| 9000–9999 | Internal invariants, testkit, and conformance infrastructure |

A code's meaning is stable once released. Rewording for clarity is allowed only when snapshots and documentation are intentionally updated; a different condition receives a different code.

## Diagnostic shape

Every serialized diagnostic contains these fields in stable order:

1. `code`
2. `severity`: `error`, `warning`, or `information`
3. A non-empty, single-line plain-language `message`
4. Primary `location`
5. Zero or more `related` message/location pairs
6. Zero or more `fixes`
7. Deduplicated, sorted tags from `accessibility`, `deprecated`, `security`, and `unnecessary`

The JSON representation must validate against `schemas/diagnostic.schema.json`. `serializeDiagnostic` emits two-space JSON plus a trailing newline for snapshot stability.

## Fixes

A fix is labeled `automatic` or `suggested` and contains one or more atomic source edits. Every edit records its file, half-open span, exact expected source text, and replacement. The expected text must have the same UTF-16 length as the span. This lets the later source-edit transaction layer reject stale files rather than overwriting unrelated work.

Edits are sorted deterministically by file and offset. Overlapping replacements and multiple insertions at the same offset are rejected because their order would be ambiguous. A multi-file fix either applies atomically through the source-edit transaction contract or does not apply.

`automatic` means the edit is mechanically safe under its expected-source precondition. `suggested` means creator judgment may be required. Neither label permits bypassing reparsing, validation, or conflict checks.

## Release policy

Base severities belong to the producing diagnostic. A calling lint profile may promote warnings to errors or apply an explicit code-specific severity override without changing the diagnostic code or message. Accessibility requirements that the specification marks non-waivable cannot be suppressed by treating them as aesthetic warnings; that enforcement is added with the accessibility/release-lint contract.
