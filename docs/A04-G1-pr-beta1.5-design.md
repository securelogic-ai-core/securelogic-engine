# A04-G1 — PR β1.5 design: commit-before-respond via a deferred-response shim

**Status:** design only (uncommitted, scratch branch `chore/a04-g1-pr-beta1.5-design`).
**Depends on:** β1 (`fdc7e12d`, dispatcher → `pgElevated`, on main).
**Blocks merge of:** β2 (PR #146, open on develop — findings POST/PATCH wrapped in `asTenant`).
**Chosen approach:** Approach B (response shim that buffers the handler's `res` calls until COMMIT resolves), per the prior β1.5 scoping analysis.

---

## 1. The defect β1.5 closes

`withTenant` (`src/api/infra/postgres.ts:91`) runs:

```
BEGIN → SET LOCAL app.current_org_id → fn() → COMMIT → (finally) release
```

The wrapped write handlers call `res.status(201).json(...)` (`findings.ts:216`) /
`res.status(200).json(...)` (`findings.ts:723`) **as the last statement inside `fn`**, before `fn`
resolves. So the wire order is:

```
INSERT/UPDATE → res.json(success) FLUSHED → fn resolves → COMMIT → release
```

The success response is sent **before** the transaction is durable. If `COMMIT` fails — connection
death, statement/idle-in-transaction timeout, a deferred constraint, or a serialization error
surfacing at commit — the row is rolled back, but the client already holds a `201` plus the finding
body. `asTenant`'s `.catch(next)` then forwards the commit error to Express, but by then
`res.headersSent === true`, so `errorHandler.ts:97` (`if (res.headersSent) return;`) drops it
silently. **The client believes the write succeeded; it didn't.**

Two honest scoping notes:

- **This window is new in β2 and is NOT inert.** Pre-β2 these writes ran on the ambient `pg` proxy in
  autocommit — each statement durable before `res.json`. The `withTenant` transaction is real
  regardless of which DB role the engine connects as, so β2 opens a real (low-probability)
  respond-before-commit window in production *independent of the phase-3 `DATABASE_URL` flip*. RLS
  enforcement is inert pre-flip; this consistency window is not.
- **Reads are unaffected.** A failed COMMIT on a read-only transaction changes no client-visible
  state. The shim is correctness-critical only for the two write routes, but it is applied uniformly
  to all five wrapped routes (and any future wrapped route) so the wrap is safe *by construction*.

---

## 2. Surface area (verified, this turn)

### 2.1 The wrap and its lifecycle

- `asTenant(handler)` (`src/api/middleware/asTenant.ts`): on a request with an org id, runs
  `withTenant(orgId, () => handler(req, res, next)).catch(next)`; with no org id, runs the handler
  **unwrapped** (no transaction) so its own `organization_context_missing` path applies. Returns the
  promise so tests can await it.
- `withTenant` (`postgres.ts:91`): the proven primitive. Used by HTTP routes *and* non-HTTP callers
  (e.g. `posture-worker`). It has no concept of an HTTP response and must stay that way. **β1.5 does
  not touch `withTenant`.**

### 2.2 `res.*` methods actually used by the five wrapped routes

`grep -oE "res\.[a-zA-Z]+" src/api/routes/findings.ts | sort | uniq -c`:

| method        | count | notes                                            |
|---------------|-------|--------------------------------------------------|
| `res.status`  | 32    | always immediately chained to `.json`            |
| `res.json`    | 1     | (`res.js` in grep = truncated `res.json`)        |

**That is the entire surface.** No `res.set`, `res.setHeader`, `res.send`, `res.write`, `res.end`,
`res.cookie`, `res.redirect`, `res.type`. Every wrapped handler terminates with exactly one
`res.status(n).json(body)` followed by `return`.

### 2.3 The streaming hazard, made concrete

`src/api/routes/findingsExport.ts` (`GET /api/findings/export.csv`) is a findings-family route and is
**not** wrapped in `asTenant`. Its `res.*` surface:

| method         | count |
|----------------|-------|
| `res.setHeader`| 2     |
| `res.write`    | 2 (one in a per-row loop) |
| `res.end`      | 1     |
| `res.status`   | 7 (validation/error paths) |
| `res.json`     | 1     |

A buffering shim cannot faithfully or safely buffer `res.write` in a loop (unbounded memory; defeats
streaming). `findingsExport` is the exact route a future RLS sweep batch might wrap without thinking.
It is the worked example for §3.6's streaming carve-out.

### 2.4 Error-handling chain

- `errorHandler.ts` (mounted last, `app.ts:463`): `if (res.headersSent) return;` else
  `internalError(res)`.
- `internalError` → `jsonError(res, 500, "internal_error")` → body `{ error: "internal_error",
  requestId? }` (`httpResponses.ts:94`, `:25`). HTTP 500, standardized, no internal leakage.

The key leverage: **because the shim never flushes during the handler, `res.headersSent` stays
`false`, so a COMMIT-failure forwarded via `next(err)` reaches `internalError(res)` and the 500
actually sends** — using the platform's existing standardized error path, with no new body invented.

---

## 3. Design — deferred-response shim (Approach B)

### 3.1 Module location and name

New module: **`src/api/middleware/deferredResponse.ts`**, exporting:

```
createDeferredResponse(realRes): { proxy: Response, commit(): void, discard(): void }
```

Rationale: keeps `asTenant.ts` readable and lets the shim be unit-tested in isolation with no DB and
no HTTP. `withTenant` stays response-agnostic; `asTenant` owns the response lifecycle; the shim is the
single place that understands "buffer then replay."

### 3.2 The `Response` surface the proxy must proxy

Minimal-but-faithful. Buffer (do **not** flush) the following, recording intent:

**The supported surface is exactly `status` + `json` (decision 4.1/4.4).** That is the entire idiom
every wrapped route uses (§2.2), so the shim models that and nothing else — single mode,
safe-by-construction. Everything outside it throws.

- `status(code)` → record `statusCode`; **return the proxy** (chainable — handlers rely on this).
- `json(body)` → record the single **terminal intent** `{ kind: "json", body }`; return the proxy.
- Pass-through reads that don't mutate output: `getHeader`, `locals`, `req` — delegate to `realRes`.

**Loud-reject everything else (decision 4.1).** Any non-`status`/non-`json` call throws, because
buffering it correctly is either impossible (streaming) or speculative (no caller), and silently
delegating to `realRes` would flush and reintroduce the respond-before-commit bug. Two typed errors,
both with a message pointing to this design doc (`docs/A04-G1-pr-beta1.5-design.md §3.2/§3.6`):

- **Streaming / early-flush terminal output** — `write`, `end` *(with a chunk)*, `pipe`, `send`,
  `sendFile`, `download`, `flushHeaders`, `writeHead` → throw `TenantWrapStreamingError`. Message:
  the route streams or flushes early and cannot run inside an `asTenant` wrap; stream outside the
  tenant transaction (commit-then-stream).
- **Any other unmodelled method** (e.g. `set`/`setHeader`/`header`/`cookie`/`redirect`/`type`) →
  throw `TenantWrapUnsupportedResponseError` naming the method. Header setters and friends are NOT
  buffered — no current wrapped route uses them, and modelling them speculatively was rejected
  (decision 4.4). A future route that genuinely needs headers extends the shim deliberately, with its
  own test, rather than getting silent best-effort behaviour.

### 3.3 Buffering strategy

Single terminal intent. Handlers issue zero-or-more `status(code)` calls then exactly one `json(body)`
and `return`, so the model is: an optional recorded `statusCode`, then exactly one terminal `json`.
No header buffering (decision 4.4) — header setters throw (§3.2).

- `commit()` (called by `asTenant` **after** `withTenant` resolves, i.e. after COMMIT): assert
  `realRes.headersSent === false` (else surface — see §3.5), then apply the terminal call onto
  `realRes` (`realRes.status(code).json(body)`).
- `discard()` (called on the failure path): no-op on the wire — nothing was ever flushed. Exists for
  symmetry/clarity and to assert-guard against a double terminal.
- **Double-terminal guard:** a second terminal call recorded before `commit()` is a handler bug
  (e.g. forgot a `return` after an error response). Throw `TenantWrapDoubleResponseError` immediately
  so it rolls back loudly rather than racing two responses.
- **No-terminal guard:** if `commit()` is reached with no terminal recorded, that is also a handler
  bug (handler resolved without responding); throw so it routes to `errorHandler` as a 500 rather
  than hanging the socket.

### 3.4 Error path — which 5xx, what body

Route COMMIT failure (and any in-scope throw) through the **existing** `next(err)` → `errorHandler`
→ `internalError(res)` path:

- HTTP **500**, body `{ error: "internal_error", requestId? }` — the platform standard. No new
  error code, no new body shape.
- Additionally, log a distinct ops event **`tenant_commit_failed`** (in `asTenant` on the
  COMMIT-failure branch) so commit failures are greppable and alertable separately from generic
  handler 500s. The client body stays generic (no DB internals leaked); the distinction lives in
  logs only.

Why generic and not a bespoke `commit_failed` client code (decision 4.2): the client's correct
behaviour on a 500 is identical regardless of stage (retry / treat as unknown). A new public code
would leak transaction internals and expand the `ErrorCode` union for no client benefit. The
incident-response signal lives entirely in the `tenant_commit_failed` log event.

### 3.5 Headers-already-sent guard

The handler can only ever touch the **proxy**, never `realRes`, so during handler execution
`realRes.headersSent` must remain `false`. The shim enforces this two ways:

1. The proxy never calls `realRes`'s terminal/streaming methods during the handler (it buffers).
2. `commit()` asserts `realRes.headersSent === false` before replay. If it is somehow `true` (a
   handler reached the raw `res` past the proxy — should be impossible, but we don't trust shape),
   `commit()` throws `TenantWrapAlreadySentError` → `next(err)` → logged; the response is already
   partially on the wire so `errorHandler`'s own `headersSent` guard correctly delegates. This makes
   the "impossible" case loud in logs rather than a silent double-send.

### 3.6 Streaming-route carve-out (analogous to the fire-and-forget rule)

A streaming handler (`res.write` in a loop, `res.pipe`, `res.sendFile`) **cannot** be wrapped in a
buffering shim: buffering the whole stream is an OOM hazard and defeats streaming; not buffering
reintroduces respond-before-commit. `findingsExport.ts` (§2.3) is the live example.

**Decision 4.1 — runtime guard, not documentation alone (confirmed).** The proxy throws
`TenantWrapStreamingError` the moment a streaming/early-flush method is called inside a wrap, and the
thrown error's message points back to this design doc so the next engineer lands on the rationale, not
just a stack trace. Failure mode becomes: handler throws → `withTenant` ROLLBACK → `next(err)` →
standardized 500 — *loud, on the very first streamed byte, before any data flushes*. This matches the
codebase's "fail loud / never trust shape" posture (`errorHandler.ts` header comment) and the spirit
of the standing fire-and-forget rule: a structural hazard is caught by construction, not left to
reviewer memory.

This is recorded as a standing rule for the A04-G1 wrap workstream, parallel to the fire-and-forget
rule: **before wrapping a route in `asTenant()`, confirm it terminates with a single
`res.status(n).json(body)` and does not stream or set headers. Streaming routes (exports, downloads,
SSE) need a different lifecycle — either a commit-then-stream split, or wrap only the read transaction
and stream outside it.** The runtime guard enforces this; the rule documents why.

### 3.7 Interaction with Express error-handling middleware

`asTenant` keeps forwarding to `next(err)`. `withTenant` collapses both failure modes into one
rejected promise, so the wrap flags a handler-throw at its source (inside the `withTenant` callback)
and branches the log event on that flag — keeping the two signals distinct:

```
const deferred = createDeferredResponse(res);
let handlerThrew = false;
try {
  await withTenant(orgId, async () => {
    try {
      return await Promise.resolve(handler(req, deferred.proxy, next));
    } catch (err) {
      handlerThrew = true;     // application-level failure, not a durability failure
      throw err;
    }
  });
  deferred.commit();          // COMMIT already succeeded → replay onto real res
} catch (err) {
  deferred.discard();         // nothing flushed; headersSent still false
  logger.error({
    event: handlerThrew ? "tenant_wrap_handler_failed" : "tenant_commit_failed",
    ...
  });                          // distinct ops signals (decision 4.2)
  next(err);                  // → errorHandler → internalError(res) → 500 (NOW sends, headersSent=false)
}
```

Two failure modes, both now correct AND separately observable:

1. **Handler throws** (incl. streaming-guard throw): `withTenant` ROLLBACK → reject with
   `handlerThrew === true` → `discard()` → log **`tenant_wrap_handler_failed`** → `next(err)` → 500.
   (Today: also 500, but only because `res` hadn't flushed yet on a throw — unchanged behaviour, now
   uniform.) This is an application-level failure; it carries no durability signal.
2. **Handler resolves, COMMIT throws:** `withTenant` rejects with `handlerThrew === false` →
   `discard()` → log **`tenant_commit_failed`** → `next(err)` → **500 actually sends** (the fix).
   Today this path silently drops because `res` already flushed `201`.

**Why the two events stay distinct.** `tenant_commit_failed` means a transaction the application
believed it had completed failed to become durable — the load-bearing signal for durability incident
response (connection death at commit, failover, deferred-constraint violation, commit timeout). Folding
a routine handler throw (a 4xx-shaped bug, a validation error that escaped, etc.) into the same event
would drown that signal in application noise and make commit-failure alerting useless. The handler-throw
path therefore gets its own `tenant_wrap_handler_failed` event; `tenant_commit_failed` fires only when a
resolved handler's COMMIT fails.

The **no-org path stays unwrapped and unshimmed** — no transaction means no commit to order against,
so the handler writes to the real `res` directly and emits its own 403. Lower risk, no behaviour
change.

### 3.8 Why `withTenant` is untouched

`withTenant` is used by non-HTTP callers with no `res`. The shim is HTTP-response-specific and lives
entirely in the `asTenant`/`deferredResponse` layer. This preserves the proven primitive and keeps
β1.5's blast radius inside the request-scope wrap that only the (inert, pre-flip) findings routes use.

---

## 4. Resolved decisions (operator-confirmed)

### 4.1 Streaming carve-out → **runtime guard** ✅
The proxy throws an explicit error on any non-`status`/non-`json` terminal call
(`res.write`/`res.pipe`/`res.send`/`res.end`-with-chunk/`sendFile`/`download`/etc.). The error message
points to this design doc (`docs/A04-G1-pr-beta1.5-design.md §3.2/§3.6`). Chosen to match the
codebase's posture of loud failures over silent ones — the hazard surfaces at the first byte, before
anything flushes, rather than relying on reviewer vigilance. See §3.2 and §3.6.

### 4.2 COMMIT-failure response → **generic `internal_error` 500 + distinct log** ✅
The client gets exactly the body the existing `internalError(res)` path produces (`{ error:
"internal_error", requestId? }`, HTTP 500). A distinct `tenant_commit_failed` log event carries the
incident-response signal. No new public `ErrorCode`, no transaction internals leaked to clients. See
§3.4.

**Two distinct log events, one client contract (refined).** The wrap distinguishes the two ways it can
reject (§3.7): a handler that throws logs `tenant_wrap_handler_failed`; a handler that resolves but
whose COMMIT fails logs `tenant_commit_failed`. Both still produce the identical generic
`internal_error` 500 to the client — the distinction lives only in logs. Keeping them separate matters
because `tenant_commit_failed` is the load-bearing durability signal (failover, deferred-constraint
violation, commit timeout); collapsing handler throws into it would bury that signal under ordinary
application errors and make commit-failure alerting unreliable.

### 4.3 Shim scope → **uniform across all `asTenant`-wrapped routes** ✅
Single mode, safe-by-construction — the shim applies regardless of HTTP method. GETs pay a microscopic
cost (the buffered `status`/`json` is replayed once after the read transaction resolves); writes get
the correctness guarantee. No per-route opt-in marker — that is exactly the kind of forgettable flag
the α design deliberately avoided.

### 4.4 `send`/header buffering → **not modelled; throw** ✅ (folded into 4.1)
The supported surface is strictly `status` + `json`. `res.send` and header setters
(`set`/`setHeader`/`header`/`cookie`/`redirect`/`type`) are **not** buffered — they throw
(`TenantWrapStreamingError` for `send`/streaming output, `TenantWrapUnsupportedResponseError` for the
rest). A future route that genuinely needs headers extends the shim deliberately with its own test,
rather than getting silent best-effort behaviour. See §3.2.

---

## 5. Concrete PR β1.5 scope

### 5.1 Files changed

| File | Change | Est. size |
|------|--------|-----------|
| `src/api/middleware/deferredResponse.ts` | **new** — shim: `createDeferredResponse`, `status`+`json`-only proxy, `commit`/`discard`, streaming + unsupported + double-terminal guards, typed errors | ~70–100 lines |
| `src/api/middleware/asTenant.ts` | wire shim on the has-org path; explicit try/commit/catch/discard; `tenant_commit_failed` log | ~+15 / −3 lines |
| `test/isolation/deferredResponse.test.ts` | **new** — pure unit tests of the shim (no DB) | ~80–120 lines |
| `test/isolation/asTenant.test.ts` | **extend** — forced-COMMIT-failure integration case | ~+40 lines |
| `docs/A04-G1-pr-beta1.5-design.md` | this doc | — |
| `docs/A04-G1-request-scope-wrap-design.md` *(optional)* | add the streaming carve-out as a standing rule cross-ref | ~+10 lines |

**No migration. No route-handler changes. No `withTenant` change.** Complexity: low–medium,
concentrated in the shim's correctness (the proxy + guards). No production-behaviour change for any
non-wrapped route; for wrapped routes the only observable change is that a COMMIT failure now returns
500 instead of a false 201.

### 5.2 Tests that prove the fix

**Unit (`deferredResponse.test.ts`, no DB):**
1. Buffering: calling `proxy.status(201).json(body)` flushes **nothing** to the real res until
   `commit()`; after `commit()` the real res shows status 201 and body. (Spy on a fake res; assert
   not-called pre-commit, called post-commit.)
2. `discard()` flushes nothing (real res never written).
3. Streaming/early-flush guard: `proxy.write(...)` / `proxy.end(chunk)` / `proxy.pipe(...)` /
   `proxy.send(...)` each throw `TenantWrapStreamingError`, and the message references this design doc.
4. Unsupported-method guard: `proxy.setHeader(...)` / `proxy.set(...)` / `proxy.cookie(...)` /
   `proxy.redirect(...)` each throw `TenantWrapUnsupportedResponseError` naming the method.
5. Double-terminal guard: two `json()` calls throw `TenantWrapDoubleResponseError`.

**Integration (`asTenant.test.ts`, DB-backed — the headline test):**
6. **Forced COMMIT failure → client sees 500, never 201.** Inside the wrapped handler, register a
   `DEFERRABLE INITIALLY DEFERRED CONSTRAINT TRIGGER` (or a deferred-constraint temp table) that
   raises at COMMIT, then call `res.status(201).json(...)` and return. Assert: `fakeRes.statusCode`
   is the error status (500 via `errorHandler`/`next`), **not** 201; the success body was never
   replayed; `next` received the commit error; and the pool client was released (no leak — mirrors
   the existing throw-path test at `asTenant.test.ts:110`).
7. Happy path regression: a normal handler still produces its 200/201 after commit (the existing
   three `asTenant.test.ts` cases must pass unchanged — the shim sits transparently between handler
   and the test's `fakeRes`).

### 5.3 What β1.5 does to the β2 sequence

Because Approach B is **transparent to handler code**, β2's POST/PATCH handlers need **no code
changes** — they keep calling `res.status(n).json(...)` exactly as written in PR #146. Once β1.5 lands
and promotes:

- β2 rebases onto the corrected wrap and reduces to a **re-test**, not a rewrite: re-run the isolation
  + route suites; confirm writes still 201/200 on success and now 500 (not a false 201) under a forced
  commit failure.
- Order: β1 (done) → **β1.5 (this — infra + commit-ordering test, promote)** → β2 (re-test on the
  corrected wrap) → γ (risks / posture / vendorAssessments) → δ–ζ.

---

## 6. Out of scope for β1.5 (explicit)

- Handler that does a successful write then throws in non-DB code and self-catches to a 500: the write
  still commits while the client sees 500. Pre-existing semantic, not introduced or fixed here.
- The dead webhook retry loop (`finding_webhook_retry_loop_dead`) — separate ticket.
- Wrapping `findingsExport.ts` — it stays unwrapped; the streaming guard only protects against a
  *future* wrap. A commit-then-stream design for exports is its own item if/when needed.
- Any phase-3 `DATABASE_URL` flip work.
