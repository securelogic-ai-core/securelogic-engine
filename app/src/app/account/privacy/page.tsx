import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getDataExports } from "@/lib/api";
import { DataExportPanel } from "./DataExportPanel";

export const revalidate = 0;

/**
 * Privacy & Your Data — a peer of the other /account sub-surfaces.
 *
 * The only capability here today is the GDPR/CCPA self-export (user_self scope).
 * Data-subject access & portability rights are not tier-gated, so there is no
 * entitlement check — but they ARE identity-gated: the export endpoints require
 * a JWT (email/password) session. A legacy API-key session can't be tied to a
 * single human, so we hide the export surface and show a sign-in explainer
 * instead (decision B).
 */
export default async function PrivacyPage() {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) {
    redirect("/login");
  }

  const isJwtSession = Boolean(session.jwtToken);
  const initial = isJwtSession ? await getDataExports(session.jwtToken!) : null;

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <div className="mb-8">
        <Link
          href="/account"
          className="text-xs font-medium text-slate-400 hover:text-slate-600 transition-colors mb-4 inline-block"
        >
          ← Account
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Privacy &amp; Your Data</h1>
        <p className="text-slate-500 text-sm">
          Download a copy of the personal data we hold about you, in line with your
          GDPR access &amp; portability rights and CCPA.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">
          Export Your Data
        </h2>

        {isJwtSession ? (
          <DataExportPanel initialExports={initial?.exports ?? []} />
        ) : (
          <div>
            <p className="text-sm text-slate-600">
              Data exports are tied to your personal account. To export your data,
              sign in with your email and password.
            </p>
            <p className="text-xs text-slate-400 mt-3">
              You&apos;re currently using a legacy API-key session, which isn&apos;t
              linked to an individual user.
            </p>
            <Link
              href="/login"
              className="inline-block mt-4 text-sm font-medium text-teal-600 hover:text-teal-700 transition-colors"
            >
              Sign in with email &amp; password →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
