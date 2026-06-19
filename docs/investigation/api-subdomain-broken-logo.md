# api.securelogicai.com — broken logo references

Discovered 2026-06-12 after PR #2b prod deploy verification.

**Update 2026-06-19:** all 6 broken logo references are now FIXED via PR #221 —
repointed to `https://app.securelogicai.com/branding/securelogic-ai-logo.png`
(verified HTTP 200). The underlying DNS misconfiguration of `api.securelogicai.com`
is **still open** (see Root cause / Proper fix below); #221 routed around it, it did
not fix the DNS.

## Status
- **Logo references: RESOLVED** (PR #221, on develop `ba2a86dd`). No code path still
  points at the broken `api.securelogicai.com/assets/logo.png`.
- **DNS root cause: STILL OPEN.** `api.securelogicai.com` returns Cloudflare 1000/403
  — "DNS points to prohibited IP" (apex A-record / prohibited-IP misconfig). The
  `api.` hostname remains broken at the edge. **Tracked in #224.**
- Engine `/version` is fine via `securelogic-engine.onrender.com` — only the `api.`
  hostname is misconfigured.

## Affected references (all RESOLVED via PR #221)
All 6 repointed from `https://api.securelogicai.com/assets/logo.png` to
`https://app.securelogicai.com/branding/securelogic-ai-logo.png`:
- ✅ `app/src/components/AuthCard.tsx` — auth/login/signup pages
- ✅ `src/api/routes/customerAuth.ts:159,194,233` — verification / password-reset / lockout emails
- ✅ `src/api/lib/briefEmailRenderer.ts:242,587` — brief email masthead + footer

No customer-facing surface still renders the broken logo.

## Root cause — STILL OPEN
**Tracking issue: #224** — https://github.com/securelogic-ai-core/securelogic-engine/issues/224

PR #221 took option 2 below for the logo (repointed the references to the live
`app.securelogicai.com` asset), which unblocks the customer-facing breakage. But the
actual `api.securelogicai.com` DNS misconfiguration is unresolved. Remaining work:

1. **Fix Cloudflare DNS for `api.securelogicai.com`** (proper Render custom-domain
   setup) so the hostname stops returning 1000/403 — this is the real fix if anything
   else still depends on `api.`, OR
2. ~~Migrate all asset references to an on-brand stable URL~~ — done for the logo (now
   on `app.securelogicai.com/branding/`); consider a dedicated `assets.`/`cdn.` host if
   more shared assets appear.

Don't hardcode `securelogic-engine.onrender.com` — that ties customer emails to
Render's infrastructure hostname, which is brittle.

## Related backlog item (open)
"Investigate Cloudflare audit log for apex A record deletion (forensic)" — this 1000
error may be related to whatever DNS event caused that.
