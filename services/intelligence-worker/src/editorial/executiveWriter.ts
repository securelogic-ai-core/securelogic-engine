function clean(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function sentenceCase(value: string): string {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function removeQuotedTitle(text: string, title: string): string {
  const t = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^"?${t}"?\\s*(reflects|signals|raises)?\\s*`, "i");
  return text.replace(regex, "").trim();
}

function stripAiTone(text: string): string {
  return clean(
    text
      .replace(/^the event reported in\s+/i, "")
      .replace(/^the development reported in\s+/i, "")
      .replace(/\bhighlights\b/gi, "signals")
      .replace(/\bmay increase\b/gi, "raises")
      .replace(/\bshould assess\b/gi, "should evaluate")
  );
}

/**
 * SIGNAL-SPECIFIC ANALYSIS
 */
function compressAnalysis(title: string, analysis: string, category: string): string {
  let text = stripAiTone(clean(analysis));
  text = removeQuotedTitle(text, title);

  const t = title.toLowerCase();

  if (category === "SECURITY_INCIDENT") {
    if (t.includes("mobile") || t.includes("ios") || t.includes("android")) {
      return "Malicious mobile applications targeting user devices, increasing risk of data exfiltration and credential or asset compromise.";
    }
    if (t.includes("wallet") || t.includes("crypto")) {
      return "Targeted theft of high-value digital assets through compromise of user-controlled recovery data.";
    }
    if (t.includes("phishing") || t.includes("credential")) {
      return "Credential-focused attack activity targeting enterprise users and authentication flows.";
    }
    return "Active threat activity with potential impact to enterprise systems and user accounts.";
  }

  if (category === "AI_GOVERNANCE") {
    return "Emerging AI capability introducing governance, oversight, and usage control considerations.";
  }

  if (category === "REGULATION") {
    return "Regulatory development introducing new expectations for governance, documentation, and accountability.";
  }

  if (text.length > 180) {
    text = text.split(". ")[0] + ".";
  }

  return sentenceCase(text || "Relevant development requiring evaluation for enterprise impact.");
}

/**
 * PRIORITY ENGINE (THIS IS THE PRODUCT)
 */
function calculatePriority(item: any): number {
  let score = 0;

  const risk = (item.riskLevel || item.risk_level || "").toLowerCase();
  const title = (item.title || "").toLowerCase();

  if (risk === "critical") score += 60;
  else if (risk === "high") score += 45;
  else if (risk === "medium") score += 25;

  if (title.includes("active") || title.includes("exploit") || title.includes("malware")) {
    score += 20;
  }

  if (title.includes("data") || title.includes("credential") || title.includes("wallet")) {
    score += 15;
  }

  if (item.category === "REGULATION" || item.category === "AI_GOVERNANCE") {
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

  if (category === "SECURITY_INCIDENT") {
    return "Assess exposure and confirm control effectiveness.";
  }

  if (category === "REGULATION") {
    return "Review alignment with current compliance posture.";
  }

  if (category === "AI_GOVERNANCE") {
    return "Validate governance coverage before adoption or expansion.";
  }

  return "Evaluate relevance to current risk posture.";
}

/**
 * FULL ITEM REWRITE
 */
function rewriteItem(item: any): any {
  const title = clean(item.title);
  const category = clean(item.category || "GENERAL");
  const riskLevel = clean(item.riskLevel || item.risk_level || "low").toLowerCase();

  const analysis = compressAnalysis(
    title,
    clean(item.analysis || item.summary || ""),
    category
  );

  const priorityScore = calculatePriority({ ...item, title, category, riskLevel });
  const tier = priorityTier(priorityScore);

  return {
    ...item,
    title,
    category,
    riskLevel,
    risk_level: riskLevel,
    analysis,

    priorityScore,
    priorityTier: tier,
    directive: directive(category, priorityScore),

    whyItMatters: clean(item.whyItMatters || ""),
    recommendedAction: clean(item.recommendedAction || "")
  };
}

function executiveHeadline(items: any[]): string {
  const immediate = items.filter(i => i.priorityTier === "IMMEDIATE").length;

  if (immediate > 0) {
    return "Immediate action required on high-priority security activity.";
  }

  return "Key developments require near-term review across security and governance domains.";
}

export function applyExecutiveEditorialPass(issue: any) {
  const sections = issue.sections || {};

  const rewritten = [
    ...(sections.securityIncidents || []).map(rewriteItem),
    ...(sections.aiGovernance || []).map(rewriteItem),
    ...(sections.regulations || []).map(rewriteItem),
    ...(sections.vendorRisk || []).map(rewriteItem),
    ...(sections.compliance || []).map(rewriteItem),
    ...(sections.general || []).map(rewriteItem)
  ];

  // SORT BY PRIORITY (CRITICAL)
  const sorted = [...rewritten].sort((a, b) => b.priorityScore - a.priorityScore);

  return {
    ...issue,

    executiveSummary: executiveHeadline(sorted),

    // TOP SIGNALS NOW ACTUALLY MEAN SOMETHING
    topSignals: sorted.slice(0, 3),

    sections: {
      securityIncidents: sorted.filter(i => i.category === "SECURITY_INCIDENT"),
      aiGovernance: sorted.filter(i => i.category === "AI_GOVERNANCE"),
      regulations: sorted.filter(i => i.category === "REGULATION"),
      vendorRisk: sorted.filter(i => i.category === "VENDOR_RISK"),
      compliance: sorted.filter(i => i.category === "COMPLIANCE_UPDATE"),
      general: sorted.filter(i => i.category === "GENERAL")
    }
  };
}
