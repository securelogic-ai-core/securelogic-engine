# SR-005 — Document or evidence upload fails

| | |
|---|---|
| **Playbook ID** | SR-005 |
| **Domain** | Documents / Evidence |
| **Severity default** | SEV2 (blocks audit evidence collection) |
| **Owning level** | L1 triage → L2 → Engineering |
| **Release dependency** | Live in production today |
| **Feature flag** | None |
| **Last validated** | 2026-08-21 against `develop@58cccb2c` |
| **Status** | Diagnosis VALIDATED. **No recovery procedure — SUP-PROC-1.** |

## Customer-visible symptoms

Upload fails or stalls; evidence will not open or download; an error banner on the
evidence panel.

## What the error codes mean

| Code | Meaning | Who fixes it |
|---|---|---|
| `file_too_large` | Over the size limit | Customer — split or compress |
| `unsupported_file_type` | Type not accepted | Customer |
| `no_file_uploaded` | Nothing attached / browser dropped it | Customer — retry |
| `org_storage_quota_exceeded` | Organization storage quota reached | **Commercial decision — escalate** |
| `storage_unavailable` | Object storage not reachable | **Platform — SEV2, escalate now** |
| `blob_put_failed` | Write to storage failed | Platform — escalate |
| `signed_url_failed` | Could not mint a download URL | Platform — escalate |
| `evidence_has_no_file` | Record exists, no file attached | Escalate — possible partial write |
| `source_record_not_found` | The finding/control it attaches to is gone or not theirs | Escalate |

## Safe diagnostic steps

1. **Get the exact error code or banner text.** The table resolves most of it in
   one step. *(L1 OBSERVABLE.)*
2. **File size and type.** *(L1 OBSERVABLE.)*
3. **One file or all files?** All files → suspect storage → **SR-008**.
   *(L1 OBSERVABLE.)*
4. **One user or the whole org?** *(L1 OBSERVABLE.)*
5. Storage backend health is *(L2/ENGINEERING ONLY.)*

## Evidence to collect

Error code, file size and type (**not the file**), timestamp with timezone,
organization slug, whether it affects all uploads, browser.

## Approved L1 actions

Retry guidance; size/type correction; confirm scope. Nothing privileged.

## Actions L1 must NOT perform

- ask the customer to email the document instead — evidence sent through a support
  inbox leaves the tenant boundary and lands somewhere with different retention
  and access rules. **This is the tempting one; do not do it.**
- create the evidence record manually
- retry writes to storage

## Escalate when

`storage_unavailable`, `blob_put_failed`, `signed_url_failed`, or
`evidence_has_no_file` — any of these are platform-side. Multiple orgs affected →
SEV1, **SR-008**.

## Recovery

**None validated (SUP-PROC-1).** Storage recovery is Engineering.

## Recovery verification

The customer uploads successfully **and** re-opens the file — a successful write
that cannot be read back is not a recovery.

## Customer communication

> "Thanks — that error tells me where it's failing. While we look, please don't
> email the document across; we'd rather keep your evidence inside your account
> where the access controls and retention apply."

## Observability

| Signal | Where | Level |
|---|---|---|
| Error code on screen | Customer | **L1** |
| Storage errors | Engine logs | L2 |
| Quota usage for an org | — | **NOT OBSERVABLE to support** |

**Missing:** support cannot see an organization's storage quota usage, so
`org_storage_quota_exceeded` cannot be confirmed or quantified without Engineering
(**SUP-OBS-11**).

## Related

SR-008 · `src/api/routes/evidence*.ts`
