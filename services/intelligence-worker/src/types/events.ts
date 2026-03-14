export type SignalIngestedEvent = {
  eventType: "signal.ingested";
  signalId: string;
  source: string;
  title: string;
  timestamp: string;
  payload: unknown;
};