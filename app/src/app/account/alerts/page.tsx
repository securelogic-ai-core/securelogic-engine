import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getAlertPreferences, type AlertPreferences } from "@/lib/api";
import { AlertToggle } from "./AlertToggle";

const ALERT_FIELDS: Array<{
  field: keyof AlertPreferences;
  label: string;
  description: string;
}> = [
  {
    field: "critical_finding_immediate",
    label: "Critical finding — immediate",
    description: "Email immediately when a Critical severity finding is created.",
  },
  {
    field: "high_finding_immediate",
    label: "High finding — immediate",
    description: "Email immediately when a High severity finding is created.",
  },
  {
    field: "daily_digest",
    label: "Daily findings digest",
    description: "A morning summary of new findings from the past 24 hours.",
  },
  {
    field: "weekly_summary",
    label: "Weekly posture summary",
    description: "A Monday morning overview of your overall security posture, open findings, and framework readiness.",
  },
];

export default async function AlertPreferencesPage() {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const prefs = await getAlertPreferences(token);

  const defaults: AlertPreferences = {
    critical_finding_immediate: true,
    high_finding_immediate: true,
    daily_digest: true,
    weekly_summary: true,
  };

  const effective: AlertPreferences = {
    critical_finding_immediate: prefs?.critical_finding_immediate ?? defaults.critical_finding_immediate,
    high_finding_immediate: prefs?.high_finding_immediate ?? defaults.high_finding_immediate,
    daily_digest: prefs?.daily_digest ?? defaults.daily_digest,
    weekly_summary: prefs?.weekly_summary ?? defaults.weekly_summary,
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <div className="mb-8">
        <Link
          href="/account"
          className="text-xs font-medium text-slate-400 hover:text-slate-600 transition-colors mb-4 inline-block"
        >
          ← Account
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Alert Preferences</h1>
        <p className="text-slate-500 text-sm">
          Control which email alerts you receive. Changes take effect immediately.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
          Email Alerts
        </h2>
        <div>
          {ALERT_FIELDS.map((item, i) => (
            <AlertToggle
              key={item.field}
              field={item.field}
              label={item.label}
              description={item.description}
              initialValue={effective[item.field]}
            />
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-4">
          Alerts respect your organization&apos;s email suppression settings. Emails are sent to{" "}
          <span className="font-medium text-slate-600">{session.email ?? "your account email"}</span>.
        </p>
      </div>
    </div>
  );
}
