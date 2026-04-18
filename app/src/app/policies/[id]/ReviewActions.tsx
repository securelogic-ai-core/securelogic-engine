"use client";

import { useTransition } from "react";
import { markPolicyReviewed } from "./actions";

interface Props {
  policyId: string;
}

export function ReviewActions({ policyId }: Props) {
  const [isPending, startTransition] = useTransition();

  function handleMarkReviewed() {
    startTransition(async () => {
      await markPolicyReviewed(policyId);
    });
  }

  return (
    <button
      onClick={handleMarkReviewed}
      disabled={isPending}
      className="w-full py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
      style={{ background: "#00c4b4", color: "#0a0f1a" }}
    >
      {isPending ? "Marking reviewed…" : "Mark as Reviewed"}
    </button>
  );
}
