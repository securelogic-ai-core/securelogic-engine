type EndpointUsage = Record<string, number>;

interface UsageRecord {
  total: number;
  blocked: number;
  endpoints: EndpointUsage;
}

const usage: Record<string, UsageRecord> = {};

export function recordUsage(apiKey: string, endpoint: string) {
  if (!usage[apiKey]) {
    usage[apiKey] = { total: 0, blocked: 0, endpoints: {} };
  }

  usage[apiKey].total += 1;
  usage[apiKey].endpoints[endpoint] =
    (usage[apiKey].endpoints[endpoint] ?? 0) + 1;
}

export function recordBlocked(apiKey: string) {
  if (!usage[apiKey]) {
    usage[apiKey] = { total: 0, blocked: 0, endpoints: {} };
  }

  usage[apiKey].blocked += 1;
}

export function getUsage() {
  return usage;
}
