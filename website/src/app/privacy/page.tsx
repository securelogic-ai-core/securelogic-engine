import type { Metadata } from "next";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { MarkdownPage } from "@/components/MarkdownPage";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Privacy Policy for SecureLogic AI — how Threat Loom, LLC d/b/a SecureLogic AI collects, uses, discloses, and protects personal information.",
};

export default function PrivacyPage() {
  const filePath = path.join(process.cwd(), "src/content/legal/privacy.md");
  const raw = fs.readFileSync(filePath, "utf8");
  const { content, data } = matter(raw);

  return (
    <MarkdownPage
      title="Privacy Policy"
      eyebrow="Legal"
      content={content}
      effectiveDate={data.effectiveDate}
      lastUpdated={data.lastUpdated}
    />
  );
}
