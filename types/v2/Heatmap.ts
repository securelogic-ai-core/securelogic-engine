export interface HeatmapCell {
  count: number;
}

export type HeatmapMatrix = HeatmapCell[][];

export interface HeatmapResult {
  matrix: HeatmapMatrix;
  highestCell: number;
}
