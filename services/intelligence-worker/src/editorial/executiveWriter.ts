function clean(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function sentenceCase(value: string): string {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function stripLeadIn(text: string): string {
  return clean(
    text
      .replace(/^the event reported in\s+/i, "")
      .replace(/^the development reported in\s+/i, "")
      .replace(/^this event\s+/i, "")
      .replace(/^this development\s+/i, "")
  );
}

function stripQuotedTitle(text: string, title: string): string {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`^"${escaped}"\\s*`, "i"),
    new RegExp(`^'${escaped}'\\s*`, "i"),
    new RegExp(`^${escaped}\\s*`, "i")
  ];

  let output = text;
  for (const pattern of patterns) {
    output = output.replace(pattern, "");
  }

  return clean(output.replace(/^(reflects|raises|signals|highlights)\s+/i, ""));
}

function normalizeAnalysis(item: any): string {
  const title = clean(item.title || "");
  const category = clean(item.category || "GENERAL").toUpperCase();
  const riskLevel = clean(item.riskLevel || item.risk_level || "low").toLowerCase();
  const raw = clean(item.analysis || item.summary || "");
  const titleLower = title.toLowerCase();

  if (category === "SECURITY_INCIDENT") {
    if (
      titleLower.includes("mobile") ||
      titleLower.includes("ios") ||
      titleLower.includes("android") ||
      titleLower.includes("app")
    ) {
      return "Malicious mobile applications targeting user devices, increasing risk of data theft, credential compromise, or asset loss.";
    }

    if (
      titleLower.includes("wallet") ||
      titleLower.includes("crypto") ||
      titleLower.includes("recovery phrase") ||
      titleLower.includes("seed phrase")
    ) {
      return "Targeted theft activity focused on high-value recovery data and digital assets.";
    }

    if (
      titleLower.includes("phishing") ||
      titleLower.includes("credential")
    ) {
      return "Credential-focused attack activity targeting enterprise users and authentication flows.";
    }

    if (
      titleLower.includes("ransomware") ||
      titleLower.includes("malware") ||
      titleLower.includes("trojan") ||
      titleLower.includes("backdoor")
    ) {
      return "Active malicious activity with potential impact to endpoints, user accounts, and operations.";
    }

    if (riskLevel === "high" || riskLevel === "critical") {
      return "Active threat activity with potential impact to enterprise systems, users, or sensitive data.";
    }
  }

  if (category === "AI_GOVERNANCE") {
    return "Emerging AI capability introducing governance, oversight, and usage control considerations.";
  }

  if (category === "REGULATION") {
    return "Regulatory development introducing new expectations for governance, documentation, and accountability.";
  }

  if (!raw) {
    return "Relevant development requiring evaluation for enterprise impact.";
  }

  const withoutLeadIn = stripLeadIn(raw);
  const withoutTitle = stripQuotedTitle(withoutLeadIn, title);
  const firstSentence = withoutTitle.split(/(?<=[.?!])\s+/)[0] || withoutTitle;

  return sentenceCase(firstSentence);
}

function normalizeWhyItMatters(item: any): string {
  const explicit = clean(
    item.whyItMatters ||
    item.executiveImpact ||
    item.riskImplication ||
    item.risk_implication ||
    ""
  );

  if (explicit) return explicit;

  const category = clean(item.category || "GENERAL").toUpperCase();

  if (category === "SECURITY_INCIDENT") {
    return "May create near-term exposure requiring validation of impact, control coverage, and response readiness.";
  }

  if (category === "AI_GOVERNANCE") {
    return "May create governance, policy, and oversight gaps as adoption expands.";
  }

  if (category === "REGULATION") {
    return "May create new compliance, documentation, or assurance obligations.";
  }

  return "Requires review for relevance to enterprise risk posture.";
}

function normalizeRecommendedAction(item: any): string {
  const explicit = clean(
    item.recommendedAction ||
    item.recommendation ||
    ""
  );

  if (explicit) return explicit;

  const category = clean(item.category || "GENERAL").toUpperCase();

  if (category === "SECURITY_INCIDENT") {
    return "Validate exposure, confirm control effectiveness, and prepare response actions where necessary.";
  }

  if (category === "AI_GOVERNANCE") {
    return "Review governance controls, approval workflows, and acceptable use expectations.";
  }

  if (category === "REGULATION") {
    return "Assess policy, documentation, and compliance alignment against the new requirement.";
  }

  return "Evaluate relevance and assign ownership if follow-up is required.";
}

function calculatePriority(item: any): number {
  let score = 0;
  const risk = clean(item.riskLevel || item.risk_level || "").toLowerCase();
  const title = clean(item.title || "").toLowerCase();
  const category = clean(item.category || "GENERAL").toUpperCase();

  if (risk === "critical") score += 60;
  else if (risk === "high") score += 45;
  else if (risk === "medium") score += 25;
  else score += 10;

  if (
    title.includes("active") ||
    title.includes("actively exploited") ||
    title.includes("exploit") ||
    title.includes("breach")
  ) {
    score += 20;
  }

  if (
    title.includes("credential") ||
    title.includes("wallet") ||
    title.includes("recovery phrase") ||
    title.includes("seed phrase") ||
    title.includes("data")
  ) {
    score += 15;
  }

  if (
    title.includes("ios") ||
    title.includes("android") ||
    title.includes("mobile") ||
    title.includes("app")
  ) {
    score += 10;
  }

  if (category === "REGULATION" || category === "AI_GOVERNANCE") {
    score -= 5;
  }

  return Math.max(0, Math.min(100, score));
}

function priorityTier(score: number): string {
  if (score >= 70) return "IMMEDIATE";
  if (score >= 40) return "NEAR-TERM";
  return "MONITOR";
}

function directive(category: string, score: number): string {
  if (category === "SECURITY_INCIDENT" && score >= 70) {
    return "Validate exposure and initiate response readiness immediately.";
  }

  if (category === "SECURITY_INCIDENT" && score >= 40) {
    return "Assess exposure and confirm defensive coverage in the near term.";
  }

  if (category === "REGULATION") {
    return "Review compliance alignment and ownership.";
  }

  if (category === "AI_GOVERNANCE") {
    return "Validate governance controls before expansion.";
  }

  return "Evaluate relevance and assign follow-up if needed.";
}

function rewriteItem(item: any): any {
  const category = clean(item.category || "GENERAL").toUpperCase();
  const riskLevel = clean(item.riskLevel || item.risk_level || "low").toLowerCase();
  const priorityScore = calculatePriority({ ...item, category, riskLevel });

  const analysis = normalizeAnalysis({ ...item, category, riskLevel });
  const whyItMatters = normalizeWhyItMatters({ ...item, category, riskLevel });
  const recommendedAction = normalizeRecommendedAction({ ...item, category, riskLevel });

  return {
    ...item,
    category,
    riskLevel,
    risk_level: riskLevel,
    analysis,
    whyItMatters,
    executiveImpact: whyItMatters,
    riskImplication: whyItMatters,
    risk_implication: whyItMatters,
    recommendedAction,
    recommendation: recommendedAction,
    priorityScore,
    priorityTier: priorityTier(priorityScore),
    directive: directive(category, priorityScore)
  };
}

function processSection(items: any[]) {
  if (!Array.isArray(items)) return [];
  return items.map(rewriteItem);
}

function executiveSummary(allItems: any[]): string {
  const immediate = allItems.filter((i) => i.priorityTier === "IMMEDIATE").length;
  const nearTerm = allItems.filter((i) => i.priorityTier === "NEAR-TERM").length;

  if (immediate > 0) {
    return "Immediate action is warranted on the highest-priority development in this cycle, with additional items requiring near-term review.";
  }

  if (nearTerm > 0) {
    return "Priority-ranked intelligence requiring near-term review across security and governance domains.";
  }

  return "Current developments warrant monitoring across security, governance, and compliance domains.";
}

export function applyExecutiveEditorialPass(issue: any) {
  const sections = issue.sections || {};

  const updatedSections = {
    aiGovernance: processSection(sections.aiGovernance),
    securityIncidents: processSection(sections.securityIncidents),
    regulations: processSection(sections.regulations),
    vendorRisk: processSection(sections.vendorRisk),
    compliance: processSection(sections.compliance),
    general: processSection(sections.general)
  };

  const all = Object.values(updatedSections)
    .flat()
    .sort((a: any, b: any) => (b.priorityScore || 0) - (a.priorityScore || 0));

  return {
    ...issue,
    sections: updatedSections,
    topSignals: all.slice(0, 3),
    executiveSummary: executiveSummary(all)
  };
}