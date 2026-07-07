/**
 * connectors.test.ts — pure helpers behind /assets/connect (EAR P13). Mirrors
 * the engine's GET /api/connectors projection; grouping + status must be stable
 * for the catalog render, and the failure classifier must match the double-fence
 * (disabled / capability / error).
 */

import { describe, it, expect } from "vitest";
import {
  groupConnectorsByCategory,
  connectorCategoryLabel,
  connectorStatusLabel,
  connectorsReadFailure,
  CONNECTOR_CATEGORY_ORDER,
  type OrgConnector,
} from "../connectors";

function conn(partial: Partial<OrgConnector> & Pick<OrgConnector, "connector_id" | "display_name" | "category">): OrgConnector {
  return {
    adapter_status: "reference",
    configured: false,
    enabled: false,
    last_sync_at: null,
    last_sync_status: null,
    sync_interval_minutes: null,
    next_sync_at: null,
    consecutive_failures: 0,
    config_fields: [],
    config_keys: [],
    ...partial,
  };
}

describe("groupConnectorsByCategory", () => {
  it("groups by category in the stable known order, connectors sorted by name", () => {
    const groups = groupConnectorsByCategory([
      conn({ connector_id: "wiz", display_name: "Wiz", category: "cloud" }),
      conn({ connector_id: "servicenow_cmdb", display_name: "ServiceNow CMDB", category: "cmdb" }),
      conn({ connector_id: "aws", display_name: "AWS", category: "cloud" }),
      conn({ connector_id: "tenable", display_name: "Tenable", category: "vulnerability" }),
    ]);
    // cmdb before cloud before vulnerability (CONNECTOR_CATEGORY_ORDER)
    expect(groups.map((g) => g.category)).toEqual(["cmdb", "cloud", "vulnerability"]);
    // within cloud: AWS before Wiz (alpha)
    const cloud = groups.find((g) => g.category === "cloud")!;
    expect(cloud.connectors.map((c) => c.display_name)).toEqual(["AWS", "Wiz"]);
  });

  it("appends unknown categories alphabetically after the known ones", () => {
    const groups = groupConnectorsByCategory([
      conn({ connector_id: "x", display_name: "X", category: "zeta" }),
      conn({ connector_id: "s", display_name: "S", category: "cmdb" }),
      conn({ connector_id: "a", display_name: "A", category: "alpha" }),
    ]);
    expect(groups.map((g) => g.category)).toEqual(["cmdb", "alpha", "zeta"]);
  });

  it("every known category has a human label", () => {
    for (const cat of CONNECTOR_CATEGORY_ORDER) {
      expect(connectorCategoryLabel(cat)).not.toBe(cat);
      expect(connectorCategoryLabel(cat).length).toBeGreaterThan(0);
    }
    expect(connectorCategoryLabel("mystery")).toBe("mystery"); // unknown passes through
  });
});

describe("connectorStatusLabel (never 'coming soon' — backend exists)", () => {
  it("enabled → Connected; configured-not-enabled → Configured; else Not connected", () => {
    expect(connectorStatusLabel({ configured: true, enabled: true })).toEqual({ text: "Connected", tone: "active" });
    expect(connectorStatusLabel({ configured: true, enabled: false })).toEqual({ text: "Configured", tone: "configured" });
    expect(connectorStatusLabel({ configured: false, enabled: false })).toEqual({ text: "Not connected", tone: "idle" });
  });
});

describe("connectorsReadFailure", () => {
  it("classifies the double-fence: disabled / capability / error", () => {
    expect(connectorsReadFailure({ disabled: true, error: "http_404" }).kind).toBe("disabled");
    expect(connectorsReadFailure({ disabled: false, error: "capability_required" }).kind).toBe("capability");
    expect(connectorsReadFailure({ disabled: false, error: "network_error" }).kind).toBe("error");
  });
});
