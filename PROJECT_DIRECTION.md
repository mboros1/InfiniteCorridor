## Infinite Corridor: Direction and Design Constraints

### Product goal

Build a terminal-first roguelike/MUD hybrid where the player “enters a portal” into a themed universe. The core loop is tight turn/tick-based play. AI is used to generate flavor, not to gate basic gameplay.

### Non-negotiables

* **Server-authoritative**: the server owns truth for simulation and state.
* **Tick-based**: players operate on a fixed tick cadence (default ~200ms, configurable per world/shard).
* **Deterministic core**: core simulation uses seeded RNG and produces reproducible outcomes (given rulesVersion + seed + cached AI artifacts).
* **AI not in the critical path** for basic actions (move/attack/wait). AI is used at run start, transitions, or background enrichment.
* **Legible gameplay**: combat and interaction are room-scoped; avoid geometry-heavy rules.

---

## World model

### Regions and transitions (persistent graph)

* The world is a **graph of Regions** (aka levels/maps).
* Each Region contains **transition points** (portals/paths). Each transition is:

  * **bi-directional**
  * **persistent** (a transition links to a specific transition in another region)
  * entering a transition lands you at the linked destination transition, enabling immediate backtracking.

### Roguelike map + MUD room overlay

* Each Region has a tile map (FOV + exploration).
* Additionally, Regions are partitioned into semantic **Rooms** (clusters) used as the unit of interaction:

  * room ID, room name, short description
  * exits (N/S/E/W + named exits if needed)
  * entities present (players/NPCs/mobs/items)
  * notable objects/fixtures

**Design intent:** players see a map, but *act socially and tactically at the room level*.

---

## Multiplayer model

### Tick loop

* Server runs a fixed tick loop per world/shard (configurable, not constantly auto-changing).
* Each actor may submit **at most one action per tick**.
* Server queues/records the latest action per actor until the tick boundary.

### Fairness + smoothing

* Do not continuously change tick duration to “match latency.” Instead:

  * accept actions up to a cutoff per tick
  * late actions apply next tick
  * optional: apply a small fixed “grace delay” if equalizing is desired
* Track analytics:

  * RTT estimate / jitter
  * % actions applied one tick late
  * server tick duration and missed ticks

### State authority and serialization

* Simulation must be **serialized per world/shard** (single owner). Avoid concurrent tick processing.

---

## Combat model

### Room-scoped interaction

* Melee attacks: same room only.
* Ranged attacks:

  * short range (same room initially; optional adjacent-room later)
  * require **charge/aim time** (1–3 ticks)
  * show clear UI telegraph (“Charging: 2 ticks remaining”)
* AoE:

  * generally affects **all hostiles in the room**
  * rare dangerous AoE may hit everyone (explicitly communicated)

### Ordering: per-tick initiative

* Each tick:

  1. Collect intents (one per actor)
  2. Compute initiative for actors with intents
  3. Resolve actions in initiative order
  4. Apply end-of-tick effects (DoT, regen, cooldown decrement)

* Initiative is explainable and mostly deterministic:

  * `initiative = speed + actionBias + tieBreak`
  * `tieBreak` is stable (e.g. hash(actorId, tickId)) to avoid “random unfairness.”

### Guard mechanic (replaces “front/back rows”)

* “Front/back row” is not simulated spatially.
* Instead, implement an explicit **Guard(target)** stance:

  * Guard triggers as a **reaction** when the guarded target is attacked.
  * Preconditions: same room, guard eligible (not stunned), reaction not on cooldown.
  * Resolution: roll/check based on guard stat vs attacker accuracy; on success redirect damage to guard (possibly mitigated).
  * Always log a clear explanation.

---

## Co-occupancy (multiple entities per tile)

### Capacity model

* Tiles have `capacity` (small int) derived from tile kind.
* Entities have `footprint` (small int) derived from entity size/type.
* A move is valid if: `sum(footprints on tile) + enteringFootprint <= tile.capacity`.

### Targeting and interaction simplification

* If multiple entities share a tile, treat them as “adjacent” for melee/interaction.
* Avoid “formation” rules. Guard covers protection needs.

### Rendering rule

* One glyph per tile: show highest-priority occupant (Player > hostile > friendly/NPC > item).
* Side panel lists other occupants in the same tile/room.

---

## Client UX direction (Ink UI)

### Screens

* Corridor (hub) → Loading → Game → GameOver

### Right panel (“Surroundings”)

Evolve to show:

* Room name + short room description
* Exits list
* Players present / hostiles present / neutrals present
* Notable objects
* Status lines:

  * Guarding: <name>
  * Charging: <ability> (ticks remaining)
  * Incoming threats (telegraphs): packs arriving, enemy charging, etc.

### Command mode

* Press `/` to open a command line (Minecraft-ish).
* Command line enables:

  * chat: `/say <msg>`
  * inspect: `/look`
  * presence: `/who`
  * abilities: `/cast ...`, `/guard <player>`, etc.
* Client sends `Action.Command { text }` to the server. Server parses it into game actions or chat events.

---

## Error handling and types

* Engine uses **messages** (GameMessage) for expected gameplay events (blocked move, etc.)
* App/system errors use a single **AppError** shape with `code`, `status`, `expose`, `context`.
* Boundaries (HTTP/WebSocket handlers, DB, AI adapters) convert unknown errors via `toAppError()` and return consistent error responses.

---

## AI integration policy

* AI generates:

  * room/region flavor
  * tile flavor names/descriptions
  * enemy flavor (name/short/long)
* AI results are cached and keyed by deterministic inputs:

  * themePrompt, rulesVersion, regionId/depth, templateIds, tileKinds, etc.
* AI failures degrade gracefully:

  * use fallback flavor from templates/tags
  * never block core turn processing

---

## Persistence

* Store world graph and regions/rooms state in an embedded DB (SQLite via bun:sqlite + Drizzle).
* Persist at least:

  * regions
  * transitions
  * optionally “state snapshots” per region/run
* Keep determinism: store `rulesVersion`, numeric seed, and cached AI artifacts.

---

# Roadmap

The canonical checklist lives in `TODO.md` (kept separate so it can be updated without editing this design doc).

---

If you want, I can also add a **“Message Protocol”** section (WebSocket events + JSON shapes) and a **“Combat Resolution”** pseudo-code block, but this is enough to get Claude/Codex aligned without over-specifying implementation.
