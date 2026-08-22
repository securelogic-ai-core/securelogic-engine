# Vendor Assurance — production containment record

- **Executed:** 2026-08-22T00:21–00:24Z. **Operator-authorised containment.**
- **Scope of change:** exactly one environment variable on one service.
- **Not a determination that Vendor Assurance is unsuitable for launch.**

---

## 1. Decision

`SECURELOGIC_VENDOR_ASSURANCE_ENABLED` set from `true` → `false` on the
**production engine** (`srv-d5vmr37fte5s73cspe1g`), so the workflow is not
customer-reachable until its staging acceptance gate has passed.

## 2. Truthful state at the time of the decision

| Fact | Status | Evidence |
|---|---|---|
| Production object storage **configured** | **Yes** | All five R2 variables verified SET on the live service (presence checked; values never read or printed) |
| Production object storage **reachable** | **NOT PROVEN** | Nothing has exercised it. Only PR #827's `HeadBucket` readiness probe can establish this, and it is unmerged |
| **VA-3 acceptance gate passed** | **No** | Never executed to completion; blocked at extraction |
| Clean-SOC 2 extraction defect | **Applies to production** | `socExtractionValidator` waives the span requirement for `null` but not `[]`; fix is PR #855, unmerged |
| Finding provenance back to CUEC | **Absent** | `findings/[id]/page.tsx` renders only a `source_type` label; ADR-0010 Option 4 not built |
| Findings ever produced by the document path | **Zero, in any environment** | Standing fact since the capability shipped |

**Therefore:** a workflow that has not passed its own acceptance gate, whose
extraction path has a known defect, and whose output loses provenance, should
not remain reachable by customers. That is the whole of the reasoning.

> **Correction carried forward.** An earlier revision of the governing documents
> claimed production had **no** R2 and that customers were being told their files
> were corrupt. That was inferred from `render.yaml` declared state and was
> **wrong** — see the Corrections sections in the R-1 pack, the capability
> baseline and the Sept 15 scope ruling. This containment does **not** rest on
> that claim.

## 3. What was changed

| | |
|---|---|
| Service | `securelogic-engine` (production), `srv-d5vmr37fte5s73cspe1g` |
| Key | `SECURELOGIC_VENDOR_ASSURANCE_ENABLED` |
| Before | `'true'` |
| After | `'false'` |
| Method | Single-key `PUT /v1/services/{id}/env-vars/{key}` — **no other variable touched** |
| Env key count | **70 before, 70 after** |

**A redeploy was required and is not incidental.** The `PUT` alone changed
nothing: Render injects environment at **deploy**, not restart, so the running
process kept the old value and the route continued to answer `401`. A same-SHA
redeploy of `011e1f1d` was triggered to apply it.

| Deploy | `dep-da4en53ncjis73fc5o4g` |
|---|---|
| Commit | `011e1f1d` — **identical to the previously live deploy; no code change** |
| Started / finished | 2026-08-22T00:21:40Z → 00:23:27Z |
| Result | `live` |

## 4. Verification — after the change

**Production, contained:**

```
/api/vendor-assurance/documents                     404   (×3 consecutive probes)
/api/vendor-assurance/cuecs/<id>/review-status      404
```

**Production, unaffected — containment is correctly scoped:**

```
/api/findings   401      /api/risks   401      /api/vendors   401
/health         {"status":"ok","db":"connected"}
```

`404` rather than `403` is the designed posture: `vendorAssuranceFeatureFlag`
short-circuits before any handler so a probing caller cannot learn the surface
exists.

**Staging — untouched and still available for VA-3, as required:**

```
SECURELOGIC_VENDOR_ASSURANCE_ENABLED = 'true'
R2 configured                        = yes
/api/vendor-assurance/documents      = 401  (live behind auth)
```

**Customer-facing behaviour is graceful, not broken.** The app maps the engine's
`not_found` to a specific message —
*"Vendor-assurance is not available on this environment yet."*
(`VendorAssuranceUploadForm.tsx`) — rather than a generic failure. The
production app additionally renders the legacy navigation with no
vendor-assurance entry, so the surface was URL-reachable only.

## 5. Reversal

One `PUT` back to `"true"` plus a same-SHA redeploy. **No data was changed**, no
migration ran, no other configuration was altered. Nothing here is destructive
and nothing needs backing out beyond the flag itself.

## 6. Re-enablement criteria

Do **not** re-enable without operator authorisation. All of the following first:

1. **VA-3 passes** on staging, through the product UI, per
   `docs/validation/VA-3-RERUN-PLAN.md`.
2. **PR #855** (clean-SOC 2 extraction) merged and deployed.
3. **Storage reachability proven**, not merely configured — PR #827's
   `HeadBucket` readiness probe.
4. **Finding provenance** built (ADR-0010 Option 4), so a promoted finding can
   be traced back to the CUEC that justified it.

Per the Sept 15 scope ruling, Vendor Assurance is **conditional**, with a
decision point at the **2026-09-05** feature cutoff and a planned fallback to
three advertised workflows.

## 7. Release state — unchanged by this action

```
origin/develop  65cd3330   (frozen candidate, unchanged)
origin/main     011e1f1d   (unchanged, 94 commits behind develop)
#826            open, undisturbed
```

No merge, no promotion, no migration, no other production configuration change.
