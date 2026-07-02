import type { Metadata } from "next";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { MarkdownPage } from "@/components/MarkdownPage";
import { LEGAL_EFFECTIVE_DATE, LEGAL_LAST_UPDATED } from "@/lib/legal";

export const metadata: Metadata = {
  title: "AI Transparency & Responsible Use Policy",
  description:
    "AI Transparency and Responsible Use Policy for SecureLogic AI — how we use artificial intelligence, the principles that guide our use, and customer rights regarding AI features.",
};

export default function AiPolicyPage() {
  const filePath = path.join(process.cwd(), "src/content/legal/ai-policy.md");
  const raw = fs.readFileSync(filePath, "utf8");
  const { content } = matter(raw);

  return (
    <MarkdownPage
      title="AI Transparency & Responsible Use Policy"
      eyebrow="Legal"
      content={content}
      effectiveDate={LEGAL_EFFECTIVE_DATE}
      lastUpdated={LEGAL_LAST_UPDATED}
    />
  );
}
