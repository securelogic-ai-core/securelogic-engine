import type { Metadata } from "next";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { MarkdownPage } from "@/components/MarkdownPage";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Terms of Service for SecureLogic AI — the legal agreement between Threat Loom, LLC d/b/a SecureLogic AI and customers of the platform.",
};

export default function TermsPage() {
  const filePath = path.join(process.cwd(), "src/content/legal/terms.md");
  const raw = fs.readFileSync(filePath, "utf8");
  const { content, data } = matter(raw);

  return (
    <MarkdownPage
      title="Terms of Service"
      eyebrow="Legal"
      content={content}
      effectiveDate={data.effectiveDate}
      lastUpdated={data.lastUpdated}
    />
  );
}
