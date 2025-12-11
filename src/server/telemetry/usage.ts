type UsageRecord = {
  key: string;
  route: string;
  timestamp: number;
};

const usage: UsageRecord[] = [];

export function recordUsage(key: string, route: string) {
  usage.push({ key, route, timestamp: Date.now() });
}

export function recordBlocked(_key: string) {
  // no-op
}

export function getUsage() {
  return usage;
}
