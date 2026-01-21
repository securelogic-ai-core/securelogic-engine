import type { ControlDefinition } from "../contracts/ControlDefinition.js";

import { governanceControls } from "./controls/governance.js";
import { MonitoringControls } from "./controls/monitoring.js";
import { DataQualityControls } from "./controls/dataQuality.js";
import { ModelDevelopmentControls } from "./controls/modelDevelopment.js";
import { BusinessContinuityControls } from "./controls/businessContinuity.js";

/**
 * Canonical framework grouping
 */
export const byFramework: Record<string, ControlDefinition[]> = {
  "AI-Governance": [
    ...Object.values(governanceControls)
  ],
  "NIST-AI-RMF": [
    ...Object.values(MonitoringControls),
    ...Object.values(DataQualityControls),
    ...Object.values(ModelDevelopmentControls),
    ...Object.values(BusinessContinuityControls)
  ]
};

/**
 * Legacy flat map (DO NOT BREAK)
 */
export const controls: Record<string, ControlDefinition> = {
  ...governanceControls,
  ...MonitoringControls,
  ...DataQualityControls,
  ...ModelDevelopmentControls,
  ...BusinessContinuityControls
};

/**
 * Flat list
 */
export const list: ControlDefinition[] = Object.values(controls);

export const ControlRegistry = {
  controls,
  list,
  byFramework
};