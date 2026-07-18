// Complete C-02 contract fixture

:: station.arrival

@music night-train loop fade=2s
@ambient rain volume=0.45 fade=1s

The last train has already gone. ^arrival.narration.last-train

Mara[distant]: You came. ^arrival.mara.you-came

@if memory.mara_met
  Mara[warm]: I was beginning to think you'd forgotten me. ^arrival.mara.remembered
@else
  Mara[guarded]: Have we met? ^arrival.mara.stranger
@end

* Ask about the letter -> station.letter ^arrival.choice.letter
* Apologize -> station.apology [when courage >= 2] ^arrival.choice.apology
* Take her hand [when trust >= 1] ^arrival.choice.hand
  @set trust += 1
  @sfx cloth
  @goto station.together
* Leave -> ending.departed ^arrival.choice.leave

:: station.letter

@set clues.letter = true
@sfx paper-unfold

Mara[whisper]: Don't read it here. ^letter.mara.warning

@call shared.train-rumble
@goto station.decision

:: station.apology

@set trust += 1
@goto station.decision

:: station.together

@goto ending.waiting

:: station.decision

@if clues.letter && trust >= 1
  * Wait together -> ending.waiting
  * Leave alone -> ending.departed
@else
  @goto ending.departed
@end

:: shared.train-rumble

@sfx train-rumble volume=0.7
@wait 350ms
@return

:: ending.departed

@music stop fade=2s
You leave before the rain can decide for you.
@ending departed "The Train You Missed"

:: ending.waiting

The first train arrives with the morning.
@ending waiting "The Train You Waited For"
