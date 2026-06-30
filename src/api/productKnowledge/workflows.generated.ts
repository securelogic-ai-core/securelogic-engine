/**
 * AUTO-GENERATED — DO NOT EDIT BY HAND.
 * Source of truth: src/api/productKnowledge/workflows/*.yaml
 * Regenerate: npm run generate:workflows
 * Verified by: src/api/tests/workflowRegistry.test.ts (validation + drift).
 */
import type { Workflow } from "../lib/workflowRegistry.js";

export const WORKFLOW_REGISTRY: Workflow[] =
[
  {
    "id": "activate_framework",
    "title": "Activate a framework",
    "goal": "Activate a framework (e.g. NIST CSF, NIST AI RMF, ISO/IEC 42001, SOC 2) to assess controls and obligations against it.",
    "permissions": "platform",
    "navigation": [
      "Compliance",
      "Frameworks"
    ],
    "routes": [
      "/frameworks"
    ],
    "ordered_steps": [
      "Open Compliance → Frameworks in the top navigation (or go to /frameworks).",
      "Choose a framework and activate it to pull in its requirements.",
      "Map controls and obligations to the framework, then track readiness on the compliance views."
    ],
    "expected_result": "The framework's requirements are available and readiness is tracked as you assess.",
    "common_mistakes": [
      "Activating a framework but never mapping controls to it, so readiness stays at zero."
    ],
    "related_workflows": [
      "assess_control",
      "review_ai_governance"
    ]
  },
  {
    "id": "add_ai_system",
    "title": "Add an AI system",
    "goal": "Register an AI system in the inventory so it can be governed and assessed.",
    "permissions": "platform",
    "navigation": [
      "Assets",
      "AI Systems"
    ],
    "routes": [
      "/ai-systems",
      "/ai-systems/new",
      "/ai-systems/import"
    ],
    "ordered_steps": [
      "Open Assets → AI Systems in the top navigation (or go to /ai-systems).",
      "Click \"Add AI System\" to open the form at /ai-systems/new.",
      "Fill in the system details and save. Bulk import is available at /ai-systems/import."
    ],
    "expected_result": "The AI system appears in the inventory, ready for a governance review or assessment.",
    "common_mistakes": [
      "Recording a vendor dependency before the AI system exists — add the system first."
    ],
    "related_workflows": [
      "review_ai_governance",
      "add_vendor"
    ]
  },
  {
    "id": "add_control",
    "title": "Add a control",
    "goal": "Add a control to your library so coverage can be assessed and evidenced.",
    "permissions": "platform",
    "navigation": [
      "Compliance",
      "Controls"
    ],
    "routes": [
      "/controls",
      "/controls/new"
    ],
    "ordered_steps": [
      "Open Compliance → Controls in the top navigation (or go to /controls).",
      "Click \"+ Add Control\" to open the form at /controls/new.",
      "Describe the control and map it to frameworks, then save."
    ],
    "expected_result": "The control appears in the library, ready to assess and attach evidence to.",
    "common_mistakes": [
      "Adding a control without mapping it to any framework, so it does not affect readiness."
    ],
    "related_workflows": [
      "assess_control",
      "upload_evidence"
    ]
  },
  {
    "id": "add_risk",
    "title": "Add a risk to the register",
    "goal": "Log a risk so it can be rated, owned, and treated.",
    "permissions": "platform",
    "navigation": [
      "Risk",
      "Risk Register"
    ],
    "routes": [
      "/risks",
      "/risks/new",
      "/risks/import"
    ],
    "ordered_steps": [
      "Open Risk → Risk Register in the top navigation (or go to /risks).",
      "Click \"+ Add Risk\" to open the new-risk form at /risks/new.",
      "Set the likelihood and impact; the inherent and residual ratings follow from your risk scale. Save."
    ],
    "expected_result": "The risk appears in the register with an inherent and residual rating.",
    "common_mistakes": [
      "Leaving the residual rating unset — it defaults from controls/treatments, not guesswork.",
      "Logging the same risk twice instead of updating the existing entry."
    ],
    "related_workflows": [
      "treat_risk",
      "manage_actions"
    ]
  },
  {
    "id": "add_vendor",
    "title": "Add a vendor",
    "goal": "Add a third-party vendor to your inventory so it can be assessed and monitored.",
    "permissions": "platform",
    "navigation": [
      "Assets",
      "Vendors"
    ],
    "routes": [
      "/vendors",
      "/vendors/new",
      "/vendors/import"
    ],
    "ordered_steps": [
      "Open Assets → Vendors in the top navigation (or go to /vendors).",
      "Click \"+ Add Vendor\" to open the new-vendor form at /vendors/new.",
      "Fill in the vendor details and save. To add many at once, use bulk import at /vendors/import."
    ],
    "expected_result": "The vendor appears in your vendor inventory, ready to assess, review, or monitor.",
    "common_mistakes": [
      "Trying to log a finding before the vendor exists — create the vendor first.",
      "Adding a duplicate of a vendor that is already in the inventory."
    ],
    "related_workflows": [
      "assess_vendor",
      "review_findings"
    ]
  },
  {
    "id": "assess_control",
    "title": "Assess a control",
    "goal": "Record a control assessment to update compliance posture.",
    "permissions": "platform",
    "navigation": [
      "Compliance",
      "Controls"
    ],
    "routes": [
      "/controls",
      "/controls/[id]/assess"
    ],
    "ordered_steps": [
      "Open Compliance → Controls and select the control to open its detail page.",
      "Click \"New Control Assessment\" (/controls/[id]/assess).",
      "Rate the control's effectiveness, attach evidence, and save."
    ],
    "expected_result": "The control's status updates and contributes to your posture and framework readiness.",
    "common_mistakes": [
      "Marking a control effective without attaching supporting evidence."
    ],
    "related_workflows": [
      "add_control",
      "upload_evidence"
    ]
  },
  {
    "id": "assess_vendor",
    "title": "Assess or review a vendor",
    "goal": "Evaluate a vendor's risk with a point-in-time assessment or an ongoing review cycle.",
    "permissions": "platform",
    "navigation": [
      "Assets",
      "Vendors"
    ],
    "routes": [
      "/vendors",
      "/vendors/[id]/assess",
      "/vendors/[id]/review"
    ],
    "ordered_steps": [
      "Open Assets → Vendors and select the vendor to open its detail page.",
      "For a point-in-time assessment, click \"New Assessment\" (/vendors/[id]/assess).",
      "For an ongoing cycle, click \"New Review Cycle\" (/vendors/[id]/review).",
      "Complete the questionnaire and save to update the vendor's inherent and residual risk."
    ],
    "expected_result": "The vendor's risk score and review history are updated from the assessment.",
    "common_mistakes": [
      "Assessing a vendor that has not been added yet — add the vendor first.",
      "Confusing a one-off assessment with a recurring review cycle."
    ],
    "related_workflows": [
      "add_vendor",
      "review_findings"
    ]
  },
  {
    "id": "manage_actions",
    "title": "Manage remediation actions",
    "goal": "Track remediation actions, their owners, and due dates to closure.",
    "permissions": "platform",
    "navigation": [
      "Risk",
      "Actions"
    ],
    "routes": [
      "/actions"
    ],
    "ordered_steps": [
      "Open Risk → Actions in the top navigation (or go to /actions).",
      "Review open, blocked, and overdue actions; sort by due date and priority.",
      "Update status and ownership as work progresses, and close actions when done."
    ],
    "expected_result": "Remediation work is tracked to closure with clear owners and due dates.",
    "common_mistakes": [
      "Leaving actions unassigned, so overdue items have no owner."
    ],
    "related_workflows": [
      "review_findings",
      "treat_risk"
    ]
  },
  {
    "id": "review_ai_governance",
    "title": "Run an AI governance review",
    "goal": "Assess an AI system's governance posture against your active frameworks.",
    "permissions": "platform",
    "navigation": [
      "Assets",
      "AI Systems"
    ],
    "routes": [
      "/ai-systems",
      "/ai-systems/[id]/review",
      "/ai-systems/[id]/assess"
    ],
    "ordered_steps": [
      "Open Assets → AI Systems and select the system to open its detail page.",
      "Click \"New Governance Review\" (/ai-systems/[id]/review) or \"New Assessment\" (/ai-systems/[id]/assess).",
      "Answer the governance questions and save."
    ],
    "expected_result": "The AI system's governance posture and review history are updated.",
    "common_mistakes": [
      "Running a review before activating any framework to assess against."
    ],
    "related_workflows": [
      "add_ai_system",
      "activate_framework"
    ]
  },
  {
    "id": "review_findings",
    "title": "Review findings",
    "goal": "Triage open findings by severity and decide what to remediate.",
    "permissions": "platform",
    "navigation": [
      "Risk",
      "Findings"
    ],
    "routes": [
      "/findings"
    ],
    "ordered_steps": [
      "Open Risk → Findings in the top navigation (or go to /findings).",
      "Filter by severity and status to focus on critical and high open findings first.",
      "Open a finding to review its detail, then create or link a remediation action."
    ],
    "expected_result": "High-priority findings are triaged and routed to remediation actions.",
    "common_mistakes": [
      "Closing a finding without an action or evidence to justify it."
    ],
    "related_workflows": [
      "manage_actions",
      "assess_vendor"
    ]
  },
  {
    "id": "treat_risk",
    "title": "Treat or mitigate a risk",
    "goal": "Record how a risk is being mitigated, accepted, transferred, or avoided.",
    "permissions": "platform",
    "navigation": [
      "Risk",
      "Risk Register"
    ],
    "routes": [
      "/risks",
      "/risks/[id]/treatments/new"
    ],
    "ordered_steps": [
      "Open Risk → Risk Register and select the risk to open its detail page.",
      "Click \"+ Add Treatment\" (/risks/[id]/treatments/new).",
      "Choose the treatment type (mitigate, accept, transfer, avoid), describe it, and save."
    ],
    "expected_result": "The treatment is recorded and moves the risk from its inherent toward its residual rating.",
    "common_mistakes": [
      "Accepting a risk without recording a rationale or owner.",
      "Expecting the residual rating to change without any treatment or control in place."
    ],
    "related_workflows": [
      "add_risk",
      "manage_actions"
    ]
  },
  {
    "id": "upload_evidence",
    "title": "Add or link evidence",
    "goal": "Attach evidence to a control (or obligation / AI system) to support an assessment and the audit trail.",
    "permissions": "platform",
    "navigation": [
      "Compliance",
      "Controls"
    ],
    "routes": [
      "/controls",
      "/controls/[id]/evidence/new"
    ],
    "ordered_steps": [
      "Open Compliance → Controls and select the control to open its detail page.",
      "Click \"Add Evidence\" (/controls/[id]/evidence/new).",
      "Upload or link the evidence and save. The same pattern exists on obligations and AI systems."
    ],
    "expected_result": "The evidence is attached to the item and available to its assessments and audit package.",
    "common_mistakes": [
      "Trying to add evidence from a global page — evidence is always attached to a specific control, obligation, or AI system."
    ],
    "related_workflows": [
      "assess_control",
      "add_control"
    ]
  },
  {
    "id": "view_brief",
    "title": "Read your Intelligence Brief",
    "goal": "Find and read your executive Intelligence Brief.",
    "permissions": "all",
    "navigation": [
      "Briefs"
    ],
    "routes": [
      "/briefs"
    ],
    "ordered_steps": [
      "Open Briefs in the top navigation (or go to /briefs).",
      "Open a brief to read its items; drill into an individual signal for detail."
    ],
    "expected_result": "You can read the latest Intelligence Brief and its underlying signals.",
    "common_mistakes": [
      "Expecting to author a brief in-app — briefs are generated for you on a schedule and read here."
    ],
    "related_workflows": [
      "view_dashboard"
    ]
  },
  {
    "id": "view_dashboard",
    "title": "Review your security posture",
    "goal": "See your overall posture score and trend, and what is driving it.",
    "permissions": "all",
    "navigation": [
      "Dashboard"
    ],
    "routes": [
      "/dashboard"
    ],
    "ordered_steps": [
      "Open Dashboard in the top navigation (or go to /dashboard).",
      "Review the overall posture score, the trend over time, and the top contributing domains.",
      "To improve the score, add and assess controls, close high-severity findings, and clear overdue actions."
    ],
    "expected_result": "You understand your current posture, its trend, and the levers that move it.",
    "common_mistakes": [
      "Looking for a way to set the posture score manually — it is computed from controls, findings, and actions."
    ],
    "related_workflows": [
      "assess_control",
      "manage_actions"
    ]
  }
];
