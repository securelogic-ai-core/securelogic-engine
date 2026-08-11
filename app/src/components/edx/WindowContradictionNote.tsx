/**
 * WindowContradictionNote — EDX-8 (date provenance) disclosure.
 *
 * Renders the one-sentence contradiction a reader should never have to
 * compute themselves: this item's source-asserted date sits `age` before the
 * coverage window the surrounding report claims. The decision (whether there
 * IS a contradiction, and its age label) is made by
 * `windowContradictionAge` in @/lib/edx/freshness — this component only
 * states it, and renders nothing when there is nothing to state.
 *
 * Server-safe: no hooks, no client directives.
 */

export function WindowContradictionNote({
  age,
  className = "",
}: {
  /** Age label from windowContradictionAge (e.g. "16 years"); null → no note. */
  age: string | null;
  className?: string;
}) {
  if (!age) return null;
  return (
    <p
      role="note"
      className={`text-xs text-amber-400 leading-relaxed ${className}`.trim()}
    >
      Reported {age} before this brief&rsquo;s coverage window.
    </p>
  );
}
