export class ConfidenceScoringContext {
  private evidenceUsage = new Map<string, number>();

  increment(key: string): number {
    const next = (this.evidenceUsage.get(key) || 0) + 1;
    this.evidenceUsage.set(key, next);
    return next;
  }

  reset() {
    this.evidenceUsage.clear();
  }
}
