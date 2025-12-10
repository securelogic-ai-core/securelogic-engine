type UsageRecord = {
  apiKey: string;
  path: string;
  status: number;
  durationMs: number;
  timestamp: string;
};

const MAX_RECORDS = 1000;
const usageLog: UsageRecord[] = [];

export function recordUsage(entry: UsageRecord) {
  usageLog.push(entry);
  if (usageLog.length > MAX_RECORDS) {
    usageLog.shift();
  }
}

export function getUsage() {
  return usageLog;
}
