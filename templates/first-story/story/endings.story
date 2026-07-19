:: crossroads.ridge

@if found_flame
  The blue flame reveals letters cut into the mountain: **Only the willing road opens.**
@else
  Wind scours the empty ridge. Far below, bells ring once and fall silent.
@end

* Speak the words and cross -> ending.beyond [when found_flame] ^ridge.choice.cross
* Return to the valley -> ending.valley ^ridge.choice.return

:: ending.beyond

The stone arch opens onto a sky you have never seen.
@ending beyond "The Willing Road"

:: ending.shrine

At dawn, the blue flame is gone. A new road waits beneath the river.
@ending shrine "The Road Below"

:: ending.valley

You return with no answer, but the question follows.
@ending valley "A Familiar Horizon"
