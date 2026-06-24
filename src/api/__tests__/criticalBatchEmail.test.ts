import { describe, it, expect, vi } from "vitest";

// criticalBatchEmail imports alertPrimitives, which imports infra/postgres
// (throws at import without DATABASE_URL). Mock postgres at the resolved path.
vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn() },
  withTenant: (_o: string, fn: () => Promise<unknown>) => fn(),
}));

import { renderCriticalBatchEmail } from "../lib/alerting/criticalBatchEmail.js";

describe("renderCriticalBatchEmail", () => {
  const items = [
    { findingId: "f1", title: "RCE in Cisco IOS XE", severity: "Critical" as const, domain: "Cisco" },
    { findingId: "f2", title: "Privilege escalation in Apache", severity: "High" as const, domain: null },
  ];

  it("subject reflects the count and the Critical/High breakdown", () => {
    const { subject } = renderCriticalBatchEmail("Acme Corp", items);
    expect(subject).toContain("2 new findings");
    expect(subject).toContain("Acme Corp");
    expect(subject).toContain("1 Critical, 1 High");
  });

  it("singular subject for one finding", () => {
    const { subject } = renderCriticalBatchEmail("Acme Corp", [items[0]!]);
    expect(subject).toContain("1 new finding");
    expect(subject).not.toContain("findings");
    expect(subject).toContain("1 Critical");
  });

  it("html lists every item's title and severity", () => {
    const { html } = renderCriticalBatchEmail("Acme Corp", items);
    expect(html).toContain("RCE in Cisco IOS XE");
    expect(html).toContain("Privilege escalation in Apache");
    expect(html).toContain("Critical");
    expect(html).toContain("High");
  });

  it("HTML-escapes titles to prevent injection", () => {
    const { html } = renderCriticalBatchEmail("Acme", [
      { findingId: "x", title: `<script>alert(1)</script>`, severity: "Critical", domain: null },
    ]);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
