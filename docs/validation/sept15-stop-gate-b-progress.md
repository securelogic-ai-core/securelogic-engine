# Stop Gate B — External Trust Boundary · Progress

Program: September 15 design-partner launch, Workstream 1 Phase 3
Date: 2026-08-12 (revised — evidence and comment routes landed)

---

## Verdict

**NOT PASSED.**

All eleven planned routes now exist and all nine adversarial classes are
covered — 70 cases against real Postgres. What remains cannot be produced by a
test file: an independent security review of the surface, and a real external
tester completing an engagement on staging.

This document exists so the near-complete state cannot be mistaken for a pass.

---

## Criteria

| # | Criterion | Result |
|---|---|---|
| B.1 | Full adversarial suite — all nine classes | **PASS** — 9 of 9, 70 cases |
| B.2 | Static invariant: no portal route reads a caller-supplied identifier | **PASS** — now enforced by test, not by reading |
| B.3 | Independent security review of the portal surface | **NOT SATISFIABLE HERE** |
| B.4 | A real external tester completes an engagement on staging | **NOT SATISFIABLE HERE** |
| B.5 | Rate limiting holds with Redis stopped | **PASS** — DB-backed by design |
| B.6 | Kill switch 404s every route and invalidates live sessions | **PASS** — re-verified across all eleven |
| B.7 | Every portal action in `audit_log` with its invite and engagement | **PASS** — all eleven routes |

Two of seven criteria need a human. Both are operator-owed and neither is
compressible.

---

## 1. What is built — the complete surface

| Route | Purpose |
|---|---|
| `POST /vendor-portal/session` | invite → cookie exchange |
| `DELETE /vendor-portal/session` | sign out |
| `GET /vendor-portal/engagement` | orientation read |
| `GET /vendor-portal/questions` | frozen scope + answers so far |
| `PUT /vendor-portal/questions/:requirementId` | save / resume one answer |
| `POST /vendor-portal/submit` | the state transition |
| `POST /vendor-portal/evidence` | attach a document |
| `GET /vendor-portal/evidence` | list attachments (metadata only) |
| `DELETE /vendor-portal/evidence/:evidenceId` | withdraw an attachment |
| `GET /vendor-portal/comments` | read the clarification thread |
| `POST /vendor-portal/comments` | send a message |

Supporting: migration `20260925` (evidence gains `engagement_id`,
`requirement_id`, `uploaded_via_invite_id`; new `vendor_engagement_comments`
with RLS), and `portalUploadPolicy.ts` (17 unit tests).

---

## 2. Adversarial coverage — 9 of 9 classes

| Class | State |
|---|---|
| Token abuse — expired, revoked, malformed, forged, replay after revocation | **Covered** |
| Cross-tenant — session reaches exactly one engagement | **Covered** |
| Parameter injection — `engagement_id` / `organization_id` as arguments | **Covered** |
| Kill switch — off 404s, off is the default, on restores | **Covered** |
| Cross-surface leakage — both directions | **Covered** |
| IDOR sweep across questionnaire objects | **Covered** |
| State machine — portal attempts transitions it may not cause | **Covered** |
| Post-submit writes return 409 | **Covered** |
| **Upload abuse** — oversize, MIME mismatch, traversal, archive, quota, orphan | **Covered** — 34 cases |

The upload class is `test/isolation/vendorPortalUploadAdversarial.test.ts`. It
stubs **only** the R2 client; the database is real, because the quota is a SUM
over real rows and the confidentiality rule is a SQL filter backed by a CHECK.
An unconfigured bucket would have made every upload return 503 and every
assertion pass for the wrong reason.

---

## 3. Four defects the new routes exposed

**1. The third portal transition was unreachable.** The transition table permits
`clarification_requested → in_progress` by a portal actor, but
`isPortalWritable` excluded that state. A reviewer who requested clarification
therefore produced an engagement the vendor could see and could not act on. The
request was a dead end. Fixed with `isPortalRespondable`, and a new test asserts
that *every* portal-permitted transition is reachable from some window — the
general property, not the one instance.

**2. Opening the link answered the clarification request.** Fixing (1)
immediately created (2): the session exchange asked the transition table "may a
portal actor reach `in_progress` from here?", and once the answer became yes for
`clarification_requested`, merely exchanging the invite marked the reviewer's
request as being worked on. The exchange now tests `from === "issued"`
explicitly. Opening a link is not answering.

**3. A vendor could exhaust the customer's org-wide evidence budget.** The
existing 2 GiB cap is per-org and sufficient against an internal user, who only
harms their own organisation. It is not sufficient here: the portal lets a third
party consume a shared resource, so one vendor could stop the customer's own
staff attaching evidence anywhere in the product. Per-engagement byte *and* file
count budgets now bind first, and a test proves a saturated engagement blocks
neither the org nor another vendor.

**4. Three assertions were passing against an empty fixture.** The test file read
`seed.orgA.userId`, which does not exist on `SeededOrg` — it was `undefined`,
inserted NULL, and thereby *satisfied* the very attribution constraints it was
meant to violate. Real user rows are now seeded. Worth recording because the
failure mode is silent: the tests were green and proved nothing.

---

## 4. Design decisions worth re-reading before extending this

Everything in the prior revision still holds (invite exchanged for a session;
resolution on `pgElevated`; disjoint auth contexts; DB-backed rate limiting;
fingerprint drift flagged not blocked; flag off everywhere by default). New:

**The portal is metadata-only.** There is no download route and no signed URL on
this surface. The vendor already holds every file they sent, so a read channel
back into the org's evidence store buys them nothing — and if it ever
mis-scoped, the blast radius is the customer's entire evidence library rather
than one row. A test asserts the absence, including that no response body
carries a URL or a storage key.

**Withdrawal is a hard delete, and the audit event is the survivor.** A vendor
who attached the wrong client's report needs it gone, not flagged. The audit row
keeps filename, size and SHA-256, so deleting the file does not delete the fact
that it was sent. Row first, blob second: the reverse order can leave a record
pointing at nothing.

**Comment bodies are stored verbatim** — not escaped, not stripped. Escaping at
write time destroys the original text and double-escapes as soon as a second
renderer appears; the renderer is the correct boundary. It also matters for
ASK-B and the analysis worker: **this is a prompt-injection ingress point, and
the analysis layer must be able to see an injection attempt in order to be
evaluated against one.** Sanitising here would hide the attack from the defence.

**`visibility` defaults to `internal`.** A caller that forgets to set it
discloses nothing. The portal read filters in SQL rather than in the mapper, and
a CHECK makes a vendor-authored internal-only row unrepresentable — so a future
route that gets it wrong still cannot hide a vendor's own message from them.

**The comment window is wider than the write window.** Clarifications arrive
during review, after the questionnaire locks; a thread the vendor cannot reply to
is not a thread. It closes at `analysis_complete`, past which a message would
arrive with nobody obliged to read it.

---

## 5. Operator note

Unchanged: turning the flag off makes `requirePortalSession` unreachable but does
not revoke live sessions. To kill the boundary in anger, also run:

```sql
UPDATE vendor_portal_sessions SET revoked_at = NOW() WHERE revoked_at IS NULL;
```

New for this release: `20260925` alters the shared `evidence` table (three
nullable columns, a widened `source_type` CHECK, two new CHECKs). It is additive
and reversible, but it is not confined to portal tables — a rollback must drop
the constraints before the columns.
