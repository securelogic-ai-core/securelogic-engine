export interface ThreatModelItem {
  controlId: string;
  title: string;
  scenario: string;
  severity: number;
}

export interface ThreatModelResult {
  items: ThreatModelItem[];
}
