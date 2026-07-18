:: crossroads.arrival

@set traveler.name = "Rowan"
@set courage = 1
@set heard_bells = false

The road divides beneath an old stone arch. One path descends toward the river; the other climbs into clouds lit gold by the setting sun.

Sable[watchful]: Which way, {{ traveler.name }}? The map has opinions, but no answers.

* Follow the sound of bells -> crossroads.river ^arrival.choice.river
* Take the high road -> crossroads.ridge ^arrival.choice.ridge

:: crossroads.river

@set heard_bells = true
@set courage += 1

The bells belong to a half-sunken shrine. In its doorway, a small blue flame burns without fuel.

* Carry the flame to the ridge -> crossroads.ridge ^river.choice.flame
* Stay until morning -> ending.shrine ^river.choice.stay

:: crossroads.ridge

@if heard_bells
  The shrine's flame leans toward the mountain, revealing letters cut into the rock: **Only the willing road opens.**
@else
  Wind scours the empty ridge. Far below, bells ring once and then fall silent.
@end

* Speak the words and cross -> ending.beyond [when courage >= 2] ^ridge.choice.cross
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
