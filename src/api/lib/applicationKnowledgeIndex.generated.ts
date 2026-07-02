/**
 * AUTO-GENERATED — DO NOT EDIT BY HAND.
 * Source of truth: app/src/lib/navigation.ts (NAV_ITEMS + SECONDARY_NAV_ITEMS)
 *                  + app/src/app/** route tree.
 * Regenerate: npm run generate:knowledge-index
 * Verified by: src/api/tests/applicationKnowledgeIndex.test.ts (drift check).
 */
import type { ApplicationKnowledgeIndex } from "./applicationKnowledgeIndex.js";

export const APPLICATION_KNOWLEDGE_INDEX: ApplicationKnowledgeIndex =
{
  "version": 2,
  "navigation": [
    {
      "type": "link",
      "label": "Dashboard",
      "href": "/dashboard",
      "access": "all"
    },
    {
      "type": "link",
      "label": "Briefs",
      "href": "/briefs",
      "access": "all"
    },
    {
      "type": "link",
      "label": "Ask",
      "href": "/ask",
      "access": "platform"
    },
    {
      "type": "link",
      "label": "Queue",
      "href": "/queue",
      "access": "platform"
    },
    {
      "type": "group",
      "label": "Assets",
      "access": "platform",
      "children": [
        {
          "label": "Vendors",
          "href": "/vendors"
        },
        {
          "label": "AI Systems",
          "href": "/ai-systems"
        }
      ]
    },
    {
      "type": "group",
      "label": "Compliance",
      "access": "platform",
      "children": [
        {
          "label": "Controls",
          "href": "/controls"
        },
        {
          "label": "Frameworks",
          "href": "/frameworks"
        },
        {
          "label": "Policies",
          "href": "/policies"
        },
        {
          "label": "Obligations",
          "href": "/obligations"
        }
      ]
    },
    {
      "type": "group",
      "label": "Risk",
      "access": "platform",
      "children": [
        {
          "label": "Findings",
          "href": "/findings"
        },
        {
          "label": "Actions",
          "href": "/actions"
        },
        {
          "label": "Risk Register",
          "href": "/risks"
        }
      ]
    },
    {
      "type": "link",
      "label": "Audit Log",
      "href": "/audit-log",
      "access": "admin"
    }
  ],
  "destinations": [
    {
      "label": "Dashboard",
      "href": "/dashboard",
      "access": "all",
      "group": null
    },
    {
      "label": "Briefs",
      "href": "/briefs",
      "access": "all",
      "group": null
    },
    {
      "label": "Ask",
      "href": "/ask",
      "access": "platform",
      "group": null
    },
    {
      "label": "Queue",
      "href": "/queue",
      "access": "platform",
      "group": null
    },
    {
      "label": "Vendors",
      "href": "/vendors",
      "access": "platform",
      "group": "Assets"
    },
    {
      "label": "AI Systems",
      "href": "/ai-systems",
      "access": "platform",
      "group": "Assets"
    },
    {
      "label": "Controls",
      "href": "/controls",
      "access": "platform",
      "group": "Compliance"
    },
    {
      "label": "Frameworks",
      "href": "/frameworks",
      "access": "platform",
      "group": "Compliance"
    },
    {
      "label": "Policies",
      "href": "/policies",
      "access": "platform",
      "group": "Compliance"
    },
    {
      "label": "Obligations",
      "href": "/obligations",
      "access": "platform",
      "group": "Compliance"
    },
    {
      "label": "Findings",
      "href": "/findings",
      "access": "platform",
      "group": "Risk"
    },
    {
      "label": "Actions",
      "href": "/actions",
      "access": "platform",
      "group": "Risk"
    },
    {
      "label": "Risk Register",
      "href": "/risks",
      "access": "platform",
      "group": "Risk"
    },
    {
      "label": "Audit Log",
      "href": "/audit-log",
      "access": "admin",
      "group": null
    }
  ],
  "routes": [
    {
      "path": "/",
      "dynamic": false,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/accept-invite",
      "dynamic": false,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/account",
      "dynamic": false,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/account/alerts",
      "dynamic": false,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/account/api-keys",
      "dynamic": false,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/account/api-keys/docs",
      "dynamic": false,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/account/privacy",
      "dynamic": false,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/account/team",
      "dynamic": false,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/actions",
      "dynamic": false,
      "navLabel": "Actions",
      "access": "platform"
    },
    {
      "path": "/ai-systems",
      "dynamic": false,
      "navLabel": "AI Systems",
      "access": "platform"
    },
    {
      "path": "/ai-systems/[id]",
      "dynamic": true,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/ai-systems/[id]/assess",
      "dynamic": true,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/ai-systems/[id]/edit",
      "dynamic": true,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/ai-systems/[id]/evidence/new",
      "dynamic": true,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/ai-systems/[id]/review",
      "dynamic": true,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/ai-systems/import",
      "dynamic": false,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/ai-systems/new",
      "dynamic": false,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/approvals",
      "dynamic": false,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/ask",
      "dynamic": false,
      "navLabel": "Ask",
      "access": "platform"
    },
    {
      "path": "/audit-log",
      "dynamic": false,
      "navLabel": "Audit Log",
      "access": "admin"
    },
    {
      "path": "/billing-return",
      "dynamic": false,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/briefs",
      "dynamic": false,
      "navLabel": "Briefs",
      "access": "all"
    },
    {
      "path": "/briefs/[id]",
      "dynamic": true,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/briefs/[id]/signal/[category]/[index]",
      "dynamic": true,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/briefs/[id]/signal/item/[index]",
      "dynamic": true,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/cancel",
      "dynamic": false,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/compliance/[frameworkId]/assess",
      "dynamic": true,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/controls",
      "dynamic": false,
      "navLabel": "Controls",
      "access": "platform"
    },
    {
      "path": "/controls/[id]",
      "dynamic": true,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/controls/[id]/assess",
      "dynamic": true,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/controls/[id]/edit",
      "dynamic": true,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/controls/[id]/evidence/new",
      "dynamic": true,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/controls/import",
      "dynamic": false,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/controls/new",
      "dynamic": false,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/dashboard",
      "dynamic": false,
      "navLabel": "Dashboard",
      "access": "all"
    },
    {
      "path": "/findings",
      "dynamic": false,
      "navLabel": "Findings",
      "access": "platform"
    },
    {
      "path": "/findings/[id]",
      "dynamic": true,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/findings/import",
      "dynamic": false,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/forgot-password",
      "dynamic": false,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/frameworks",
      "dynamic": false,
      "navLabel": "Frameworks",
      "access": "platform"
    },
    {
      "path": "/frameworks/[id]",
      "dynamic": true,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/getting-started",
      "dynamic": false,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/login",
      "dynamic": false,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/obligations",
      "dynamic": false,
      "navLabel": "Obligations",
      "access": "platform"
    },
    {
      "path": "/obligations/[id]",
      "dynamic": true,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/obligations/[id]/assess",
      "dynamic": true,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/obligations/[id]/edit",
      "dynamic": true,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/obligations/[id]/evidence/new",
      "dynamic": true,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/obligations/import",
      "dynamic": false,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/obligations/new",
      "dynamic": false,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/policies",
      "dynamic": false,
      "navLabel": "Policies",
      "access": "platform"
    },
    {
      "path": "/policies/[id]",
      "dynamic": true,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/policies/[id]/edit",
      "dynamic": true,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/policies/new",
      "dynamic": false,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/posture",
      "dynamic": false,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/pricing",
      "dynamic": false,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/queue",
      "dynamic": false,
      "navLabel": "Queue",
      "access": "platform"
    },
    {
      "path": "/recover",
      "dynamic": false,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/recover/confirm",
      "dynamic": false,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/register",
      "dynamic": false,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/reset-password",
      "dynamic": false,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/risks",
      "dynamic": false,
      "navLabel": "Risk Register",
      "access": "platform"
    },
    {
      "path": "/risks/[id]",
      "dynamic": true,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/risks/[id]/edit",
      "dynamic": true,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/risks/[id]/treatments/[tid]",
      "dynamic": true,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/risks/[id]/treatments/new",
      "dynamic": true,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/risks/import",
      "dynamic": false,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/risks/new",
      "dynamic": false,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/settings/risk-policy",
      "dynamic": false,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/settings/risk-scale",
      "dynamic": false,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/settings/security",
      "dynamic": false,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/settings/sso",
      "dynamic": false,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/settings/webhooks",
      "dynamic": false,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/signup",
      "dynamic": false,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/success",
      "dynamic": false,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/templates",
      "dynamic": false,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/templates/[industry]",
      "dynamic": true,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/vendor-assurance/[documentId]",
      "dynamic": true,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/vendor-assurance/queue",
      "dynamic": false,
      "navLabel": null,
      "access": "all"
    },
    {
      "path": "/vendors",
      "dynamic": false,
      "navLabel": "Vendors",
      "access": "platform"
    },
    {
      "path": "/vendors/[id]",
      "dynamic": true,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/vendors/[id]/assess",
      "dynamic": true,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/vendors/[id]/assess/framework",
      "dynamic": true,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/vendors/[id]/edit",
      "dynamic": true,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/vendors/[id]/findings/new",
      "dynamic": true,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/vendors/[id]/review",
      "dynamic": true,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/vendors/import",
      "dynamic": false,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/vendors/new",
      "dynamic": false,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/vendors/risk",
      "dynamic": false,
      "navLabel": null,
      "access": "platform"
    },
    {
      "path": "/verify-email",
      "dynamic": false,
      "navLabel": null,
      "access": "all"
    }
  ],
  "secondaryNavigation": [
    {
      "label": "Account, profile & billing",
      "href": "/account",
      "group": "Account",
      "access": "all"
    },
    {
      "label": "Team & users",
      "href": "/account/team",
      "group": "Account",
      "access": "all"
    },
    {
      "label": "API keys",
      "href": "/account/api-keys",
      "group": "Account",
      "access": "all"
    },
    {
      "label": "Notifications & alerts",
      "href": "/account/alerts",
      "group": "Account",
      "access": "all"
    },
    {
      "label": "Privacy & data rights",
      "href": "/account/privacy",
      "group": "Account",
      "access": "all"
    },
    {
      "label": "Plans & pricing",
      "href": "/pricing",
      "group": "Billing",
      "access": "all"
    },
    {
      "label": "Security settings",
      "href": "/settings/security",
      "group": "Settings",
      "access": "admin"
    },
    {
      "label": "Single sign-on (SSO)",
      "href": "/settings/sso",
      "group": "Settings",
      "access": "premium"
    },
    {
      "label": "Webhooks",
      "href": "/settings/webhooks",
      "group": "Settings",
      "access": "all"
    },
    {
      "label": "Risk rating scale",
      "href": "/settings/risk-scale",
      "group": "Settings",
      "access": "all"
    },
    {
      "label": "Risk policy",
      "href": "/settings/risk-policy",
      "group": "Settings",
      "access": "all"
    },
    {
      "label": "Getting started checklist",
      "href": "/getting-started",
      "group": "Onboarding",
      "access": "all"
    }
  ]
};
