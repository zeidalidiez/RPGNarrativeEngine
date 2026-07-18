# C-02: Story grammar contract

Status: Syntax, lexical primitives, fixtures, and recoverable Lezer CST implemented; AST normalization and formatter pending

This document is normative for `.story` source. The parser and editor grammar must accept exactly this surface and must not create a second, more permissive release grammar.

## Files, lines, and indentation

- Story files are UTF-8 and use the `.story` extension. A UTF-8 byte-order mark is accepted only at the beginning of a file; the formatter removes it.
- LF and CRLF are accepted. Lone CR is diagnosed. A final newline is optional; the formatter writes the project's configured LF or CRLF preference and a final newline.
- Structural indentation is spaces in exact two-space levels. Tabs in indentation or unquoted text are invalid rather than expanded differently by different editors.
- Blank lines and comment-only lines are trivia. They never create runtime effects.
- `//` starts a comment outside a quoted string unless its first slash is escaped. A literal `//` in narration or dialogue is written `\//`.
- At the current structural indentation, `::`, `@`, and `*` begin a scene, command, and choice. A leading backslash forces a line to be narration and is removed. Thus `\* text`, `\@ text`, and `\:: text` render with their marker; `\\` renders one leading backslash.

Indentation has only two semantic jobs: nesting conditional/choice bodies and continuing narration/dialogue. It never creates arbitrary blocks.

## Lexical forms

| Form                    | Contract                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stable IDs              | C-01 grammar: lowercase ASCII segments separated by dots.                                                                                                                             |
| Variable/function paths | `[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)*`; hyphens are excluded so `a-b` cannot mean both a path and subtraction.                                                                       |
| Numbers                 | Unsigned decimal core with optional fraction/exponent, no leading zeroes. A negative expression uses unary `-`. Every parsed/result number must be finite.                            |
| Durations               | Integer milliseconds such as `350ms`, or seconds with zero to three fractional digits such as `2s` and `0.45s`. They lower to exact integer milliseconds.                             |
| Booleans                | `true` and `false`, lowercase.                                                                                                                                                        |
| Quoted strings          | Double quotes with `\"`, `\\`, `\/`, `\n`, `\r`, `\t`, and `\u{HEX}` escapes. Physical newlines, raw controls, null, invalid Unicode scalar values, and unknown escapes are rejected. |
| Voice reference         | `voice-id` or `voice-id/variant-id`; the slash separates two stable IDs.                                                                                                              |
| Content suffix          | Whitespace followed by `^stable.content.id` as the final non-comment element of narration, dialogue, or a choice header.                                                              |
| Interpolation           | `{{ expression }}` inside translatable text. The closing delimiter is found with expression quote awareness; nesting interpolation is invalid.                                        |

The exported lexical constants and parsers in `@rpgnarrativeengine/language` are shared by the Lezer external tokenizers, future compiler adapters, forms, and tests.

## Scenes and control flow

A scene starts at top level:

```text
:: station.arrival
```

The header contains exactly one scene ID plus optional trailing comment. Scene IDs are project-global; the file path does not namespace them. Content before the first scene is invalid except for BOM, blank lines, and comments. A file may contain any number of scenes, but a project must contain at least one.

Every reachable scene path terminates explicitly with one of:

- `@goto target`
- `@return`
- `@ending id "Display name"`
- A choice group whose every choice body terminates
- An `@if` whose complete branch set terminates

End-of-scene and end-of-file never imply return, ending, or fallthrough to the next scene. `@call` is not terminal: execution returns to the following instruction.

Conditional blocks use exact indentation:

```text
@if clues.letter && trust >= 1
  @goto ending.waiting
@else
  @goto ending.departed
@end
```

`@else` is optional and appears at most once. `@else` and `@end` align with their `@if`; the body is one level deeper. Stray, duplicate, or unclosed markers are recoverable syntax errors.

## Narration and dialogue

One ordinary logical line creates one narration beat. A following physical line exactly one level deeper continues that beat and inserts an explicit line break. Further continuation lines use that same continuation indentation. A blank line, structural line, or return to the original indentation ends it.

Dialogue uses:

```text
Mara[whisper]: Don't read it here. ^letter.mara.warning
```

- The speaker portion is a configured display alias or stable voice ID.
- The optional bracket contains a stable variant ID within that voice.
- A colon followed by at least one space separates speaker and text.
- Alias matching is case-insensitive but must resolve to exactly one voice. Zero or multiple matches are compiler errors; the parser does not silently reinterpret the line as narration.
- A narration line that would otherwise look like dialogue uses a leading backslash to force narration.
- Dialogue continuation follows the same one-extra-level explicit-line-break rule as narration.

The explicit generated form is `@say voice-id[/variant-id] "Text"` followed by an optional content suffix.

## Choices

Adjacent `*` headers at the same indentation and without an intervening blank line or non-choice instruction form one choice group.

Shorthand:

```text
* Apologize -> station.apology [when courage >= 2] ^arrival.choice.apology
```

The exact suffix order is label, optional `-> target`, optional `[when expression]`, optional content ID. A shorthand arrow is terminal and cannot also have an indented body.

Long form:

```text
* Take her hand [when trust >= 1] ^arrival.choice.hand
  @set trust += 1
  @sfx cloth
  @goto station.together
```

The body is exactly one level deeper and must terminate with `@goto`, `@ending`, or `@call` followed eventually by a terminal path. It cannot fall into another choice. Nested conditionals are allowed. Nested choice groups are not part of v1.

`[when expression]` controls visibility by default. A project may present a false choice as disabled only through the project accessibility policy and player-safe reason data defined by that later contract; source truth remains the same condition.

## Commands

Commands occupy one logical line. The name immediately follows `@`. Positional arguments precede `key=value` arguments; duplicate keys are invalid. Unquoted values may be stable IDs, voice references, variable paths, booleans, numbers, durations, or documented flags. Whitespace/reserved characters require a quoted string. Commands with expression tails (`@if`, `@set`, and choice conditions) use C-03 rather than generic argument tokenization.

Core v1 names are:

| Group        | Commands                                                                    |
| ------------ | --------------------------------------------------------------------------- |
| Flow         | `if`, `else`, `end`, `goto`, `call`, `return`, `ending`, `checkpoint`       |
| State/text   | `set`, `say`, `voice`, `emit`                                               |
| Presentation | `music`, `ambient`, `sfx`, `transition`, `wait`, `layout`, `place`, `clear` |

`@set` accepts `=`, `+=`, `-=`, `*=`, and `/=`. Official module commands (`travel`, `explore`, `battle`, `party`, `item`, `currency`, `xp`, and `quest`) enter the grammar only when their module is enabled, but disabled commands still parse as commands so compilation can issue a direct feature diagnostic. Plugins follow the same registered-command rule. Unknown commands are syntax-preserving compiler errors, not narration.

## Safe text markup

Translatable payloads support:

- `*emphasis*`
- `**strong emphasis**`
- Explicit line breaks from indented continuation lines
- `[lang=BCP47]text[/lang]`
- `[pronounce="hint"]text[/pronounce]`
- Interpolation with `{{ expression }}`

Backslash escapes markup delimiters and content-suffix/comment starts when literal text is required. Markup cannot cross a narration/dialogue beat. Engine spans may contain emphasis/strong text but cannot overlap or nest another engine span in v1. Language tag validation belongs to C-14; pronunciation hints are plain text for speech adapters and never executable markup.

Raw HTML, script/style, inline images, links, CSS, ARIA attributes/roles, and arbitrary tags are rejected rather than escaped into active content. Interpolation values are inserted as text and HTML-escaped by every player adapter.

## Files and fixtures

Story files never import or execute other files. `project.toml` owns ordered story globs; normalized paths determine deterministic compilation order while scene IDs remain project-global.

Committed corpus:

- `tests/fixtures/language/complete.story`: representative valid control flow, commands, dialogue, choices, IDs, and durations.
- `tests/fixtures/language/multiline.story`: continuations, escapes, interpolation, and safe markup.
- `tests/fixtures/language/malformed.story`: recovery targets for headers, indentation, blocks, dialogue, choices, durations, and endings.

The generated Lezer tree, source-ranged syntax issues, and recovery tests consume these fixtures now. C-02 is not complete in code until the normalized AST and formatter idempotence tests consume the same corpus.
