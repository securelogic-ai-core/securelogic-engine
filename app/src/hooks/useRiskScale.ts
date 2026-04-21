"use client";

import { useState, useEffect } from "react";
import type { RiskScale, RiskScaleLevel } from "@/lib/api";
import { getRiskScaleAction } from "@/app/settings/risk-scale/actions";

// Module-level cache: survives component mount/unmount within the same browser session
let cached: RiskScale | null = null;
let inFlight: Promise<RiskScale | null> | null = null;

export function invalidateRiskScaleCache(): void {
  cached = null;
  inFlight = null;
}

export function useRiskScale() {
  const [scale, setScale] = useState<RiskScale | null>(cached);
  const [loading, setLoading] = useState<boolean>(cached === null);
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    if (cached !== null) {
      setScale(cached);
      setLoading(false);
      return;
    }

    let cancelled = false;

    if (!inFlight) {
      inFlight = getRiskScaleAction().finally(() => {
        inFlight = null;
      });
    }

    inFlight.then((result) => {
      if (cancelled) return;
      if (result) {
        cached = result;
        setScale(result);
        setError(false);
      } else {
        setError(true);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  function getLevelByValue(value: string): RiskScaleLevel | undefined {
    const v = value.toLowerCase();
    return scale?.levels.find((l) => l.value.toLowerCase() === v);
  }

  return { scale, loading, error, getLevelByValue };
}
