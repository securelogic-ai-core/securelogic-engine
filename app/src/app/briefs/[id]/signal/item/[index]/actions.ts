"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { engineBaseUrl } from "@/lib/engineBaseUrl";

const ENGINE_URL = engineBaseUrl();

/**
 * Promote the signal behind a Brief item into a canonical Finding, then take the
 * reader straight into its Decision Workspace.
 *
 * This is the first hop of Brief → Finding → Decision → Remediation, and until now it
 * did not exist: findings from intelligence were only ever minted by the ingestion
 * worker, and only for signals matching an entity already in the org's registry.
 *
 * The engine is idempotent on (org, signal) — a second submit returns the SAME finding
 * rather than a duplicate — so landing in the same workspace twice is the correct
 * outcome of a double-click, and this action does not need to guard against one.
 */
export async function promoteSignalToFindingAction(
  signalId: string
): Promise<{ error?: string }> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "Not authenticated" };

  let findingId: string;
  try {
    const res = await fetch(`${ENGINE_URL}/api/findings/from-signal`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ signal_id: signalId }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      // Say what actually happened. "Something went wrong" would leave the reader
      // guessing whether the finding exists, and whether clicking again is safe.
      if (res.status === 404 && body.error === "signal_not_found") {
        return { error: "This intelligence is no longer available to your organization." };
      }
      if (res.status === 404) {
        return { error: "Creating findings from intelligence is not enabled for your organization." };
      }
      if (res.status === 403) {
        return { error: "Your plan does not include findings." };
      }
      return { error: "Could not create the finding. Nothing was changed — you can try again." };
    }

    const body = (await res.json()) as { finding: { id: string }; created: boolean };
    findingId = body.finding.id;
  } catch {
    return { error: "Network error. Nothing was changed — you can try again." };
  }

  // The brief item now resolves to a finding, so its affordance must flip from
  // "Create finding" to "Open the Decision Workspace" on the next render.
  revalidatePath("/briefs", "layout");
  revalidatePath(`/findings/${findingId}`);

  // redirect() throws — it must sit OUTSIDE the try, or the catch above would swallow
  // the control-flow signal and report a network error for a finding that was created.
  redirect(`/findings/${findingId}`);
}
