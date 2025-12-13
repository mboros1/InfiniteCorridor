# Infinite Corridor Roadmap

This is the actionable checklist extracted from `PROJECT_DIRECTION.md`.

## Phase 0 — tighten the domain model (1–2 sessions)

* [ ] Add/confirm types:

  * [ ] `Action.Command { text: string }`
  * [ ] `Action.Guard { targetPlayerId: EntityId }` (or command-parsed into a Guard action)
  * [ ] Optional: `Action.StartCharge { abilityId, target }` / `Action.ReleaseCharge` (or single action that transitions based on internal state)
* [ ] Add room overlay types:

  * [ ] `RoomId`, `RoomState { id, name, description, exits, bounds/tiles?, entitiesPresent? }`
  * [ ] `RegionState` includes map + room partition metadata
* [ ] Add co-occupancy types:

  * [ ] `tileCapacity(kind): number`
  * [ ] `entityFootprint(entity): number`

## Phase 1 — command mode (high leverage, low risk)

* [ ] Client: `/` opens command input mode
* [ ] Client: sends `Action.Command` to server
* [ ] Server: parse minimal commands:

  * [ ] `/say <msg>` → broadcast chat message to room
  * [ ] `/look` → return room description + roster snapshot
  * [ ] `/who` → list players in region/room
* [ ] UI: show chat/system messages clearly in MessageLog

## Phase 2 — tick loop skeleton + per-tick initiative ordering

* [ ] Implement server tick loop per world/shard:

  * [ ] per-player latest-action buffer (max 1 queued)
  * [ ] tickId increments
  * [ ] resolve tick → update state → broadcast snapshot/diff
* [ ] Implement per-tick ordering:

  * [ ] collect intents
  * [ ] compute initiative: `speed + actionBias + deterministic tieBreak`
  * [ ] resolve in order
  * [ ] skip actors if dead/disabled at their turn

## Phase 3 — guard mechanic (reaction-based, room-scoped)

* [ ] Add “guard stance” to Player state:

  * [ ] `guarding?: EntityId`
  * [ ] `guardCooldown?: number` (optional)
* [ ] Implement guard as a reaction during attack resolution:

  * [ ] eligibility checks
  * [ ] roll/check formula
  * [ ] redirect damage, log explainable messages

## Phase 4 — co-occupancy with capacity + footprint

* [ ] Replace `getEntityAt(x,y)` with `getEntitiesAt(x,y)`
* [ ] Implement `canEnter(x,y, enteringEntity)` via capacity model
* [ ] Update movement and AI movement to respect `canEnter`
* [ ] Update rendering:

  * [ ] choose display occupant by priority
  * [ ] right panel lists additional occupants (tile + room roster)

## Phase 5 — room overlay + MUD legibility upgrades

* [ ] Add room partitioning for regions (even if simple first):

  * [ ] assign room IDs to tiles
  * [ ] compute room exits (doors/thresholds/transition points)
* [ ] Right panel upgrades:

  * [ ] room name + short description
  * [ ] exits list
  * [ ] players present / hostiles present / neutrals present
  * [ ] telegraphs: charging, packs arriving, guarding status

## Phase 6 — analytics + smoothing (do after tick loop exists)

* [ ] Add protocol fields:

  * [ ] `clientTimeMs`, `inputSeq` on client actions
  * [ ] `serverTimeMs`, `ackSeq`, `tickApplied` on responses
* [ ] Track per-player:

  * [ ] RTT estimate/jitter
  * [ ] % late-by-1-tick actions
* [ ] Optional smoothing policy knobs:

  * [ ] input cutoff per tick
  * [ ] optional fixed grace delay

## Phase 7 — AI enrichment (incremental)

* [ ] Cache AI outputs by deterministic keys
* [ ] On transition:

  * [ ] fetch/generate room flavor + tile flavors + enemy flavors
  * [ ] never block basic movement/combat ticks; show “travel/loading” UI only on transitions
