/**
 * Shared register list-page search form (vendors, AI systems, risks,
 * obligations, controls). One GET form so every register searches the same
 * way: the term is a URL param (2–120 platform bounds enforced client-side,
 * validated engine-side), works without client JS, and `hidden` carries the
 * page's other filter axes so a search never drops them.
 */
export function ListSearchForm({
  action,
  inputId,
  placeholder,
  defaultValue,
  hidden = {},
}: {
  /** Page path the GET form submits to, e.g. "/risks". */
  action: string;
  /** Unique input id for the label binding, e.g. "risk-search". */
  inputId: string;
  placeholder: string;
  defaultValue?: string;
  /** Other-axis params to preserve across a search submit. */
  hidden?: Record<string, string>;
}) {
  return (
    <form action={action} method="get" className="mb-6">
      <label
        htmlFor={inputId}
        className="block text-xs font-semibold uppercase tracking-wide mb-2"
        style={{ color: "#64748b" }}
      >
        Search
      </label>
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="flex items-center gap-2 w-full max-w-xl">
        <input
          id={inputId}
          type="search"
          name="q"
          defaultValue={defaultValue ?? ""}
          minLength={2}
          maxLength={120}
          placeholder={placeholder}
          className="flex-1 px-3 py-2 rounded-lg text-sm"
          style={{ background: "#0b1220", border: "1px solid #1e293b", color: "#e2e8f0" }}
        />
        <button
          type="submit"
          className="px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: "rgba(0,196,180,0.15)", color: "#00c4b4", border: "1px solid rgba(0,196,180,0.4)" }}
        >
          Search
        </button>
      </div>
    </form>
  );
}
