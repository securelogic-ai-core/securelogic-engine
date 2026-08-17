# Held hardening branches — merge notes (M-1 soak window)

Four branches are complete, validated, pushed, and HELD UNMERGED while the
M-1 staging soak runs (merging to develop would redeploy the five-service
staging configuration). Merge sequencing happens at soak exit, operator-gated.

| Branch | SHA | Package |
|---|---|---|
| `fix/auth-anomaly-client-identity` | `279a0ea7` | Tier-2 detector inputs record the resolved client |
| `fix/dependency-audit-remediation` | `670671b7` | high-advisory remediation + CI audit gate |
| `fix/rate-limit-client-identity` | `18dbc889` | enforcing limiters key on the resolved client |
| `fix/token-digest-at-rest` | (this branch) | reset/verify/invite tokens digested at rest |

## Known cross-branch conflicts (all trivial, resolutions recorded)

**`src/api/routes/customerAuth.ts`** is touched by three branches in
different regions:

- `279a0ea7` converts audit-write `ipAddress:` args to `resolveClientIp(req).ip`
  and adds `import { resolveClientIp } from "../infra/clientIp.js";`.
- `18dbc889` adds `keyGenerator: rateLimitKeyGenerator,` to the four limiter
  configs and adds `import { rateLimitKeyGenerator } from "../infra/clientIp.js";`.
- `fix/token-digest-at-rest` digests token storage/lookup sites and adds
  `import { digestToken, isPresentableToken } from "../lib/tokenDigest.js";`.

Resolution regardless of merge order: **keep every named import** (they can
merge into one clientIp import line:
`import { resolveClientIp, rateLimitKeyGenerator } from "../infra/clientIp.js";`)
and keep all three change regions — none overlap on the same statements.

**`src/api/routes/teamInvites.ts`** is touched by two branches:
`18dbc889` (limiter keyGenerators + clientIp import) and this branch (token
digesting + tokenDigest import). Same shape: keep both imports, both regions.

**`src/api/infra/clientIp.ts`** is touched only by `18dbc889` (adds
`rateLimitKeyGenerator`). No conflict with the others.

**Suggested merge order at soak exit** (minimizes conflict handling):
1. `670671b7` (dependency/CI — no source-route overlap with the others)
2. `279a0ea7` (Tier-2 telemetry)
3. `18dbc889` (rate-limit keying — resolve the one customerAuth import line)
4. `fix/token-digest-at-rest` (token digests — resolve the same import line)

Each merge should re-run its branch's proof suite post-merge; all four ride
the normal PR/CI path with the restored audit gate.
