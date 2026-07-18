# C-03: Expression contract

Status: Lexical forms, operator/function metadata, and executable primitive semantics implemented; parser, resolver, type checker, and seeded RNG adapter pending

Expressions are a closed, typed language. They cannot access JavaScript globals, properties, prototypes, the DOM, filesystem, clock, network, or arbitrary functions.

## Grammar and precedence

```text
expression     = logical-or
logical-or     = logical-and ("||" logical-and)*
logical-and    = equality ("&&" equality)*
equality       = comparison (("==" | "!=") comparison)*
comparison     = additive (("<" | "<=" | ">" | ">=") additive)*
additive       = multiplicative (("+" | "-") multiplicative)*
multiplicative = unary (("*" | "/" | "%") unary)*
unary          = ("!" | "-") unary | primary
primary        = boolean | number | string | path | call | "(" expression ")"
call           = path "(" [expression ("," expression)*] ")"
```

From lowest to highest precedence:

| Precedence | Operators                 | Associativity |
| ---------: | ------------------------- | ------------- |
|          1 | <code>&#124;&#124;</code> | Left          |
|          2 | `&&`                      | Left          |
|          3 | `==`, `!=`                | Left          |
|          4 | `<`, `<=`, `>`, `>=`      | Left          |
|          5 | `+`, `-`                  | Left          |
|          6 | `*`, `/`, `%`             | Left          |
|          7 | unary `!`, unary `-`      | Right         |
|          8 | calls and parentheses     | N/A           |

Function arguments evaluate left to right. `&&` and `||` require booleans and short-circuit; they do not return an operand value. All other binary operators evaluate left then right.

## Types and operators

The only values are `boolean`, finite IEEE-754 `number`, and Unicode `string`.

- Equality requires both operands to have the same type and never coerces. Build metadata, object identity, nullish values, and truthiness do not exist in expressions.
- `<`, `<=`, `>`, and `>=` accept numbers only. Chained comparisons therefore type-error after the first comparison; write `a < b && b < c`.
- `+` accepts either two numbers or two strings. Mixed concatenation is an error; interpolation is preferred for player text.
- `-`, `*`, `/`, `%`, and unary `-` accept numbers only.
- `/` and `%` reject positive and negative zero divisors. `%` is truncated-division remainder and carries the dividend's sign, matching ECMAScript for finite operands.
- Every literal, variable value, argument, and numeric result is checked for finiteness. Overflow, `NaN`, and infinity are errors. Negative zero is normalized to positive zero before state/IR serialization.

String literals use the C-02 quoted-string escapes and do not interpolate. `{{ expression }}` is parsed only in narration, dialogue, and choice text. `length` counts Unicode scalar values/code points, not UTF-16 code units or locale-dependent grapheme clusters.

## Standard functions

| Function | Signature                            | Rule                                                                                         |
| -------- | ------------------------------------ | -------------------------------------------------------------------------------------------- |
| `min`    | `number, number... -> number`        | At least one finite number.                                                                  |
| `max`    | `number, number... -> number`        | At least one finite number.                                                                  |
| `clamp`  | `number, minimum, maximum -> number` | Requires `minimum <= maximum`.                                                               |
| `round`  | `number -> number`                   | Nearest integer; exact halves go toward positive infinity; negative zero normalizes to zero. |
| `length` | `string -> number`                   | Unicode code-point count.                                                                    |
| `random` | `() -> number`                       | Draw from the serialized `story` stream in `[0, 1)`.                                         |
| `random` | `(minimum, before) -> number`        | One `story`-stream draw scaled to `[minimum, before)`; requires finite `minimum < before`.   |

The first five functions are pure and implemented by `evaluatePureStandardFunction`. `random` is metadata-only until C-08 publishes the exact xoshiro vectors and draw conversion; no temporary `Math.random` implementation is allowed.

## Names and extension points

Variable/function paths use lowercase ASCII letter/underscore-led segments separated by dots. They are distinct from stable content/entity IDs so subtraction never depends on whitespace around a hyphen.

The first-party read-only namespace roots are `world`, `party`, `inventory`, `economy`, `progression`, `combat`, `encounters`, and `quests`. A root exists only when its module is enabled; each module contract must publish its exact property paths and types before use. Writing module state through `@set` is forbidden; module commands/transactions own mutation.

Plugins register function signatures containing parameter/result types and determinism metadata. Pure functions must return the same result for the same inputs. Seeded functions receive only their assigned serialized plugin RNG stream through the runtime adapter. Unknown functions, missing modules/plugins, ambiguous registrations, nondeterministic functions, and calls with the wrong arity/type are compile errors.

## Executable evidence

- `tests/fixtures/language/expression-operators.json` is the canonical precedence/associativity table.
- `tests/fixtures/language/expression-vectors.json` covers strict arithmetic, comparison, equality, concatenation, rounding, clamping, and Unicode length.
- Unit tests prove short-circuit behavior, no coercion, zero-divisor errors, finite-result enforcement, and seeded-random metadata.

The parser/type checker must add source-aware success and failure fixtures before C-03 is treated as complete. C-08 must add exact random output/draw-count vectors before `random` can execute.
