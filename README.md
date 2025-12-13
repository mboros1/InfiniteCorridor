# Infinite Corridor

Terminal-first roguelike/MUD hybrid: enter a portal into a themed universe, then play tight turn/tick-based roguelike gameplay with AI-generated flavor (never gating basic gameplay).

## Quickstart

- Install deps: `bun install`
- Run server: `bun run ic-server`
- Run client: `bun run ic-game`

## Key Docs

- Product + design constraints: `PROJECT_DIRECTION.md`
- Error/optional policy: `ERROR_POLICY.md`
- Branch improvements tracking: `CODE_IMPROVEMENTS.md`

## Runtime Config

Runtime env config is centralized in `src/config/runtime.ts` (`RUNTIME_CONFIG`).

- `PORT` (default `3000`)
- `WORLD_DB_PATH` (default `world.db`)
- `TICK_MS` (default `200`)
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`
- `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_SITE_URL`, `OPENROUTER_SITE_NAME`

## Debug

- `IC_DEBUG=1` enables gated engine debug logging.
