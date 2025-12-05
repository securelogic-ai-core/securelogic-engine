export interface RoadmapItem {
  id: string;
  title: string;
  priority: number;
}

export interface RoadmapResult {
  items: RoadmapItem[];
}
