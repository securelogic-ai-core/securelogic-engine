export type NewsletterSignal = {
  id: string;
  cve: string; // 🔑 canonical dedupe key
  source: "CISA_KEV" | "NVD" | "OTHER";
  title: string;
  summary: string;
  publishedAt: string;
  severity: "Low" | "Medium" | "High" | "Critical";
  tags: string[];
  url?: string;
};