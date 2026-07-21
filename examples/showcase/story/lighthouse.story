// The Light at Brinewatch — public showcase story

:: brinewatch.arrival

@set player.name = "Keeper Rowan"
@set resolve = 1
@set trust.iona = 1
@set found.log = false
@set found.flare = false
@set warned.ship = false
@set beacon.lit = false
@set storm.bearing = random(1, 4)
@ambient surf-distant volume=0.5
@music salt-and-embers loop
@transition fade duration=700ms

For ninety years the light at Brinewatch has warned ships away from the teeth of the coast. Tonight, for the first time, it is dark. ^arrival.narration.dark

Iona[urgent]: {{ player.name }}, the mail ship is somewhere beyond that fog. We have perhaps an hour. ^arrival.iona.warning

Nera[radio]: Brinewatch, answer.
  The *Cormorant* is four miles east and the storm has swallowed every channel but this one. ^arrival.nera.call

* Answer the harbor radio -> harbor.radio ^arrival.choice.radio
* Search the old keeper's archive -> tower.archive ^arrival.choice.archive
* Climb straight to the lantern room -> tower.lantern ^arrival.choice.climb
* Leave the headland before the path floods -> ending.darkness ^arrival.choice.leave

:: harbor.radio

@sfx radio-open
@set warned.ship = true
@set resolve += 1

Nera[command]: Keep this channel clear. Tell me what still works, not what ought to work. ^radio.nera.command

Vale[radio]: Brinewatch, this is Captain Vale aboard the *Cormorant*. We can turn once before the reef takes the choice from us. ^radio.vale.position

@if storm.bearing == 1
  The signal needle kicks north, then steadies. The storm is giving you one narrow lane through its center. ^radio.weather.north
@else
  The signal needle skitters against its stop. Whatever course the storm once had, it has changed it. ^radio.weather.shifted
@end

* Tell Vale to hold east while you search the archive ^radio.choice.archive
  @set trust.iona += 1
  @goto tower.archive
* Ask Iona where the emergency signals are kept -> tower.gear ^radio.choice.gear

:: tower.archive

@sfx drawer-open
@set found.log = true
@set resolve += 1

The archive smells of lamp oil and wet stone. Inside a salt-warped ledger, one line is underlined twice. **When the lens refuses the flame, turn it toward the memory of dawn.** ^archive.ledger.clue

In the margin, the lens is named [pronounce="aw-REE-lee-ah"]Aurelia[/pronounce]. Beneath it, someone has written [lang=fr]*toujours vers l'aube*[/lang] — always toward dawn. ^archive.ledger.language

Orren[memory]: A lighthouse is a promise made by people who may never meet the ones they save. ^archive.orren.memory

Iona[quiet]: My father wrote that. I thought it was only one of his riddles. ^archive.iona.father

@if warned.ship
  Nera[radio]: Rowan, the *Cormorant* has begun to drift. Whatever you found, use it now. ^archive.nera.hurry
@end

* Take the ledger to the lantern room -> tower.lantern ^archive.choice.lantern
* Search the emergency cabinet first -> tower.gear ^archive.choice.gear

:: tower.gear

@sfx cabinet-break
@set found.flare = true

Behind a rusted latch you find a red signal flare, a coil of dry fuse, and three brass keys for locks that no longer exist. ^gear.narration.find

Iona[wry]: Good news: the flare is older than I am. Better news: I am occasionally reliable. ^gear.iona.flare

@if found.log
  The ledger's final diagram matches the smallest brass key. The lantern's eastern bearing can still be released by hand. ^gear.ledger.key
@else
  Scratched into the cabinet door is an arrow pointing east — a crude echo of the clue waiting downstairs. ^gear.cabinet.arrow
@end

* Bring the flare and the smallest key upstairs -> tower.lantern ^gear.choice.lantern

:: tower.lantern

@call shared.storm

The great Fresnel lens waits in the dark. Beyond it, the sea is a sheet of hammered iron; within it, every weak reflection becomes a corridor of gold. ^lantern.narration.lens

@if found.log
  The keeper's note is still warm in your hand, though the room is bitterly cold. ^lantern.clue.log
@else
  Nothing in the mechanism is broken. The lens simply faces the wrong horizon. ^lantern.clue.instinct
@end

Iona[steady]: We do not need the whole night. We need one true turn and one true flame. ^lantern.iona.steady

@if warned.ship
  Vale[radio]: Brinewatch, I can see the tower but not the reef. Give me anything I can steer by. ^lantern.vale.plea
@end

* Turn the lens east and strike the flame -> tower.beacon [when found.log && resolve >= 2] ^lantern.choice.ignite
* Trust Iona to align the lens by hand -> tower.together ^lantern.choice.together
* Fire the red signal from the gallery -> tower.signal [when found.flare && warned.ship] ^lantern.choice.signal
* Descend before the glass gives way -> ending.darkness ^lantern.choice.leave

:: tower.together

Iona[quiet]: I kept waiting to feel ready. I do not think the sea cares. ^together.iona.quiet

Iona[steady]: On three. Not because we know it will work — because someone out there needs us to try. ^together.iona.promise

@set trust.iona += 1
@set resolve += 1
@goto tower.beacon

:: tower.beacon

@set beacon.lit = true
@sfx beacon-ignite
@music dawn-signal swell
@transition bloom duration=900ms

The flame catches. Light pours through the glass in one bright, revolving blade, and somewhere in the fog a ship answers with its horn. ^beacon.narration.light

@if found.log
  Orren[memory]: There. The promise kept. ^beacon.orren.promise
@else
  Iona[relieved]: We did it, {{ player.name }}. Remember this the next time you mistake fear for certainty. ^beacon.iona.relief
@end

Nera[radio]: Brinewatch is lit. *Cormorant*, come three points south and follow the sweep home. ^beacon.nera.course

Vale[radio]: We have the light. Tell your keeper the whole ship saw it return. ^beacon.vale.answer

@ending beacon "A Light Against the Storm"

:: tower.signal

@sfx flare-strike
@transition flash duration=300ms

The flare tears upward, a red star against the rain. For one breath the reef, the ship, and every white crest between them stand exposed. ^signal.narration.flare

Vale[command]: Reef sighted. Hard south — now. ^signal.vale.turn

Nera[radio]: The *Cormorant* is turning. That bought them the channel, Rowan. Now get down before the storm takes the tower. ^signal.nera.saved

Iona[relieved]: Not the light Father planned. Still a light. Still enough. ^signal.iona.enough

@ending signal "A Red Star in the Rain"

:: shared.storm

@ambient storm-close volume=0.8
@sfx tower-groan

@if storm.bearing == 1
  Wind strikes the western glass in one sustained note, like a fingertip drawn around the rim of a vast cup. ^storm.narration.west
@else
  The tower shudders. Dust lifts from the stairwell, and the dark lens turns half an inch of its own accord. ^storm.narration.shudder
@end

@return

:: ending.darkness

@music stop fade=2s
@ambient rain-alone volume=0.7

You descend while there is still enough moonlight to see the path. Far out at sea, a horn calls once, then is swallowed by the weather. ^darkness.narration.descent

Vale[distant]: Brinewatch? If you can hear us, we are still looking for your light. ^darkness.vale.final

@ending darkness "The Unanswered Horn"
