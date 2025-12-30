export type RunRecord = {
  runId: string;
  customerId: string;
  status: "PENDING" | "RUNNING" | "COMPLETE" | "FAILED";
  createdAt: string;
};
