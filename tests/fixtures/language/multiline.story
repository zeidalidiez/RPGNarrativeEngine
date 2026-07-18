:: prose.forms

This is one narration paragraph
  with an explicit line break and *literal markers*.

Mara[quiet]: This dialogue also continues
  on a second spoken line with {{ player.name }}.

\* This begins with a literal star rather than a choice.
\@ This begins with a literal at sign rather than a command.
\:: This begins with literal colons rather than a scene.

The safe subset supports *emphasis*, **strong text**, [lang=ja]東京[/lang],
  and [pronounce="toh-kyoh"]東京[/pronounce].

* Continue -> prose.done ^prose.choice.continue

:: prose.done

@ending prose.done "Prose Forms"
