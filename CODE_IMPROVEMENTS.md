# Infinite Corridor Code Improvements

This document explains improvements implemented on the current branch compared to `trunk`, and tracks what’s still pending.

## Scope (current branch vs `trunk`)

This branch focuses on:
- Eliminating duplication in AI adapters.
- Pushing more behavior into testable, pure-ish utilities (dependency injection for side effects).
- Making persistence safer by validating/normalizing data before it hits the DB.
- Codifying an error/optional policy using fp-ts `Option` + `Either`/`TaskEither` (no “expected failure” throws).
- Reducing noisy engine debug logging (gated behind `IC_DEBUG`).
- Centralizing runtime env config (`RUNTIME_CONFIG`) for server/DB.

Validation:
- `bun run typecheck`
- `bun test`

Files changed vs `trunk`:
- `README.md`
- `TODO.md`
- `PROJECT_DIRECTION.md`
- `package.json`
- `CODE_IMPROVEMENTS.md`
- `ERROR_POLICY.md`
- `src/ai/utils.ts`
- `src/ai/anthropicAdapter.ts`
- `src/ai/openRouterAdapter.ts`
- `src/config/runtime.ts`
- `src/db/client.ts`
- `src/engine/game.ts`
- `src/engine/levelgen.ts`
- `src/utils/logger.ts`
- `src/utils/fp.ts`
- `src/utils/appResult.ts` (removed)
- `src/utils/debug.ts`
- `src/errors/appError.ts`
- `src/db/serialization.ts`
- `src/db/worldRepo.ts`
- `src/server/index.ts`
- `src/ai/__tests__/utils.test.ts`
- `src/utils/__tests__/logger.test.ts`
- `src/db/__tests__/serialization.test.ts`
- `src/engine/__tests__/transition.test.ts`

## Improvement Areas (status)

| # | Area | Status | Notes |
|---:|------|--------|-------|
| 1 | DRY violations in AI adapters | ✅ Done | Shared utilities in `src/ai/utils.ts` |
| 2 | Improve functional purity | ⚠️ Partial | AI uses injected logging; engine debug logs are gated; server still has `console.log` |
| 3 | Enhance type safety in serialization | ✅ Done | Stronger Zod schemas + pre-serialization validation |
| 4 | Improve error handling | ⚠️ Partial | `AppError` + fp-ts policy landed; AI/DB/server boundaries migrated; client still throws |
| 5 | Functional state management | ⏳ Not started | No state update refactors yet |
| 6 | Module organization | ⏳ Not started | No major splits (e.g. `engine/game.ts`) yet |
| 7 | Type safety in database layer | ⚠️ Partial | DB repo returns `TaskEither` and validates (still no migrations/backcompat layer) |
| 8 | Functional error handling (Result/Either) | ⚠️ Partial | fp-ts `Either/TaskEither` used in AI parsing + server + DB; client not migrated yet |
| 9 | Configuration system | ⚠️ Partial | Added `RUNTIME_CONFIG`; gameplay config remains in `src/config/index.ts` |
| 10 | Testing infrastructure | ✅ Improved | Added targeted tests; no shared harness/helpers yet |

## Implementation Details (by improvement)

### 1) DRY violations in AI adapters ✅

**Goal**
- Remove duplicated parsing/normalization/fallback logic between `Anthropic` and `OpenRouter` adapters.

**Implemented (this branch)**
- Introduced shared AI utilities in `src/ai/utils.ts`:
  - `normalizeAiResponse(parsed, logger)`:
    - Converts common “AI returned arrays” shapes (`enemyFlavors[]`, `tileFlavors[]`) into objects keyed by id/kind.
    - Fills in missing `char`/`fg` for tiles using `TILE_DATA`.
    - Sanitizes invalid tile colors to defaults (hex-only), preventing persistence crashes.
  - `createFallbackResponse(request)`:
    - Deterministic fallback if AI fails (names are derived from template role).
  - `buildRoomFlavorPrompt(request)`:
    - Centralizes the shared prompt text (previously duplicated across adapters).
  - `parseRoomFlavorResponseText(content, logger)`:
    - One concrete boundary that returns `Either<AppError, RoomFlavorResponse>` instead of throwing.
    - Handles fenced JSON and a minimal truncation-repair strategy.
    - Enforces “display-safe” text (single-line, no control chars, tile `char` must be single-column).
- Removed duplicate code from:
  - `src/ai/anthropicAdapter.ts`
  - `src/ai/openRouterAdapter.ts`

**How it’s used**
- Each adapter:
  - Calls the provider API to get raw text.
  - Uses `parseRoomFlavorResponseText()` to parse/validate.
  - If parse/validation fails, attempts one “repair pass” (send issues + prior JSON back to the provider) and re-parses.
  - Falls back via `createFallbackResponse()` if repair also fails.

**Tests**
- `src/ai/__tests__/utils.test.ts` covers:
  - normalization behavior
  - fallback behavior
  - boundary behavior + error codes for parse/invalid/empty

**Still open**
- Decide whether “truncation repair” and the single repair pass should be more conservative (both are intentionally minimal).

### 2) Improve functional purity ⚠️ (partial)

**Goal**
- Separate pure logic from side effects (logging, I/O), to improve testability and make behavior more deterministic.

**Implemented (this branch)**
- Added a logging abstraction in `src/utils/logger.ts`:
  - `Logger` interface
  - `consoleLogger` / `nullLogger`
  - `createTestLogger()` to capture logs for assertions
  - `createPrefixedLogger()` for context
- Added `src/utils/debug.ts`:
  - `debugLog()` gated behind `IC_DEBUG`/`DEBUG` env vars
  - used to silence engine debug output by default
- Updated AI utilities/adapters to accept injected logging:
  - `normalizeAiResponse(parsed, logger)` defaults to `consoleLogger`
  - Adapter configs now accept `logger?: Logger`
- Server wires a logger into adapters (`src/server/index.ts`).
- Replaced engine debug `console.log` calls with `debugLog()`:
  - `src/engine/game.ts`
  - `src/engine/levelgen.ts`

**Still open**
- Server code still calls `console.log` directly (server-side logging is a reasonable boundary, but it’s not DI-friendly yet).
- Consider whether `debugLog()` should be replaced by a real injected `Logger` in engine code (for full purity and easier test control).
- Next step if you want full purity: define “boundaries” (server/CLI) where side effects are allowed, and inject `Logger` everywhere else (engine, DB repo).

### 3) Enhance type safety in serialization ✅

**Goal**
- Remove `any`/`unknown` holes around persistence; validate before writing and after reading.

**Implemented (this branch)**
- Strengthened Zod schemas in `src/db/serialization.ts`:
  - Entity discriminated unions (`Player`/`Monster`/`Item`)
  - Tile kind validation against `TILE_DATA`
  - Tile flavor hex color validation
  - World config difficulty as `'Easy' | 'Normal' | 'Hard'`
  - Game messages validated against `GameMessageKind`
  - Full `GameState` schema
- Added pre-serialization validation:
  - `serializeLevel`, `serializeTileFlavors`, `serializeEnemyFlavors`, `serializeGameState` validate inputs before `JSON.stringify`.
- Adjusted flavor serialization function signatures to accept `null` (to match runtime patterns and tests).

**Tests**
- `src/db/__tests__/serialization.test.ts` covers:
  - round-trip serialization
  - expected validation failures (invalid tiles, invalid colors, invalid worldConfig)

**Still open**
- Backward compatibility/migrations: older persisted data might not satisfy stricter schemas.
- If you want to reject unknown keys (not just validate known fields), switch selected schemas to `.strict()` and/or validate “no extra keys” explicitly.

### 4) Improve error handling ⚠️ (partial)

**Goal**
- Consistent error shapes + consistent boundary behavior (log + recover vs log + fail fast).

**Implemented (this branch)**
- Introduced minimal `AppError` and code registry:
  - `src/errors/appError.ts` defines `APP_ERROR_CODE`, `appError()`, and `toAppError()` for unknown throws.
- Added an explicit error/optional policy doc:
  - `ERROR_POLICY.md` defines:
    - when to use `Option` vs `Either`/`TaskEither`
    - “log once at boundary”
    - public HTTP error shape + code→status mapping guidance
- Added fp-ts convenience re-exports:
  - `src/utils/fp.ts` re-exports `pipe/flow` and `E/O/TE`.
- AI boundary returns a typed error instead of throwing:
  - `parseRoomFlavorResponseText()` in `src/ai/utils.ts` returns `Either<AppError, RoomFlavorResponse>`
  - adapters log + safely fall back
- Server enforces a stable public error shape + request correlation:
  - `src/server/index.ts` returns `{ error: { code, message, requestId, details? } }` for all non-2xx
  - adds `X-Request-Id` response header
  - wraps throw-y request parsing with `TaskEither.tryCatch`
- DB repo functions return `TaskEither<AppError, ...>`:
  - query and (de)serialization failures become `DB_*` errors
  - missing rows are represented as `Option.none` (not `null`)

**Still open**
- Decide on a project-wide policy:
  - whether client should also adopt `TaskEither` + parse the public error shape (recommended)
  - how server maps errors to HTTP status codes + response bodies
- Consider adding “public vs private” error messages consistently (what gets returned to clients vs only logged).

### 5) Enhance functional state management ⏳

**Goal**
- Make state transitions more composable and less ad-hoc (especially in engine).

**Proposed implementation**
- Add pure helper functions for common state changes:
  - `withUpdatedPlayer(state, fn)` / `updateEntity(level, entityId, fn)`
  - `appendMessage(state, msg)`
  - `setRoomFlavor(state, { enemyFlavors, tileFlavors, roomDescription })`
- Prefer returning new objects (already the pattern in many places) and avoid deep inline updates.

**Success criteria**
- Engine action handlers read as pure transforms and are unit-testable with minimal scaffolding.

### 6) Improve module organization ⏳

**Goal**
- Split large, mixed-responsibility files into smaller modules.

**Proposed implementation**
- Start with `src/engine/game.ts`:
  - extract action handlers into `src/engine/actions/*`
  - extract transition logic into `src/engine/transition/*`
  - keep `game.ts` as orchestrator/exports

**Success criteria**
- Each module has a single responsibility and can be tested without large fixtures.

### 7) Enhance type safety in database layer ⚠️ (partial)

**Goal**
- Stronger guarantees at the DB boundary beyond serialization.

**Implemented (this branch)**
- DB repo functions now return `TaskEither<AppError, …>` and never throw for expected failures:
  - `src/db/worldRepo.ts` catches query/serialize/deserialize failures and returns typed errors
  - missing rows are represented as `Option.none` (not `null`)
- DB path is centralized via `RUNTIME_CONFIG`:
  - `src/db/client.ts` reads `RUNTIME_CONFIG.worldDbPath`

**Still open**
- Backward compatibility/migrations for older persisted data that may fail stricter validation.
- If you want “narrow, typed repos”: add explicit domain ↔ DB mapping helpers and keep DB row shapes out of other modules.

### 8) Improve functional error handling (Result/Either) ⚠️ (partial)

**Goal**
- Make expected failures explicit in the type system instead of exceptions.

**Implemented (this branch)**
- Adopted fp-ts “Result/Either” style:
  - Optional: `Option<A>`
  - Sync failures: `Either<AppError, A>`
  - Async failures: `TaskEither<AppError, A>`
- Implemented at concrete boundaries:
  - AI parsing: `src/ai/utils.ts`
  - DB repo: `src/db/worldRepo.ts`
  - HTTP request parsing + persistence: `src/server/index.ts`

**Still open**
- Apply the pattern to additional boundaries:
  - gameplay config parsing (`src/config/index.ts`) and any CLI/env parsing
  - client-side API error handling (consistent error shape)
- Decide whether to keep fp-ts “surface area” minimal (recommended: use `src/utils/fp.ts` as the import entrypoint everywhere).

### 9) Enhance configuration system ⚠️ (partial)

**Goal**
- Type-safe config loading with clear defaults and validation.

**Implemented (this branch)**
- Added `src/config/runtime.ts` exporting `RUNTIME_CONFIG` and used it in:
  - `src/server/index.ts` (port + AI keys/models)
  - `src/db/client.ts` (DB path)

**Still open**
- Migrate remaining runtime settings from scattered `process.env` reads to `RUNTIME_CONFIG` (or explicit DI).
- Decide whether gameplay config loading (`src/config/index.ts`) should produce `AppError` instead of throwing a generic `Error`.

### 10) Improve testing infrastructure ✅ (improved)

**Goal**
- Make it easier to write/maintain tests and avoid flaky/noisy test runs.

**Implemented (this branch)**
- Added tests for AI utilities, logger utilities, and DB serialization.
- Added `nullLogger` and `createTestLogger()` for testing side-effecting code without printing.
- Added `scripts.test` (`"test": "bun test"`) for consistency.
- Reduced test log noise:
  - engine debug output is gated behind `IC_DEBUG` (via `src/utils/debug.ts`)
  - logger tests mute `console.*` while exercising `consoleLogger`

**Still open**
- Add shared test helpers/fixtures if test volume grows.

## Suggested Next Steps (highest leverage)

1. Update this document’s status table as new areas land (especially #4/#8).
2. Migrate the client API wrapper to parse `{ error: { code, message, requestId, details? } }` and return `TaskEither`.
3. Start the “module split” (#6) once engine behavior is stable.
