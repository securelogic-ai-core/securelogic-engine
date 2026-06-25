# Example: AI governance review → finding → posture

Shows how the verified objects connect, so new GRC work extends the graph instead of forking
it. (Skeletons — read the real routes `aiGovernanceAssessments.ts` / `governanceReviews.ts`
before implementing.)

## The object graph (VERIFIED)
```
ai_systems (org-scoped, criticality)
   ├── governance_reviews            point-in-time, immutable
   │      └── findings source_type='ai_review'
   └── ai_governance_assessments     mutable workflow
          └── findings source_type='ai_governance_review', domain='AI Governance'
                 ├── (status non_compliant | partially_compliant → finding on first transition)
                 └── feeds posture engine → domain_scores['AI Governance'] → overall
   └── ai_system_vendor_dependencies (typed edge → vendors; signal cascade edge)
evidence (source_type='ai_governance_review', source_id=assessment.id) — structured, immutable
```

## Mutable-workflow status transition that triggers a finding
```ts
// inside the PATCH /api/ai-governance-assessments/:id handler (sketch)
const prev = current.status;
const next = validated.input.status;   // e.g. 'partially_compliant'

await pg.query(
  `UPDATE ai_governance_assessments SET status = $1, updated_at = NOW()
    WHERE id = $2 AND organization_id = $3`,            // org predicate mandatory
  [next, id, organizationId]
);

// Finding ONLY on the first transition into a triggering status (idempotent — don't dup)
const TRIGGERS = new Set(["non_compliant", "partially_compliant"]);
if (TRIGGERS.has(next) && !TRIGGERS.has(prev)) {
  await pg.query(
    `INSERT INTO findings (organization_id, source_type, source_id, domain, severity, status, title)
     VALUES ($1, 'ai_governance_review', $2, 'AI Governance', $3, 'open', $4)`,
    [organizationId, id, severityFor(next), `AI governance: ${next}`]
  );
}

writeAuditEvent({
  organizationId, actorUserId: (req as any).userId ?? null,
  actorApiKeyId: (req as any).apiKey?.id ?? null,
  eventType: "ai_governance_assessment.status_changed",
  resourceType: "ai_governance_assessment", resourceId: id,
  payload: { from: prev, to: next }, ipAddress: req.ip ?? null,
});
```

Key points the skill enforces:
- **Org predicate** on the UPDATE; org from context.
- **Correct `source_type`** (`ai_governance_review`, the *mutable* one) and `domain='AI Governance'`.
- **Finding only on first transition** into a triggering status (idempotent).
- **Audit** the transition.
- The finding then flows to the **pure** posture engine automatically — you do not write
  domain scores by hand.

## Mapping to an external framework (use the crosswalk, don't hardcode)
```ts
// Relationship comes from frameworks/crosswalk.json, not an inline map.
// C1–C12 → { nist_csf, nist_ai_rmf, iso_42001, soc2, securelogic }
import crosswalk from "../../../frameworks/crosswalk.json";
const aiRmfCategories = crosswalk.nist_ai_rmf;   // ["C1","C3","C5","C7","C8","C9","C10","C11"]
```
If you need control-level (not category-level) NIST AI RMF coverage, that is **RECOMMENDED /
not built** — propose a catalog-import package; do not fabricate per-control mappings.

## Evidence attachment (structured, immutable)
```ts
await pg.query(
  `INSERT INTO evidence (organization_id, source_type, source_id, evidence_type, title, description)
   VALUES ($1, 'ai_governance_review', $2, 'document', $3, $4)`,
  [organizationId, assessmentId, "Model card v3", "Reviewed bias eval + sign-off"]
);
// the file itself → R2 via blobStorage at org/{orgId}/... ; evidence row is metadata only
```

## Don't
- Don't merge the point-in-time and mutable workflows or reuse the wrong `source_type`.
- Don't store an approval/decision as prose — keep it on the workflow + audit.
- Don't claim ISO 27001 coverage from the iso_42001 crosswalk (UNKNOWN — reconcile first).
