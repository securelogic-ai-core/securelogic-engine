/**
 * whatsNew.ts — the customer-facing release notes for a promotion wave.
 *
 * DETERMINISTIC BY DESIGN. This content is authored, typed, and static. It is
 * never generated, summarized, or personalized by an LLM: a customer reading
 * "why did this change?" is asking a question about our intent, and only we can
 * answer it. A generated paragraph here would be exactly the credibility risk
 * the platform's determinism principle exists to prevent.
 *
 * WHY THIS MODULE EXISTS RATHER THAN JSX IN THE PANEL
 *
 * The release notes are content, not layout. Keeping them in a pure module means
 * they can be unit-tested (stable keys, valid hrefs, banner-key shape) without
 * rendering, and a future product-communication capability (roadmap: product
 * communication as a platform capability) can consume the same structure instead
 * of re-authoring it.
 *
 * THE BANNER KEY
 *
 * Persistence reuses the existing per-user mechanism: POST /api/me/dismiss-banner
 * writes into users.dismissed_banner_keys (see src/api/routes/templates.ts). No
 * new route, no migration. The key MUST satisfy the engine's shape guard
 * /^[a-z0-9:_-]{1,64}$/i or the dismiss call 400s — pinned by test.
 */

/** One highlight: what moved, why it moved, and where to go see it. */
export type WhatsNewItem = {
  /** Stable identifier — never reuse across waves. */
  readonly id: string;
  /** What changed, in the customer's language. */
  readonly title: string;
  /** The "why this changed" line. Our intent, not a feature description. */
  readonly why: string;
  /** Where the capability now lives. */
  readonly href: string;
  readonly hrefLabel: string;
};

export type WhatsNewRelease = {
  /** The dismissal key persisted per user. */
  readonly bannerKey: string;
  readonly headline: string;
  /** One sentence framing the whole change before the item list. */
  readonly intro: string;
  readonly items: readonly WhatsNewItem[];
};

/** The engine's banner-key shape guard, mirrored so tests can assert against it. */
export const BANNER_KEY_PATTERN = /^[a-z0-9:_-]{1,64}$/i;

/**
 * Wave 1 ("Reveal") — surfaces that already existed become reachable, and the
 * dashboard starts leading with change rather than state.
 *
 * Scope discipline: every item below is delivered by a Wave 1 flag. Nothing here
 * describes Wave 2 or Wave 3 capability, and nothing describes the executive
 * dashboard, which remains dark. Announcing a capability the customer cannot
 * reach is worse than announcing nothing.
 */
export const WAVE_1_RELEASE: WhatsNewRelease = {
  bannerKey: "whats-new:wave-1",
  headline: "Your workspace has a new shape",
  intro:
    "We moved a few things so the product answers what changed before it shows you what exists. Nothing was removed, and nothing you had is gone.",
  items: [
    {
      id: "briefing-leads-with-change",
      title: "Your dashboard now opens with what changed since you were last here",
      why: "You shouldn't have to remember what was true last week to know what needs you today.",
      href: "/dashboard",
      hrefLabel: "See your briefing",
    },
    {
      id: "posture-in-nav",
      title: "Posture has a permanent place in the menu",
      why: "\"Are we improving?\" is a standing question, so it deserves a standing home rather than a link you had to know about.",
      href: "/posture",
      hrefLabel: "Open Posture",
    },
    {
      id: "reachable-surfaces",
      title: "Approvals, Evidence, and Vendor Assurance are now in the menu",
      why: "These already worked, but you had to know the address. Work you can't find is work we didn't really ship.",
      href: "/evidence",
      hrefLabel: "Open Evidence",
    },
    {
      id: "workspace-vs-explorer",
      title: "Findings now separates your daily workspace from the full explorer",
      why: "Doing today's work and investigating the whole inventory are different tasks, and one list was serving both badly.",
      href: "/findings",
      hrefLabel: "Open your workspace",
    },
    {
      id: "decision-context",
      title: "Finding detail now shows the context behind the decision",
      why: "The information you need in order to decide should be where you decide, not somewhere you have to go and fetch.",
      href: "/findings",
      hrefLabel: "Review findings",
    },
  ],
} as const;
