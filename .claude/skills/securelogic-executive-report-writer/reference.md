# Reference — Executive Report Writer

Anatomy of each output and the canonical objects that feed it. **VERIFIED** = a real repo
output; **RECOMMENDED** = a writing template over real objects (not an existing generator).

## 1. Intelligence Brief item (VERIFIED — `intelligenceBriefGenerator.ts`)
Fields the platform actually produces (match them; don't add prose fields):
- `title` · `severity` (Critical/High/Moderate/Low) · `category`
  (vulnerability / threat_actor / vendor_incident / regulatory / general)
- `affected_cve` (or null) · `affected_vendor` (or null)
- `analysis` · `why_it_matters` · `recommended_actions`
- Brief-level: thesis / executive summary / cross-domain pattern (from `briefSynthesizer.ts`)

Premium-brief requirement (`FINAL_PRODUCT_STANDARD.md`): title, severity, category/section,
audience, whyItMatters, analysis, recommended action, CVE when available, vendor when
available, rationale for higher-risk items.

## 2. Executive posture summary (VERIFIED — `routes/executiveReport.ts`)
Sections: posture **score** + severity, **risk breakdown** by domain, **framework
compliance**, **open findings**. Source objects: latest `posture_snapshots` + `domain_scores`,
open `findings`, framework/control readiness. **Overall score is NULL when zero open
findings → "insufficient data," never 0.**

## 3. Risk memo (RECOMMENDED template)
Ground in one `risks` row + its `risk_treatments` + linked findings/evidence.
Structure: Decision → Risk (likelihood × impact = rating) → Exposure (what/who) → Treatment
(type, owner, status) → Recommendation → Evidence references. Use canonical Risk enums
(likelihood very_likely…rare; status open/accepted/mitigated/closed/transferred).

## 4. Approval / decision memo (RECOMMENDED template)
Ground in the workflow record (e.g. an assessment) + the audit trail.
Structure: Decision requested → Context → Options + tradeoffs → Recommendation → Approver +
date → Audit reference (`security_audit_log` event). Keep the decision on the structured
record; the memo narrates it.

## 5. Remediation plan (RECOMMENDED template)
Ground in open `findings` + their `actions`.
Structure: per finding → severity, exposure, the `action` (title, owner_user_id, due_date,
priority immediate/near_term/planned/watch), status. Roll up: count by severity, overdue
count. These counts must come from the data (`actions/summary`-style), never estimated.

## 6. Customer-facing update (RECOMMENDED template)
Only disclosed, non-sensitive facts. No internal findings, no other tenant's data, no
unproven certification. Structure: What happened → What it means for you → What we're doing →
What you should do. Restrained and factual.

## 7. The five decision-quality questions (VERIFIED standard)
Every output answers: what changed · why it matters · what exposure · what next · who acts by
when. A draft missing any of these is incomplete.

## 8. Banned phrasings (VERIFIED) → replacements
| Banned | Replace with |
|---|---|
| "may affect posture" | "raises the Vendor Risk domain score from Moderate to High because …" |
| "organizations should review" | "Acme's security lead must patch CVE-2026-… by <date>" |
| "could potentially" | "exposes <system> to <specific impact>" |
| "underscores the importance" | (delete; state the action) |

## 9. Data-integrity rules
- Never invent counts/dates/CVEs/vendors — read the object or write "unavailable".
- NULL posture = "insufficient data".
- Canonical enums only; don't blur Severity (`Moderate`) with criticality (`medium`).
- One org per output; no cross-tenant data.
- No fake proof / vanity metrics / misleading certifications. ISO 27001 unproven — don't claim.

## Cross-references
Brief pipeline + synthesis → **securelogic-intelligence-pipeline-engineer**. Compliance/
framework wording + ISO claim → **securelogic-ai-governance-expert**. Don't expose data a
tenant shouldn't see → **securelogic-security-reviewer**.
