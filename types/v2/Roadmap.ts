export interface RoadmapItem {
  controlId: string;
  title: string;
  currentMaturity: number;
  targetMaturity: number;
  priority: number;
  recommendation: string;
}

export interface RoadmapResult {
  items: RoadmapItem[];
}
