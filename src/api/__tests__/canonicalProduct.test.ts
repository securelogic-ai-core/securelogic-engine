/**
 * canonicalProduct.test.ts — the Canonical Product normalization core (Phase C1).
 * The load-bearing invariant is R2: vendor identity ALONE is never product-
 * identifiable, so it can never become evidence of an `affected` product/asset.
 */

import { describe, it, expect } from "vitest";
import { canonicalProductIdentity, normalizeCve } from "../lib/canonicalProduct.js";

describe("normalizeCve", () => {
  it("uppercases and accepts a well-formed CVE", () => {
    expect(normalizeCve("cve-2024-1234")).toBe("CVE-2024-1234");
    expect(normalizeCve("  CVE-2008-4250 ")).toBe("CVE-2008-4250");
    expect(normalizeCve("CVE-2024-1234567")).toBe("CVE-2024-1234567");
  });
  it("rejects malformed / absent input", () => {
    expect(normalizeCve("2024-1234")).toBeNull();
    expect(normalizeCve("CVE-24-1")).toBeNull();
    expect(normalizeCve("")).toBeNull();
    expect(normalizeCve(null)).toBeNull();
    expect(normalizeCve(undefined)).toBeNull();
  });
});

describe("canonicalProductIdentity — R2 vendor-alone is NOT product-identifiable", () => {
  it("vendor name alone yields identifiable=false (never affected evidence)", () => {
    const id = canonicalProductIdentity({ vendor: "Microsoft Corporation" });
    expect(id.vendor_canonical).toBe("microsoft");
    expect(id.product_canonical).toBeNull();
    expect(id.cve).toBeNull();
    expect(id.identifiable).toBe(false);
  });

  it("a product token makes it identifiable", () => {
    const id = canonicalProductIdentity({ vendor: "Microsoft", product: "Exchange Server" });
    expect(id.product_canonical).toBe("exchange server");
    expect(id.identifiable).toBe(true);
  });

  it("a CVE makes it identifiable even without a product token", () => {
    const id = canonicalProductIdentity({ vendor: "Microsoft", cve: "cve-2021-26855" });
    expect(id.cve).toBe("CVE-2021-26855");
    expect(id.identifiable).toBe(true);
  });

  it("no evidence at all → not identifiable", () => {
    expect(canonicalProductIdentity({}).identifiable).toBe(false);
    expect(canonicalProductIdentity({ vendor: "   " }).identifiable).toBe(false);
  });
});

describe("canonicalProductIdentity — deterministic, org-neutral key", () => {
  it("produces a stable key shape with preserved empty segments", () => {
    expect(canonicalProductIdentity({ vendor: "Microsoft", product: "Exchange", cve: "CVE-2021-26855" }).canonical_key)
      .toBe("microsoft|exchange|CVE-2021-26855");
    expect(canonicalProductIdentity({ cve: "CVE-2021-26855" }).canonical_key)
      .toBe("||CVE-2021-26855");
  });

  it("is stable across equivalent vendor spellings (reuses the one canonical normalizer)", () => {
    const a = canonicalProductIdentity({ vendor: "Microsoft Corporation", product: "Exchange" });
    const b = canonicalProductIdentity({ vendor: "microsoft, inc.", product: "exchange" });
    expect(a.canonical_key).toBe(b.canonical_key);
  });
});
