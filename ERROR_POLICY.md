# Error + Optional Policy (fp-ts)

This project uses fp-ts types to model “missing” vs “failed” explicitly and to avoid exceptions escaping module boundaries.

## Principles

1. **No intentional throws for expected failures**
   - Parsing/validation, I/O, and “not found” scenarios should not throw.
   - Any API that can throw is wrapped with `Either.tryCatch` or `TaskEither.tryCatch`.
2. **Log once, at the boundary**
   - Library code (engine/utils/db/ai parsing) returns errors but does not log.
   - Boundary code (HTTP server, CLI entrypoint) logs once per request/job, with a `requestId`.
3. **Banish `null` in domain code**
   - Domain code should not use `null`. Use:
     - `Option<A>` for “may be missing”
     - `undefined` only at JS/interop boundaries where `Option` is not practical
   - Convert `null`/`undefined` to `Option` immediately at boundaries (`O.fromNullable`).
4. **Absence is `Option`, failure is `Either`**
   - Use `Option<A>` when “0 or 1 values” is a valid outcome.
   - Use `Either<AppError, A>` / `TaskEither<AppError, A>` when an operation can fail.

## Core Types

- **Optional (absence is normal):** `Option<A>`
- **Sync failure channel:** `Either<AppError, A>`
- **Async failure channel:** `TaskEither<AppError, A>`

Guideline: prefer naming that encodes semantics:
- `findX(...): TaskEither<AppError, Option<X>>` (missing is fine)
- `getX(...): TaskEither<AppError, X>` (missing becomes `NOT_FOUND` where it’s required)

## Error Model (`AppError`)

`AppError` is the single internal error type used across the codebase:
- `code`: stable identifier for programmatic handling and HTTP mapping
- `message`: human-readable (may be sanitized for public responses)
- `context`: JSON-serializable structured fields (ids, counts, previews, validation formats)
- `cause`: nested error (may be `unknown`)
- `status` (optional): explicit HTTP status override (otherwise derived from `code`)
- `expose` (optional): whether `message` is safe to return to clients (otherwise derived from status < 500)

### Public vs private error information

- **Server response** returns a safe `ApiError` object (see below).
- **Logs** may include full `context` and summarized `cause` chain.

## Public HTTP Error Shape (`ApiError`)

All non-2xx server responses should use:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid request body",
    "requestId": "req-...",
    "details": { "fieldErrors": "..." }
  }
}
```

Rules:
- Always include `code` and `requestId`.
- Include `details` for `BAD_REQUEST` only (e.g. Zod validation).
- For 5xx errors, `message` should be generic; details stay in logs.
- Server also sets `X-Request-Id` response header for correlation.

## HTTP Status Mapping (codes → status)

Central mapping (authoritative):

| Code | HTTP | Notes |
|------|------|------|
| `BAD_REQUEST` | 400 | Validation/parsing of request body, params |
| `NOT_FOUND` | 404 | Resource missing (promoted from `Option.none` at the HTTP boundary) |
| `CONFIG_INVALID` | 500 | Startup/config issue |
| `DB_*` | 500 | Internal persistence issue |
| `AI_*` | 502/500 | Only if surfaced; often handled via fallback |
| `UNKNOWN` | 500 | Catch-all |

## Patterns

### Converting `Option` to `NOT_FOUND` (at the boundary)

When a route requires a value, convert `Option.none` to a `NOT_FOUND` error at the route handler:
- Add the right context there (resource type/id, route).
- This keeps repos/core free of HTTP concepts.

### Wrapping throw-y code

- Sync:
  - `E.tryCatch(() => JSON.parse(text), (cause) => appError(..., { cause, context }))`
- Async:
  - `TE.tryCatch(() => fetch(...), (cause) => appError(...))`

### Logging

Boundary logging includes:
- `requestId`
- error `code`
- internal `message`
- `context`
- summarized `cause`
