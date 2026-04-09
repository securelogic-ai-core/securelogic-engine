import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { getIssue } from "@/lib/api";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function BriefDetailPage({ params }: Props) {
  const { id } = await params;
  const session = await getSession();

  if (!session.apiKey) {
    redirect("/login");
  }

  const issue = await getIssue(session.apiKey, id);

  if (!issue) {
    notFound();
  }

  const date = issue.publish_date
    ? new Date(issue.publish_date).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : new Date(issue.created_at).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      {/* Breadcrumb */}
      <div className="mb-8">
        <Link
          href="/briefs"
          className="text-slate-500 hover:text-slate-700 text-sm transition-colors"
        >
          ← Briefs
        </Link>
      </div>

      {/* Header */}
      <div className="mb-8">
        <p className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-3">
          {date}
        </p>
        <h1 className="text-3xl font-bold text-slate-900 leading-tight mb-4">
          {issue.title}
        </h1>
        {issue.summary && (
          <p className="text-slate-600 text-lg leading-relaxed">{issue.summary}</p>
        )}
      </div>

      {/* Content or locked state */}
      {issue.locked ? (
        <LockedContent />
      ) : issue.content_html ? (
        <div
          className="prose prose-slate max-w-none"
          dangerouslySetInnerHTML={{ __html: issue.content_html }}
        />
      ) : (
        <div className="text-slate-500 text-sm">
          Content is not available for this issue.
        </div>
      )}
    </div>
  );
}

function LockedContent() {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-10 text-center">
      <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="w-5 h-5 text-slate-500"
        >
          <path
            fillRule="evenodd"
            d="M12 1.5a5.25 5.25 0 0 0-5.25 5.25v3a3 3 0 0 0-3 3v6.75a3 3 0 0 0 3 3h10.5a3 3 0 0 0 3-3v-6.75a3 3 0 0 0-3-3v-3c0-2.9-2.35-5.25-5.25-5.25Zm3.75 8.25v-3a3.75 3.75 0 1 0-7.5 0v3h7.5Z"
            clipRule="evenodd"
          />
        </svg>
      </div>

      <h2 className="text-lg font-bold text-slate-900 mb-2">
        This brief requires a subscription
      </h2>
      <p className="text-slate-600 text-sm mb-6 max-w-sm mx-auto">
        Subscribe to read the full brief — all sections, risk-scored findings,
        and recommended actions.
      </p>

      <div className="flex items-center justify-center gap-3 flex-wrap">
        <form action="/api/billing/checkout" method="POST">
          <input type="hidden" name="tier" value="professional" />
          <button
            type="submit"
            className="bg-teal-600 hover:bg-teal-500 text-white font-semibold px-6 py-2.5 rounded-lg transition-colors text-sm"
          >
            Professional — $39/mo
          </button>
        </form>
        <form action="/api/billing/checkout" method="POST">
          <input type="hidden" name="tier" value="team" />
          <button
            type="submit"
            className="border border-slate-300 text-slate-700 hover:border-slate-400 font-semibold px-6 py-2.5 rounded-lg transition-colors text-sm"
          >
            Team — $209/mo
          </button>
        </form>
      </div>

      <p className="mt-4 text-xs text-slate-400">
        Cancel any time.
      </p>
    </div>
  );
}
