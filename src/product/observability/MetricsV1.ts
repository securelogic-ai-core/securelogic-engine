export interface MetricV1 {
  name: string;
  value: number;
  tags?: Record<string, string>;
  timestamp: string;
}
