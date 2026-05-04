# Manual Brief Generation

There are **two** routes that generate Intelligence Briefs by hand. They are not interchangeable — they have different auth, different scope, and different intended uses. Picking the wrong one is the most common reason a manual generation attempt fails.

## Which route do you want?

- Want to regenerate a brief for **one specific organization**? → **Route 1**.
- Want to manually run the **full scheduler** (same code path as the daily 8 AM UTC cron, every eligible org)? → **Route 2**.
- Want a daily/scheduled trigger? → Don't use either. Let the cron run. The cron lives in the intelligence-worker; see *Related* below.

---

## Route 1: Per-org generation

`POST /api/intelligence-briefs/generate`

Customer-tier endpoint. Generates a brief for the org that owns the API key in the request — the route does not accept an `organization_id` in the body, it derives it from auth.

**Auth:** `X-Api-Key: <org api key>` header.
Equivalent forms: lowercase `x-api-key:`, or `Authorization: Bearer <jwt>` (JWT bridge auto-loads the org's primary active API key).

**Tier requirement:** the org must hold the `standard` entitlement or higher. Starter-tier orgs are rejected by `requireEntitlement("standard")`.

**Body (optional):**
```json
{
  "period_start": "2026-04-27",
  "period_end":   "2026-05-04"
}
```
Both must be ISO 8601 strings; window must be ≤ 30 days. Default when omitted: last 7 days ending at "now".

**Working curl:**
```bash
curl -X POST https://securelogic-engine.onrender.com/api/intelligence-briefs/generate \
  -H "X-Api-Key: <ORG_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"period_start":"2026-04-27","period_end":"2026-05-04"}'
```
(Body is optional — drop the `-d` flag and the `Content-Type` header for the default last-7-days window.)

**Failure modes:**

| Status | Body                          | Meaning                                                |
|--------|-------------------------------|--------------------------------------------------------|
| 401    | `api_key_required`            | No auth header on the request                          |
| 401    | `invalid_token`               | JWT supplied but signature/expiry check failed         |
| 401    | `no_active_api_key`           | JWT valid but the org has no active API key on file    |
| 403    | (entitlement payload)         | Org is on starter tier; needs standard or higher       |
| 429    | `rate_limit_exceeded`         | More than 5 requests/min from this org                 |
| 400    | `invalid_period_*`            | `period_start`/`period_end` not valid ISO 8601         |
| 400    | `period_window_too_large`     | Window between start and end exceeds 30 days           |

**When to use:**
- Testing prompt or pipeline changes against one specific org's signal set.
- Customer-support scenario where a single org needs a regeneration without re-running the whole scheduler.

---

## Route 2: Full scheduler run

`POST /api/admin/briefs/run-scheduler`

Operator endpoint. Runs `runScheduler()` over **every** eligible org — same code path as the daily 8 AM UTC cron. There is no per-org variant of this route; it is all-or-nothing.

**Auth:** `Authorization: Bearer <SCHEDULER_SECRET>` only.
Independent of both `X-Api-Key` (the customer API key system) and `X-Admin-Key` (the admin panel system). Compared in constant time against `process.env.SCHEDULER_SECRET`.

**Body:** none.

**Working curl:**
```bash
curl -X POST https://securelogic-engine.onrender.com/api/admin/briefs/run-scheduler \
  -H "Authorization: Bearer <SCHEDULER_SECRET>"
```

**Failure modes:**

| Status | Body                          | Meaning                                                                      |
|--------|-------------------------------|------------------------------------------------------------------------------|
| 503    | `service_not_configured`      | `SCHEDULER_SECRET` env var is unset on the service. Deliberately **not** 401 — distinguishes misconfiguration from a bad token. |
| 401    | `unauthorized`                | Token missing or doesn't match                                               |
| 429    | `rate_limit_exceeded`         | More than 5 requests/min from this IP                                        |
| 500    | `internal_error`              | The scheduler run itself threw; check engine logs for `scheduler_manual_trigger_failed` |

**When to use:**
- Validating end-to-end pipeline changes without waiting until 8 AM UTC. This is the route to hit to answer "does the daily cron now produce what we expect?"
- Re-running after a known transient failure (e.g. an LLM provider outage during the cron window).

---

## Where SCHEDULER_SECRET lives

- **Required at boot in production** by `src/api/startup/validateEnv.ts:292` — minimum 32 chars, maximum 512 chars. Engine refuses to start without it when `NODE_ENV=production`.
- **Set in the Render dashboard** for both the `securelogic-engine` (prod) and `securelogic-engine-staging` services. Values differ between prod and staging; do not copy across.
- **Declared in `render.yaml` as `sync: false`** for both engine blocks. The YAML asserts the variable is required without committing the value. Previously dashboard-only and undeclared in YAML — corrected in the same change that introduced this doc.

To rotate: generate a new value (`openssl rand -hex 32` or similar, ≥ 32 chars), set it in the Render dashboard for the relevant service, restart the service. There is no rotation/grace-period mechanism — the new value takes effect on next request, the old one stops working immediately.

---

## Related

- **Daily 8 AM UTC cron:** `services/intelligence-worker/src/scheduler.js` (compiled entry point) drives the cadence; the actual brief generation logic lives in `src/api/lib/briefScheduler.ts` (the `runScheduler` function called by both the cron and Route 2).
- **Per-org generation handler:** `src/api/routes/intelligenceBriefs.ts:84`.
- **Scheduler trigger handler:** `src/api/routes/adminBriefs.ts:51`.
- **Three auth surfaces in this codebase** — `X-Api-Key` (customer/per-org), `X-Admin-Key` (admin panel via `SECURELOGIC_ADMIN_KEY`), and `Authorization: Bearer <SCHEDULER_SECRET>` (this route only). A broader audit and consolidated `docs/admin-operations.md` is deferred — see deferred-followups.
