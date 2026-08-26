/**
 * concurrency.ts — bounded parallel map.
 *
 * WHY
 * ---
 * The codebase had no concurrency limiter anywhere: fan-out was either fully
 * serial (the per-signal LLM matcher — hours of wall-clock) or fully unbounded
 * (`Promise.all` over every brief item — 24 simultaneous Anthropic requests
 * from one org, with nothing stopping that number from growing if a cap
 * changes). Unbounded fan-out is the one that bites in production: it converts
 * a provider rate limit into a burst of failures that the call sites then
 * silently degrade into template fallbacks.
 *
 * This is a deliberate ~30-line local helper rather than a dependency
 * (`p-limit` et al): the semantics needed are small and fully testable, and
 * adding a runtime dependency to the engine for them is not a trade worth
 * making.
 */

/**
 * Map `items` through `fn` with at most `limit` invocations in flight.
 *
 * Results are returned in INPUT order regardless of completion order — callers
 * (e.g. brief enrichment) rely on positional correspondence with their input.
 * A rejection propagates, exactly like `Promise.all`; callers that need
 * per-item error isolation must catch inside `fn`, as they already do.
 *
 * `limit` is clamped to at least 1, so a mis-configured 0 degrades to serial
 * rather than deadlocking.
 */
export async function mapWithConcurrency<T, R>(
  items: ReadonlyArray<T>,
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;

  const effectiveLimit = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  };

  await Promise.all(Array.from({ length: effectiveLimit }, () => worker()));
  return results;
}
