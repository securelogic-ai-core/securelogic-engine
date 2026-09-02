# GitHub automation path — repository misidentification, and an unresolved PAT write status

**Date:** 2026-09-02
**Outcome:** PR #984 merged through the normal GitHub path. `develop` = `b6d4d7ad`.
**Status of the automation path:** **UNKNOWN — requires separate verification.**
**Release impact:** none. Manual merge through the GitHub UI is proven and sufficient.

---

## 1. Primary root cause: repository misidentification

The detour was **not** caused by a credential fault. It was caused by calling the
GitHub API against the wrong repository.

```
actual remote (git remote -v, $GITHUB_REPOSITORY)
    securelogic-ai-core/securelogic-engine     <- org-owned, the real repository

called instead, for the first several rounds
    SecureLogic-AI/securelogic-engine          <- a DIFFERENT repository that exists,
                                                  user-owned, stale since 2025-12-30
```

`SecureLogic-AI` is the **git author name** and the PAT owner. It is **not** the
repository owner. The API path was derived from that author metadata instead of
from the remote, and because a real repository happens to exist at that path,
every call returned plausible-looking results instead of an obvious error.

**Lesson, permanent:** never derive GitHub API owner/repo identity from git author
metadata, the org name, or any label. Resolve it from `git remote -v` or
`$GITHUB_REPOSITORY` **before the first API call**, and re-check it the moment an
API answer contradicts local git state.

## 2. Observations from the WRONG repository — NOT evidence about anything

Everything below described `SecureLogic-AI/securelogic-engine`. **None of it may be
cited as evidence about the real repository, its PRs, or any credential's
permissions on it.**

| Observation | Why it is void |
|---|---|
| `0 open PRs` | wrong repo; the real one had **39** open, including #984 |
| `check-runs total_count: 0` on `90539f72` | wrong repo; the commit is not there |
| `POST /pulls` -> 403 `Resource not accessible by integration` (Codespace token) | wrong repo — says nothing about Codespace-token rights on the real one |
| `POST /pulls` -> 422 `head invalid` / `base invalid` (PAT) | wrong repo; neither branch exists there |
| `branches/develop` -> 404 (PAT) | wrong repo |
| `/repos` -> 200, `permissions: {admin: true, ...}` | wrong repo; and this field is the *account's* role, never a token's grant |
| Conclusion drawn at the time: "the Codespace token lacks PR write, per its default permission set" | inference built on wrong-repo data; **unverified, treat as withdrawn** |

The `.devcontainer/devcontainer.json` fact remains true as a fact — it declares no
`customizations.codespaces.repositories` block — but the conclusion drawn from it
was never tested against the real repository.

## 3. Observations from the WRONG credential — also not evidence

Three merge attempts against the **correct** repository used a PAT secret that had
been cached in a curl config and **revoked in the meantime**. They returned 403 and
prove nothing.

```
~/.securelogic-gh.env mtime  21:56:59 -> 22:25:20   (rewritten after caching)
file vs cached secret        byte comparison: MISMATCH
cached secret, GET /user     HTTP 401                (revoked)
```

**Lesson:** re-read the secret from disk on every invocation; never cache it.

## 4. The VALID observations about the real repository

Two write attempts were made with a **verified-live** credential against the correct
repository, at different times, requiring two *different* permissions. Both were
refused identically.

### 4.1 Merge of PR #984 — requires `contents=write`

```
PUT /repos/securelogic-ai-core/securelogic-engine/pulls/984/merge
body: {"sha": "90539f72...", "merge_method": "merge", ...}
2026-09-02T22:27:51Z

HTTP/2 403
github-authentication-token-expiration: 2026-12-01 23:24:01 UTC
x-accepted-github-permissions: contents=write
x-ratelimit-limit: 5000    x-ratelimit-resource: core
x-github-request-id: BE48:14B8C4:3AB2A1F:BBEB655:6A98A2E6

{"message": "Resource not accessible by personal access token",
 "documentation_url": ".../rest/pulls/pulls#merge-a-pull-request",
 "status": "403"}
```

Credential state at that moment, verified: `GET /user` -> 200,
`SecureLogic-AI` (User, id 246550011), token unexpired, authenticated 5000/hr
quota. Reads against the real repository all returned 200 (repo, PR #984,
`develop`, check-runs).

So this was an **authorization decision on a live, recognised identity** — not an
authentication failure and not a wrong-repo artifact.

### 4.2 Create a PR — requires `pull_requests=write`

Attempted 2026-09-02T22:44Z, opening the PR for *this* document, with the secret
re-read fresh from disk (identity re-verified: `GET /user` -> 200, `SecureLogic-AI`):

```
POST /repos/securelogic-ai-core/securelogic-engine/pulls
head: docs/pat-write-auth-diagnosis  base: develop

HTTP/2 403
x-accepted-github-permissions: pull_requests=write
x-github-request-id: BE48:23BF37:1C10F4F:5B133F8:6A98A65E

{"message": "Resource not accessible by personal access token"}
```

### 4.3 What the pair establishes that one did not

| Operation | Endpoint requires | Result |
|---|---|---|
| Merge PR #984 | `contents=write` | 403 |
| Create a PR | `pull_requests=write` | 403 |

Two different required permissions, refused identically, minutes apart, on a live
credential. A single missing permission cannot produce that — it would require both
to be independently absent, one of them immediately after the owner verified it was
set.

**Leading hypothesis: the token holds no write authorization on this organization's
repositories at all**, i.e. the refusal sits at the org-approval layer rather than at
the token's permission checkboxes. This remains a hypothesis — GitHub names no cause
in either response — but it is materially better supported than any single-permission
explanation, and it is where verification should start.

Contrast, same session: **`git push` of this branch SUCCEEDED.** That runs over the
Codespace credential through the git helper, so contents-write *via git* works while
the PAT's API writes do not. The two paths are independent; do not infer one from
the other.

### What neither response establishes

The response names no cause. It does not identify a missing Contents permission,
an organization approval state, repository access, branch/ruleset protection, or
an App/workflow restriction. No SSO, ruleset, or `x-github-blocked-*` header was
returned. `"Resource not accessible by personal access token"` is GitHub's generic
fine-grained-PAT refusal, emitted for several distinct conditions without
distinguishing them.

The owner has verified **Contents: Read and write** is set on the token. Nothing in
the response contradicts that.

**Do not record PAT write authorization as definitively broken.** Two undiagnosed
403s narrow the cause but do not name it, and the first came minutes after the token
was regenerated. Status: **UNKNOWN — requires separate verification.**

Candidates, after the second observation:
- **org approval absent or not surviving the token regeneration** — now the leading
  candidate, since it explains refusals across two distinct permissions
- org policy restricting or disallowing fine-grained PATs — equally consistent
- repository not in the token's selected-repositories list — equally consistent
- individual permissions genuinely absent — **now unlikely**; it would require two
  independent grants to be missing, one of them verified set by the owner

## 5. Two further evidence traps worth keeping

- **`x-accepted-github-permissions` is a REQUIREMENT, not a diagnosis.** It states
  what the endpoint needs, and is returned on successes too — the same header read
  `contents=read` on a call that returned **200**. Reading `contents=write` on a 403
  as "contents write is missing" drove three rounds of unnecessary credential edits.
- **Public-repo reads prove nothing.** `securelogic-ai-core/securelogic-engine` is
  `private: false`, so 200s on repo/PR/branch/check-run reads succeed for any valid
  token regardless of repository selection, permission, or org approval.

## 6. Credential landscape

| Credential | Identity | Reads (real repo) | API write (real repo) |
|---|---|---|---|
| `GITHUB_TOKEN` | `ghu_` GitHub App user-to-server, Codespaces-injected, org-installed | 200 | **UNTESTED** — one attempt was stopped by a local permission classifier, never reaching GitHub |
| `SECURELOGIC_GH_PAT` (`~/.securelogic-gh.env`, 0600) | `github_pat_`, user `SecureLogic-AI` id 246550011, expires 2026-12-01 | 200 | **two 403s** (`contents=write`, `pull_requests=write`), cause UNKNOWN |

The repository owner is an **Organization**; the PAT owner is a **User**. A
fine-grained PAT reaches org repositories only where the org has approved that
specific token secret.

## 7. Resolution of PR #984

Merged through the normal GitHub path (web UI), not by API and not by any bypass:

```
#984  closed, merged: true, 2026-09-02T22:35:11Z
merge commit  b6d4d7ad7cb7d885048f653a39cf1ca6b71edd8c
parents       05cb7a4a + 90539f72          (merge commit, not squashed)
develop       b6d4d7ad
file          docs/validation/VA-S4-governed-evidence-coverage-STAGING-gate-2026-09-02.md
              153 lines, sha256 4318c2bf... identical to the reviewed commit
main          d42acbac — unchanged; gate record NOT on main
```

Branch protection was not bypassed at any point. Every API merge attempt pinned
`sha=90539f72...` with `merge_method: "merge"`.

## 8. To resolve the automation path (separate work, not release-blocking)

1. **Start here:** verify whether org approval exists for this token secret and
   survived its regeneration. Two refusals across two different permissions point at
   this layer, not at the permission checkboxes.
2. If fine-grained PATs are restricted org-wide, this path is closed — use step 3.
3. Alternative: grant the Codespace credential PR write via a
   `customizations.codespaces.repositories` block in `.devcontainer/devcontainer.json`
   (rebuild + re-authorization). Org-installed, so no PAT approval gate applies.
4. Prove whichever path with the cheapest possible write **before** relying on it
   for the production promotion.

Deliberately NOT investigated: organization token administration, per owner
instruction.

## 9. Bearing on the production promotion

The promotion needs a working API write path, or it will be a manual merge as well.
Settle this beforehand. It does not block release work — manual merge is proven.
