# SR-023 — Vulnerability imported but not attached to any asset

| | |
|---|---|
| **Playbook ID** | SR-023 |
| **Domain** | Vulnerability / Asset |
| **Severity default** | SEV3 |
| **Owning level** | L1 triage → L2 |
| **Release dependency** | Requires the `develop` → `main` promotion. Unflagged. |
| **Feature flag** | None |
| **Last validated** | 2026-08-21 against `develop@58cccb2c` |
| **Status** | Diagnosis VALIDATED. **No recovery procedure — SUP-PROC-1.** |

## Customer-visible symptoms

- Import result says the row was created but the asset was **not found** or
  **ambiguous**
- The vulnerability shows **"No asset recorded"**
- Affected-assets count is lower than the number of hosts in the file

## Impact

The vulnerability is recorded correctly — it simply is not linked to a host, so it
will not appear in per-asset exposure views. **A vulnerability with no asset is a
valid, permanently supported record**, not a broken one.

## Likely causes — in order

1. **The asset is not in SecureLogic.** By far the most common. Resolution only
   matches assets the organization already has; **nothing creates an asset during
   import**, deliberately, because inventing a placeholder host would put fiction in
   the inventory that every later report would treat as real.
2. **Only an IP was supplied.** An IP is a lease, not a name — it never resolves on
   its own, because resolving on it would silently move a vulnerability between
   hosts as leases change.
3. **Ambiguous** — two assets carry the same identifier (two `web01`s in two
   domains is ordinary). The platform **refuses to guess**: an occurrence on the
   wrong host is worse than none, because it reports exposure someone will act on.
4. **A scanner's own asset id was used** and that scanner has never been registered
   as a source — those ids are only meaningful within the scanner that issued them.

## Safe diagnostic steps

1. **Which asset columns were mapped?** Hostname, FQDN, cloud resource id and
   internal asset id can resolve; **IP and MAC cannot, alone.** *(L1 OBSERVABLE.)*
2. **Read the per-row asset outcome**: `not_found` vs `ambiguous` — different
   causes, different answers. *(L1 OBSERVABLE.)*
3. **Ask whether the host exists in SecureLogic's asset registry.** The customer
   can check their own assets. *(L1 OBSERVABLE.)*
4. For `ambiguous`, ask whether they have two assets with that name.
   *(L1 OBSERVABLE.)*
5. Confirming which asset_identifier rows exist for the org is
   *(L2/ENGINEERING ONLY)* — there is no support-facing view of them.

## Evidence to collect

Column mapping, the per-row asset outcome and its reason text, one example
identifier value **(hostname is fine; do not collect IPs or internal
hostnames beyond what the customer volunteers)**, organization slug, timestamp.

## Approved L1 actions

- explain that the asset must exist in SecureLogic first
- guide the customer to map a stronger identifier (FQDN, cloud resource id or
  internal asset id) rather than a hostname or IP
- guide them to attach the vulnerability to an asset manually from the finding

## Actions L1 must NOT perform

- **create an asset** to make the import attach — this is the single most tempting
  and most damaging action in this runbook. A placeholder asset is indistinguishable
  from a real one afterwards and corrupts every exposure count that follows.
- pick one of the ambiguous assets on the customer's behalf
- insert asset identifier rows
- advise "just use the IP" — it will never resolve

## Escalate when

The asset demonstrably exists with a matching identifier and still does not
resolve; resolution returns an asset in a **different organization** → **SR-009,
SEV1**.

## Recovery

**None validated (SUP-PROC-1).** The supported paths are customer-side: register
the asset, map a stronger identifier, or attach manually.

## Recovery verification

The finding's affected-assets panel shows the asset, and the rollup count
increments.

## Customer communication

> "The vulnerability imported fine — it just isn't linked to a host yet. We only
> attach to assets already in SecureLogic, and we never create one from a scan file,
> because a made-up host would show up in your exposure reports as though it were
> real. If the host is already there, mapping its FQDN or asset ID instead of the
> hostname or IP will usually connect it."

For ambiguity:

> "Two of your assets share that name, so we've deliberately not guessed which one
> is affected — attaching it to the wrong host would be worse than leaving it
> unattached. You can attach it directly on the finding."

## Observability

| Signal | Where | Level |
|---|---|---|
| Per-row asset outcome + reason | Import result | **L1** |
| "No asset recorded" state | Finding detail | **L1** |
| `asset_identifiers` contents | Database | **NOT OBSERVABLE to support** |
| Resolution outcome for an ad-hoc identifier | `POST /api/assets/resolve-identifiers` | L2 (authenticated) |

**Missing:** support cannot answer "what identifiers does SecureLogic hold for this
asset?" without Engineering. That is the most common follow-up question in this
runbook (**SUP-OBS-8**).

## Related

SR-020, SR-024 · `src/api/lib/assetIdentity.ts` (precedence and refusal rules) ·
migration `20261033`
