# Sentry Setup — Operator Runbook

Sentry error tracking is wired into **two** SecureLogic services, each reporting
to its **own** Sentry project:

| Service              | SDK              | Sentry project    |
| -------------------- | ---------------- | ----------------- |
| Engine (Express)     | `@sentry/node`   | engine project    |
| App (Next.js)        | `@sentry/nextjs` | app project       |

The integration is **additive and inert-by-default**: with no DSN configured,
both services build, boot, and run exactly as before — Sentry is simply
disabled. No code change is required to turn it on; you only set environment
variables in Render.

> Workers (intelligence / posture / delivery) are intentionally **not**
> instrumented in this PR. Adding Sentry to the workers is a separate change.

---

## 1. Environment variables

DSN values come from each Sentry project's *Settings → Client Keys (DSN)*. **Do
not** commit DSNs to the repo — they are declared in `render.yaml` with
`sync: false` and their values are entered in the Render dashboard only.

### Engine — `securelogic-engine` (prod) and `securelogic-engine-staging`

| Variable            | Required? | Notes                                                                 |
| ------------------- | --------- | --------------------------------------------------------------------- |
| `SENTRY_DSN_ENGINE` | optional  | Engine project DSN. Unset ⇒ Sentry disabled (logged once at boot).    |
| `SENTRY_ENV`        | optional  | `production` on prod, `staging` on staging. Falls back to `NODE_ENV`. |

> Note: the engine sets `NODE_ENV=production` on **both** prod and staging (so
> prod-safety checks stay active), so set `SENTRY_ENV=staging` explicitly on the
> staging service to tell the two environments apart in Sentry.

The engine also tags releases automatically from Render's `RENDER_GIT_COMMIT`
(no action needed).

### App — `securelogic-app`

| Variable                     | Required? | Scope        | Notes                                                              |
| ---------------------------- | --------- | ------------ | ------------------------------------------------------------------ |
| `SENTRY_DSN_APP`             | optional  | server-only  | App project DSN for SSR / route handlers / edge. Never sent to the browser. |
| `NEXT_PUBLIC_SENTRY_DSN_APP` | optional  | **browser**  | App project DSN inlined into the client bundle **at build time**.   |
| `NEXT_PUBLIC_SENTRY_ENV`     | optional  | browser+srv  | Environment label. Falls back to `NODE_ENV`.                        |

`SENTRY_DSN_APP` and `NEXT_PUBLIC_SENTRY_DSN_APP` are typically the **same DSN
string** — the split exists only so the server can keep a non-public copy if you
ever want to use distinct keys. Because `NEXT_PUBLIC_*` vars are inlined at build
time, **a redeploy/rebuild is required** for a DSN change to reach the browser.

> `securelogic-app-staging` is **not** declared in `render.yaml` (known IaC gap —
> the service exists on Render but is not codified). If you want Sentry on the
> staging app, set the same three vars on it in the Render dashboard directly.

---

## 2. GitHub Actions secrets (source map upload — DEFERRED)

Source map upload is **not** enabled in this PR. When a follow-up PR wires it up,
you will need:

| Secret              | Where                | Purpose                                  |
| ------------------- | -------------------- | ---------------------------------------- |
| `SENTRY_AUTH_TOKEN` | Render + GH Actions  | Auth for release creation + sourcemap upload |
| `SENTRY_ORG`        | Render + GH Actions  | Sentry org slug                          |
| `SENTRY_PROJECT`    | Render + GH Actions  | Sentry project slug                      |

`next.config.mjs` already reads these via `withSentryConfig`. Until
`SENTRY_AUTH_TOKEN` is present the build **succeeds** and simply skips source map
upload (you will see a "No auth token provided" warning in the build log — this
is expected and harmless).

---

## 3. Browser CSP — resolved via tunnelRoute

**Resolved.** The browser SDK POSTs events to `/monitoring` (same-origin), which
Next.js proxies to Sentry. No CSP change is required — `/monitoring` is already
permitted by the existing `connect-src 'self'`. This is wired in
`app/next.config.mjs` via `tunnelRoute: "/monitoring"` in the `withSentryConfig`
options.

Trade-offs (accepted — worth it to avoid widening the CSP):

- Tunneled events count against the app's request budget on Render (negligible
  at soft-launch scale).
- You lose Sentry's per-host metrics granularity (events arrive via your origin
  rather than directly).

Server-side capture (SSR, route handlers, the engine) does not use the tunnel
and is unaffected.

---

## 4. Verifying Sentry is receiving events

1. Set the relevant DSN(s) in Render and trigger a redeploy.
2. **Engine:** confirm the boot log shows `sentry_initialized` (not
   `sentry_disabled`).
3. Trigger a test error:
   - Engine: any route that throws an unexpected error will be captured by the
     Express error handler; or temporarily add a throwing test route.
   - App: throw inside a server component / route handler (server capture), and
     for the browser, throw in a client component event handler (browser capture
     — tunneled through `/monitoring`, see §3).
4. Check the Sentry dashboard for each project: the event should appear within a
   minute, tagged with the `environment` and `release` you configured.
5. Confirm scrubbing: the captured event must **not** contain request bodies,
   `Authorization` / `Cookie` / `X-Api-Key` headers, or any field named
   `password`, `token`, `apiKey`, `sessionToken`, `mfaCode`, `refreshToken`
   (these are redacted to `[Filtered]` by the shared `beforeSend` scrubber).

---

## 5. Sampling and quota tuning

- **Errors:** all captured (no sampling).
- **Performance traces:** `tracesSampleRate: 0.1` (10%) on every runtime
  (engine, app client/server/edge). Conservative for soft-launch.

If you approach the Sentry free-tier quota:

- Lower `tracesSampleRate` (e.g. `0.05` or `0`) in `src/api/lib/sentry.ts`
  (engine) and `app/sentry.{client,server,edge}.config.ts` (app).
- Errors are usually the valuable signal; traces are the first thing to cut.
- Consider `sampleRate` (error sampling < 1.0) only as a last resort.

---

## 6. Known follow-ups (not in this PR)

- **Source map upload** via `SENTRY_AUTH_TOKEN` (de-minified stack traces).
- **`global-error.js`** in the app to capture React render errors in the App
  Router (Sentry logs a build-time recommendation about this).
- **`instrumentation-client.ts`**: `@sentry/nextjs` now prefers this over
  `sentry.client.config.ts` (required only if the app migrates to Turbopack
  builds; the current webpack `next build` still supports the config file).
- **Worker instrumentation** (intelligence / posture / delivery).
