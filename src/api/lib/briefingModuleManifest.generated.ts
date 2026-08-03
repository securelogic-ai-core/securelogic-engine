/**
 * AUTO-GENERATED — DO NOT EDIT BY HAND.
 * Source of truth: app/src/lib/briefing/registry.ts (BRIEFING_MODULES)
 *                  + app/src/lib/briefing/contracts.ts (LEGACY_DASHBOARD_TILE_IDS).
 * Regenerate: npm run generate:briefing-manifest
 * Verified by: src/api/tests/briefingModuleManifest.test.ts (drift check).
 * INERT until a B2 write path consumes it via briefingModuleManifest.ts.
 */
import type { BriefingModuleManifest } from "./briefingModuleManifest.js";

export const BRIEFING_MODULE_MANIFEST: BriefingModuleManifest =
{
  "schema_version": 1,
  "modules": [
    {
      "id": "whats_changed",
      "title": "Since Your Last Visit",
      "description": "What changed while you were away — new findings, work that became overdue, remediation completed, findings closed, and new intelligence.",
      "zone": "your_work",
      "category": "my_work",
      "scope": "organization",
      "requiresUserIdentity": true,
      "minEntitlement": "platform",
      "destination": "/findings?queue=all",
      "legacyTileId": null
    },
    {
      "id": "my_work",
      "title": "My Work",
      "description": "Findings you own and remediation actions assigned to you, with overdue work called out.",
      "zone": "your_work",
      "category": "my_work",
      "scope": "personal",
      "requiresUserIdentity": true,
      "minEntitlement": "platform",
      "destination": "/findings?bucket=my_work",
      "legacyTileId": null
    },
    {
      "id": "my_pending_reviews",
      "title": "My Pending Reviews",
      "description": "Findings assigned to you as independent Governance Reviewer — remediation complete, your closure decision pending.",
      "zone": "your_work",
      "category": "my_work",
      "scope": "personal",
      "requiresUserIdentity": true,
      "minEntitlement": "platform",
      "requiredFlag": "independent_review",
      "destination": "/findings?bucket=pending_independent_review",
      "legacyTileId": null
    },
    {
      "id": "needs_attention",
      "title": "Needs Attention",
      "description": "Critical and High active findings across the organization.",
      "zone": "organization",
      "category": "findings",
      "scope": "organization",
      "requiresUserIdentity": false,
      "minEntitlement": "platform",
      "destination": "/findings?active=true",
      "legacyTileId": "findings_donut"
    },
    {
      "id": "overdue_actions",
      "title": "Remediation Actions",
      "description": "Active remediation actions organization-wide, leading with overdue work.",
      "zone": "organization",
      "category": "actions",
      "scope": "organization",
      "requiresUserIdentity": false,
      "minEntitlement": "platform",
      "destination": "/actions?active=true&view=team",
      "legacyTileId": "actions_ring"
    },
    {
      "id": "ready_to_close",
      "title": "Ready to Close",
      "description": "Organization-wide findings with remediation complete and a governance decision pending.",
      "zone": "organization",
      "category": "findings",
      "scope": "organization",
      "requiresUserIdentity": false,
      "minEntitlement": "platform",
      "destination": "/findings?bucket=ready_to_close",
      "legacyTileId": null
    },
    {
      "id": "posture_score",
      "title": "Security Posture",
      "description": "The organization's latest posture score, linking to the full posture dashboard.",
      "zone": "organization",
      "category": "posture",
      "scope": "organization",
      "requiresUserIdentity": false,
      "minEntitlement": "platform",
      "destination": "/posture",
      "legacyTileId": "posture_score"
    },
    {
      "id": "recent_findings",
      "title": "Recent Findings",
      "description": "The five most recent active findings across the organization.",
      "zone": "organization",
      "category": "findings",
      "scope": "organization",
      "requiresUserIdentity": false,
      "minEntitlement": "platform",
      "destination": "/findings?queue=all",
      "legacyTileId": null
    },
    {
      "id": "latest_brief",
      "title": "Latest Brief",
      "description": "The most recent Intelligence Brief for your organization.",
      "zone": "intelligence",
      "category": "intelligence",
      "scope": "organization",
      "requiresUserIdentity": false,
      "minEntitlement": "all",
      "destination": "/briefs",
      "legacyTileId": null
    }
  ],
  "legacy_tile_ids": [
    "posture_score",
    "risks_breakdown",
    "risk_heatmap",
    "posture_trend",
    "findings_donut",
    "domain_posture",
    "actions_ring",
    "open_items_aging",
    "vendor_risk",
    "framework_gaps",
    "compliance_coverage",
    "inventory_grid"
  ]
};
