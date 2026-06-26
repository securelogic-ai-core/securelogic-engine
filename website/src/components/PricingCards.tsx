import Link from "next/link";
import { getPricingTiers, type PricingTier } from "@/lib/pricing";

function CtaButton({ tier }: { tier: PricingTier }) {
  const className = tier.featured ? "btn-primary w-full" : "btn-outline w-full";
  // External app links use a plain anchor; internal routes use next/link.
  if (tier.ctaHref.startsWith("http")) {
    return (
      <a href={tier.ctaHref} className={className}>
        {tier.cta}
      </a>
    );
  }
  return (
    <Link href={tier.ctaHref} className={className}>
      {tier.cta}
    </Link>
  );
}

function FeatureList({ features }: { features: string[] }) {
  return (
    <ul className="space-y-2.5 text-sm text-text-body">
      {features.map((f) => (
        <li key={f} className="flex items-start gap-2.5">
          <span className="mt-0.5 flex-shrink-0 w-4 h-4 rounded-full bg-accent/15 text-accent flex items-center justify-center">
            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </span>
          <span>{f}</span>
        </li>
      ))}
    </ul>
  );
}

/** Compact card used for the three Brief tiers. */
function BriefCard({ tier }: { tier: PricingTier }) {
  return (
    <div className="card p-7 flex flex-col">
      <p className="pill-mono text-text-muted mb-3">{tier.name}</p>
      <div className="flex items-baseline gap-1.5 mb-1">
        <span className="text-3xl font-extrabold text-text">{tier.price}</span>
        {tier.priceNote && <span className="text-sm text-text-muted">{tier.priceNote}</span>}
      </div>
      {tier.allowance && (
        <p className="text-xs text-accent font-medium mb-3">{tier.allowance}</p>
      )}
      <p className="text-sm text-text-muted leading-relaxed mt-2 mb-6">{tier.tagline}</p>
      <FeatureList features={tier.features} />
      <div className="mt-7 pt-2">
        <CtaButton tier={tier} />
      </div>
    </div>
  );
}

/** Featured card used for Platform Professional + Enterprise. */
function PlatformCard({ tier }: { tier: PricingTier }) {
  return (
    <div
      className={`card p-8 flex flex-col relative ${
        tier.featured ? "border-accent/60 ring-1 ring-accent/40 bg-bg-elevated-2" : ""
      }`}
    >
      {tier.badge && (
        <span className="absolute -top-3 left-8 pill-mono bg-accent text-[#04201d] font-semibold px-3 py-1 rounded-full">
          {tier.badge}
        </span>
      )}
      <p className="pill-mono text-text-muted mb-3">{tier.name}</p>

      {tier.urgency && (
        <p className="text-xs font-semibold text-accent mb-3">{tier.urgency}</p>
      )}

      <div className="flex items-baseline gap-1.5">
        <span className="text-4xl font-extrabold text-text">{tier.price}</span>
        {tier.priceNote && <span className="text-sm text-text-muted">{tier.priceNote}</span>}
      </div>

      {tier.priceDetails && (
        <div className="mt-2 space-y-0.5">
          {tier.priceDetails.map((d) => (
            <p key={d} className="text-sm text-text-muted">{d}</p>
          ))}
        </div>
      )}

      {tier.lockNote && (
        <p className="text-xs text-text-muted/80 mt-2">{tier.lockNote}</p>
      )}

      {tier.allowance && (
        <p className="text-xs text-accent font-medium mt-3">{tier.allowance}</p>
      )}

      <p className="text-sm text-text-body leading-relaxed mt-4 mb-6">{tier.tagline}</p>
      <FeatureList features={tier.features} />
      <div className="mt-7 pt-2">
        <CtaButton tier={tier} />
      </div>
    </div>
  );
}

interface PricingCardsProps {
  appUrl: string;
}

/**
 * Shared pricing layout: the three Brief tiers grouped in one row, with
 * Platform Professional + Enterprise featured separately as a different
 * product class. Used by both the homepage and the pricing page.
 */
export function PricingCards({ appUrl }: PricingCardsProps) {
  const tiers = getPricingTiers(appUrl);
  const briefTiers = tiers.filter((t) => t.group === "brief");
  const platformTiers = tiers.filter((t) => t.group === "platform");

  return (
    <div className="space-y-8">
      {/* Brief tiers */}
      <div>
        <p className="pill-mono text-text-muted mb-4">The Intelligence Brief</p>
        <div className="grid md:grid-cols-3 gap-5">
          {briefTiers.map((tier) => (
            <BriefCard key={tier.id} tier={tier} />
          ))}
        </div>
      </div>

      {/* Platform + Enterprise — a different product class */}
      <div>
        <p className="pill-mono text-text-muted mb-4">The Platform</p>
        <div className="grid lg:grid-cols-2 gap-5">
          {platformTiers.map((tier) => (
            <PlatformCard key={tier.id} tier={tier} />
          ))}
        </div>
      </div>
    </div>
  );
}
