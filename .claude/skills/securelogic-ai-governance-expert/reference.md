# Reference — AI Governance Expert

Object + route + reference-data map. **VERIFIED** unless tagged. Authoritative model:
`CANONICAL_DOMAIN_MODEL.md` and the architect skill's `domain-model.md`.

## 1. AI governance objects
| Object | Table | Routes | Findings | Notes |
|---|---|---|---|---|
| AI System | `ai_systems` | `aiSystems.ts` | — | `criticality` lowercase (critical/high/medium/low). |
| Governance Review | `governance_reviews` | `governanceReviews.ts` | `ai_review` (point-in-time) | immutable. |
| AI Governance Assessment | `ai_governance_assessments` | `aiGovernanceAssessments.ts` | `ai_governance_review`, `domain='AI Governance'` | mutable; triggers on `non_compliant`/`partially_compliant`. |
| AI↔Vendor dependency | `ai_system_vendor_dependencies` | `aiSystemVendorDependencies.ts` | — | typed by `dependency_role`; partial-unique per (org, ai_system, vendor, role). |
| Governance context | — | `aiSystemGovernanceContext.ts` | — | read surface. |

## 2. Compliance objects
| Object | Table | Routes | Findings |
|---|---|---|---|
| Framework | `frameworks` | `frameworks.ts`, `frameworkActivation.ts`, `frameworkReadiness.ts` | — |
| Requirement | `requirements` | `requirements.ts` | — |
| Control | `controls` | `controls.ts` | — |
| Control Mapping | `control_mappings` | `controlMappings.ts` | — |
| Control Assessment | `control_assessments` | `controlAssessments.ts` | `control_test`, `domain='General'` (mutable) |
| Obligation | `obligations` | `obligations.ts` | — |
| Obligation Mapping | `obligation_mappings` | `obligationMappings.ts` | — |
| Obligation Assessment | `obligation_assessments` | `obligationAssessments.ts` | `obligation_review`, `domain=obligation.domain` |
| Control/Obligation context | — | `controlComplianceContext.ts`, `obligationComplianceContext.ts` | read surfaces |
| Signal links | `signal_control_links`, `signal_obligation_links`, `signal_ai_system_links` | matching routes | org-scoped, permit global signals |

## 3. Evidence & approvals
- `evidence` — immutable metadata, `(source_type, source_id)` linkage; source types incl.
  `control_test`, `ai_review`, `ai_governance_review`, `obligation_review`, `risk_treatment`,
  `finding`. Blob (if any) in R2.
- Approvals/sign-off: attach to the workflow record + `writeAuditEvent` (actor + org +
  reason). No free-text approval object exists — **RECOMMENDED** to keep approvals on the
  structured workflow + audit trail, not prose.

## 4. Framework reference data (VERIFIED files; depth caveats)
| File | Content |
|---|---|
| `frameworks/categories.json` | 12 internal categories C1–C12. |
| `frameworks/crosswalk.json` | C1–C12 → `nist_csf`, `nist_ai_rmf`, `iso_42001`, `soc2`, `securelogic`. |
| `frameworks/crosswalks/nist_ai_rmf_to_nist_csf.json` | NIST AI RMF ↔ NIST CSF. |
| `frameworks/crosswalks/nist_csf_to_soc_2.json` | NIST CSF ↔ SOC 2. |
| `frameworks/crosswalks/securelogic_controls_to_nist_csf.json` | SecureLogic controls ↔ NIST CSF. |
| `frameworks/catalog/securelogic_full.json`, `src/frameworks/catalog/securelogic_controls.json` | small SecureLogic control catalogs. |
| `src/engine/registry/controls/nistAiRmf.ts`, `aiGovernance.ts`, … | engine-side control domain definitions (stubs/registry). |
| `src/templates/{healthcare-saas,fintech,b2b-ai}.ts` | industry starter sets; HIPAA/SOC2/PCI/GDPR references. |

### Depth labels
- **VERIFIED:** category crosswalks + control-registry stubs + per-org assessable objects.
- **INFERRED:** not comprehensive line-item catalogs of each external standard.
- **UNKNOWN:** README says ISO 27001; crosswalk says iso_42001 — reconcile before claiming.
- **RECOMMENDED:** full per-standard control import, requirement-level automated readiness,
  automated evidence-to-control coverage.

## 5. Scoring touchpoints (VERIFIED)
- Posture engine (`src/engine/scoring/v2/*`, pure) consumes open findings (incl. AI-governance
  and control-test findings) + open risks → domain + overall scores. `domain='AI Governance'`
  rolls up as its own domain. Posture overall = NULL when zero open findings.
- `frameworkReadiness.ts` surfaces framework-level readiness from the control/requirement graph
  (read its current logic before extending — don't assume a scoring model).

## 6. GRC standards context (advisory, not repo facts)
When advising on NIST AI RMF (Govern/Map/Measure/Manage), ISO/IEC 42001 (AI management
system), SOC 2 (Trust Services Criteria), or NIST CSF (Identify/Protect/Detect/Respond/
Recover), map advice back to the **repo's** category crosswalk and structured objects. Label
external-standard interpretation as advisory; label what the platform actually implements as
VERIFIED/partial.

## Cross-references
Domain model / enums → **securelogic-enterprise-architect**. Signal→control/obligation/AI
matching → **securelogic-intelligence-pipeline-engineer**. Compliance reporting language →
**securelogic-executive-report-writer**.
