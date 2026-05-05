"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { dismissBannerAction } from "@/app/actions/dismissBanner";

export function DismissBannerButton({ bannerKey }: { bannerKey: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      aria-label="Dismiss"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await dismissBannerAction(bannerKey);
          router.refresh();
        })
      }
      style={{
        background: "transparent",
        border: "none",
        color: "#9ca3af",
        cursor: isPending ? "wait" : "pointer",
        fontSize: 18,
        lineHeight: 1,
        padding: "4px 8px",
      }}
    >
      ×
    </button>
  );
}
