# Stop Gate ASK-A — Authorization Equivalence · Evidence

Program: September 15 design-partner launch, Workstream 2
Branch: `feat/sept15-va-phase1-engagement-spine`
Date: 2026-08-12

---

## The invariant

> Ask must never reveal an object, field, aggregate, search result, citation or
> derived conclusion the requesting user could not obtain through their
> authorized product access.

---

## Verdict

**PASS on the engineering criteria (A.1–A.5).**
**Gate overall: PARTIAL** — A.6 (independent security review) is operator-owned.

---

## 1. Criteria

| # | Criterion | Result |
|---|---|---|
| A.1 | Per-tool differential test: same user, same question, same authorized set | **PASS** |
| A.2 | Contributor seat receives only assigned objects | **DEFERRED** — see §4 |
| A.3 | Cross-tenant probe across every tool | **PASS** |
| A.4 | No Ask module imports `pg`, `pgElevated` or `withTenant` | **PASS** |
| A.5 | Every tool's chain is reference-equal to its route's chain | **PASS — by construction** |
| A.6 | Independent security review sign-off | **NOT SATISFIABLE HERE** — operator-owned |

---

## 2. How the invariant is enforced

Ask's original defect was a **parallel data-access layer**: eight hand-written
queries duplicating what the canonical routes already compute. Git records five
separate corrections for drift between the two (`88bf1254`, `df05d81b`,
`455966e0`, `a71af3c6`, `fe70510d`), and the September audit still found five
more live defects — including a severity filter using lower-case literals against
a PascalCase domain, so the model was handed a permanently empty
critical-findings list and narrated a clean posture from it.

The durable fix is not better SQL. It is making the second data path impossible
to write.

A tool now reaches data **only** by executing a real route's real middleware
chain, in the requesting user's security context. `requireEntitlement`,
`denyContributor`, `requireCapability`, `ownerCondition`, `mayAccessOwned` and
`asTenant`/RLS therefore apply automatically and unchanged — not because the tool
layer re-checks them, but because it is running the code that performs them.

### Chains are resolved from the live router

The ratified plan had tools declaring their middleware chain by hand, with a test
asserting parity against the route. Implementation evidence produced something
better: `findings.ts` registers **inline anonymous handlers**, so there is nothing
to import and bind to.

`routeResolver.ts` therefore flattens the built Express router and takes the exact
handler array the route registered, wrappers (`asTenant`, …) intact. Consequences:

- there is no second list, so parity is **structural rather than asserted** — a
  middleware added to a route is in the tool on next boot, with no code change
  here and no test to remember;
- a tool bound to a route that does not exist throws at **construction**, at boot,
  not the first time a customer asks a question. This fired immediately: the
  initial spec bound posture to `/posture`, which is not a route (`/posture/latest`
  is), and the registry refused to build.

---

## 3. Test evidence

### Structural — `src/api/__tests__/platformToolRegistry.test.ts` (14 passed)

- **No file under `src/api/tools/` imports `pg`, `pgElevated` or `withTenant`.**
  The tool layer is physically incapable of reaching the database except through
  a route.
- No tool schema exposes an org / user / tenant / seat / impersonation argument.
- Every schema is closed (`additionalProperties: false`), so the model cannot
  pass arbitrary keys into a query string or body.
- Each tool's chain is **reference-identical**, handler by handler, to the chain
  its route registers.
- Every chain carries `requireApiKey` and `attachOrganizationContext` before the
  handler.
- Deleting a route from the product takes its tool with it.
- September 15 ships **read only**: a non-read tool arriving before Stop Gate
  ASK-B fails the build.
- Every read tool binds to a `GET` route.

### Behavioural — `test/isolation/askToolAuthorizationEquivalence.test.ts` (15 passed)

Run against a real Postgres with the full migration set and RLS enabled.

**Equivalence.** Eight cases run the same question through both paths and assert
`deepEqual` on the actual response bodies:

```
HTTP : supertest -> /api/<route>     what the product returns
Tool : executeTool(...)              what Ask would return
```

Covering `findings.search`, `findings.summary`, `vendors.search`, `risks.search`,
`actions.search`, `controls.search`, `obligations.search`, and a filtered
`findings.search?severity=Critical`. Comparing bodies rather than shapes means a
divergence cannot hide behind a plausible-looking response.

Verified in the full suite: **141 files · 975 tests · 0 failed.**

**Cross-tenant.** Orgs are seeded with distinguishable data (`ORG-A-ONLY` /
`ORG-B-SECRET`) so a leak is unmistakable in the failure output:

- no org A tool call surfaces org B data, across every read tool;
- **each org does see its own data** — without this, the absence assertions would
  also pass if every tool returned nothing;
- injecting `organization_id` / `organizationId` / `org_id` as tool **arguments**
  is ignored; tenant identity comes from the authenticated key;
- fetching another org's object by id returns `denied` with a message
  **byte-identical** to a genuinely absent id. The platform answers 404 for a
  cross-org read, and preserving that distinction in the tool layer would leak
  existence through Ask that the API deliberately refuses to leak;
- an unauthenticated or invalid-key caller is refused before any data is read.

---

## 4. A.2 — Contributor scoping, deferred with reason

Contributor enablement is ratified as **after ASK-A passes**, and the mechanism
that makes it safe (`ownerCondition` / `isAssignedScope` inside the handlers) runs
automatically because the handler is the real one.

It is not asserted here because `SECURELOGIC_SEAT_MODEL_ENABLED` gates all seat
enforcement, and exercising it end-to-end needs a seeded Contributor seat with an
assigned-object fixture that the isolation harness does not yet provide. Writing
a test that passes because the seat model is off would be worse than no test.

**Carried as an explicit P0 item before Contributors are enabled**, not as a
silent omission.

---

## 5. A real fix the test found

The first run failed on every tool:

```
Cannot set property path of #<IncomingMessage> which has only a getter
```

Express defines `path`, `query`, `ip` and `protocol` as prototype **getters**, so
a copy-based synthetic request cannot work at all.

The correct construction is prototypal inheritance from the live request,
shadowing only the routing surface as own data properties. That is also the more
secure shape: every auth-bearing field the chain reads — `apiKey`,
`organizationContext`, `userId`, seat scope, and anything a future middleware
attaches — resolves to the **same object** on the originating request. There is no
snapshot to go stale and no field a refactor can forget to carry across. The tool
request cannot hold a wider identity than its origin because it does not hold one
at all.

---

## 6. Scope note

The registry and executor are **not yet wired into `ask.ts`**. They stand alone
until the orchestration loop lands (Ask A1 remainder). `POST /api/ask` still
serves the A0-corrected snapshot path.

That ordering is deliberate: the gate is proven before the surface that depends
on it is switched over.
