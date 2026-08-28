/**
 * Shared lifecycle vocabulary for the pen-test pages (T2-I).
 *
 * These mirror — never extend — the engine's closed vocabularies
 * (penTestEngagements.ts ENGAGEMENT_STATUSES / TEST_TYPES / RETEST_RESULTS).
 * The engine is the authority; the app only puts human labels on its words.
 */
import type { CSSProperties } from "react";
import type {
  PenTestEngagementStatus,
  PenTestTestType,
  PenTestRetestResult,
} from "@/lib/api";

export const ENGAGEMENT_STATUS_LABELS: Record<PenTestEngagementStatus, string> = {
  planned: "Planned",
  testing: "Testing",
  report_received: "Report Received",
  remediation: "Remediation",
  closed: "Closed",
};

/** The five statuses in lifecycle order — the order the select offers them.
 *  Transitions are FREE (the engine ruling): any value may follow any other,
 *  so this is presentation order, not a state machine. */
export const ENGAGEMENT_STATUSES: PenTestEngagementStatus[] = [
  "planned",
  "testing",
  "report_received",
  "remediation",
  "closed",
];

export const ENGAGEMENT_STATUS_STYLES: Record<PenTestEngagementStatus, CSSProperties> = {
  planned:         { background: "rgba(148,163,184,0.15)", color: "#94a3b8" },
  testing:         { background: "rgba(59,130,246,0.15)",  color: "#93c5fd" },
  report_received: { background: "rgba(245,158,11,0.15)",  color: "#fcd34d" },
  remediation:     { background: "rgba(249,115,22,0.15)",  color: "#fdba74" },
  closed:          { background: "rgba(34,197,94,0.12)",   color: "#86efac" },
};

export const TEST_TYPE_LABELS: Record<PenTestTestType, string> = {
  network:            "Network",
  web_application:    "Web Application",
  mobile_application: "Mobile Application",
  api:                "API",
  cloud:              "Cloud",
  social_engineering: "Social Engineering",
  physical:           "Physical",
  red_team:           "Red Team",
  other:              "Other",
};

export const RETEST_RESULT_LABELS: Record<PenTestRetestResult, string> = {
  remediated: "Remediated",
  not_remediated: "Not Remediated",
  partially_remediated: "Partially Remediated",
};

export const RETEST_RESULT_STYLES: Record<PenTestRetestResult, CSSProperties> = {
  remediated:           { background: "rgba(34,197,94,0.12)",  color: "#86efac" },
  not_remediated:       { background: "rgba(239,68,68,0.12)",  color: "#fca5a5" },
  partially_remediated: { background: "rgba(245,158,11,0.15)", color: "#fcd34d" },
};
