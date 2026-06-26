# Example: cross-org isolation test + finding writeup

## A. The negative-path test the reviewer demands

For any new customer-data surface, isolation is proven in `test/isolation/` (real Postgres),
not the unit lane (which mocks `pg`). Model on `crossOrgIsolation.test.ts` /
`findingsRls.test.ts`. Two flavors:

### Route-level (org A credentials cannot read org B rows)
```ts
// test/isolation/widgetsIsolation.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { seedOrg, asOrg } from "./testDb.js";   // harness helpers

describe("widgets — cross-org isolation", () => {
  let orgA: string, orgB: string, widgetB: string;
  beforeAll(async () => {
    orgA = await seedOrg("A");
    orgB = await seedOrg("B");
    widgetB = await asOrg(orgB).createWidget({ title: "B-secret" });
  });

  it("org A GET :id of an org-B widget → 404 (not the row, not 403)", async () => {
    const res = await asOrg(orgA).get(`/api/widgets/${widgetB}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "widget_not_found" });
  });

  it("org A list never contains org-B rows", async () => {
    const res = await asOrg(orgA).get(`/api/widgets`);
    expect(res.body.widgets.find((w: any) => w.id === widgetB)).toBeUndefined();
  });
});
```

### RLS-level (policy holds under the real role)
```ts
// test/isolation/widgetsRls.test.ts — proves the inert-but-required policy
import { withRole } from "./testDb.js";   // connects as app_request via SET ROLE

it("unset GUC → zero rows (fail-closed)", async () => {
  await withRole("app_request", async (c) => {
    await c.query(`SELECT set_config('app.current_org_id', '', true)`);
    const r = await c.query(`SELECT * FROM widgets`);
    expect(r.rowCount).toBe(0);                 // NULLIF('', '') → NULL → no rows
  });
});

it("cross-org INSERT rejected by WITH CHECK", async () => {
  await withRole("app_request", async (c) => {
    await c.query(`SELECT set_config('app.current_org_id', $1, true)`, [orgA]);
    await expect(
      c.query(`INSERT INTO widgets (organization_id, title) VALUES ($1, 'x')`, [orgB])
    ).rejects.toThrow();
  });
});
```

## B. How to write a finding

```
[BLOCKING] Cross-org read in GET /api/widgets/:id
file: src/api/routes/widgets.ts:142
Rule: TENANT_ISOLATION_STANDARD.md §4 — UPDATE/DELETE/SELECT by id MUST include
      `AND organization_id = $org`.
Risk: the query is `WHERE id = $1` with no org predicate. Any authenticated org can read
      any other org's widget by guessing/enumerating a UUID (IDOR → cross-tenant leak).
Fix:  add `AND organization_id = $2` with organizationId from req.organizationContext;
      return 404 on no-match. Add test/isolation/widgetsIsolation.test.ts (above).
```

```
[NON-BLOCKING] Audit event missing on PATCH
file: src/api/routes/widgets.ts:210
Rule: TENANT_ISOLATION_STANDARD.md §8 + R7 — mutations must writeAuditEvent.
Risk: status changes are not attributable after the fact; weakens the auditability we sell.
Fix:  add writeAuditEvent({ ..., eventType: "widget.status_changed" }) after the UPDATE.
```

Severity guide: missing org scope / wrong entitlement tier / secret exposure / cross-org LLM
batching / missing negative-path test = **BLOCKING**. Missing audit / weak validation /
naming = non-blocking (but list them).
