export function assertExecutionInvariant(condition: boolean, code: string): void {
  if (!condition) {
    throw new Error(`EXECUTION_INVARIANT_VIOLATION:${code}`);
  }
}
