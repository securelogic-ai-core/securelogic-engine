export interface MetricPointV1 {
  name: string;
  value: number;
  timestamp: string;
  tags?: Record<string, string>;
}
