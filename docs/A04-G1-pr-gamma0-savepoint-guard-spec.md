# A04-G1 PR γ.0 — savepoint-safety guard: design micro-spec

**Status:** Design only. No implementation. One-page spec for operator review per the γ authorization.
**Goal:** enforce §7.3-risk-2 — a handler wrapped in `asTenant()` must not issue a transaction-control / session-level statement that `createSavepointClient` does **not** rewrite (`BEGIN ISOLATION LEVEL …`, advisory locks, `LISTEN/NOTIFY`, `COPY`), because those pass through un-rewritten onto the request's tenant client and corrupt the wrap's transaction.

---

## 0. The load-bearing fact that makes this tractable

All five `asTenant` wrap sites today are **inline function expressions**: `asTenant(async (req, res) => { … })` (`findings.ts:89,238,444,513,597`). So "downstream of an `asTenant()` call site" = "lexically inside the function argument to `asTenant()`." No cross-function data-flow, no type info, no call-graph tracing needed for the **direct** case. A pure-AST ESLint rule resolves it.

**Tooling fit:** ESLint 9 flat config (`eslint.config.js`) + `@typescript-eslint/parser` already wired; `lint` is a required CI check on main. A local flat-config plugin plugs straight into the existing gate. Baseline is clean (grep: zero forbidden patterns in `src/api/routes/` today), so the rule lands green.

---

## 1. Approach A — ESLint custom rule (the requested deliverable)

**Mechanism (stateful stack, idiomatic ESLint):**
- Enter a function node whose `parent` is `CallExpression`, `parent.callee.name === 'asTenant'`, and `parent.arguments[0] === node` → push "in-wrap".
- On any `CallExpression` whose callee is a `MemberExpression` `.query(...)` → if the in-wrap stack is non-empty **and** the first argument yields a forbidden **static string**, `context.report(...)`.
- Exit that function node → pop.

The stack naturally covers nested closures inside the handler (a `setImmediate(() => client.query(...))` is still in-wrap → still flagged).

**Static-string extraction** (first arg of `.query`, or `.text` of a `{ text }` config object — mirroring the rewriter's own `text`-branch at `tenantContext.ts:144-146`):
- `Literal` (string) → `.value`
- `TemplateLiteral` with no `${}` (single quasi) → cooked value
- anything else → **not statically resolvable → not matched** (see §3 won't-catch)

**Forbidden matchers** — I recommend tightening beyond the regexes in your message; deltas flagged for your approval:

| Pattern | Matcher | Note |
|---|---|---|
| non-bare `BEGIN` | `/^\s*BEGIN\b/i` AND NOT `/^\s*BEGIN\s*$/i` | **Tighter than your `/^BEGIN\s+/i`:** also catches `BEGIN;` and `BEGIN WORK` (both non-rewritten — the rewriter accepts *only* trimmed-uppercase `=== "BEGIN"`). |
| `START TRANSACTION` | `/^\s*START\s+TRANSACTION\b/i` | **Added.** Postgres `BEGIN` synonym, carries `ISOLATION LEVEL`, also un-rewritten. Your spec's regex misses it entirely — real gap. |
| non-bare `COMMIT`/`ROLLBACK` | `/^\s*(COMMIT\|ROLLBACK\|END)\b/i` AND NOT exactly bare | **Added (symmetry).** `COMMIT AND CHAIN`, `COMMIT;`, `END` are the same un-rewritten hazard class as non-bare BEGIN. |
| advisory locks | `/\bpg_advisory(_xact)?_(un)?lock(_shared)?\b/i` | session-level locks especially leak onto the pooled connection. |
| async notify | `/^\s*(LISTEN\|UNLISTEN\|NOTIFY)\b/i` | session-scoped, survives pooled reuse. |
| `COPY` | `/^\s*COPY\b/i` | protocol-level stream, breaks under the proxy. |

**Integration:** add a `plugins: { "securelogic-local": localPlugin }` block to `eslint.config.js` scoped to `files: ["src/api/routes/**/*.ts"]`, rule `"securelogic-local/no-unrewritten-tx-in-tenant-wrap": "error"`. Rule source lives in `eslint-rules/` (new dir), imported by the flat config.

**Escape hatch (no false-positive on the legitimate `pgRaw` path):** the rule fires on `*.query(forbiddenLiteral)` **receiver-agnostically** — so it correctly catches aliased proxy clients, but it would also flag a *legitimate* `pgRaw.connect()` client that owns its own real transaction (the sanctioned escape, `tenantContext.ts:44-53`). Resolution: a per-line `// eslint-disable-next-line securelogic-local/no-unrewritten-tx-in-tenant-wrap -- pgRaw escape hatch: <reason>` with a required justification. This keeps the rule simple (no variable-origin tracking → no aliasing blind spot) and makes the escape an explicit, reviewable act — matching the escape hatch's own "deliberate choice" philosophy. (Receiver-origin tracking was considered and **rejected for γ.0**: aliasing — `const c2 = client` — makes it a flaky heuristic, which fails your stated bar.)

---

## 2. What Approach A WILL catch

- Any **literal** transaction-control / advisory / listen / copy statement written **directly inside** an `asTenant()` inline handler (or a closure nested in it) — i.e. the exact drift vector of "someone edits a wrapped route handler." This is 100% of current usage and the common case.
- Aliased receivers (`const c2 = client; c2.query("BEGIN ISOLATION LEVEL …")`) — flagged, because matching is receiver-agnostic.
- Both call forms: `query("…")` and `query({ text: "…" })`.
- Deterministic, zero false positives (the only suppression is an explicit, justified disable comment).

## 3. What Approach A WON'T catch (honest blind spots)

1. **Statements inside called helpers.** The rule is lexically scoped to the handler subtree. A handler that calls a `lib/` helper which itself does `pg.connect()` + `BEGIN ISOLATION LEVEL …` is **not** scanned. **This is not hypothetical:** `computeAndSavePostureSnapshot` (`postureSnapshot.ts:255`) does exactly `pg.connect()` + `BEGIN` and is called from the posture handler γ.2 will wrap. Today that `BEGIN` is bare (safe), but the lint would **not** protect it from drifting to a non-bare form.
2. **Dynamically-built query strings.** `client.query(sql)` where `sql` is a variable, concatenation, or template with `${}` — the rule reads only static literals, so it sees nothing.
3. **Non-`asTenant`-but-still-scoped paths.** Code reaching a tenant scope via a future wrapping mechanism other than a literal `asTenant(...)` inline call would not match the selector.

Blind spots (1) and (2) mean **Approach A alone does not fully discharge §7.3-risk-2** — it guards the direct/literal drift vector but leaves the helper and dynamic paths to the documented caveat.

---

## 4. Approach B — runtime guard in `createSavepointClient` (recommended complement)

A ~4-line addition at the choke point closes **all three** blind spots deterministically: in the savepoint client's `query()` (`tenantContext.ts:139`), when a single-arg statement (string or `{text}`) **starts** a transaction-control / session statement (`/^\s*(BEGIN|START TRANSACTION|COMMIT|ROLLBACK|END|LISTEN|UNLISTEN|NOTIFY|COPY)\b/i` or `pg_advisory`) but is **not** the bare form the rewriter accepts → `throw new TenantSavepointUnsupportedError(...)` before issuing it to the real client.

- Catches helper-issued and dynamically-built statements (it sees the actual runtime string), which the lint cannot.
- Same enforcement philosophy as β1.5's `TenantWrapStreamingError` (fail loud at the choke point).
- Fires in unit/isolation tests + staging, not just on literals at dev time.
- Touches α-era infra — must be reviewed carefully and covered by a test asserting bare control statements still pass and a non-bare one throws.

---

## 5. Recommendation & decision needed

**Per your bar — "a heuristic that misses cases is worse than the documented caveat" — Approach A *alone* does not meet it** (it misses helpers like `postureSnapshot.ts` and dynamic strings). My recommendation:

- **Ship B as the load-bearing guard** (runtime, at the choke point, no blind spots), **and A as fast dev-time feedback** on the common literal-in-handler vector. Together they are belt-and-suspenders with no silent miss.
- If you want **lint-only**, that is defensible *only if* we explicitly keep §7.3-risk-2 as a "documented caveat, partially linted" — not "guarded" — and accept the `postureSnapshot.ts`-class helper gap. I'd advise against calling that closed.

**Feasibility verdict (you asked me to STOP and surface if harder than expected):** the lint core is **not** harder than expected — the inline-handler fact makes it clean and false-positive-free. The thing worth your decision is **not** difficulty; it's that **lint-only leaves real gaps**, and the cheap way to actually close the hazard is the runtime guard (B). I stopped here for that decision rather than silently shipping a partial guard.

**Decision requested:** (a) A + B (recommended), (b) A only with the caveat downgraded honestly, or (c) B only (skip the lint). After you choose, γ.0 implements that; γ.1 starts only once γ.0 lands clean.

---

## 6. Scope of γ.0 (whichever option)
- New: `eslint-rules/no-unrewritten-tx-in-tenant-wrap.js` (+ flat-config wiring) for A; `createSavepointClient` guard + `TenantSavepointUnsupportedError` for B.
- Tests: rule unit tests (positive: each forbidden form flagged; negative: bare control + pgRaw-with-disable pass) for A; savepoint-guard unit test for B.
- Docs: escape-hatch note (A) and the `pgRaw` + manual `set_config` path (`tenantContext.ts:44-53`).
- No route files touched. No `asTenant` allowlist change. Lands before γ.1.
