"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const DEFAULT_IDLE_SECONDS = 30 * 60;

interface IdleLogoutProps {
  /**
   * Idle window in seconds. Passed from the server layout, which reads
   * SESSION_IDLE_SECONDS at request time so the client timer matches the
   * server-enforced idle cap without a build-time (NEXT_PUBLIC) coupling.
   */
  idleSeconds?: number;
}

export default function IdleLogout({ idleSeconds }: IdleLogoutProps) {
  const router          = useRouter();
  const lastActivityRef = useRef<number>(Date.now());
  const loggingOutRef   = useRef<boolean>(false);
  const [showWarning, setShowWarning] = useState(false);

  useEffect(() => {
    const idleMs = (idleSeconds && idleSeconds > 0 ? idleSeconds : DEFAULT_IDLE_SECONDS) * 1000;
    // Warn a little before logout; scale down for short (test) windows.
    const warningBeforeMs = Math.min(2 * 60 * 1000, Math.floor(idleMs * 0.25));
    // Poll cadence: frequent enough to be responsive, never a storm.
    const checkIntervalMs = Math.min(60 * 1000, Math.max(5 * 1000, Math.floor(idleMs / 6)));

    function doLogout() {
      if (loggingOutRef.current) return;
      loggingOutRef.current = true;
      void fetch("/api/logout", { method: "POST" }).finally(() => {
        router.push("/login?reason=idle");
      });
    }

    function resetTimer() {
      lastActivityRef.current = Date.now();
      setShowWarning(false);
    }

    // Promptly enforce when the tab regains focus/visibility after being away,
    // instead of waiting for the next poll tick or navigation.
    function checkNow() {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastActivityRef.current >= idleMs) doLogout();
    }

    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"] as const;
    events.forEach((evt) => window.addEventListener(evt, resetTimer, { passive: true }));
    document.addEventListener("visibilitychange", checkNow);
    window.addEventListener("focus", checkNow);

    const interval = setInterval(() => {
      const idle = Date.now() - lastActivityRef.current;
      if (idle >= idleMs) {
        clearInterval(interval);
        doLogout();
        return;
      }
      if (idle >= idleMs - warningBeforeMs) setShowWarning(true);
    }, checkIntervalMs);

    return () => {
      events.forEach((evt) => window.removeEventListener(evt, resetTimer));
      document.removeEventListener("visibilitychange", checkNow);
      window.removeEventListener("focus", checkNow);
      clearInterval(interval);
    };
  }, [router, idleSeconds]);

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
        You&apos;ve been inactive for a while and will be signed out soon.
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
