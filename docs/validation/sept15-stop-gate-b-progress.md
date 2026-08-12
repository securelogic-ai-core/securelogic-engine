# Stop Gate B — External Trust Boundary · Progress

Program: September 15 design-partner launch, Workstream 1 Phase 3
Date: 2026-08-12

---

## Verdict

**NOT PASSED.** The credential boundary is built and adversarially tested; the
questionnaire, evidence and comment routes are not built, and two criteria
require a human.

This document exists so the partial state cannot be mistaken for a pass.

---

## Criteria

| # | Criterion | Result |
|---|---|---|
| B.1 | Full adversarial suite — all nine classes | **PARTIAL** — 5 of 9 classes covered |
| B.2 | Static invariant: no portal route reads a caller-supplied identifier | **PASS** (by construction; see §3) |
| B.3 | Independent security review of the portal surface | **NOT SATISFIABLE HERE** |
| B.4 | A real external tester completes an engagement on staging | **NOT SATISFIABLE HERE** |
| B.5 | Rate limiting holds with Redis stopped | **PASS** — DB-backed by design |
| B.6 | Kill switch 404s every route and invalidates live sessions | **PASS** |
| B.7 | Every portal action in `audit_log` with its invite and engagement | **PARTIAL** — covered for the routes that exist |

---

## 1. What is built

| Component | State |
|---|---|
| `vendor_engagement_invites` + `vendor_portal_sessions` (migration `20260923`) | Built, RLS enabled |
| `portalTokens.ts` — minting, hashing, validity, cookie policy | Built, 24 tests |
| `requirePortalSession` — the external principal resolver | Built, 23 tests |
| `vendorPortalFeatureFlag` — the kill switch | Built |
| `POST /vendor-portal/session` — invite → cookie exchange | Built |
| `DELETE /vendor-portal/session` — sign out | Built |
| `GET /vendor-portal/engagement` — orientation read | Built |

**Not built:** the questionnaire routes (`GET/PUT /questions`), evidence upload
and listing, comments, and `POST /submit`. Four of the eleven planned routes
exist.

---

## 2. Adversarial coverage — 5 of 9 classes

| Class | State |
|---|---|
| Token abuse — expired, revoked, malformed, forged, replay after revocation | **Covered** |
| Cross-tenant — session reaches exactly one engagement | **Covered** |
| Parameter injection — `engagement_id` / `organization_id` as arguments | **Covered** |
| Kill switch — off 404s, off is the default, on restores | **Covered** |
| Cross-surface leakage — both directions | **Covered** |
| IDOR sweep across every object type | **Blocked** — needs the questionnaire/evidence/comment routes |
| Upload abuse — oversize, MIME mismatch, traversal, zip bomb, quota race | **Blocked** — needs the upload route |
| State machine — portal attempts transitions it may not cause | **Blocked** — needs `POST /submit` |
| Post-submit writes return 409 | **Blocked** — needs the write routes |

The four blocked classes are blocked on routes that do not exist, not on
difficulty. They land with those routes.

---

## 3. Why B.2 is structural rather than tested-by-sampling

No portal handler reads an identifier from the request. `req.portalContext`
carries `organizationId`, `engagementId`, `inviteId` and `sessionId`, all resolved
by `requirePortalSession` from the session ROW.

A caller therefore cannot *express* the attack. The adversarial suite confirms it
behaviourally — supplying `engagement_id`, `engagementId` and `organization_id`
as query parameters changes nothing — but the property holds because there is no
code path that would read them.

When the remaining routes land, the planned static test (grep the router source
for those keys) becomes worth adding, because by then there will be more handlers
than a reader can hold in their head.

---

## 4. Design decisions worth re-reading before extending this

**The invite is exchanged for a session.** The existing `/accept-invite`
precedent puts the token in the URL, which is fine for a one-shot internal
invite. A vendor engagement lives for weeks, so a URL-borne token would persist
that whole time in browser history, in `Referer` headers to any third-party
asset, and in every access log between the vendor and us.

**Resolution runs on `pgElevated`.** It necessarily precedes org context — the
lookup is what establishes the org — so the tenant channel would return zero rows
post-flip. Same shape as the tokenized data-export download route.

**`portalContext` and `organizationContext` are structurally disjoint.** Neither
middleware populates the other's field, so a portal request cannot reach an
authenticated route and an API key cannot drive a portal route. The resolver also
strips a pre-existing `organizationContext` rather than letting it ride along.

**Rate limiting is DB-backed.** `apiRateLimiter.ts` fails open when Redis is
unavailable — defensible for authenticated API keys, unacceptable on a public
endpoint where a blip would remove the only limit. The counter lives on the
session row.

**Fingerprint drift is flagged, never blocked.** Vendors legitimately switch
networks and devices mid-questionnaire; blocking would lock out honest users
while barely inconveniencing someone who already holds the cookie.

**The flag defaults OFF everywhere**, including non-production — unlike
`vendorAssuranceFeatureFlag`, which opens off-production for developer
convenience. An external write path must never be open by accident on a preview
environment.

---

## 5. Operator note

Turning the flag off does **not** by itself revoke live sessions; it makes
`requirePortalSession` unreachable. To kill the boundary in anger, also run:

```sql
UPDATE vendor_portal_sessions SET revoked_at = NOW() WHERE revoked_at IS NULL;
```

The partial index `idx_vendor_portal_sessions_live` exists for exactly this.
