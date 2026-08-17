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
| `DATABASE_SSL_SERVERNAME` | hostname to verify when the DSN uses Render's INTERNAL hostname (§1.3) |
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

### 1.3 The one unknown, and the staged rollout that resolves it

Whether each service's `DATABASE_URL` (dashboard-managed, value not readable
from this environment) uses the external or the INTERNAL hostname. The cert's
SANs cover only the public names, so an internal-hostname DSN fails hostname
verification with:

    Hostname/IP does not match certificate's altnames

Rollout (operator):

1. Merge to `develop` → staging auto-deploys. The engine boots
   `npm run migrate && npm start`, so a live staging engine IS the proof that
   verification connects. All five staging workers prove the same for their
   DSNs.
2. If a staging service fails with the altnames error above: set
   `DATABASE_SSL_SERVERNAME=<that DB's external hostname>` on that service
   (dashboard) and redeploy. External hostnames: `<dpg-id>.virginia-postgres.render.com`.
3. If it fails with an UNTRUSTED-chain error (not expected — §1.2): STOP,
   set `DATABASE_TLS_NO_VERIFY=true` on the failing service, report. Do not
   proceed to production.
4. Production promotion rides the next normal release train — never a
   standalone force-push. Same per-service checks; same knobs.

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
