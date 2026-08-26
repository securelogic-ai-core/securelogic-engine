# P0 hardening batch — 2026-08-17

Approved scope: the three P0 findings of the 2026-08-17 enterprise hardening
assessment, exactly as documented there. No adjacent P1/P2 work is included.
E-2 Increment 4 and Stage-2 activation are untouched and remain under their
existing gates.

| Finding | Code change | Operator-owed |
|---|---|---|
| P0-1 Postgres TLS verification | THIS BRANCH | staged rollout (§1.3) |
| P0-2 backup/restore + secrets recovery | none | everything (§2) |
| P0-3 admin control plane | none | telemetry → flip → rotate (§3) |

---

## 1. P0-1 — Postgres TLS verification (code complete)

### 1.1 What changed

Every pool previously used `ssl: { rejectUnauthorized: false }` — encrypted but
UNAUTHENTICATED, accepting any certificate an on-path party presents. The
2026-05 OWASP audit rated this its only Critical; it stayed open 15 months.

Now one pure, unit-tested decision (`src/api/infra/pgSsl.ts`) is shared by the
app pools (`infra/postgres.ts`, both `pg` and `pgElevated`) and all seven
standalone script pools. **Verification is the default.** Knobs:

| Env | Purpose |
|---|---|
| `DATABASE_SSL_DISABLED` | pre-existing: non-TLS harness Postgres only |
| `DATABASE_SSL_SERVERNAME` | override the hostname checked against the cert's SANs. **Cannot fix Render internal-hostname DSNs** — those fail on an untrusted self-signed chain, not on hostname mismatch (§1.3); the knob remains for genuine SNI/SAN-mismatch cases only |
| `DATABASE_SSL_CA` | extra trust anchor; unused today |
| `DATABASE_TLS_NO_VERIFY="true"` | **incident rollback hatch** — exact legacy behaviour; engine logs error-level every boot while set (selfTest) |

Side effect worth recording: `scripts/runMigrations.ts` can now run against a
local non-TLS Postgres with `DATABASE_SSL_DISABLED=true` — the hardcoded SSL
that blocked the local harness (migrate-from-scratch defect note) is gone.

### 1.2 Evidence that default-verify connects to Render

Probed credential-free 2026-08-17 with `openssl s_client -starttls postgres`
against all three database hostnames (`dpg-….virginia-postgres.render.com`):

- issuer `C=US, O=Let's Encrypt, CN=YR2` — publicly trusted, system roots suffice
- SANs include `*.virginia-postgres.render.com` (and the aws-us-east-1 names)
- `-verify_return_error -verify_hostname <dpg-host>` → **Verify return code: 0 (ok)**

So for an EXTERNAL-hostname DSN, `rejectUnauthorized: true` works with zero
additional configuration.

### 1.3 The one unknown — RESOLVED on staging 2026-08-17 (see §1.5 for proof)

The unknown was whether each service's `DATABASE_URL` (dashboard-managed,
value not readable from this environment) used the external or the INTERNAL
hostname. Staging answered it: `securelogic-engine-staging`,
`securelogic-vendor-extraction-worker-staging`, and
`securelogic-data-rights-worker-staging` were on internal hostnames and failed;
the other three staging services connected under verify-default with no
changes.

**CORRECTION — the predicted failure mode was wrong.** This section originally
predicted internal-hostname DSNs would fail hostname verification
(`Hostname/IP does not match certificate's altnames`), fixable by
`DATABASE_SSL_SERVERNAME`. Observed reality (staging, 2026-08-17): Render's
internal connections do not present the Let's Encrypt certificate at all —
they present a **self-signed certificate**, failing with:

    Error: self-signed certificate  (code: DEPTH_ZERO_SELF_SIGNED_CERT)

`DATABASE_SSL_SERVERNAME` can never fix that (it only overrides the hostname
check; the chain itself is untrusted). The §1.2 openssl evidence holds for
EXTERNAL hostnames only.

**The remedy, proven on staging: repoint `DATABASE_URL` to the database's
External Database URL** (`<dpg-id>.virginia-postgres.render.com`, from the
Render dashboard) on the failing service, then redeploy — Render injects env
at DEPLOY, not restart. Do NOT use `DATABASE_TLS_NO_VERIFY` for this case;
the hatch is for genuine incidents only.

Failure signatures per service type — deploy status alone is NOT a pass:

- **Engine** (fails safe): `npm run migrate` dies → `update_failed`, prior
  build stays live. A live engine deploy IS proof (migrate + boot self-test +
  `/health` `db:connected` all traverse the pool).
- **Workers** (fail LIVE-but-broken): the deploy reports `live` while every
  poll tick errors (`*_worker_tick_error` with the code above, every 15s).
  Only runtime logs show it. A healthy worker tick is silent, so the pass
  signal is the absence of tick errors from the CURRENT instance — check
  instance labels; the outgoing instance keeps erroring until SIGTERM.

Production promotion (rides the next normal release train — never a
standalone force-push):

1. **BEFORE the release reaches `main`**: check each prod service's
   `DATABASE_URL` hostname form in the dashboard; repoint any
   internal-hostname value to the External Database URL. Prod workers hit the
   same live-but-broken trap otherwise.
2. After promotion: verify engine deploy live + `/health`, then read each
   worker's runtime logs for tick errors — not `render deploys list`.

Rollback at any point: `DATABASE_TLS_NO_VERIFY=true` on the affected service —
an env flip, no code revert, no migration. Remember Render injects env at
DEPLOY, not restart: flip, then redeploy the same SHA.

### 1.4 Validation executed on this branch

- `pgSsl.test.ts`: 9/9 — verify-by-default, both escapes, precedence,
  servername/ca passthrough, boot-alarm trigger.
- Full typecheck clean; lint clean.
- `migrationFilenameOrder.test.ts` (real Postgres, runs the actual migration
  runner): 5/5 with the new resolution against the non-TLS harness.
- Production behaviour without env changes = verified TLS. The only
  environments whose behaviour changes are ones that actually negotiate TLS.

### 1.5 Staging closing proof — 2026-08-17 ≈14:05 UTC: PASSED

All six staging services live on `develop` @ `782df747` (#799 verify-default +
#800 script-import fix), verified via `render deploys list`, live probes, and
runtime logs:

- **engine**: two `update_failed` auto-deploys while `DATABASE_URL` was
  internal (12:44, 13:03 — prior build stayed live, as designed); after the
  operator repointed to the External Database URL, the manual deploy went
  live 13:57:47 with `Migrations complete` (13:57:36), `Boot self-test
  passed`, `/health` → `{"status":"ok","db":"connected"}`.
- **vendor-extraction-worker**: pre-repoint instance errored on EVERY
  15-second tick with `DEPTH_ZERO_SELF_SIGNED_CERT` until SIGTERM at
  14:01:17; post-repoint instance (started 14:00:22) logged zero errors
  across ~20 DB-touching ticks (`claimNextJob` queries per tick, and this
  code path is proven loud — same build, same cadence, only the DSN differs).
- **data-rights-worker**: post-repoint instance clean; its tick also queries
  the DB every 15s through the shared `resolvePgSsl`-configured pool, so
  silence is meaningful.
- **intelligence-worker, posture-worker, app**: live on the same commit since
  ~13:03 with zero certificate errors — their DSNs already verified.
- **No service is on the hatch**: zero `pg_tls_verification_disabled`
  boot-alarm events across all six services.

Remaining for full P0-1 closure: the production rollout in §1.3 (hostname
check BEFORE the release train, worker-log verification after).

---

## 2. P0-2 — backup/restore + secrets recovery (all operator-owed)

Nothing here is executable from this environment; `docs/DR_PLAN.md` already
contains the procedures. The batch adds the missing working material:

1. **Verify the §3 boxes against the live dashboard**: prod Postgres backup
   schedule/retention/PITR, staging backup existence, `main` branch protection.
2. **Execute the §6 restore test once, now** — staging DB → scratch instance →
   §5 checklist. It is the plan's own pre-beta gate and is cheapest while the
   prod dataset is 1 org / 1 user.
3. **Sealed secrets export**: the generated per-service checklist
   (`secrets-inventory.md`, produced from render.yaml this session) covers
   **153 `sync: false` instances / 52 distinct keys** plus the database
   credentials. Export to the org password manager, dated, and record the date
   in DR_PLAN §3.
4. Decide the R2 second-provider question (§3) — a decision, not a task.

Completion evidence for this finding = the four DR_PLAN boxes checked with
dates, and §6's test log filled in.

---

## 3. P0-3 — admin control plane (operator-owed; evidence gathered)

### 3.1 What the code provides today (verified)

`adminChain` = network → lockout → timing-safe key (with rotation support:
comma-separated `SECURELOGIC_ADMIN_KEY` accepts up to 10 keys, so rotation is
add-new → migrate → remove-old, zero downtime) → rate limit → audit.
`requireAdminNetwork` resolves the caller via `CF-Connecting-IP` (not the
rotating Cloudflare edge address) and emits `admin_network_evaluated`
telemetry on EVERY admin request in both modes. Dark mode passes everything
and logs `WOULD BLOCK` at warn when the allowlist would have refused.

### 3.2 Live finding — the prod flip is currently BLOCKED (stop condition)

Production logs since 2026-08-10 contain **zero** `admin_network_evaluated`
events and no meaningful `/admin` traffic: there have been no admin requests
to validate the allowlist against. Additionally, ALLOWED requests log at
debug (invisible at prod log level) — so the validation discriminator is:

> operator performs a known admin request; if it authenticates AND no
> `WOULD BLOCK` warn appears for it, the resolved IP matched the allowlist.

### 3.3 Flip sequence (operator)

1. **Staging first.** Make one authenticated admin request against staging.
   Confirm no `WOULD BLOCK` warn. Set
   `SECURELOGIC_ADMIN_NETWORK_ENFORCED="true"` (staging), redeploy, repeat the
   request — expect success from the allowlisted address and 401 from any
   other (e.g. mobile hotspot).
2. **Correct the prod allowlist first if needed** —
   `SECURELOGIC_ADMIN_ALLOWED_IPS` holds two addresses that predate the
   CF-Connecting-IP fix and have never been compared against a correctly
   resolved caller.
3. **Prod**: one known admin request in dark mode → check for `WOULD BLOCK` →
   flip → redeploy → verify success-from-allowlisted + refusal-from-elsewhere.
4. **Rotate `SECURELOGIC_ADMIN_KEY`** using the comma-list mechanism, in the
   same window: the key has outlived several credential rotations.
5. Rollback at any point: unset the ENFORCED flag, redeploy. The allowlist
   misconfigured state fails closed with `500 server_misconfigured`, which is
   loud, not silent.

Completion evidence = staging + prod enforcement verified from both sides of
the allowlist, key rotated, dates recorded here.
