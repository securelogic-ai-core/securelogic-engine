/**
 * Shared pricing model — single source of truth for the homepage and the
 * pricing page so the two never drift. Reflects the official commercial model
 * for this build:
 *   Intelligence Brief (Free) · Brief Pro · Brief-Team · Platform Professional · Enterprise
 *
 * Platform Professional uses the revised founding-annual + month-to-month
 * structure (overrides any older $799 / $7,990 figures).
 */

export interface PricingTier {
  id: string;
  name: string;
  /** Primary price token, e.g. "Free", "$49", "$600", "Custom". */
  price: string;
  /** Small qualifier next to the price, e.g. "/ month", "/month billed annually". */
  priceNote?: string;
  /** One-line positioning statement. */
  tagline: string;
  features: string[];
  cta: string;
  ctaHref: string;
  /** Visual grouping — the three Brief tiers vs. the Platform/Enterprise class. */
  group: "brief" | "platform";
  badge?: string;
  /** Founding-rate urgency line (Platform only). */
  urgency?: string;
  /** Secondary price structure lines rendered under the price (Platform only). */
  priceDetails?: string[];
  /** Lock-in reassurance line (Platform only). */
  lockNote?: string;
  /** Seats / entities allowance shown on the card. */
  allowance?: string;
  featured?: boolean;
}

export function getPricingTiers(appUrl: string): PricingTier[] {
  return [
    {
      id: "brief-free",
      name: "Intelligence Brief",
      price: "Free",
      group: "brief",
      tagline:
        "The weekly briefing for any security professional. Top signals, no credit card.",
      features: [
        "Weekly AI-enriched brief",
        "Top signals from 9 live sources",
        "Executive summary + analyst commentary",
        "Delivered every Monday",
      ],
      cta: "Get the Free Brief",
      ctaHref: "/#brief-signup",
    },
    {
      id: "brief-pro",
      name: "Brief Pro",
      price: "$49",
      priceNote: "/ month",
      group: "brief",
      tagline: "Personalized to your org's vendors, risks, and obligations.",
      features: [
        "Everything in Free",
        "Full brief — all signals every week",
        "Why It Matters + Recommended Actions",
        "Brief matched to your registered vendors & AI systems",
        "Relevant-to-your-org signal matching",
        "Brief archive and search",
        "Severity filtering",
        "Priority delivery every Monday",
      ],
      cta: "Start Brief Pro",
      ctaHref: `${appUrl}/signup?plan=brief-pro`,
    },
    {
      id: "brief-team",
      name: "Brief-Team",
      price: "$199",
      priceNote: "/ month",
      group: "brief",
      allowance: "Up to 6 members",
      tagline:
        "The brief for a small team — credited toward Platform when you upgrade.",
      features: [
        "Everything in Brief Pro",
        "Up to 6 members",
        "Credit toward Platform when you upgrade",
        "Brief-only (no platform workflows)",
        "Past 6 members → move to Platform",
      ],
      cta: "Start Brief-Team",
      ctaHref: `${appUrl}/signup?plan=brief-team`,
    },
    {
      id: "platform-professional",
      name: "Platform Professional",
      price: "$600",
      priceNote: "/month billed annually",
      group: "platform",
      featured: true,
      badge: "Most Popular",
      urgency: "Founding rate · through Dec 2026",
      priceDetails: ["$7,200 / year total", "$800 month-to-month"],
      lockNote: "Locked in for as long as you remain an active customer.",
      allowance: "Up to 10 seats / 50 monitored entities",
      tagline:
        "Full risk platform for teams serious about continuous risk management.",
      features: [
        "Everything in Brief Pro",
        "Vendor risk management",
        "AI governance assessments",
        "Compliance — SOC 2, ISO 27001, GDPR, HIPAA, NIST CSF",
        "Risk register with treatment workflows",
        "Signal ingestion from all supported sources",
        "Posture scoring across 4 domains",
        "Leadership intelligence dashboard",
        "API access + audit log",
      ],
      cta: "Start Free Trial",
      ctaHref: `${appUrl}/signup?plan=professional`,
    },
    {
      id: "enterprise",
      name: "Enterprise",
      price: "Custom",
      group: "platform",
      tagline: "For large enterprises, regulated industries, and MSSPs.",
      features: [
        "Everything in Platform Professional",
        "SSO / SAML",
        "Custom signal sources",
        "White-labeled Intelligence Brief",
        "Multi-org support (MSSP)",
        "Custom data retention",
        "Dedicated onboarding + SLA",
        "Priority support",
      ],
      cta: "Talk to Sales",
      ctaHref: "/contact/",
    },
  ];
}

/** The nine live intelligence sources, shown text-only in the Sources bar. */
export const SOURCES: string[] = [
  "CISA KEV",
  "NVD",
  "CISA Alerts",
  "BleepingComputer",
  "Krebs on Security",
  "The Hacker News",
  "The Register",
  "FTC News",
  "MIT Technology Review AI",
];
