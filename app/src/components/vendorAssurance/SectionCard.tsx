/**
 * SectionCard — shared chrome for the three document-review sections
 * (Cover Sheet / Complementary User Entity Controls / Exceptions and
 * Deviations). Server component, layout only.
 */

import type { ReactNode } from "react";

type Props = {
  title: string;
  subtitle?: string;
  /** Right-aligned content in the section header (e.g. a count chip). */
  aside?: ReactNode;
  children: ReactNode;
};

export default function SectionCard({ title, subtitle, aside, children }: Props): JSX.Element {
  return (
    <section
      style={{
        border: "1px solid #374151",
        borderRadius: 10,
        background: "rgba(15,23,42,0.5)",
        padding: 20,
      }}
    >
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#e5e7eb" }}>{title}</h2>
          {subtitle && <p style={{ margin: "2px 0 0", fontSize: 12, color: "#9ca3af" }}>{subtitle}</p>}
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}
