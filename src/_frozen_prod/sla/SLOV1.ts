export interface SLOV1 {
  sloId: string;
  tenantId: string;
  metric: "AVAILABILITY" | "LATENCY" | "DURABILITY";
  target: number;
  windowMinutes: number;
}
