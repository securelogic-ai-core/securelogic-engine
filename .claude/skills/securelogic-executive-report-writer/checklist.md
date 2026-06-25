# Checklist — Executive Report Writer

Run before shipping any leadership / customer-facing text.

## Decision quality (BLOCKING)
- [ ] Answers all five: **what changed · why it matters · what exposure · what next · who acts
      by when.**
- [ ] Leads with the decision/implication, then the evidence. Restrained, enterprise voice.

## No generic language (BLOCKING)
- [ ] None of the banned phrasings ("may affect posture", "organizations should review",
      "could potentially", "underscores the importance", "highlights governance questions").
- [ ] Specifics present: named vendor / CVE / actor / system, concrete exposure, concrete
      action, owner, date.

## Data integrity (BLOCKING)
- [ ] Every number/count/date/CVE/vendor comes from a real object — nothing invented.
- [ ] NULL posture rendered as "insufficient data", never 0.
- [ ] Canonical enums used exactly; Severity (`Moderate`) not blurred with criticality
      (`medium`).
- [ ] No fake proof, vanity metrics, or misleading certification claims. No "ISO 27001"
      (unproven) — confirm with **securelogic-ai-governance-expert** first.

## Tenancy (BLOCKING)
- [ ] Output covers exactly one organization; no other tenant's data present.
- [ ] Customer-facing text discloses only non-sensitive, approved facts (no internal findings).

## Grounding
- [ ] Brief items match the real `BriefItem` field set (title/severity/category/cve/vendor/
      analysis/why_it_matters/recommended_actions).
- [ ] Posture/exec summaries match the actual report sections (posture score, risk breakdown,
      framework compliance, open findings).
- [ ] RECOMMENDED formats (risk/approval/remediation memos) are presented as templates over
      canonical objects — not implied to be auto-generated unless they are.

## Action routing
- [ ] Each recommendation names the responsible role and a due date or canonical priority
      (immediate/near_term/planned/watch).
- [ ] Traceability stated where it matters: which finding/risk/evidence/audit event backs the
      claim ("I can prove why we acted").
