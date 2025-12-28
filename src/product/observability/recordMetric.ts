import type { MetricV1 } from "./MetricsV1";

export function recordMetric(metric: MetricV1): void {
  if (!metric.timestamp) {
    throw new Error("METRIC_MISSING_TIMESTAMP");
  }
}
