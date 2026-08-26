# Dependency-audit remediation & triage — 2026-08-17

Package: the approved dependency-remediation + CI audit-signal item (follows
M-1 in the 2026-08-17 hardening sequence, which judges dependency work by
**reachability/exploitability, never advisory counts**). Branch-held during
the M-1 staging soak.

## Before → after

| Scope | Before | After |
|---|---|---|
| Production deps (`npm audit --omit=dev`) | **4 high** | **0** |
| All deps | **7 high** | **0** |

The `audit` CI job had been red on every PR for weeks; eight PRs merged in the
2026-08-17 session alone under an "inherited audit red" exception — an
institutionalized alarm-fatigue failure this package also repairs (see the
gate section).

## Exact dependency changes (lockfile + one override; `package.json` ranges otherwise untouched)

| Package | Before | After | Semver | How |
|---|---|---|---|---|
| `undici` (direct) | 7.28.0 | 7.29.0 | minor | `npm audit fix` |
| `ip-address` (via express-rate-limit) | 10.2.0 | 10.5.0 | minor | `npm audit fix` |
| `fast-uri` (via ajv, overridden) | 3.1.2 | **3.1.5** | patch | override tightened `">=3.1.2"` → `">=3.1.5 <4"` |
| `brace-expansion` (via archiver→glob→minimatch) | 2.1.2 / 5.0.7 | 2.1.4 / 5.0.9 | patch | `npm audit fix` |
| (dev-only chains) | 3 high | 0 | minor/patch | `npm audit fix` |

**Major-jump boundary honored:** npm's default resolution moved `fast-uri` to
4.1.2 — a transitive MAJOR beyond ajv's declared `^3.0.1` (permitted by a
pre-existing repo override `">=3.1.2"`). Rather than accept it, the override
was tightened to the patched 3.x line (`3.1.5`), staying inside ajv's declared
major. No major-version jump ships anywhere in this change.

## Per-advisory triage (production dependencies)

### undici — 5 advisories (high)
- **Chain:** DIRECT dependency `undici@7.28.0`.
- **Reachable surfaces:** `src/api/lib/webhookDispatcher.ts` (outbound HTTP to
  **customer-controlled webhook URLs** — the highest-exposure outbound path),
  `src/api/lib/webhookUrlSafety.ts` (**the SSRF guard's own Agent**),
  `src/api/lib/connectorHttpClient.ts` (third-party connector syncs).
- **Exploitability judgment:** REACHABLE. A hostile webhook endpoint controls
  the responses these clients parse; the advisories include response
  desynchronization via the retry interceptor, cross-user information
  disclosure via cache directives, CRLF injection via body `type`, and cookie
  attribute injection. Multi-tenant dispatcher = the cross-user-disclosure
  class matters here specifically.
- **Disposition:** REMEDIATED → 7.29.0 (fixed line). Residual: none known.

### ip-address — 3 advisories (high)
- **Chain:** `express-rate-limit@8.5.x → ip-address@10.2.0`.
- **Reachable surfaces:** every rate-limited endpoint — including the
  **login, signup and forgot-password limiters** (customerAuth) and the admin
  rate limit. The advisories are IP parse/classification mismatches
  (leading-zero octets, CIDR-suffix suppression, IPv4-mapped confusion)
  enabling trust-boundary/SSRF-adjacent bypasses — i.e., exactly the class
  that lets a caller manipulate how a limiter buckets them.
- **Exploitability judgment:** REACHABLE in principle; partially mitigated in
  practice because the enforcing admin controls key on
  `resolveThrottleIdentity` (Cloudflare-resolved), not raw parses — but the
  express-rate-limit internals still parse IPs for IPv6 bucketing.
- **Disposition:** REMEDIATED → 10.5.0 (fixed line). Residual: none known.

### fast-uri — 3 advisories (high)
- **Chain:** `ajv@8.18.0 → fast-uri` (repo override present).
- **Reachable surfaces:** ajv is used for contract/schema validation, not for
  HTTP-route body validation (routes are hand-validated). Host-confusion in
  URI parsing matters where `format: "uri"` validates untrusted values —
  limited surface today.
- **Exploitability judgment:** LOW reachability; remediated anyway since a
  patched in-major release exists.
- **Disposition:** REMEDIATED → 3.1.5 via the tightened override
  (`">=3.1.5 <4"`). Residual: none known. Note for the future: when ajv moves
  its own range to fast-uri 4.x, drop the override rather than fighting it.

### brace-expansion — 1 advisory family (high)
- **Chain:** `archiver@7 → archiver-utils → glob → minimatch → brace-expansion`
  (+ a second copy under glob@11).
- **Reachable surfaces:** `archiver` builds the **GDPR data-export ZIP
  bundles** (data-rights worker). The DoS requires attacker-controlled glob
  PATTERNS; the exporter globs with code-controlled patterns only.
- **Exploitability judgment:** LOW (no untrusted patterns reach minimatch).
  Remediated anyway (patch-level).
- **Disposition:** REMEDIATED → 2.1.4 / 5.0.9. Residual: none known.

### Dev-only advisories (3 high, not gating)
`brace-expansion`/`fast-uri`-class duplicates inside dev toolchains (vitest/
eslint/build chains). Not shipped; remediated by the same run; the CI gate
prints but never fails on dev-only advisories — the enforcement boundary is
what ships.

## Accepted vulnerabilities / waivers

**None.** `.audit-waivers.json` ships EMPTY. Every current advisory is
remediated; the waiver mechanism exists only for future operator-approved,
named, expiring exceptions.

## The CI gate (restored signal)

`.github/workflows/ci.yml` `audit` job now runs `scripts/ci/auditGate.mjs`:
FAILS on any unwaived high/critical **production**-dependency advisory;
waivers are per-GHSA, expiring, operator-approved; stale waivers are surfaced
for removal; dev-only advisories print as INFO. Proofs
(`src/api/__tests__/auditGate.test.ts`, 7 tests, + the live baseline run):

1. remediated baseline → gate PASS (live run, exit 0);
2. synthetic new high production advisory → FAIL;
3. approved waiver passes ONLY the named advisory, pre-expiry;
4. expired waiver → FAIL (and a waiver with no valid expiry never passes);
5. an unrelated advisory — even in the SAME package — cannot hide behind an
   existing waiver; stale waivers are flagged.

## Validation

- Full battery: typecheck, lint, unit, isolation — results recorded in the
  package report/commit.
- Targeted regression probes on every remediated reachable surface: webhook
  dispatch + URL-safety (SSRF guard), connector HTTP client, rate limiting,
  export/ZIP bundling — the existing dedicated suites for each, run
  explicitly, plus the data-export real-SQL isolation tests.
