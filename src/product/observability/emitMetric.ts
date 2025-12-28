import type { MetricPointV1 } from "./MetricsV1";

export function emitMetric(_: MetricPointV1): void {
  // enterprise hook point (exporter injected at runtime)
}
