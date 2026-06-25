# Example: reviewing a diff / PR in this codebase

How to perform a SecureLogic-grade review. Use `pr-checklist.md` as the full grid and
`security-review.md` for the security lens; this shows the *order of operations* and what to
look hardest at. Be brutally honest (per `CLAUDE.md`) — don't pass a change that's only
visually improved or only happy-path tested.

## Order of operations

1. **Classify the change.** Is the problem/feature a local implementation detail, a
   sequencing issue, a missing shared abstraction, a data-model problem, a pipeline problem,
   or a platform-architecture problem? Say which (per `CLAUDE.md` §9). A "fix" that's really
   a missing abstraction should become the abstraction.

2. **Is it in scope?** Does it match the active package in `BUILD_SEQUENCE.md`? Did it
   broaden scope, build something deferred, or touch a parked area (e.g. price labels)?
   Out-of-sequence work is a finding even if the code is correct.

3. **Tenant isolation first.** For every customer-data SQL statement in the diff:
   - `WHERE organization_id = $n` present?
   - org sourced from `req.organizationContext`, never body/param?
   - org predicate on `id`-filtered reads/updates/deletes (anti-IDOR)? 404 not 403 on miss?
   - cross-row refs verified same-org?
   - new table → `organization_id NOT NULL` + index + canonical RLS policy?
   - **a cross-org negative-path test added?** (If not, that's a blocking finding.)

4. **Entitlement & role.** Correct `requireEntitlement` tier (cited from §9)? Viewer blocked
   on mutation? Admin routes audit staff + org + reason?

5. **Security pass.** Secrets in code/config/fixtures/logs? Raw DB error to client? File
   route org-keyed/size-capped/streamed? LLM single-org + untrusted-output handled? Outbound
   URL pinned? Any control weakened without a compensating control?

6. **Audit & domain model.** Every mutation calls `writeAuditEvent` with actor + org? Any
   canonical object stored as a blob? Any divergent enum re-declared?

7. **Data & ops.** Migration idempotent + auto-apply-safe + correctly ordered? New env on the
   right service (and in `.env.example` + `render.yaml` prod+staging + `validateEnv` if
   boot-required)? Risky behavior flag-gated and staged first? `region:` pinned?

8. **Tests & docs.** Unit (mocked pg) + isolation/RLS + output-shape + negative-path present
   and matched to what changed? Governing docs / this Skill / canonical-model rows updated?

9. **Rollback.** Flag-flip or clean revert available? Forward-only migration documents its
   manual rollback? Nothing destructive without authorization + evidence trail.

## How to write findings

For each finding give: **file:line**, the **rule/standard** it violates (cite the governing
doc or this Skill), **why it matters** (the concrete risk — e.g. "org B can read org A's
findings"), and the **smallest correct fix**. Separate **blocking** (architecture, security,
tenant isolation, entitlements, missing negative-path test) from **non-blocking** (style,
naming, optional simplification). Don't invent issues to pad the list; don't rubber-stamp.

## Red flags that are almost always blocking here
- A customer-data query with no org predicate, or org from the body.
- A new route missing `requireApiKey → attachOrganizationContext → requireEntitlement`.
- A mutation with no audit event.
- A canonical object serialized into an output/blob.
- A new customer-data table with no RLS policy and/or no isolation test.
- An LLM prompt mixing two orgs' private data.
- A `new Pool()` outside `infra/postgres.ts`.
- "Done" claimed with only a happy-path unit test, or only UI polish.
- A commit proposed without the active-package scope stated, or without authorization.
