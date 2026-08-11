# ADR-0006 — Platform scope boundaries: internal security operations, Finding detection identity, business units, MSSP

- **Status:** PROPOSED (2026-07-28). Awaiting Simmee ruling. This ADR is the rudder for
  connector expansion, the Universal Finding v2 charter (issue **#697**), and sales
  scoping; it authorizes no implementation itself.
- **Date:** 2026-07-28
- **Source:** Decision Review DS-4, DS-6, DS-7, DS-13 (2026-07-28).
- **Decision requested:** ratify the four scope rulings below as standing product policy.

---

## Ruling 1 — Internal security operations: INGEST by default

Per the platform thesis (PRODUCT_VISION: integrate, normalize, correlate, prioritize,
govern, decide — not replace):

| Domain | Determination |
|---|---|
| Vulnerability management (Tenable/Qualys/Rapid7 — adapters exist) | **INGEST** findings; **INTEGRATE** tickets (E6.P3) |
| Penetration testing | **INGEST** reports + **BUILD** the engagement/finding lifecycle only (no incumbent system; today claiming pen test is a ruled false claim — LAUNCH_READINESS) |
| Application security (SAST/DAST/SCA) | **INGEST** |
| Cloud security (CSPM/CNAPP — wiz/aws/azure/gcp adapters exist) | **INGEST** |
| Configuration reviews / benchmarks | **INGEST** (results as findings vs controls) |
| Identity findings (identity_provider/microsoft_graph adapters exist) | **INGEST** |
| Data protection (DLP/DSPM) | **INGEST** onto `enterprise_data_stores` |
| SIEM/EDR | **OOS at alert granularity**; INGEST incident-grade detections only. No SIEM adapter is built in either direction; outbound webhook events (issue #694 wave 1) are the interim SIEM answer |
| Ticketing | **INTEGRATE** (E6.P3 charter stands: approval-gated, ledgered) |

Every determination lands in the ONE findings model via `source_type` extension —
no parallel finding stores, ever (one-concept-one-object is locked).

## Ruling 2 — Universal Finding v2 direction (charter gate for #697)

The Finding today is a governance object with no detection identity (verified at column
level: no fingerprint, no `asset_id`, no external identity, no first/last-seen, no
suppression; connectors write observations, never findings). The extension is
**in-model and additive** — fingerprint identity, stored asset linkage, tool identity,
rule-level suppression (false-positive/informational dispositions ONLY — never a
bypass of acceptance SoD), bulk ingestion writer. Rejected alternatives, recorded so
they stay rejected: a separate `detections` table (recreates the dual-write problem;
violates one-concept-one-object) and routing internal findings through the
global-signal lane (wrong tenancy shape — org-private facts are not global
intelligence). Memo-first, CANONICAL_DOMAIN_MODEL amendment before migration, per the
locked protocol. Sequenced after ADR-0004's promotion package.

## Ruling 3 — Business units stay graph-native; labels never become ACLs

BUs remain `enterprise_entities` (`business_unit`/`department`) with rollups and
ownership derived from `part_of`/`owned_by` traversal, per the ERIP E3/E4 charters.
BU-scoped RBAC is deferred to an explicitly chartered Enterprise package. Guardrail:
**no `entity_type` label may ever silently become an access-control input.** First-class
BU tables/FKs are rejected for now (would fork the locked one-tenant model and the one
graph substrate before RLS is even live).

## Ruling 4 — MSSP/multi-org is a future chartered program, not a pricing claim

The advertised multi-org/MSSP capability (both pricing surfaces) is structurally absent
(`users.organization_id` single NOT NULL FK) and forbidden by TENANT_ISOLATION §1.
The claim comes down now (issue #692). Any future MSSP program begins with a §14
amendment to the tenant standard — never with UI or copy.

## Consequences

- Connector roadmap gains a filter; sales answers on internal-security domains become
  scriptable and honest; #697's memo has its consuming strategy.
- ALIGNS: PRODUCT_VISION thesis, one-model rulings, EAR-AD-4 (one graph),
  TENANT_ISOLATION §1, LAUNCH_READINESS false-claim rulings, E6.P3 charter.
- CONFLICTS: none against ratified rulings; Ruling 4 removes a marketing claim that
  already conflicted with the standard.
