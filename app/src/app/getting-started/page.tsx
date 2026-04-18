import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { getDashboardSummary } from "@/lib/api";
import { completeOnboardingAction } from "./actions";

// ─────────────────────────────────────────────────────────────
// Step definitions
// ─────────────────────────────────────────────────────────────

type Step = {
  title: string;
  description: string;
  cta: string;
  href: string;
};

const STEPS: Step[] = [
  {
    title: "Activate a framework",
    description: "Choose a compliance framework like SOC 2, NIST CSF, or ISO 27001 to start tracking your readiness.",
    cta: "Choose Framework →",
    href: "/frameworks",
  },
  {
    title: "Add your first vendor",
    description: "Track the third-party vendors that have access to your systems or data.",
    cta: "Add Vendor →",
    href: "/vendors/new",
  },
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

// ─────────────────────────────────────────────────────────────
// Step completion logic
// ─────────────────────────────────────────────────────────────

function getCompletedSteps(inventory: {
  frameworks: number;
  vendors: number;
  controls: number;
  control_assessments: number;
}): boolean[] {
  const assessmentsDone = inventory.control_assessments > 0;
  return [
    inventory.frameworks > 0,
    inventory.vendors > 0,
    inventory.controls > 0,
    assessmentsDone,
    assessmentsDone,
  ];
}

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────

export default async function GettingStartedPage() {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  // If onboarding already completed, skip to dashboard
  if (session.onboardingCompleted === true) redirect("/dashboard");

  const orgName = session.organizationName ?? "Your organization";

  const summary = await getDashboardSummary(token);

  const inventory = summary?.inventory ?? {
    frameworks: 0,
    vendors: 0,
    controls: 0,
    control_assessments: 0,
    governance_reviews: 0,
  };

  const completed = getCompletedSteps(inventory);
  const completedCount = completed.filter(Boolean).length;
  const allDone = completedCount === STEPS.length;
  const progressPct = (completedCount / STEPS.length) * 100;

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
            {completedCount} of {STEPS.length} steps complete
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
        {STEPS.map((step, i) => {
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
