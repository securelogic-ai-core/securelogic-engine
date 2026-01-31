import crypto from "node:crypto";
import type { NewsletterSignal } from "../types/NewsletterSignal.js";

/**
 * Fetch and normalize NVD CVE signals
 */
export async function fetchNvdSignals(): Promise<NewsletterSignal[]> {
  const res = await fetch(
    "https://services.nvd.nist.gov/rest/json/cves/2.0?resultsPerPage=2000"
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch NVD feed: ${res.status}`);
  }

  const data: any = await res.json();
  const vulnerabilities = Array.isArray(data?.vulnerabilities)
    ? data.vulnerabilities
    : [];

  return vulnerabilities
    .map((v: any): NewsletterSignal | null => {
      const cve = String(v?.cve?.id ?? "").trim();
      if (!cve) return null;

      const description =
        v?.cve?.descriptions?.find((d: any) => d.lang === "en")?.value ??
        "No description provided";

      const cvss =
        v?.cve?.metrics?.cvssMetricV31?.[0]?.cvssData ??
        v?.cve?.metrics?.cvssMetricV30?.[0]?.cvssData ??
        null;

      if (!cvss) return null;

      const severity = cvss.baseSeverity as
        | "Low"
        | "Medium"
        | "High"
        | "Critical";

      if (severity !== "High" && severity !== "Critical") {
        return null;
      }

      const id = crypto
        .createHash("sha256")
        .update(`NVD:${cve}`)
        .digest("hex");

      return {
        id,
        cve, // ✅ REQUIRED — fixes TS2741
        source: "NVD",
        title: `${cve} — ${v?.cve?.sourceIdentifier ?? "NVD Vulnerability"}`,
        summary: description,
        publishedAt: String(v?.cve?.published ?? ""),
        severity,
        tags: ["vulnerability"],
        url: `https://nvd.nist.gov/vuln/detail/${cve}`,
      };
    })
    .filter(Boolean) as NewsletterSignal[];
}