import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import {
  getIndustryTemplate,
  type IndustryTemplateId,
  type IndustryTemplateDetail,
} from "@/lib/api";
import { TemplatePreview } from "./TemplatePreview";

const VALID_IDS: IndustryTemplateId[] = ["healthcare-saas", "fintech", "b2b-ai"];

export default async function TemplatePreviewPage({
  params,
}: {
  params: Promise<{ industry: string }>;
}) {
  const { industry } = await params;
  if (!(VALID_IDS as string[]).includes(industry)) notFound();
  const industryId = industry as IndustryTemplateId;

  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const template: IndustryTemplateDetail | null = await getIndustryTemplate(token, industryId);
  if (!template) notFound();

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <div className="mb-6">
        <Link href="/templates" style={{ color: "#60a5fa", fontSize: 13, textDecoration: "none" }}>
          ← All templates
        </Link>
        <h1 className="text-2xl font-bold mt-2" style={{ color: "#f1f5f9" }}>
          {template.name}
        </h1>
        <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
          {template.description}
        </p>
        <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#64748b", marginTop: 8 }}>
          <span>v{template.version}</span>
          <span>Last reviewed {template.last_reviewed_at}</span>
        </div>
      </div>

      <TemplatePreview template={template} />
    </div>
  );
}
