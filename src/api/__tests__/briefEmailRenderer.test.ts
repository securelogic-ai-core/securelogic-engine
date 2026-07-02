import { describe, it, expect } from "vitest";

import {
  renderBriefEmail,
  renderBriefEmailText,
  type BriefEmailData,
  type EmailBriefItem,
  type EmailBriefCategory
} from "../lib/briefEmailRenderer.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const itemCritical: EmailBriefItem = {
  title: "Microsoft Windows MSMQ Remote Code Execution Vulnerability",
  summary:
    "Microsoft Windows Message Queuing contains a critical unauthenticated RCE vulnerability actively exploited in the wild.",
  severity: "Critical",
  relevance: "high",
  affected_cve: "CVE-2024-30080",
  why_it_matters:
    "Any Windows server with MSMQ enabled is remotely exploitable without authentication. Attackers can achieve full SYSTEM privileges. Over 360,000 internet-facing hosts are estimated to be affected.",
  recommended_actions:
    "1. Disable MSMQ if not required via Windows Features.\n" +
    "2. Apply KB5039212 (June 2024 Patch Tuesday).\n" +
    "3. Block TCP port 1801 at the network perimeter.\n" +
    "4. Search EDR telemetry for MSMQ service spawning cmd.exe or powershell.exe."
};

const itemHigh: EmailBriefItem = {
  title: "Apache Log4j2 Remote Code Execution Vulnerability",
  summary:
    "Apache Log4j2 JNDI injection vulnerability allowing remote code execution via specially crafted log messages.",
  severity: "High",
  relevance: "high",
  affected_cve: "CVE-2021-44228",
  why_it_matters:
    "Log4Shell affects virtually every Java application using Log4j2. Attackers can execute arbitrary code by sending a single crafted HTTP header.",
  recommended_actions:
    "1. Upgrade Log4j2 to 2.17.1 or later.\n" +
    "2. Set log4j2.formatMsgNoLookups=true as immediate mitigation.\n" +
    "3. Audit all Java applications in your environment."
};

const itemModerate: EmailBriefItem = {
  title: "Increased Ransomware Activity Targeting Healthcare Sector",
  summary:
    "Multiple ransomware groups observed escalating campaigns against healthcare providers in North America and Europe.",
  severity: "Moderate",
  relevance: "medium",
  affected_cve: null,
  why_it_matters: "Healthcare entities face elevated risk of operational disruption and patient data exposure.",
  recommended_actions:
    "1. Review backup integrity and offline backup procedures.\n2. Verify EDR coverage on clinical systems."
};

const itemLow: EmailBriefItem = {
  title: "Geopolitical Cyber Activity — Eastern Europe",
  summary:
    "Intelligence services report increased reconnaissance activity targeting critical infrastructure in Eastern European NATO members.",
  severity: "Low",
  relevance: "low",
  affected_cve: null,
  why_it_matters: null,
  recommended_actions: null
};

const itemNullEnrichment: EmailBriefItem = {
  title: "Generic advisory with no enrichment",
  summary: "A low-priority advisory with no analyst commentary.",
  severity: "Low",
  relevance: "low",
  affected_cve: null,
  why_it_matters: null,
  recommended_actions: null
};

const itemEmptyEnrichment: EmailBriefItem = {
  title: "Item with empty string enrichment",
  summary: "Advisory with empty strings.",
  severity: "Moderate",
  relevance: "low",
  affected_cve: null,
  why_it_matters: "",
  recommended_actions: ""
};

function makeData(categories: EmailBriefCategory[]): BriefEmailData {
  return {
    period_start: "2026-04-07T00:00:00.000Z",
    period_end: "2026-04-14T00:00:00.000Z",
    signal_count: 42,
    high_count: 2,
    medium_count: 1,
    low_count: 1,
    categories
  };
}

const fullData: BriefEmailData = makeData([
  {
    category: "vulnerability",
    label: "Vulnerabilities & Patches",
    items: [itemCritical, itemHigh]
  },
  {
    category: "threat_actor",
    label: "Threat Actors & Malware",
    items: [itemModerate]
  },
  {
    category: "vendor_incident",
    label: "Vendor & Supply Chain Incidents",
    items: []
  },
  {
    category: "general",
    label: "General Intelligence",
    items: [itemLow]
  }
]);

// ====================================================================
// HTML structure
// ====================================================================

describe("renderBriefEmail — HTML structure", () => {
  const html = renderBriefEmail(fullData, "Acme Corp");

  it("contains DOCTYPE declaration", () => {
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("contains <html> element", () => {
    expect(html).toContain("<html");
  });

  it("contains <body> element", () => {
    expect(html).toContain("<body");
  });

  it("contains SecureLogic AI branding in header", () => {
    expect(html).toContain("SecureLogic AI");
  });

  it("contains Intelligence Brief label", () => {
    expect(html).toContain("Intelligence Brief");
  });

  it("contains period label with April dates", () => {
    expect(html).toContain("April");
  });

  it("contains signal count", () => {
    expect(html).toContain("42");
  });

  it("contains high relevance count", () => {
    expect(html).toContain("2");
  });

  it("contains org name", () => {
    expect(html).toContain("Acme Corp");
  });

  it("returns a non-empty string", () => {
    expect(html.length).toBeGreaterThan(500);
  });
});

// ====================================================================
// Category sections
// ====================================================================

describe("renderBriefEmail — category sections", () => {
  const html = renderBriefEmail(fullData, "Acme Corp");

  it("renders vulnerability category heading", () => {
    expect(html).toContain("Vulnerabilities &amp; Patches");
  });

  it("renders threat_actor category heading", () => {
    expect(html).toContain("Threat Actors &amp; Malware");
  });

  it("renders general category heading", () => {
    expect(html).toContain("General Intelligence");
  });

  it("omits empty vendor_incident category section", () => {
    expect(html).not.toContain("Vendor &amp; Supply Chain Incidents");
  });

  it("renders item title in correct category", () => {
    expect(html).toContain("Microsoft Windows MSMQ Remote Code Execution Vulnerability");
  });
});

describe("renderBriefEmail — empty brief", () => {
  const emptyData = makeData([
    { category: "vulnerability", label: "Vulnerabilities & Patches", items: [] },
    { category: "threat_actor", label: "Threat Actors & Malware", items: [] }
  ]);
  const html = renderBriefEmail(emptyData, "Test Org");

  it("renders 'no items' message for fully empty brief", () => {
    expect(html).toContain("No intelligence items");
  });

  it("does not render any category headings", () => {
    expect(html).not.toContain("Vulnerabilities");
    expect(html).not.toContain("Threat Actors");
  });
});

// ====================================================================
// Severity badges
// ====================================================================

describe("renderBriefEmail — severity badge colors", () => {
  const makeHtml = (severity: string) =>
    renderBriefEmail(
      makeData([
        {
          category: "vulnerability",
          label: "Vulnerabilities & Patches",
          items: [{ ...itemCritical, severity }]
        }
      ]),
      "Org"
    );

  it("Critical badge uses red (#ef4444)", () => {
    expect(makeHtml("Critical")).toContain("#ef4444");
  });

  it("High badge uses orange (#f97316)", () => {
    expect(makeHtml("High")).toContain("#f97316");
  });

  it("Moderate badge uses amber (#d97706)", () => {
    expect(makeHtml("Moderate")).toContain("#d97706");
  });

  it("Low badge uses slate (#94a3b8)", () => {
    expect(makeHtml("Low")).toContain("#94a3b8");
  });

  it("Critical badge displays the label 'Critical'", () => {
    expect(makeHtml("Critical")).toContain(">Critical<");
  });

  it("High badge displays the label 'High'", () => {
    expect(makeHtml("High")).toContain(">High<");
  });
});

// ====================================================================
// WHY IT MATTERS section
// ====================================================================

describe("renderBriefEmail — why it matters", () => {
  const html = renderBriefEmail(
    makeData([
      {
        category: "vulnerability",
        label: "Vulnerabilities & Patches",
        items: [itemCritical]
      }
    ]),
    "Org"
  );

  it("renders 'Why It Matters' label", () => {
    expect(html).toContain("Why It Matters");
  });

  it("renders the why_it_matters content", () => {
    expect(html).toContain("remotely exploitable without authentication");
  });

  it("uses amber left-border accent color (#eab308)", () => {
    expect(html).toContain("#eab308");
  });

  it("uses amber background (#fefce8)", () => {
    expect(html).toContain("#fefce8");
  });
});

describe("renderBriefEmail — why it matters omitted when null", () => {
  const html = renderBriefEmail(
    makeData([
      {
        category: "general",
        label: "General Intelligence",
        items: [itemNullEnrichment]
      }
    ]),
    "Org"
  );

  it("does not render 'Why It Matters' when null", () => {
    expect(html).not.toContain("Why It Matters");
  });

  it("does not render amber background when null", () => {
    expect(html).not.toContain("#fefce8");
  });
});

describe("renderBriefEmail — why it matters omitted when empty string", () => {
  const html = renderBriefEmail(
    makeData([
      {
        category: "general",
        label: "General Intelligence",
        items: [itemEmptyEnrichment]
      }
    ]),
    "Org"
  );

  it("does not render 'Why It Matters' when empty string", () => {
    expect(html).not.toContain("Why It Matters");
  });
});

// ====================================================================
// RECOMMENDED ACTIONS section
// ====================================================================

describe("renderBriefEmail — recommended actions as numbered list", () => {
  const html = renderBriefEmail(
    makeData([
      {
        category: "vulnerability",
        label: "Vulnerabilities & Patches",
        items: [itemCritical]
      }
    ]),
    "Org"
  );

  it("renders 'Recommended Actions' label", () => {
    expect(html).toContain("Recommended Actions");
  });

  it("renders numbered list as <ol>", () => {
    expect(html).toContain("<ol");
  });

  it("renders list items as <li>", () => {
    expect(html).toContain("<li");
  });

  it("renders the first action content", () => {
    expect(html).toContain("Disable MSMQ");
  });

  it("renders the patch instruction", () => {
    expect(html).toContain("KB5039212");
  });

  it("uses green left-border accent (#22c55e)", () => {
    expect(html).toContain("#22c55e");
  });

  it("uses green background (#f0fdf4)", () => {
    expect(html).toContain("#f0fdf4");
  });
});

describe("renderBriefEmail — recommended actions omitted when null", () => {
  const html = renderBriefEmail(
    makeData([
      {
        category: "general",
        label: "General Intelligence",
        items: [itemNullEnrichment]
      }
    ]),
    "Org"
  );

  it("does not render 'Recommended Actions' when null", () => {
    expect(html).not.toContain("Recommended Actions");
  });

  it("does not render green background when null", () => {
    expect(html).not.toContain("#f0fdf4");
  });
});

// ====================================================================
// CVE identifier
// ====================================================================

describe("renderBriefEmail — CVE display", () => {
  const htmlWithCve = renderBriefEmail(
    makeData([
      {
        category: "vulnerability",
        label: "Vulnerabilities & Patches",
        items: [itemCritical]
      }
    ]),
    "Org"
  );

  const htmlNoCve = renderBriefEmail(
    makeData([
      {
        category: "threat_actor",
        label: "Threat Actors & Malware",
        items: [itemModerate]
      }
    ]),
    "Org"
  );

  it("renders CVE identifier when present", () => {
    expect(htmlWithCve).toContain("CVE-2024-30080");
  });

  it("CVE displayed in monospace font-family", () => {
    // The CVE block uses Courier New
    expect(htmlWithCve).toContain("Courier");
  });

  it("does not render CVE block when affected_cve is null", () => {
    expect(htmlNoCve).not.toContain("CVE-");
  });

  it("no broken layout tags when CVE is absent", () => {
    // The HTML should still be a complete valid structure
    expect(htmlNoCve).toContain("</html>");
    expect(htmlNoCve).toContain("Threat Actors");
  });
});

// ====================================================================
// Footer and unsubscribe
// ====================================================================

describe("renderBriefEmail — footer and unsubscribe", () => {
  const html = renderBriefEmail(fullData, "Acme Corp");

  it("contains unsubscribe link placeholder {{unsubscribe_url}}", () => {
    expect(html).toContain("{{unsubscribe_url}}");
  });

  it("contains 'Unsubscribe' text", () => {
    expect(html).toContain("Unsubscribe");
  });

  it("unsubscribe link is an <a> element", () => {
    expect(html).toContain('<a href="{{unsubscribe_url}}"');
  });

  it("footer contains org name", () => {
    expect(html).toContain("Acme Corp");
  });
});

// ====================================================================
// Graceful degradation — no why_it_matters or recommended_actions
// ====================================================================

describe("renderBriefEmail — graceful degradation without enrichment", () => {
  const html = renderBriefEmail(
    makeData([
      {
        category: "vulnerability",
        label: "Vulnerabilities & Patches",
        items: [itemNullEnrichment]
      }
    ]),
    "Org"
  );

  it("renders the item title", () => {
    expect(html).toContain("Generic advisory with no enrichment");
  });

  it("renders the item summary", () => {
    expect(html).toContain("no analyst commentary");
  });

  it("still closes html tag correctly", () => {
    expect(html).toContain("</html>");
  });

  it("still contains the footer", () => {
    expect(html).toContain("{{unsubscribe_url}}");
  });

  it("does not render why it matters section", () => {
    expect(html).not.toContain("Why It Matters");
  });

  it("does not render recommended actions section", () => {
    expect(html).not.toContain("Recommended Actions");
  });

  it("does not contain undefined or null as literal text", () => {
    expect(html).not.toContain(">null<");
    expect(html).not.toContain(">undefined<");
  });
});

// ====================================================================
// XSS safety — HTML escaping
// ====================================================================

describe("renderBriefEmail — HTML escaping", () => {
  const maliciousItem: EmailBriefItem = {
    title: '<script>alert("xss")</script>',
    summary: "Normal summary with <b>bold</b> attempt",
    severity: "High",
    relevance: "high",
    affected_cve: null,
    why_it_matters: "Has <script> tag & ampersand",
    recommended_actions: "1. Use 'single quotes' and \"double quotes\""
  };

  const html = renderBriefEmail(
    makeData([
      {
        category: "vulnerability",
        label: "Vulnerabilities & Patches",
        items: [maliciousItem]
      }
    ]),
    "Org"
  );

  it("escapes <script> tags in title", () => {
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes <b> tags in summary", () => {
    expect(html).not.toContain("<b>bold</b>");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });

  it("escapes ampersand in why_it_matters", () => {
    expect(html).toContain("&amp;");
  });

  it("escapes quotes in recommended_actions", () => {
    expect(html).toContain("&#39;single quotes&#39;");
    expect(html).toContain("&quot;double quotes&quot;");
  });
});

// ====================================================================
// Relevance badges
// ====================================================================

describe("renderBriefEmail — relevance badges", () => {
  const makeHtml = (relevance: string) =>
    renderBriefEmail(
      makeData([
        {
          category: "vulnerability",
          label: "Vulnerabilities & Patches",
          items: [{ ...itemCritical, relevance }]
        }
      ]),
      "Org"
    );

  it("high relevance uses indigo (#6366f1)", () => {
    expect(makeHtml("high")).toContain("#6366f1");
  });

  it("medium relevance uses sky blue (#0ea5e9)", () => {
    expect(makeHtml("medium")).toContain("#0ea5e9");
  });

  it("low relevance uses slate (#64748b)", () => {
    expect(makeHtml("low")).toContain("#64748b");
  });
});

// ---------------------------------------------------------------------------
// app_base_url injection — staging↔production drift (Sprint 3A)
// ---------------------------------------------------------------------------
describe("renderBriefEmail — app base URL injection", () => {
  const stagingData: BriefEmailData = {
    ...fullData,
    app_base_url: "https://app.staging.securelogicai.com",
    upgrade_cta: true,
    total_signal_count: 42
  };

  it("uses the injected app_base_url for logo + CTA in the HTML and never the prod app", () => {
    const html = renderBriefEmail(stagingData, "Acme");
    expect(html).toContain("https://app.staging.securelogicai.com/branding/securelogic-ai-logo.png");
    expect(html).toContain("https://app.staging.securelogicai.com/signup");
    expect(html).not.toContain("https://app.securelogicai.com/");
  });

  it("uses the injected app_base_url in the plain-text part", () => {
    const text = renderBriefEmailText(stagingData, "Acme");
    expect(text).toContain("https://app.staging.securelogicai.com/signup");
    expect(text).not.toContain("https://app.securelogicai.com/signup");
  });

  it("falls back to the production app only when app_base_url is omitted", () => {
    const html = renderBriefEmail({ ...fullData, upgrade_cta: true, total_signal_count: 42 }, "Acme");
    expect(html).toContain("https://app.securelogicai.com/branding/securelogic-ai-logo.png");
    expect(html).toContain("https://app.securelogicai.com/signup");
  });

  it("normalizes a trailing slash on the injected base URL", () => {
    const html = renderBriefEmail(
      { ...stagingData, app_base_url: "https://app.staging.securelogicai.com/" },
      "Acme"
    );
    expect(html).not.toContain("securelogicai.com//branding");
    expect(html).not.toContain("securelogicai.com//signup");
  });
});
