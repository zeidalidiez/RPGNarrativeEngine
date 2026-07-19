:: crossroads.arrival

@set traveler.name = "Rowan"
@set found_flame = false

The road divides beneath an old stone arch. One path descends toward the river; the other climbs into the evening clouds.

Sable[watchful]: Which way, {{ traveler.name }}? The map has opinions, but no answers.

* Follow the bells by the river -> crossroads.river ^arrival.choice.river
* Take the high road -> crossroads.ridge ^arrival.choice.ridge

:: crossroads.river

@set found_flame = true

The bells belong to a half-sunken shrine. A small blue flame burns in its doorway without fuel.

* Carry the flame to the ridge -> crossroads.ridge ^river.choice.ridge
* Stay at the shrine -> ending.shrine ^river.choice.stay
