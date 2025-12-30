export interface ProcurementRequestV1 {
  clientId: string;
  serviceCode: string;
  quantity: number;
  metadata?: Record<string, unknown>;
}
