# Example: lib service + hand-written validator

Two patterns: (1) the per-domain **validator** (no zod/ajv for route bodies — this is the
house style), returning a discriminated union; (2) a pure **lib service** that holds
business logic so routes stay thin. Reference: any `src/api/lib/*Validation.ts`.

## 1. Validator (`src/api/lib/widgetValidation.ts`)

```ts
// Pure, no I/O. Returns { input } on success or { error, detail? } on failure.
const MAX_TITLE = 255;

export type WidgetCreateInput = {
  title: string;
  description?: string | null;
};

export type ValidationResult<T> =
  | { input: T }
  | { error: string; detail?: string };

function sanitize(s: string): string {
  return s.trim();
}

export function validateWidgetCreate(body: unknown): ValidationResult<WidgetCreateInput> {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "invalid_body" };
  }
  const b = body as Record<string, unknown>;

  if (typeof b.title !== "string" || b.title.trim().length === 0) {
    return { error: "title_required" };
  }
  const title = sanitize(b.title);
  if (title.length > MAX_TITLE) {
    return { error: "title_too_long", detail: `max ${MAX_TITLE} chars` };
  }

  let description: string | null = null;
  if ("description" in b && b.description !== null && b.description !== undefined) {
    if (typeof b.description !== "string") return { error: "description_must_be_string" };
    description = sanitize(b.description);
  }

  return { input: { title, description } };
}
```

The route consumes it exactly as in `route-handler.md`:
`const validated = validateWidgetCreate(req.body); if ("error" in validated) { res.status(400).json(validated); return; }`.

**Test it** (`src/api/lib/__tests__/widgetValidation.test.ts`) — every reject branch + the
accept branch + boundary lengths.

## 2. Pure lib service (`src/api/lib/widgetScoring.ts`)

Keep business logic out of the route and out of `src/engine` if it needs nothing from the
engine. If it needs DB rows, the route fetches them and passes them in — keep the service
pure and unit-testable, mirroring how `workflowScoringIntegration.ts` is pure and
`posture.ts` owns the queries.

```ts
// Pure: rows in, result out. No pg, no network.
import type { WidgetRow } from "../types/widget.js";

export function summarizeWidgets(rows: WidgetRow[]): {
  open: number; in_progress: number; closed: number;
} {
  const acc = { open: 0, in_progress: 0, closed: 0 };
  for (const r of rows) {
    if (r.status === "open") acc.open++;
    else if (r.status === "in_progress") acc.in_progress++;
    else if (r.status === "closed") acc.closed++;
  }
  return acc;
}
```

**When to put logic in `src/engine/**` instead:** only risk/posture *scoring* belongs in
the pure engine (so posture, assessments, and reports share one brain). Generic
feature logic belongs in `src/api/lib/`.

## 3. Anti-patterns to avoid here
- Reaching into `pg` from a "pure" service — then it can't be unit-tested database-free.
- Re-declaring enum values inline — import/centralize the canonical set.
- Throwing for expected validation failures — return the `{ error }` union so the route can
  shape a clean 400.
