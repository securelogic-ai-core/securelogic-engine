/**
 * productKnowledge.ts — curated SecureLogic AI product knowledge for assistants
 *
 * Why this exists
 * ---------------
 * "Ask SecureLogic" (src/api/routes/ask.ts) answers questions strictly from a
 * per-request, org-scoped *data* snapshot (posture, findings, risks, vendors,
 * …). That makes it good at "what is my posture?" but useless for "how do I
 * add a vendor?" — the data snapshot contains no product documentation, route
 * metadata, feature metadata, or workflow guidance, and the Ask prompt (rightly)
 * forbids inventing facts not present in its context. So platform how-to
 * questions previously fell through to "no data available".
 *
 * This module is the smallest safe fix: a single, curated, static source of
 * truth describing what the platform does and how a user accomplishes the core
 * workflows, grounded ONLY in features that actually exist in the app
 * (app/src/app/*) and engine (src/api/routes/*). It is plain structured data +
 * a renderer, with no DB access and no external calls, so any output surface
 * (Ask today, an in-app help panel later) can reuse it.
 *
 * Maintenance contract
 * --------------------
 * Every entry here must map to a real UI path and/or engine route. If a
 * workflow changes, update the matching entry. Do NOT add aspirational
 * features — an assistant that confidently describes a button that does not
 * exist is worse than one that says "I'm not sure". Keep navigation labels in
 * sync with app/src/components/Header.tsx.
 */

export type ProductWorkflow = {
  /** Stable id for tests/links. */
  id: string;
  /** What the user is trying to do, phrased as they'd ask it. */
  intent: string;
  /** The accurate, step-level answer. Grounded in real UI navigation. */
  answer: string;
  /** Keywords that should route a question to this workflow (lowercase). */
  keywords: string[];
};

/**
 * Platform overview — the one-paragraph "what is this product" grounding so the
 * assistant frames how-to answers correctly (Platform is the product; the
 * Intelligence Brief is one premium output, not the whole system).
 */
export const PLATFORM_OVERVIEW = `
SecureLogic AI is a holistic cyber, GRC, AI-governance, and third-party-risk posture platform. Organizations use it to understand their current security and governance posture, assess vendors / AI systems / controls / regulatory obligations, monitor risk over time, prioritize action, and produce executive reporting. The Intelligence Brief is one premium output of the platform — a curated executive read on external risk signals — not the center of the product.
`.trim();

/**
 * Top navigation map (from app/src/components/Header.tsx). Used so the
 * assistant can tell a user exactly where to click. Labels are grouped under
 * dropdowns in the real header; we flatten them here with their destination
 * paths. Account/settings items live under the user menu, not the top nav.
 */
export const NAVIGATION: ReadonlyArray<{ label: string; path: string; note?: string }> = [
  { label: "Dashboard", path: "/dashboard", note: "posture summary and trend, your landing view" },
  { label: "Getting Started", path: "/getting-started", note: "guided onboarding checklist for new orgs" },
  { label: "Vendors", path: "/vendors", note: "third-party / vendor inventory and risk" },
  { label: "AI Systems", path: "/ai-systems", note: "AI system inventory and governance" },
  { label: "Risk Register", path: "/risks", note: "risk register (inherent + residual ratings)" },
  { label: "Findings", path: "/findings" },
  { label: "Actions", path: "/actions", note: "remediation actions and their due dates" },
  { label: "Obligations", path: "/obligations", note: "regulatory / compliance obligations" },
  { label: "Controls", path: "/controls", note: "control library and assessments" },
  { label: "Frameworks", path: "/frameworks", note: "framework activation (NIST, ISO, SOC 2, …)" },
  { label: "Compliance", path: "/frameworks", note: "framework readiness and gap views" },
  { label: "Briefs", path: "/briefs", note: "your Intelligence Briefs" },
  { label: "Policies", path: "/policies" },
  { label: "Posture", path: "/posture", note: "posture score detail (read-only, derived)" },
  { label: "Ask", path: "/ask", note: "this assistant" },
  { label: "Audit Log", path: "/audit-log" },
];

/**
 * Core how-to workflows. Each is grounded in a verified UI action. Keep the
 * `answer` step-level but concise — it is injected into a token-bounded prompt.
 */
export const WORKFLOWS: ReadonlyArray<ProductWorkflow> = [
  {
    id: "add-vendor",
    intent: "How do I add a vendor?",
    answer:
      'Open Vendors in the top navigation (or go to /vendors), then click "+ Add Vendor" to open the new-vendor form at /vendors/new and fill in the vendor details. You can also bulk-import vendors from /vendors/import. New vendors appear in your vendor inventory, where you can then run an assessment or review on them.',
    keywords: ["add vendor", "new vendor", "create vendor", "onboard vendor", "third party", "third-party", "supplier"],
  },
  {
    id: "assess-vendor",
    intent: "How do I assess or review a vendor?",
    answer:
      'Open the vendor from Vendors (/vendors) to its detail page, then use "New Assessment" (/vendors/[id]/assess) for a point-in-time assessment, "New Review Cycle" (/vendors/[id]/review) for an ongoing review, or framework-based assessment for a structured questionnaire. Inherent and residual risk are tracked from these.',
    keywords: ["assess vendor", "vendor assessment", "vendor review", "review vendor", "evaluate vendor"],
  },
  {
    id: "add-ai-system",
    intent: "How do I add an AI system?",
    answer:
      'Open AI Systems in the top navigation (or go to /ai-systems), then click "Add AI System" to open the form at /ai-systems/new. You can also import AI systems from /ai-systems/import. Once added, you can run an AI governance review or assessment on the system.',
    keywords: ["add ai system", "new ai system", "create ai system", "ai inventory", "ai governance"],
  },
  {
    id: "review-ai-system",
    intent: "How do I run an AI governance review?",
    answer:
      'Open the AI system from AI Systems (/ai-systems) to its detail page, then use "New Governance Review" (/ai-systems/[id]/review) or "New Assessment" (/ai-systems/[id]/assess). These capture AI-governance posture against your active frameworks.',
    keywords: ["ai governance review", "governance review", "assess ai", "ai assessment", "ai risk"],
  },
  {
    id: "add-risk",
    intent: "How do I create a risk?",
    answer:
      'Open Risk Register in the top navigation (or go to /risks), then click "+ Add Risk" to open the new-risk form at /risks/new. Each risk carries an inherent rating (pre-controls) and a residual rating (post-controls). You can also import risks from /risks/import.',
    keywords: ["add risk", "new risk", "create risk", "log risk", "risk register", "raise risk"],
  },
  {
    id: "treat-risk",
    intent: "How do I treat or mitigate a risk?",
    answer:
      'Open the risk from the Risk Register (/risks) to its detail page, then click "+ Add Treatment" (/risks/[id]/treatments/new) to record a treatment (mitigate, accept, transfer, or avoid). Treatments are what move a risk from its inherent rating toward its residual rating.',
    keywords: ["treat risk", "mitigate risk", "risk treatment", "remediate risk", "accept risk", "reduce risk"],
  },
  {
    id: "add-finding",
    intent: "How do I add a finding?",
    answer:
      'Findings are typically raised against a vendor: open the vendor detail page and use "Add Finding" (/vendors/[id]/findings/new). All findings are listed under Findings (/findings) in the top navigation, where you can filter by severity and status.',
    keywords: ["add finding", "new finding", "create finding", "log finding", "raise finding"],
  },
  {
    id: "add-control",
    intent: "How do I add a control or run a control assessment?",
    answer:
      'Open Controls in the top navigation (or go to /controls), then "+ Add Control" (/controls/new) to add one. To assess a control, open it and use "New Control Assessment" (/controls/[id]/assess). Strong control coverage and assessments are what improve your posture score.',
    keywords: ["add control", "new control", "control assessment", "assess control", "controls"],
  },
  {
    id: "add-obligation",
    intent: "How do I add or assess a regulatory obligation?",
    answer:
      'Open Obligations in the top navigation (or go to /obligations), then "+ Add Obligation" (/obligations/new). To assess one, open it and use "New Obligation Assessment" (/obligations/[id]/assess). Obligations track your regulatory and compliance requirements.',
    keywords: ["add obligation", "new obligation", "obligation assessment", "regulatory", "compliance requirement"],
  },
  {
    id: "link-evidence",
    intent: "How do I add or link evidence?",
    answer:
      'Evidence is attached to a control, obligation, or AI system. Open the relevant item\'s detail page (for example a control at /controls/[id]) and use "Add Evidence" (e.g. /controls/[id]/evidence/new). Evidence supports your assessments and audit trail.',
    keywords: ["add evidence", "link evidence", "upload evidence", "attach evidence", "proof"],
  },
  {
    id: "activate-framework",
    intent: "How do I activate a framework like NIST, ISO, or SOC 2?",
    answer:
      "Open Frameworks in the top navigation (or go to /frameworks), choose a framework (e.g. NIST CSF, NIST AI RMF, ISO/IEC 42001, SOC 2) and activate it. Activating a framework pulls its requirements in so you can assess controls and obligations against it and track readiness on the Compliance views.",
    keywords: ["activate framework", "add framework", "enable framework", "nist", "iso", "soc 2", "soc2", "framework", "compliance framework"],
  },
  {
    id: "view-brief",
    intent: "Where do I find my Intelligence Brief?",
    answer:
      "Open Briefs in the top navigation (or go to /briefs) to see your Intelligence Briefs. Open a brief to read the items; you can drill into an individual signal within a brief. Briefs are generated for you on a schedule — customers read them here rather than authoring them.",
    keywords: ["intelligence brief", "brief", "briefs", "executive brief", "newsletter", "signals report"],
  },
  {
    id: "understand-posture",
    intent: "How is my posture score calculated and how do I improve it?",
    answer:
      "Your posture score is derived from your controls, assessments, findings, and actions across domains — it is computed for you and shown read-only on the Dashboard (/dashboard) and the Posture page (/posture); there is no manual posture entry. To improve it, add and assess controls, close high-severity findings, and complete overdue actions. The Dashboard shows the trend over time.",
    keywords: ["posture score", "improve posture", "security posture", "posture", "overall score", "how is my score"],
  },
  {
    id: "invite-team",
    intent: "How do I invite a teammate?",
    answer:
      "Open your account/team settings from the user menu (Team, at /account/team) to invite teammates to your organization. Invited users join your org and share its data per their role.",
    keywords: ["invite", "add user", "add teammate", "team member", "invite colleague", "add member"],
  },
  {
    id: "get-started",
    intent: "I'm new — where do I start?",
    answer:
      "Start with Getting Started (/getting-started), a guided checklist that walks you through choosing a framework, adding your first vendor, adding a control, running an assessment, and reviewing your posture on the Dashboard. From there, the top navigation gives you Vendors, AI Systems, Risk Register, Controls, Obligations, Findings, Actions, and Briefs.",
    keywords: ["get started", "getting started", "new", "onboard", "where do i start", "first steps", "setup", "set up"],
  },
];

/**
 * Capabilities the assistant must NOT claim a UI exists for. Keeps it honest
 * about things that are derived/server-side rather than user-authored.
 */
export const NOT_USER_ACTIONS: ReadonlyArray<string> = [
  "Posture scores are computed/derived, not manually entered — there is no 'create posture' action.",
  "Intelligence Briefs are generated server-side on a schedule; customers view them at /briefs but do not author them in-app.",
  "There is no standalone product help center, guided tour, or knowledge base beyond the Getting Started checklist and this assistant.",
  "Evidence and assessments are always created from a parent item (a specific control, obligation, AI system, or vendor) — there is no global 'add evidence' page detached from a parent.",
];

/**
 * Render the curated knowledge into a compact text block for prompt injection.
 * Deterministic ordering so prompt caching and tests are stable.
 */
export function renderProductKnowledge(): string {
  const nav = NAVIGATION.map(
    (n) => `- ${n.label} (${n.path})${n.note ? ` — ${n.note}` : ""}`
  ).join("\n");

  const flows = WORKFLOWS.map(
    (w) => `Q: ${w.intent}\nA: ${w.answer}`
  ).join("\n\n");

  const limits = NOT_USER_ACTIONS.map((s) => `- ${s}`).join("\n");

  return [
    "SECURELOGIC PRODUCT KNOWLEDGE (how the platform works — use this to answer product / how-to / navigation questions)",
    "",
    "What the platform is:",
    PLATFORM_OVERVIEW,
    "",
    "Top navigation (where to click):",
    nav,
    "",
    "Common workflows:",
    flows,
    "",
    "Important limits (do not claim these UIs exist):",
    limits,
  ].join("\n");
}
