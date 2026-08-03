/**
 * executiveNarrative.ts — the deterministic Executive Summary for the
 * executive PDF (EG2 Tier 2 slice 13, Executive Awareness).
 *
 * The report assembled every fact a board asks about and then presented them
 * as tables — "what", never "so what". This composer turns the SAME assembled
 * data into decision-grade prose, deliberately WITHOUT an LLM: every sentence
 * is derived from a named figure in the report body, so the narrative is
 * reproducible, audit-defensible, and can never contradict the tables below
 * it. (FINAL_PRODUCT_STANDARD "no generic language": every sentence carries a
 * number, a direction, or a named object — no "may affect posture".)
 *
 * Pure function over the report's data shape; unit-tested without a database.
 */

type NarrativeInput = {
  org_name: string;
  posture: { overall_score: number | null; overall_severity: string | null; snapshot_date: string | null } | null;
  posture_prior: { overall_score: number | null; snapshot_date: string | null } | null;
  period: {
    days: number;
    findings_closed: number;
    findings_risk_accepted: number;
    findings_remediated: number;
    findings_new: number;
    risk_approvals: number;
  };
  open_actions_count: number;
  risks_by_rating: Array<{ rating: string; count: number }>;
  findings_by_severity: Array<{ severity: string; count: number }>;
  frameworks: Array<{ name: string; total: number; satisfied: number; unmapped: number }>;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "an unknown date";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function severityCount(rows: NarrativeInput["findings_by_severity"], sev: string): number {
  return rows.find((r) => r.severity === sev)?.count ?? 0;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Ordered paragraphs. Empty inputs produce honest sentences, never filler. */
export function buildExecutiveNarrative(data: NarrativeInput): string[] {
  const paragraphs: string[] = [];

  // 1. Posture position + direction.
  if (data.posture?.overall_score != null) {
    let sentence = `As of ${fmtDate(data.posture.snapshot_date)}, ${data.org_name}'s security posture scores ${data.posture.overall_score} of 100 (${data.posture.overall_severity ?? "unrated"}).`;
    if (data.posture_prior?.overall_score != null) {
      const delta = data.posture.overall_score - data.posture_prior.overall_score;
      sentence +=
        delta === 0
          ? ` The score is unchanged from ${fmtDate(data.posture_prior.snapshot_date)}.`
          : ` That is ${delta > 0 ? "up" : "down"} ${Math.abs(delta)} points from ${data.posture_prior.overall_score} on ${fmtDate(data.posture_prior.snapshot_date)}.`;
    } else {
      sentence += " No prior snapshot exists for comparison; this report establishes the baseline.";
    }
    paragraphs.push(sentence);
  } else {
    paragraphs.push(
      `${data.org_name} has no posture snapshot yet; scores in this report will populate after the first assessment cycle.`
    );
  }

  // 2. Current exposure: severe findings + the highest open residual band.
  const critical = severityCount(data.findings_by_severity, "Critical");
  const high = severityCount(data.findings_by_severity, "High");
  const topRisk = data.risks_by_rating.find((r) => r.count > 0) ?? null;
  const exposureParts: string[] = [];
  exposureParts.push(
    critical + high > 0
      ? `${plural(critical, "Critical finding")} and ${plural(high, "High finding")} are active.`
      : "No Critical or High findings are active."
  );
  if (topRisk) {
    exposureParts.push(
      `The highest open residual risk band is ${topRisk.rating}, with ${plural(topRisk.count, "risk")} on the register.`
    );
  }
  paragraphs.push(exposureParts.join(" "));

  // 3. Execution — the period decision record (sourced from the immutable
  // lifecycle streams the report already prints).
  const p = data.period;
  paragraphs.push(
    `In the last ${p.days} days the organization closed ${plural(p.findings_closed, "finding")}, ` +
      `completed remediation on ${p.findings_remediated}, formally accepted ${plural(p.findings_risk_accepted, "risk")}, ` +
      `and recorded ${plural(p.findings_new, "new finding")}. ` +
      `${plural(data.open_actions_count, "remediation action")} remain${data.open_actions_count === 1 ? "s" : ""} open.`
  );

  // 4. Compliance position: best coverage + largest gap, by name.
  const withReqs = data.frameworks.filter((f) => f.total > 0);
  if (withReqs.length > 0) {
    const pct = (f: (typeof withReqs)[number]) => Math.round((f.satisfied / f.total) * 100);
    const best = [...withReqs].sort((a, b) => pct(b) - pct(a))[0]!;
    const widestGap = [...withReqs].sort((a, b) => b.unmapped - a.unmapped)[0]!;
    let sentence = `Framework coverage is strongest on ${best.name} at ${pct(best)}% of requirements satisfied.`;
    if (widestGap.unmapped > 0) {
      sentence += ` ${widestGap.name} carries the largest gap, with ${plural(widestGap.unmapped, "requirement")} not yet mapped to any control.`;
    }
    paragraphs.push(sentence);
  } else {
    paragraphs.push("No compliance frameworks are activated; framework readiness is not yet measured.");
  }

  // 5. Leadership focus — one derived, concrete ask. Priority: Critical
  // findings → top residual band → the widest framework gap → sustain.
  if (critical > 0) {
    paragraphs.push(
      `Leadership focus: the ${plural(critical, "Critical finding")} above carry the report's nearest-term exposure; remediation ownership and dates for each appear in the findings section.`
    );
  } else if (topRisk && (topRisk.rating === "Critical" || topRisk.rating === "High")) {
    paragraphs.push(
      `Leadership focus: ${plural(topRisk.count, `${topRisk.rating} residual risk`)} on the register await treatment decisions; the register section lists each with its current treatment state.`
    );
  } else if (withReqs.some((f) => f.unmapped > 0)) {
    const widest = [...withReqs].sort((a, b) => b.unmapped - a.unmapped)[0]!;
    paragraphs.push(
      `Leadership focus: closing the ${widest.name} mapping gap (${plural(widest.unmapped, "unmapped requirement")}) is the largest available compliance gain.`
    );
  } else {
    paragraphs.push(
      "Leadership focus: no Critical exposure is open; sustaining remediation velocity and review cadence is the period's objective."
    );
  }

  return paragraphs;
}
