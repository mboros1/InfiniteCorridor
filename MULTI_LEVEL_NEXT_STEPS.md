# Multi-level Multiplayer: Next Steps

This repo is currently “single active level per world”: `GameState.currentLevel` and `world.currentLevelId` imply *everyone* shares one level, so portals and ticking are effectively global.

We’ve started the groundwork by introducing `PlayerLocation` and persisting `{ levelId, position }` for offline players, but the simulation and protocol are still single-level.

## Current Groundwork (Already In)

- `PlayerLocation` type + `world.playerLocations` + upgraded `world.offlinePlayers` to `{ levelId, position }`.
- Disconnect handling removes a player entity from the level and stores their last location.
- Startup load can detach persisted players (treat them as offline after reboot) and keep their last location for respawn.
- wsHub tests now include a “party transition still works” test, and TODOs for multi-level.

## Goal

Enable:

- Players can be on different levels at the same time.
- A portal/transition moves only the acting player (not the whole party).
- Each player receives a view of *their* current level (and can later be FOV-limited).
- Server ticks update only the levels that have activity (players/monsters), not a single global `currentLevel`.

## High-level Design

### 1) Persistent world state: per-player locations

Move from global `currentLevelId` to per-player location mapping:

- `world.playerLocations[playerEntityId] = { levelId, position }`
- `world.offlinePlayers[playerEntityId] = { levelId, position }`

Keep `world.currentLevelId` temporarily for backwards compatibility/migrations until the engine and protocol no longer rely on it.

### 2) Simulation becomes per-level

Refactor engine to stop mutating a single `currentLevel`:

- All actions resolve `(actorId -> levelId)` first.
- Apply movement/combat within that `LevelState`.
- Monsters act within their own level only.
- Respawns apply per-level.

Suggested core functions:

- `applyTickForLevel(state, levelId, intentsForThatLevel)`
- `applyMonsterActionsForLevel(state, levelId)`
- `respawnMonstersForLevel(state, levelId)`
- `transitionActor(state, actorId)` (moves only the actor between levels)

### 3) Protocol: per-socket “view state”

Stop broadcasting a single global `GameState` payload.

Instead send each socket:

- `playerEntityId`
- `currentLevelId`
- `currentLevel` (for that player)
- shared metadata: `worldConfig`, `turn`, `messages` (+ optionally per-level messages later)

This enables:

- Different players seeing different levels.
- Easy FOV limiting by filtering `currentLevel.tiles`/`entities` per player.

## Concrete Next Steps (Incremental)

### Step A — Maintain `playerLocations` authoritatively

When a player is present on a level:

- Ensure `world.playerLocations[playerEntityId]` matches their actual entity position and `levelId`.
- When a player disconnects:
  - remove entity from that level
  - move location from `playerLocations` to `offlinePlayers`
- When a player joins:
  - respawn them near their saved `{ levelId, position }` (same level if possible)
  - move their location from `offlinePlayers` to `playerLocations`

**Tests to add/update**

- `wsHub > multi-level: a Transition action moves only the acting player` (currently `test.todo`)

### Step B — Actor-scoped transitions

Refactor `handleTransition` to stop moving the whole party:

- Only the acting player uses the portal edge.
- Only that player’s entity is removed from source level and inserted into destination level.
- Update `world.playerLocations[actorId]`.

**Tests**

- Start with 2 players on the same level.
- Player A transitions.
- Assert A is on destination level and B remains on source level.

### Step C — wsHub broadcast becomes per-player view

Update `broadcastState` to generate a view payload per socket:

- Determine that socket’s player entity ID.
- Determine that player’s current `levelId` via `world.playerLocations`.
- Send only that level’s `LevelState` as `currentLevel`.

**Tests**

- `wsHub > multi-level: wsHub broadcasts per-player level view when players are on different levels` (currently `test.todo`)
- After A transitions, confirm:
  - wsA receives `currentLevel.id === levelB`
  - wsB receives `currentLevel.id === levelA`

### Step D — Tick per active level

Instead of ticking once per gameId using a global `currentLevel`, on each tick:

- Group queued intents by `levelId` (using `world.playerLocations`).
- Apply tick logic per level group.
- Persist once after all level updates.

**Tests**

- Put A on levelB and B on levelA.
- Queue a move for each.
- Tick and ensure each moved within their respective level.

## Optional: FOV-limited state

Once view-state exists, limit what each client sees:

- Mask tiles not visible/discovered.
- Filter entities to visible ones.
- Keep server authoritative; filtering only happens at serialization time.

## Known Risks / Edge Cases

- “OfflinePlayers” migration: older DBs may have `{x,y}`; upgrade should map them to `{ currentLevelId, {x,y} }`.
- Players without a stored location (brand new) need a default spawn strategy.
- If destination tile is occupied, spawn-near logic must search for a nearby walkable tile (existing BFS helper can be reused).
- Until the engine refactor lands, party transitions are still the default behavior.

