export class DeterministicSerializer {
  static stableStringify(obj: unknown): string {
    return JSON.stringify(obj, Object.keys(obj as any).sort());
  }
}
