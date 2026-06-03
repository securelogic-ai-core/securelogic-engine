# A04-G1 — PR γ.0 design: savepoint-safety guard (runtime choke point + dev-time lint)

**Status:** design only (uncommitted). Implementation contract — read-gated, same discipline as β1.5.
**Depends on:** β2 (`47f9aa0c`, findings family wrapped, on main). The savepoint mechanism (`createSavepointClient`, `tenantContext.ts:135`) is α-era infra; γ is the first workstream that makes it load-bearing for *writes*.
**Blocks start of:** γ.1 (risks wrap). γ.0 must land on develop → promote to main → prod-verify before γ.1 begins.
**Chosen approach:** A + B (operator-authorized). **B** = runtime guard inside `createSavepointClient` (load-bearing). **A** = ESLint rule scoped to `asTenant()` handler bodies (dev-time fast feedback).

---

## 1. Problem restatement (the residual risk from γ scope review)

γ wraps three families (risks, posture, vendorAssessments) whose write handlers own explicit `pg.connect()` + `BEGIN/COMMIT/ROLLBACK` transactions. Under `asTenant`, `pg.connect()` returns a `createSavepointClient` proxy that rewrites **only the bare, single-token control form** — `txControlKeyword` (`tenantContext.ts:114`) matches iff `value.trim().toUpperCase() === "BEGIN"|"COMMIT"|"ROLLBACK"`. Anything else passes through untouched to `real.query` on the request's tenant client.

So a statement the rewriter does **not** recognise — `BEGIN ISOLATION LEVEL SERIALIZABLE`, `START TRANSACTION`, `SELECT pg_advisory_lock(...)`, `LISTEN`/`NOTIFY`, `COPY` — issued inside a wrapped scope mutates or corrupts the ambient request transaction (a real nested `BEGIN`, a session lock that rides the pooled connection back, an async-notify channel that leaks across reuse, a protocol-level stream the proxy can't frame). §7.3-risk-2 of the γ design named this; the γ.0-feasibility micro-spec (`docs/A04-G1-pr-gamma0-savepoint-guard-spec.md`) established that a lint alone misses two real vectors:

1. **Helper-deep statements.** The lint is lexically scoped to the route-handler body; a statement inside a called `lib/` helper is invisible to it. **Not hypothetical:** `computeAndSavePostureSnapshot` (`postureSnapshot.ts:255`) does `pg.connect()` + `BEGIN` and is called from the posture handler γ.2 will wrap.
2. **Dynamically-built query strings.** The lint reads only static literals; `client.query(sql)` with a computed `sql` is opaque to it.

The runtime guard (B) closes both — it inspects the actual statement value at the single choke point through which every wrapped-scope `pg.connect()` query flows, regardless of how the string was built or how deep the call stack is. The lint (A) is retained as fast, pre-runtime feedback for the common case (a forbidden literal typed directly into a handler), caught before tests ever run.

Baseline is clean: grep finds **zero** forbidden statements in `src/api/routes/` today, so both guards land green.

---

## 2. The runtime guard (Approach B) — load-bearing

### 2.1 Error class
New typed error, **co-located with `createSavepointClient`** in `src/api/infra/tenantContext.ts` (mirrors β1.5 co-locating its errors with the shim in `deferredResponse.ts`), following the `TenantWrap…Error` house style (`extends Error`, sets `this.name`):

```ts
export class TenantWrapUnrewriteableStatementError extends Error {
  constructor(statement: string) {
    super(
      `asTenant wrap: statement "${statement}" cannot run on the savepoint-rewritten tenant ` +
      `client — createSavepointClient only rewrites the bare BEGIN/COMMIT/ROLLBACK form, so this ` +
      `would execute un-rewritten on the request transaction. If a connection legitimately needs ` +
      `this (explicit ISOLATION LEVEL, advisory lock, LISTEN/NOTIFY, COPY, bespoke tx lifecycle), ` +
      `use the pgRaw escape hatch with its own set_config — see tenantContext.ts:44-53.`
    );
    this.name = "TenantWrapUnrewriteableStatementError";
  }
}
```

**Naming (operator-confirmed):** `TenantWrapUnrewriteableStatementError`, not the originally-suggested `TenantWrapUnrewriteableTxControl`. The forbidden set is broader than transaction *control* — it includes advisory locks / `LISTEN` / `NOTIFY` / `COPY` / `SET TRANSACTION` — so `…UnrewriteableStatement…` names the whole set accurately.

### 2.2 Exact matchers (mirror the rewriter's acceptance set exactly)
Computed once on the candidate statement string `kw = statement.trim().toUpperCase()`:

| Forbidden | Test | Why |
|---|---|---|
| non-bare `BEGIN` | starts `BEGIN` **and** `kw !== "BEGIN"` | bare `BEGIN` is the *only* rewritten form; `BEGIN;`, `BEGIN WORK`, `BEGIN ISOLATION LEVEL …` are not. |
| non-bare `COMMIT` | starts `COMMIT` **and** `kw !== "COMMIT"` | catches `COMMIT;`, `COMMIT AND CHAIN`. |
| non-bare `ROLLBACK` | starts `ROLLBACK` **and** `kw !== "ROLLBACK"` | catches `ROLLBACK;`, `ROLLBACK AND CHAIN`, `ROLLBACK TO SAVEPOINT …` (manual savepoint juggling under the wrap is unsafe — intentionally flagged). |
| `END` (commit synonym) | starts `END` | un-rewritten commit of the ambient tx. |
| `START TRANSACTION` | starts `START TRANSACTION` | Postgres `BEGIN` synonym, carries `ISOLATION LEVEL`. **Added beyond the original spec — real gap.** |
| `SET TRANSACTION …` | starts `SET TRANSACTION` | **Operator-added (decision 1).** Mutates the ambient request transaction's isolation/mode **without** a `BEGIN`. Catching `BEGIN ISOLATION LEVEL X` but **not** `SET TRANSACTION ISOLATION LEVEL X` would be a load-bearing inconsistency — a bypass-by-syntax-choice hazard. |
| `SET LOCAL TRANSACTION …` | starts `SET LOCAL TRANSACTION` | **Operator-added (decision 1).** Same hazard via the `SET LOCAL` spelling. Anchored to `SET LOCAL TRANSACTION` so it does **not** catch the legitimate `SET LOCAL <guc> = …` form (and note: `withTenant`'s own GUC uses the `set_config(...)` *function*, `SELECT set_config('app.current_org_id', …, true)`, not a `SET LOCAL` statement, so it is untouched). |
| advisory locks | starts `SELECT PG_ADVISORY_` (matches `pg_advisory_lock`, `_xact_lock`, `_unlock`, `_shared`) | session locks leak onto the pooled connection. |
| async notify | starts `LISTEN` / `UNLISTEN` / `NOTIFY` | session-scoped, survives pooled reuse. |
| `COPY` | starts `COPY` | protocol-level stream, can't be framed through the proxy. |

"Starts" = the trimmed-uppercased statement begins with the token at a word boundary, internal whitespace `\s+`-tolerant (`/^SET\s+TRANSACTION\b/`, `/^START\s+TRANSACTION\b/`, etc.), so `SELECT 'BEGIN'` (literal data), `UPDATE … SET begin_at = …`, and `SET LOCAL app.current_org_id = …` do **not** match.

### 2.3 Exact throw site
In `createSavepointClient`'s inner `query` (`tenantContext.ts:139`). The bare control forms already `return` early from the existing `if (control === …)` blocks, so the guard sits in the **fall-through path**, immediately before `return (real.query)(...)`:

```ts
const query = (...args: unknown[]): unknown => {
  // ── extract candidate statement string (string form OR { text } form) ──
  const stmt =
    typeof args[0] === "string" ? args[0]
    : (typeof args[0] === "object" && args[0] !== null && typeof (args[0] as { text?: unknown }).text === "string")
      ? (args[0] as { text: string }).text
      : null;

  if (args.length === 1) {
    // … existing BEGIN→SAVEPOINT / COMMIT→RELEASE / ROLLBACK→ROLLBACK-TO logic, unchanged …
    // (bare control statements return here; nothing below runs for them)
  }

  // ── B: guard the fall-through. Bare control already returned above. ──
  if (stmt !== null) {
    const kw = stmt.trim().toUpperCase();
    if (isUnrewriteableStatement(kw)) {           // §2.2 matchers
      throw new TenantWrapUnrewriteableStatementError(stmt);
    }
  }

  return (real.query as (...a: unknown[]) => unknown)(...args);
};
```

- **Synchronous `throw`, NOT a rejected promise (clarification A — pinned).** `query` is a plain (non-`async`) function; the guard executes a bare `throw new TenantWrapUnrewriteableStatementError(stmt)` *before* any promise is constructed or returned. This matches β1.5's `TenantWrapStreamingError` fail-on-first-byte posture exactly. At a call site `await client.query(...)` the synchronous throw is hoisted into the awaiting async frame and surfaces as a rejection there → caught by the handler's own `try/catch` (which `ROLLBACK`s its savepoint) or, if unhandled, by `asTenant`'s `withTenant` → ROLLBACK → `next(err)`. **Test (§4.1 case A1) asserts the synchronous shape:** `expect(() => proxy.query("BEGIN ISOLATION LEVEL SERIALIZABLE")).toThrow(TenantWrapUnrewriteableStatementError)` — i.e. it throws on call, it does **not** return a promise that later rejects (`.rejects` would be the wrong assertion and is explicitly tested *not* to be the shape).
- **Both call forms are inspected (clarification B — pinned).** The candidate-string extraction handles the string form `client.query("BEGIN ISOLATION LEVEL …")` **and** the config-object form `client.query({ text: "BEGIN ISOLATION LEVEL …" })`, mirroring the existing rewriter's `text`-property branch (`tenantContext.ts:144-146`). A statement smuggled in via `{ text }` is guarded identically to the string form. (`§4.1` has a case for each form — strings = cases 1–9, config-object = case 10.)
- **The bare path is byte-identical to today** — the guard only ever fires on statements that currently fall through to `real.query`, and of those only the forbidden prefixes. Normal SQL (SELECT/INSERT/UPDATE/DELETE/bare control) is unaffected.
- `isUnrewriteableStatement(kw)` is a small pure helper beside `txControlKeyword`, unit-tested directly.

---

## 3. The lint rule (Approach A) — dev-time fast feedback

### 3.1 Mechanism (pure AST, no type info)
New flat-config local rule `securelogic-local/no-unrewriteable-stmt-in-tenant-wrap`, source in `eslint-rules/no-unrewriteable-stmt-in-tenant-wrap.js`, wired into `eslint.config.js` as a `plugins` entry scoped to `files: ["src/api/routes/**/*.ts"]`, severity `error` (joins the existing required `lint` CI job).

**In-wrap stack** (idiomatic ESLint enter/exit):
- On a function node (`ArrowFunctionExpression`/`FunctionExpression`) whose `parent` is a `CallExpression` with `parent.callee.name === "asTenant"` and `parent.arguments[0] === node` → push. On exit → pop.
- On a `CallExpression` whose callee is a `MemberExpression` with `property.name === "query"`: if the in-wrap stack is non-empty **and** the first argument (or its `text` property for the `{ text }` form) is a **static string** (`Literal` string, or `TemplateLiteral` with a single quasi / no expressions) matching a §2.2 forbidden pattern → `context.report`.

The stack covers closures nested inside the handler (still in-wrap). The selector matches today's only wrap shape — inline function arguments to `asTenant()` (verified: all five sites in `findings.ts` are `asTenant(async (req,res) => {…})`).

### 3.2 Escape hatch — explicit disable, not receiver tracking
The rule fires on `*.query(forbiddenLiteral)` **receiver-agnostically** (so aliased proxy clients are caught). A *legitimate* `pgRaw` client owning its own real transaction inside a wrapped handler is the sanctioned escape (`tenantContext.ts:44-53`) and is safe — but receiver-agnostic matching would flag it. Resolution: a per-line
```
// eslint-disable-next-line securelogic-local/no-unrewriteable-stmt-in-tenant-wrap -- pgRaw escape hatch: <reason>
```
Receiver-origin tracking was **rejected** (γ.0-spec §1): aliasing (`const c2 = client`) makes it a flaky heuristic, which fails the operator's "no heuristic that misses/over-flags" bar. The explicit disable keeps the rule deterministic and makes each escape a reviewable, justified act.

### 3.3 Matcher parity with B
A's regexes mirror B's matcher set exactly (same acceptance set, same forbidden tokens) so the two never disagree on a literal. A only adds the **static-extraction** precondition (it cannot see dynamic strings — that is B's job).

---

## 4. Test plan (every case enumerated)

All guard/rewriter unit tests extend the **existing** `src/api/__tests__/tenantContext.test.ts` harness (`makeFakeClient`, `makeCtx`) — **unit suite** (`vitest run`), so the **isolation suite stays at 106** (γ.0 wraps no route). Lint-rule tests use ESLint `RuleTester` (also unit).

### 4.1 Runtime guard — unit (`tenantContext.test.ts`)
**A1 — synchronous-throw shape (clarification A):** `expect(() => proxy.query("BEGIN ISOLATION LEVEL SERIALIZABLE")).toThrow(TenantWrapUnrewriteableStatementError)`, and an explicit assertion that the call does **not** return a thenable (the throw happens before any promise is constructed) — i.e. the `.rejects` form is the *wrong* shape and is asserted against.

Positive (each throws `TenantWrapUnrewriteableStatementError`):
1. `BEGIN ISOLATION LEVEL SERIALIZABLE` (string form — cases 1–9 cover the string form per clarification B)
2. `BEGIN;` (trailing-token form the original spec's `/^BEGIN\s+/` would miss)
3. `BEGIN TRANSACTION` / `BEGIN WORK`
4. `START TRANSACTION` / `START TRANSACTION ISOLATION LEVEL REPEATABLE READ`
5. `COMMIT AND CHAIN` / `COMMIT;` / `END`
6. `ROLLBACK AND CHAIN` / `ROLLBACK TO SAVEPOINT sp_1`
7. `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE` **(decision 1)** — the bypass-by-syntax twin of case 1.
8. `SET LOCAL TRANSACTION ISOLATION LEVEL SERIALIZABLE` **(decision 1)**; plus a negative-control assertion that legitimate `SET LOCAL app.current_org_id = '…'` does **not** throw (proves the matcher is anchored to `SET LOCAL TRANSACTION`, not `SET LOCAL`).
9. `SELECT pg_advisory_lock(1)` / `SELECT pg_advisory_xact_lock(1)`
10. `LISTEN ch` / `NOTIFY ch` / `UNLISTEN ch`
11. `COPY t FROM STDIN`
12. **multi-statement, forbidden at prefix (clarification C — covered):** `"BEGIN ISOLATION LEVEL SERIALIZABLE; SELECT 1"` throws — the trimmed-uppercased string *starts* with `BEGIN ` so the prefix matcher catches it. (The reverse ordering, forbidden **not** at the prefix, is the documented residual — see §5.)
13. **config-object form (clarification B):** `{ text: "BEGIN ISOLATION LEVEL SERIALIZABLE" }` throws — proving the `text`-branch is guarded identically to the string form.
14. **error message asserts** it names the offending statement **and** contains the `tenantContext.ts:44-53` escape-hatch pointer.

Negative (must **not** throw — behaviour preserved):
15. bare `BEGIN` / `COMMIT` / `ROLLBACK` still rewrite to `SAVEPOINT`/`RELEASE`/`ROLLBACK TO` (the existing tests at `:36-67` must stay green) and explicitly do not throw.
16. ordinary `SELECT 1`, parameterised `SELECT … WHERE id = $1`, cursors/Submittables pass through (existing `:87-104`).
17. `SELECT 'BEGIN'` (forbidden token only as literal data) does **not** throw — proves word-boundary anchoring. (Companion negative-control for `SET LOCAL <guc>` is folded into case 8.)

**Helper-deep proof + savepoint-stack assertion (the postureSnapshot class — operator-required; clarification E):**
18. A test that invokes the proxy's `query` from inside a **fake helper function** (not a route-handler closure), issuing `BEGIN ISOLATION LEVEL …`, and asserts it still throws — proving the choke point catches helper-deep statements the lint structurally cannot see. **Plus the §6-E savepoint-stack assertion:** before the throwing call, push a real savepoint (`proxy.query("BEGIN")` → `SAVEPOINT sp_1`, so `ctx.savepoint.n === 1`); then issue the forbidden statement and assert it throws; then assert (a) `ctx.savepoint.n` is **unchanged** (still `1`) and (b) the fake client recorded **no** additional `SAVEPOINT`/`RELEASE`/`ROLLBACK TO` from the throwing call — proving the guard fires in the fall-through path *before* any savepoint push/pop and leaves the stack intact.

### 4.2 Lint rule — `RuleTester` (unit)
Invalid (each reports):
19. route fixture with `asTenant(async (req,res) => { … client.query("BEGIN ISOLATION LEVEL SERIALIZABLE") … })`
20. fixtures for `START TRANSACTION`, `SET TRANSACTION ISOLATION LEVEL …`, `SELECT pg_advisory_lock(…)`, `LISTEN`, `COPY`, `{ text: "BEGIN WORK" }`
21. forbidden statement inside a **closure nested in** the handler (still in-wrap)
Valid (no report):
22. the **current route files lint clean** (baseline regression — run the rule over `findings.ts` etc., expect zero)
23. bare `BEGIN`/`COMMIT`/`ROLLBACK` inside a wrapped handler
24. forbidden statement **outside** any `asTenant()` wrap (e.g. an admin route, or top-level) — not reported
25. `pgRaw` path with the documented `eslint-disable-next-line … -- pgRaw escape hatch: <reason>` — not reported

### 4.3 The two A+B integration proofs (operator-required)
- **(a) lint catches inline, before runtime** — case 19: a forbidden statement added inline in a handler fails `npm run lint`; the runtime guard never has to run. (Demonstrated by the RuleTester invalid case = lint-time catch.)
- **(b) runtime catches helper-deep, where lint is blind** — case 18: a forbidden statement reachable only through a helper passes lint (the lint never scans the helper) but throws at the `createSavepointClient` choke point. Pair 22+18 together demonstrate the division of labour explicitly.

### 4.4 Test-count deltas
- **Isolation suite: unchanged (106).** γ.0 adds no route wrap and touches no isolation harness.
- **Unit suite: +~27** (≈19 runtime-guard assertions in §4.1 — A1 + 14 positive incl. the two `SET TRANSACTION` variants and the multi-statement case + 3 negative + the helper-deep/savepoint-stack case — plus ≈8 RuleTester cases in §4.2). Exact before/after numbers are captured fresh at implementation start (the memory baseline of 3871 is not assumed — re-counted on the γ.0 branch and reported in the PR body).

---

## 5. What this catches vs. what it doesn't (honest residuals)

**B catches (deterministically, at runtime):**
- Every forbidden statement in §2.2 reaching the savepoint client — **whether the string is a literal or dynamically built**, and **however deep the call stack**. *Directly answering the operator's question:* yes, a dynamically-constructed `"BEGIN ISOLATION LEVEL SERIALIZABLE"` **is** caught by B — the guard inspects the runtime value, not the source token. (A does **not** catch it — A only reads literals; this is exactly why B is the load-bearing layer.)

**A catches (at dev time, before tests run):**
- Forbidden **literals** typed directly into (or in a closure within) an `asTenant()` handler body — the common accidental-drift vector.

**Now covered by the matcher set (decision 1, no longer residual):** `SET TRANSACTION ISOLATION LEVEL …` and `SET LOCAL TRANSACTION …` — the bypass-by-syntax twins of `BEGIN ISOLATION LEVEL …`. Catching the `BEGIN` spelling but not the `SET TRANSACTION` spelling would have been a load-bearing inconsistency; both are now flagged (§2.2).

**Also explicitly covered — multi-statement with the forbidden statement at the prefix (clarification C):** `"BEGIN ISOLATION LEVEL SERIALIZABLE; SELECT 1"` **is caught** — `trim().toUpperCase()` makes the string start with `BEGIN `, so the prefix matcher fires (test §4.1 case 12). The trim+prefix shape is sufficient for the common accidental form (the dangerous statement written first).

**Residual gaps (neither layer closes — documented, not silently assumed away):**
1. **Statements that bypass `createSavepointClient` entirely.** `pgRaw`/`pgElevated`/a directly-imported `Pool` do not flow through the proxy, so B never sees them. `pgRaw` is the *sanctioned* escape (safe — owns its own connection); `pgElevated` is the audit/dispatch channel. A misuse of `pgElevated` for tenant-relative work is a *different* concern (the fire-and-forget rule), out of γ.0 scope.
2. **Forbidden statement *not* at the prefix.** The reverse multi-statement ordering — `"SELECT 1; BEGIN ISOLATION LEVEL …"` — has prefix `SELECT`, so the embedded `BEGIN` is missed; likewise an advisory lock buried inside a CTE / multi-column SELECT escapes the anchored `^SELECT\s+PG_ADVISORY_` matcher. These are **deliberate-evasion** shapes (you have to *construct* a benign-looking prefix), not accidental-drift shapes. **Decision (operator-confirmed): leave documented, do not chase with broader regex** — un-anchoring would create false positives on legitimate SQL containing these tokens mid-statement, which fails the "no over-flag" bar. The trim+prefix shape is the right altitude.
3. **Non-`asTenant` future wrap mechanisms.** Both layers key on the current wrap shape; a future wrapper other than a literal `asTenant(...)` inline call would need the selectors revisited (a ζ CI-invariant concern).

Net: B makes §7.3-risk-2 **substantively closed for accidental reintroduction** (literal or dynamic, handler or helper, including the `SET TRANSACTION` and prefix-multi-statement spellings); the residuals above are deliberate-evasion or out-of-channel paths that remain documented caveats. This is a strict, large improvement over the pre-γ.0 "documented caveat only" state.

---

## 6. Failure modes

**Guard fires (a forbidden statement was issued under the wrap):**
- Synchronous throw at `client.query(...)` → the handler's own `try/catch` runs `ROLLBACK` (rewritten to `ROLLBACK TO sp_n; RELEASE`, undoing its savepoint) and self-responds 500, **or** if unhandled, `asTenant`'s `withTenant` callback rejects → ROLLBACK of the request transaction → `next(err)` → `errorHandler` → `internalError(res)` → **HTTP 500 `internal_error`** (the platform standard, β1.5 §3.4). Nothing forbidden ever reaches `real.query`; nothing partial persists.
- **Client-facing contract — generic 500, no information disclosure (clarification D — pinned).** The client receives exactly the existing `internalError(res)` body — `{ error: "internal_error", requestId? }`, HTTP 500 — the **same shape** as any `tenant_wrap_handler_failed` (this throw *is* a handler-side throw, so it routes through that path, not `tenant_commit_failed`). The typed error **name** and its message — **which contains the offending statement text and implies the matcher** — go to the **engine log only, never the response body**. Leaking the statement text or the matcher pattern to the client would be an information-disclosure surface (it reveals internal SQL and the guard's detection logic), so it is explicitly excluded from the wire. The log carries the full detail for incident response; the client learns nothing beyond "internal error."
- **Observability:** the typed `TenantWrapUnrewriteableStatementError` (name + statement in the message) is greppable in engine logs, emitted under the existing `tenant_wrap_handler_failed` event (handler-side throw, not a COMMIT failure — consistent with β1.5's two-event taxonomy; `tenant_commit_failed` stays reserved for durability incidents).
- **Savepoint stack is unaffected by the throw (clarification E — pinned).** The guard fires in the **fall-through path** of `query` — *after* the `if (control === BEGIN/COMMIT/ROLLBACK)` blocks that push/pop `stack` and bump `ctx.savepoint.n`, and only for statements that are **not** those bare controls. So when the guard throws it has performed **no** `stack.push`/`stack.pop` and **no** `ctx.savepoint.n` increment, and issued **no** `SAVEPOINT`/`RELEASE`/`ROLLBACK TO` to the real client. The scope's savepoint accounting is exactly as it was immediately before the offending call; the handler's own subsequent `ROLLBACK` (or `asTenant`'s request-level ROLLBACK) unwinds cleanly from that intact state. Asserted by §4.1 case 18.

**Guard misfires (false throw on legitimate SQL):** only possible if a wrapped handler legitimately issues one of the forbidden statements **through the proxy** — which is precisely the unsafe act the guard exists to prevent. The correct response is the escape hatch (`pgRaw` + manual `set_config`), which bypasses the proxy and thus the guard. So a "misfire" is by construction a real finding, not a false alarm. Word-boundary anchoring (§2.2) prevents the only true false-positive class (forbidden token as literal data / column name), covered by test 17.

**Guard fails to fire (residual §5.2):** the un-rewritten statement reaches `real.query` on the tenant client. In most cases Postgres itself then errors loudly (`there is already a transaction in progress` for a nested `BEGIN`; `SET TRANSACTION ISOLATION LEVEL must be called before any query`) → handler 500. The dangerous *silent* case is a session advisory lock that succeeds and rides the pooled connection back — which is exactly why §5.2 recommends keeping advisory matching and flags the non-anchored evasion as a known limit.

**Lint false state:** a RuleTester-verified rule cannot "misfire" in CI beyond its tested behaviour; the only operational risk is a *new* wrap shape the selector doesn't recognise (→ silently not linted, but B still guards at runtime — defence in depth).

---

## 7. Rollout (same discipline as β1.5)

1. **Branch off develop.** Implement B (guard + error + helper, `tenantContext.ts`) and A (rule + flat-config wiring + RuleTester tests), plus the unit tests in §4. No route files touched. No `asTenant` allowlist change. No migration. No `withTenant` change.
2. **Green locally:** `npm run lint` (new rule active, baseline clean), `npm test` (unit, +~23), `npm run test:isolation` (still 106), `npm run typecheck`, `npm run build`.
3. **PR to develop** with the before/after test counts in the body. Branch-sync discipline: promote with literal `gh pr merge <N> --merge` (never squash — `feedback_branch_sync_merge_strategy`).
4. **Promote develop → main** (the 6 required checks must pass, incl. the now-extended `lint`), then **prod-verify**:
   - `/version` confirms the new commit live on engine prod + staging.
   - **Inert-by-design check:** the guard changes behaviour only for forbidden statements, of which there are zero in the codebase — so prod verification is a **findings smoke** (GET list + a POST/PATCH on the already-wrapped findings family) confirming the guard does **not** throw on legitimate wrapped-route traffic. This is the meaningful prod signal: that adding the choke-point check broke nothing on the live wrapped path.
5. **Only after main is prod-verified does γ.1 (risks) start.** γ.1's explicit-tx write tests then run *with the guard already in place*, so any unsafe statement in the risks handlers fails fast.

---

## 8. Out of scope for γ.0 (explicit)
- Any route wrap (that is γ.1–γ.3). The posture inner-`withTenant` refactor lives in γ.2, not here.
- Receiver-origin data-flow tracking for the lint (rejected, §3.2).
- Chasing the prefix-evasion residuals (forbidden statement not at the string prefix; non-anchored advisory) with broader regex — **operator-confirmed left documented** (§5 residual 2); un-anchoring would over-flag legitimate SQL. (`SET TRANSACTION`/`SET LOCAL TRANSACTION` are now **in scope** and in the matcher set per decision 1 — no longer pending.)
- A ζ-style CI invariant that every `attachOrganizationContext` route is wrapped-or-allowlisted — separate, later.
- The dead webhook retry loop, phase-3 `DATABASE_URL` flip — unrelated.
