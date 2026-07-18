// The Light at Brinewatch — bundled showcase story

:: brinewatch.arrival

@set player.name = "Keeper"
@set resolve = 1
@set found_log = false
@set beacon_lit = false
@ambient surf-distant volume=0.5
@music salt-and-embers loop

For ninety years the light at Brinewatch has warned ships away from the teeth of the coast. Tonight, for the first time, it is dark.

Iona[urgent]: {{ player.name }}, the mail ship is somewhere beyond that fog. We have perhaps an hour.

* Climb straight to the lantern room -> tower.lantern ^arrival.choice.climb
* Search the old keeper's desk -> tower.archive ^arrival.choice.search
* Abandon the tower -> ending.darkness ^arrival.choice.leave

:: tower.archive

@sfx drawer-open
@set found_log = true
@set resolve += 1

Inside the salt-warped ledger, one line is underlined twice: **When the lens refuses the flame, turn it toward the memory of dawn.**

Iona[quiet]: My father wrote that. I thought it was only one of his riddles.

* Take the ledger upstairs -> tower.lantern ^archive.choice.upstairs

:: tower.lantern

@call shared.storm

The great Fresnel lens waits in the dark. Beyond it, the sea is a sheet of hammered iron.

@if found_log
  The keeper's note is still warm in your hand, though the room is bitterly cold.
@else
  Nothing in the mechanism is broken. The lens simply faces the wrong horizon.
@end

* Turn the lens east and strike the flame -> tower.beacon [when resolve >= 2] ^lantern.choice.ignite
* Ask Iona to help align the lens -> tower.together ^lantern.choice.together
* Give up before the storm arrives -> ending.darkness ^lantern.choice.leave

:: tower.together

Iona[steady]: On three. Not because we know it will work—because someone out there needs us to try.

@set resolve += 1
@goto tower.beacon

:: tower.beacon

@set beacon_lit = true
@sfx beacon-ignite
@music dawn-signal swell

The flame catches. Light pours through the glass in one bright, revolving blade, and somewhere in the fog a ship answers with its horn.

@if found_log
  Iona[relieved]: He knew we'd find the answer. Maybe not us exactly—but someone stubborn enough to look.
@else
  Iona[relieved]: We did it, {{ player.name }}. Remember this the next time you mistake fear for certainty.
@end

@ending beacon "A Light Against the Storm"

:: shared.storm

@ambient storm-close volume=0.8
@sfx tower-groan
@return

:: ending.darkness

@music stop fade=2s

You descend while there is still enough moonlight to see the path. Far out at sea, a horn calls once, then is swallowed by the weather.

@ending darkness "The Unanswered Horn"
