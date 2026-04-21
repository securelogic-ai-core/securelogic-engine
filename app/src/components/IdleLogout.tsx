"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const IDLE_TIMEOUT_MS  = 30 * 60 * 1000; // 30 minutes
const WARNING_BEFORE_MS = 2 * 60 * 1000; // show warning 2 minutes before logout
const CHECK_INTERVAL_MS = 60 * 1000;     // check every 60 seconds

export default function IdleLogout() {
  const router          = useRouter();
  const lastActivityRef = useRef<number>(Date.now());
  const [showWarning, setShowWarning] = useState(false);

  useEffect(() => {
    function resetTimer() {
      lastActivityRef.current = Date.now();
      setShowWarning(false);
    }

    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"] as const;
    events.forEach((evt) => window.addEventListener(evt, resetTimer, { passive: true }));

    const interval = setInterval(() => {
      const idle = Date.now() - lastActivityRef.current;

      if (idle >= IDLE_TIMEOUT_MS) {
        clearInterval(interval);
        void fetch("/api/logout", { method: "POST" }).finally(() => {
          router.push("/login?reason=idle");
        });
        return;
      }

      if (idle >= IDLE_TIMEOUT_MS - WARNING_BEFORE_MS) {
        setShowWarning(true);
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      events.forEach((evt) => window.removeEventListener(evt, resetTimer));
      clearInterval(interval);
    };
  }, [router]);

  if (!showWarning) return null;

  return (
    <div
      style={{
        position:        "fixed",
        bottom:          "24px",
        left:            "50%",
        transform:       "translateX(-50%)",
        background:      "#1e293b",
        borderTop:       "3px solid #00c4b4",
        borderRadius:    "10px",
        padding:         "14px 20px",
        display:         "flex",
        alignItems:      "center",
        gap:             "16px",
        zIndex:          9999,
        boxShadow:       "0 4px 24px rgba(0,0,0,0.4)",
        maxWidth:        "480px",
        width:           "calc(100vw - 48px)",
      }}
    >
      <p style={{ margin: 0, color: "#e2e8f0", fontSize: "14px", lineHeight: "1.4", flex: 1 }}>
        You&apos;ve been inactive for a while. You&apos;ll be logged out in 2 minutes.
      </p>
      <button
        onClick={() => {
          lastActivityRef.current = Date.now();
          setShowWarning(false);
        }}
        style={{
          flexShrink:   0,
          background:   "#00c4b4",
          color:        "#0a0f1a",
          border:       "none",
          borderRadius: "6px",
          padding:      "8px 14px",
          fontSize:     "13px",
          fontWeight:   600,
          cursor:       "pointer",
          whiteSpace:   "nowrap",
        }}
      >
        Stay signed in
      </button>
    </div>
  );
}
