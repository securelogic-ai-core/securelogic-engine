export interface TraceSpanV1 {
  traceId: string;
  spanId: string;
  name: string;
  startTime: string;
  endTime?: string;
}
