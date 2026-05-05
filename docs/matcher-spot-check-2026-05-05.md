# Auto-matcher spot-check (2026-05-05)

Direct-invocation tests of `processSignal()` against the canonical Staging Inc org.
Each run posts 15 synthetic signals and records what the matcher did. Run script:

```
npm run test:matcher-staging
```

Categories applied automatically:
- **clearly correct** — matcher matched and the entity name equals the signal vendor (case-insensitive)
- **plausible (false positive)** — matcher matched but names differ (unreachable with current ILIKE-equality matcher; included for completeness)
- **missed (plausible)** — matcher did not match, but inventory contains a vendor name with substring overlap to the signal vendor (potential near-miss the matcher would catch with wildcards or fuzzy logic)
- **missed (no inventory overlap)** — matcher did not match and no inventory vendor has substring overlap (correct outcome for vendors not in inventory)

---

## Run 2026-05-05T02:50:23.110Z (runId=`69f31836`)

**Org:** `fe2ede61-e1f3-499f-b2b3-3ce530f4fc06`  
**Inventory:** 10 vendors, 5 ai_systems  
**Signals submitted:** 15  
**Findings created (independent count via DB):** 7  

| # | group | affected_vendor | matched | matched_name | finding_id | domain | category | notes |
|---|---|---|---|---|---|---|---|---|
| 1 | brand_hit | Microsoft | yes | Microsoft | 2888c9e5 | Vendor Risk | clearly correct | — |
| 2 | brand_hit | Cisco | yes | Cisco | 43189953 | Vendor Risk | clearly correct | — |
| 3 | brand_hit | Apple | yes | Apple | 53b310f2 | Vendor Risk | clearly correct | — |
| 4 | brand_hit | Adobe | yes | Adobe | e550058e | Vendor Risk | clearly correct | — |
| 5 | brand_hit | Apache | yes | Apache | b42f2df2 | Vendor Risk | clearly correct | — |
| 6 | compound | Microsoft Azure | yes | Microsoft Azure | 4bd45e85 | Vendor Risk | clearly correct | — |
| 7 | compound | AWS | no | — | — | — | missed (no inventory overlap) | — |
| 8 | compound | Bloomberg | no | — | — | — | missed (plausible) | inventory contains: "Bloomberg Terminal" |
| 9 | compound | Refinitiv | no | — | — | — | missed (plausible) | inventory contains: "Refinitiv Eikon" |
| 10 | compound | Cisco Systems | yes | Cisco Systems | bf68fd72 | Vendor Risk | clearly correct | — |
| 11 | unrelated | Oracle | no | — | — | — | missed (no inventory overlap) | — |
| 12 | unrelated | Salesforce | no | — | — | — | missed (no inventory overlap) | — |
| 13 | unrelated | Atlassian | no | — | — | — | missed (no inventory overlap) | — |
| 14 | unrelated | GitHub | no | — | — | — | missed (no inventory overlap) | — |
| 15 | unrelated | Snowflake | no | — | — | — | missed (no inventory overlap) | — |

**Summary:**
- clearly correct: **7**
- missed (no inventory overlap): **6**
- missed (plausible): **2**

---

