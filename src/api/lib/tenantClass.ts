/**
 * tenantClass.ts — the ONE governed way to ask for the real corpus.
 *
 * VA-S4-4C-3, owner decision 6. Synthetic validation evidence must be
 * distinguishable from real customer evidence and must never enter real-corpus
 * measurements, customer assurance metrics, product analytics, prevalence
 * claims, or production evidence reasoning.
 *
 * ── Why this file exists rather than a constant ────────────────────────────
 *
 * The decision was explicit that permanent correctness must NOT depend on
 * remembering to exclude a literal organization ID from every query. An
 * exported UUID constant would be exactly that mechanism with an extra step:
 * still opt-in, still forgettable, still invisible when forgotten.
 *
 * So the classification is a column (`organizations.tenant_class`, migration
 * 20261074) and this module is the only sanctioned way to read it. A corpus
 * query either goes through here or it is measuring the wrong population, and
 * `corpusQueryHygiene.test.ts` fails the build when a query in the census does
 * neither.
 *
 * ── What this is NOT ───────────────────────────────────────────────────────
 *
 * It is NOT a security boundary and must never be used as one. Tenant isolation
 * is RLS plus `organization_id` scoping, and nothing here weakens or substitutes
 * for either. This is a MEASUREMENT boundary: it decides whose evidence counts
 * as real when the platform makes a claim about the world.
 *
 * A synthetic organization is a fully normal tenant in every other respect. Its
 * data is isolated exactly as a customer's is, its users authenticate the same
 * way, and nothing here grants or denies access to anything.
 */

export const TENANT_CLASSES = ["customer", "synthetic_fixture"] as const;
export type TenantClass = (typeof TENANT_CLASSES)[number];

export function isTenantClass(v: unknown): v is TenantClass {
  return typeof v === "string" && (TENANT_CLASSES as readonly string[]).includes(v);
}

/**
 * Unknown or absent classification is treated as SYNTHETIC for measurement.
 *
 * This is the fail-closed direction FOR THE STATED REQUIREMENT, and it is the
 * opposite of the column's DEFAULT — deliberately, because the two answer
 * different questions. The column defaults to `customer` because a real
 * customer that silently vanished from analytics is a defect somebody "fixes"
 * by flipping the default back, leaving nothing. This function, which decides
 * whether a row may back a CLAIM ABOUT THE WORLD, resolves the unknown the
 * other way: a value it cannot recognise does not get to be evidence.
 */
export function classifyForMeasurement(raw: string | null | undefined): TenantClass {
  return isTenantClass(raw) && raw === "customer" ? "customer" : "synthetic_fixture";
}

export function isRealCorpus(raw: string | null | undefined): boolean {
  return classifyForMeasurement(raw) === "customer";
}

/**
 * The SQL predicate for a real-corpus population, as a fragment to be joined
 * into a query that already reaches `organizations`.
 *
 * `orgAlias` is the alias of the `organizations` table in the caller's query.
 * It is interpolated, so it must be a caller-authored SQL identifier and never
 * anything derived from a request. `assertSqlIdentifier` enforces that rather
 * than trusting the caller.
 *
 * There is no parameterised form because a table alias cannot be a bind
 * parameter. The identifier check is what makes the interpolation safe.
 */
export function realCorpusOrgPredicate(orgAlias = "o"): string {
  assertSqlIdentifier(orgAlias);
  return `${orgAlias}.tenant_class = 'customer'`;
}

/**
 * The predicate for a query that has an `organization_id` but does not join
 * `organizations`. Emits a subquery rather than tempting the caller to inline a
 * list of ids.
 */
export function realCorpusOrgIdPredicate(orgIdColumn: string): string {
  for (const part of orgIdColumn.split(".")) assertSqlIdentifier(part);
  return `${orgIdColumn} IN (SELECT id FROM organizations WHERE tenant_class = 'customer')`;
}

const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function assertSqlIdentifier(value: string): void {
  if (!SQL_IDENTIFIER.test(value)) {
    throw new Error(
      `tenantClass: "${value}" is not a bare SQL identifier. Table aliases are interpolated, ` +
        `so they must be authored in code and never derived from a request.`
    );
  }
}
