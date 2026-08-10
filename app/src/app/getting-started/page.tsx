import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { getDashboardSummary, getAssets, getMe } from "@/lib/api";
import { isPlatformEntitled } from "@/lib/entitlements";
import { completeOnboardingAction } from "./actions";
import { getOnboardingStepCompletion } from "./onboardingProgress";

// ─────────────────────────────────────────────────────────────
// Step definitions
// ─────────────────────────────────────────────────────────────

type Step = {
  title: string;
  description: string;
  cta: string;
  href: string;
};

// The legacy vendor step (step 2), used while the Asset Registry is dark.
const VENDOR_STEP: Step = {
  title: "Add your first vendor",
  description: "Track the third-party vendors that have access to your systems or data.",
  cta: "Add Vendor →",
  href: "/vendors/new",
};

// The Asset Registry step (step 2) when SECURELOGIC_ASSET_REGISTRY_ENABLED is on.
// It LAUNCHES the canonical registry onboarding (/assets/new → create manually,
// import CSV, or connect enterprise systems) — the wizard owns no onboarding
// logic of its own. Vendors and AI systems are asset types within it.
const ASSET_INVENTORY_STEP: Step = {
  title: "Build your asset inventory",
  description: "Add assets manually, import from CSV, or connect enterprise systems — vendors and AI systems are asset types in your registry.",
  cta: "Open Asset Registry →",
  href: "/assets/new",
};

const STEPS: Step[] = [
  {
    title: "Activate a framework",
    description: "Choose a compliance framework like SOC 2, NIST CSF, or ISO 27001 to start tracking your readiness.",
    cta: "Choose Framework →",
    href: "/frameworks",
  },
  VENDOR_STEP,
  {
    title: "Add a security control",
    description: "Define the security controls your organization has in place.",
    cta: "Add Control →",
    href: "/controls/new",
  },
  {
    title: "Run an assessment",
    description: "Assess the effectiveness of your controls and generate your first findings.",
    cta: "Go to Controls →",
    href: "/controls",
  },
  {
    title: "Review your security posture",
    description: "Your security posture score is now available. See how your organization measures up.",
    cta: "View Dashboard →",
    href: "/dashboard",
  },
];

// Step-completion logic lives in ./onboardingProgress (pure + unit-tested).

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────

export default async function GettingStartedPage() {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  // Platform entitlement gate. Every step below targets a platform-gated
  // destination — /frameworks and /controls/* sit behind the engine's
  // `requireEntitlement("premium")`, /vendors/new and /assets/new behind
  // `requirePremiumOrCorePlatform`, and the app pages for those redirect
  // unentitled orgs to /dashboard. Without this guard a starter tenant could
  // reach the checklist directly (the user-menu link is already gated) and be
  // shown a five-step setup in which it cannot complete a single step: two
  // steps bounce straight back to /dashboard, and the other two render but
  // 403 on write. An onboarding checklist that cannot be started is a worse
  // first impression than no checklist at all, so ineligible orgs go to
  // /dashboard, where the free-tier experience (the Brief + UpgradeCard) is.
  //
  // This is the same predicate, and the same redirect target, that /findings,
  // /actions and /approvals already use — see lib/entitlements.ts for why the
  // triad is the engine's own equivalence class rather than an app invention.
  const me = await getMe(token);
  if (!isPlatformEntitled(me?.entitlementLevel)) redirect("/dashboard");

  // Deliberately NO completed-users redirect: "Skip setup" used to make this
  // page permanently unreachable (the user-menu link now returns here). The
  // checklist derives completion from live inventory counts, so a finished org
  // simply sees every step checked — a progress record, not a nag.

  const orgName = session.organizationName ?? "Your organization";

  const summary = await getDashboardSummary(token);

  const inventory = summary?.inventory ?? {
    frameworks: 0,
    vendors: 0,
    controls: 0,
    control_assessments: 0,
    governance_reviews: 0,
  };
  const posture = summary?.posture ?? {
    overall_score: null,
    snapshot_date: null,
  };

  // EAR P12/P13: when the Asset Registry is enabled, step 2 becomes the asset
  // inventory step that launches the canonical registry onboarding. Dark default
  // → the legacy vendor step, unchanged. The engine 404s /api/assets while the
  // registry is off, so the extra read only happens when the flag is on.
  const registryEnabled = process.env.SECURELOGIC_ASSET_REGISTRY_ENABLED === "true";
  const assetsRead = registryEnabled ? await getAssets(token, { limit: 1 }) : null;
  const assetsTotal = assetsRead && assetsRead.ok ? assetsRead.total : 0;

  const steps: Step[] = registryEnabled
    ? STEPS.map((s, i) => (i === 1 ? ASSET_INVENTORY_STEP : s))
    : STEPS;

  const completed = getOnboardingStepCompletion(inventory, posture, {
    assetRegistryEnabled: registryEnabled,
    assetsTotal,
  });
  const completedCount = completed.filter(Boolean).length;
  const allDone = completedCount === steps.length;
  const progressPct = (completedCount / steps.length) * 100;

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold mb-2" style={{ color: "#f1f5f9" }}>
          Welcome to SecureLogic AI
        </h1>
        <p className="text-lg" style={{ color: "#94a3b8" }}>
          {orgName}&apos;s security program starts here.
        </p>
      </div>

      {/* Progress */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs" style={{ color: "#64748b" }}>
            {completedCount} of {steps.length} steps complete
          </span>
          {allDone && (
            <span className="text-xs font-semibold" style={{ color: "#00c4b4" }}>
              All done!
            </span>
          )}
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: "#1e293b" }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${progressPct}%`, background: "#00c4b4" }}
          />
        </div>
      </div>

      {/* Checklist */}
      <div className="space-y-3 mb-8">
        {steps.map((step, i) => {
          const isDone = completed[i];
          return (
            <div
              key={i}
              className="flex items-center gap-4 rounded-xl p-5"
              style={{
                background: "var(--color-brand-surface, #111827)",
                border: `1px solid ${isDone ? "rgba(0,196,180,0.2)" : "#1e293b"}`,
              }}
            >
              {/* Circle indicator */}
              <div
                className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                style={
                  isDone
                    ? { background: "#00c4b4", border: "2px solid #00c4b4", color: "#fff" }
                    : { background: "transparent", border: "2px solid #334155", color: "#64748b" }
                }
              >
                {isDone ? "✓" : i + 1}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className="text-xs mb-0.5" style={{ color: "#475569" }}>
                  Step {i + 1}
                </p>
                <p
                  className="text-sm font-semibold"
                  style={{ color: isDone ? "#64748b" : "#f1f5f9" }}
                >
                  {step.title}
                </p>
                <p className="text-xs mt-0.5" style={{ color: "#64748b" }}>
                  {step.description}
                </p>
              </div>

              {/* CTA */}
              <div className="flex-shrink-0">
                {isDone ? (
                  <span className="text-xs font-semibold" style={{ color: "#00c4b4" }}>
                    Done ✓
                  </span>
                ) : (
                  <Link
                    href={step.href}
                    className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                    style={{
                      border: "1px solid rgba(0,196,180,0.4)",
                      color: "#00c4b4",
                      background: "transparent",
                    }}
                  >
                    {step.cta}
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer actions */}
      <div className="text-center space-y-4">
        {allDone && (
          <form action={completeOnboardingAction}>
            <button
              type="submit"
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold transition-colors"
              style={{ background: "#00c4b4", color: "#0a0f1a" }}
            >
              Go to your dashboard →
            </button>
          </form>
        )}

        <div>
          <form action={completeOnboardingAction}>
            <button
              type="submit"
              className="text-xs transition-colors hover:opacity-80"
              style={{ color: "#475569" }}
            >
              Skip setup for now →
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
