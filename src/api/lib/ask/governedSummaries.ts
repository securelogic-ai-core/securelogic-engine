/**
 * governedSummaries.ts — server-sourced object identity for governed
 * proposal summaries (LC-5b).
 *
 * A governed confirmation card must identify the object from the SERVER's
 * knowledge, not the model's narration: the operator's findings.close
 * requirement is explicit ("summary must identify finding title +
 * severity"). These lookups run inside the same withTenant scope that
 * persists the proposal, org-scoped by construction.
 *
 * Return contract:
 *   { ok: true, suffix }  — append the identity suffix to the tool summary.
 *   { ok: false }         — the object is NOT VISIBLE to this org. The
 *                           proposal is DROPPED (never persisted, no token):
 *                           a card for an object the org cannot see is
 *                           either a hallucinated id or a cross-tenant
 *                           probe, and both fail toward NOT mutating.
 *
 * Tools without an enricher (the mutate class) pass through unchanged.
 */

import { pg } from "../../infra/postgres.js";

export type EnrichmentResult = { ok: true; suffix: string } | { ok: false };

type Enricher = (
  organizationId: string,
  input: Record<string, unknown>
) => Promise<EnrichmentResult>;

const ENRICHERS: Record<string, Enricher> = {
  "findings.close": async (organizationId, input) => {
    const result = await pg.query<{ title: string; severity: string }>(
      `SELECT title, severity FROM findings WHERE id = $1 AND organization_id = $2`,
      [String(input.id ?? ""), organizationId]
    );
    if ((result.rowCount ?? 0) === 0) return { ok: false };
    const row = result.rows[0]!;
    return { ok: true, suffix: ` — finding: "${row.title}" (severity ${row.severity})` };
  },
  "risks.accept": async (organizationId, input) => {
    const finding = await pg.query<{ title: string; severity: string }>(
      `SELECT title, severity FROM findings WHERE id = $1 AND organization_id = $2`,
      [String(input.id ?? ""), organizationId]
    );
    if ((finding.rowCount ?? 0) === 0) return { ok: false };
    // The accountable owner must be a member of THIS org — the route enforces
    // it at execution too; failing here means no card is ever rendered for an
    // owner the org could not name.
    const owner = await pg.query<{ name: string | null; email: string }>(
      `SELECT name, email FROM users WHERE id = $1 AND organization_id = $2`,
      [String(input.owner_user_id ?? ""), organizationId]
    );
    if ((owner.rowCount ?? 0) === 0) return { ok: false };
    const f = finding.rows[0]!;
    const o = owner.rows[0]!;
    return {
      ok: true,
      suffix:
        ` — finding: "${f.title}" (severity ${f.severity}); accountable owner: ` +
        `${o.name?.trim() || o.email}`,
    };
  },
  "vendors.decide": async (organizationId, input) => {
    const result = await pg.query<{
      vendor_name: string | null;
      status: string;
      residual_rating: string | null;
    }>(
      `SELECT v.name AS vendor_name, e.status, e.residual_rating
         FROM vendor_engagements e
         LEFT JOIN vendors v ON v.id = e.vendor_id AND v.organization_id = e.organization_id
        WHERE e.id = $1 AND e.organization_id = $2`,
      [String(input.id ?? ""), organizationId]
    );
    if ((result.rowCount ?? 0) === 0) return { ok: false };
    const row = result.rows[0]!;
    return {
      ok: true,
      suffix:
        ` — vendor: "${row.vendor_name ?? "(unnamed)"}", engagement status ${row.status}` +
        (row.residual_rating ? `, residual ${row.residual_rating}` : ""),
    };
  },
};

/**
 * Enrich a proposal summary with server-sourced identity. Must run inside a
 * tenant scope. Non-governed tools (no enricher) return the summary as-is.
 */
export async function enrichProposalSummary(
  organizationId: string,
  toolName: string,
  input: Record<string, unknown>,
  summary: string
): Promise<{ ok: true; summary: string } | { ok: false }> {
  const enricher = ENRICHERS[toolName];
  if (!enricher) return { ok: true, summary };
  const result = await enricher(organizationId, input);
  if (!result.ok) return { ok: false };
  return { ok: true, summary: summary + result.suffix };
}
