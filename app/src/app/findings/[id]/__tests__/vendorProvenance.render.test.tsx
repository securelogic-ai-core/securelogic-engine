/**
 * vendorProvenance.render.test.tsx — T1-B (#861), the return path of the Vendor
 * Assurance chain.
 *
 * Two things are worth testing here and nothing else is.
 *
 * 1. THE PANEL DECLINES TO OCCUPY SPACE IT CANNOT FILL. The endpoint answers
 *    with three states — `vendor_assurance_cuec`, `vendor_assessment`,
 *    `not_applicable` — and only the first has anything to say. A panel headed
 *    "Where this came from" saying "not applicable" on every unrelated finding
 *    is noise, not honesty.
 *
 * 2. IT IS IN BOTH LAYOUTS, AND ITS FETCH IS OUTSIDE THE FLAG BRANCH.
 *    SECURELOGIC_DECISION_WORKSPACE_ENABLED is `false` in production (verified
 *    live 2026-08-27 on the prod engine AND the prod app). ADR-0010 Option 4
 *    requires findings to keep a navigable path back to the vendor / document /
 *    CUEC, so provenance that only appeared inside the Workspace would be a
 *    ratified capability that production never receives. The sibling
 *    AffectedAssetsPanel and RiskRegisterPanel carry the same requirement and
 *    the same source-level assertion.
 *
 * The determination BASIS is quoted from the snapshot, never recomputed — a
 * decision made in March has to stay explainable in September — so the test
 * that matters about it is that it renders what it was given.
 */

import { readFileSync } from "fs";
import { resolve } from "path";

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { VendorProvenancePanel } from "../VendorProvenancePanel";
import type { FindingVendorProvenance } from "@/lib/api";

const FINDING = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

const cuecProvenance = (
  over: Partial<NonNullable<FindingVendorProvenance["provenance"]>> = {}
): FindingVendorProvenance => ({
  finding_id: FINDING,
  source_type: "vendor_review",
  source: "vendor_assurance_cuec",
  provenance: {
    vendor: { id: "v-1", name: "Northwind Payments" },
    document: {
      id: "d-1",
      original_filename: "northwind-soc2-2026.pdf",
      sha256: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      document_type_hint: "SOC 2 Type II",
      processing_status: "complete",
    },
    cuec: {
      id: "c-1",
      ordinal: 7,
      text: "User entities are responsible for enabling multi-factor authentication for all administrative accounts.",
      review_status: "gap",
    },
    determination: {
      review_status: "gap",
      reason: "MFA is not enforced for the two break-glass admin accounts.",
      decided_at: "2026-08-14T10:00:00.000Z",
      decided_by: { user_id: "u-1", email: "risk@example.com", name: "Dana Okafor" },
      // Shaped exactly as vendorAssuranceDocuments.ts snapshots it.
      basis: {
        determined_at: "2026-08-14T10:00:00.000Z",
        determined_status: "gap",
        mapped_controls: [
          { control_id: "AC-2", control_name: "Account Management", implementation_status: "partially_implemented" },
        ],
        mapped_control_count: 1,
        basis: "reviewer_judgement_with_mapped_controls",
      },
    },
    ...over,
  },
});

// ---------------------------------------------------------------------------
// Absence is an answer; the panel says nothing rather than saying "nothing".
// ---------------------------------------------------------------------------

describe("the panel renders only for CUEC-promoted findings", () => {
  it("renders nothing when the fetch failed soft to null", () => {
    const { container } = render(<VendorProvenancePanel data={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for a vendor_review finding that came from an assessment", () => {
    const { container } = render(
      <VendorProvenancePanel
        data={{ finding_id: FINDING, source_type: "vendor_review", source: "vendor_assessment", provenance: null }}
      />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for a finding of any other source type", () => {
    const { container } = render(
      <VendorProvenancePanel
        data={{ finding_id: FINDING, source_type: "pen_test", source: "not_applicable", provenance: null }}
      />
    );
    expect(container.innerHTML).toBe("");
  });
});

// ---------------------------------------------------------------------------
// The return journey itself.
// ---------------------------------------------------------------------------

describe("the way back to the vendor, the report, the obligation, the reviewer", () => {
  it("links the vendor and the source document, not just names them", () => {
    render(<VendorProvenancePanel data={cuecProvenance()} />);
    expect(screen.getByText("Northwind Payments").closest("a")?.getAttribute("href")).toBe("/vendors/v-1");
    expect(screen.getByText("northwind-soc2-2026.pdf").closest("a")?.getAttribute("href")).toBe(
      "/vendor-assurance/d-1"
    );
  });

  it("quotes the obligation VERBATIM — a paraphrase is a different requirement", () => {
    const data = cuecProvenance();
    render(<VendorProvenancePanel data={data} />);
    expect(screen.getByText(data.provenance!.cuec.text)).toBeTruthy();
    expect(screen.getByText(/CUEC 7, as written/)).toBeTruthy();
  });

  it("names the determination in plain words, and who made it", () => {
    render(<VendorProvenancePanel data={cuecProvenance()} />);
    expect(screen.getByText("We don't meet this")).toBeTruthy();
    expect(screen.getByText(/by Dana Okafor/)).toBeTruthy();
    expect(screen.getByText("MFA is not enforced for the two break-glass admin accounts.")).toBeTruthy();
  });

  it("shows the SNAPSHOTTED basis, and says that it is a snapshot", () => {
    render(<VendorProvenancePanel data={cuecProvenance()} />);
    expect(screen.getByText(/Account Management/)).toBeTruthy();
    expect(screen.getByText(/partially implemented/)).toBeTruthy();
    expect(screen.getByText(/Controls change; this does\s+not\./)).toBeTruthy();
  });

  it("says the reviewer decided on judgement when no control was mapped", () => {
    // The exact payload vendorAssuranceDocuments.ts writes in that case. Reading
    // the writer's real shape is the point: a panel that agrees with an invented
    // shape agrees with nothing.
    const data = cuecProvenance();
    data.provenance!.determination.basis = {
      determined_at: "2026-08-14T10:00:00.000Z",
      determined_status: "gap",
      mapped_controls: [],
      mapped_control_count: 0,
      basis: "reviewer_judgement_no_mapped_control",
    };
    render(<VendorProvenancePanel data={data} />);
    expect(
      screen.getByText(/No control was mapped to this obligation/)
    ).toBeTruthy();
  });

  it("survives a basis shape it does not recognise — JSONB is writer-shaped", () => {
    const data = cuecProvenance();
    data.provenance!.determination.basis = "something entirely unexpected";
    expect(() => render(<VendorProvenancePanel data={data} />)).not.toThrow();
  });

  it("does not fall over when the reviewer was never recorded", () => {
    const data = cuecProvenance();
    data.provenance!.determination.decided_by = null;
    render(<VendorProvenancePanel data={data} />);
    expect(screen.getByText(/reviewer not recorded/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The activation boundary, asserted at the only place it is visible: the page.
// ---------------------------------------------------------------------------

describe("provenance reaches BOTH layouts, so the flag cannot remove it", () => {
  const PAGE = readFileSync(
    resolve(__dirname, "..", "page.tsx"),
    "utf8"
  );

  it("is rendered twice — once per layout", () => {
    // The Decision Workspace is a different tree. A panel added to only one of
    // them disappears the moment the flag flips — and that flag is false in
    // production, which is where the customers are.
    expect(PAGE.split("<VendorProvenancePanel").length - 1).toBe(2);
  });

  it("is passed to the Decision Workspace as its own zone, not inside a tab", () => {
    expect(PAGE).toMatch(/vendorProvenance=\{<VendorProvenancePanel/);
  });

  it("its fetch sits OUTSIDE the DECISION_WORKSPACE branch", () => {
    // If the fetch moved inside the `if (…DECISION_WORKSPACE_ENABLED === "true")`
    // block, the legacy layout would render an always-empty panel and nobody
    // would notice, because empty is also how "no provenance" looks.
    const flagBranch = PAGE.indexOf('SECURELOGIC_DECISION_WORKSPACE_ENABLED === "true"');
    const fetchCall = PAGE.indexOf("getFindingVendorProvenance(token, id)");
    expect(flagBranch).toBeGreaterThan(-1);
    expect(fetchCall).toBeGreaterThan(-1);
    expect(fetchCall).toBeLessThan(flagBranch);
  });

  it("travels with the two sibling panels that carry the same requirement", () => {
    expect(PAGE.split("<AffectedAssetsPanel").length - 1).toBe(2);
    expect(PAGE.split("<RiskRegisterPanel").length - 1).toBe(2);
  });
});
