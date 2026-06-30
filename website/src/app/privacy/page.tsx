import type { Metadata } from "next";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { MarkdownPage } from "@/components/MarkdownPage";
import { LEGAL_EFFECTIVE_DATE, LEGAL_LAST_UPDATED } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Privacy Policy for SecureLogic AI — how Threat Loom, LLC d/b/a SecureLogic AI collects, uses, discloses, and protects personal information.",
};

export default function PrivacyPage() {
  const filePath = path.join(process.cwd(), "src/content/legal/privacy.md");
  const raw = fs.readFileSync(filePath, "utf8");
  const { content } = matter(raw);

  return (
    <MarkdownPage
      title="Privacy Policy"
      eyebrow="Legal"
      content={content}
      effectiveDate={LEGAL_EFFECTIVE_DATE}
      lastUpdated={LEGAL_LAST_UPDATED}
    />
  );
}
