import crypto from "node:crypto";
import type { NewsletterSignal } from "../types/NewsletterSignal.js";

/**
 * Fetch and normalize CISA Known Exploited Vulnerabilities (KEV)
 */
export async function fetchCisaKevSignals(): Promise<NewsletterSignal[]> {
  const res = await fetch(
    "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch CISA KEV feed: ${res.status}`);
  }

  const data: any = await res.json();

  const vulnerabilities = Array.isArray(data?.vulnerabilities)
    ? data.vulnerabilities
    : [];

  return vulnerabilities.map((v: any): NewsletterSignal => {
    const cve = String(v?.cveID ?? "").trim();
    const name = String(v?.vulnerabilityName ?? "").trim();

    const id = crypto
      .createHash("sha256")
      .update(`CISA_KEV:${cve}`)
      .digest("hex");

    return {
      id,
      cve, // ✅ canonical deduplication key
      source: "CISA_KEV",
      title: `${cve} — ${name}`.trim(),
      summary: String(v?.shortDescription ?? "").trim(),
      publishedAt: String(v?.dateAdded ?? "").trim(),
      severity: "High",
      tags: ["exploited", "vulnerability"],
      url: `https://www.cisa.gov/known-exploited-vulnerabilities-catalog`,
    };
  });
}