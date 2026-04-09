"use client";

import { useEffect, useState } from "react";

export type TocEntry = { id: string; label: string };

/**
 * Sticky scrollspy table of contents.
 * Observes section IDs via IntersectionObserver and highlights the active entry.
 * Sticky at top once scrolled past its natural position.
 * Hidden from print output.
 */
export function ScrollSpyTOC({ sections }: { sections: TocEntry[] }) {
  const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? "");

  useEffect(() => {
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the topmost intersecting section
        const intersecting = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (intersecting.length > 0) {
          setActiveId(intersecting[0].target.id);
        }
      },
      {
        // Fire when 10–30% from top of viewport enters view
        rootMargin: "-10% 0px -60% 0px",
        threshold: 0,
      }
    );

    for (const { id } of sections) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [sections]);

  if (sections.length < 2) return null;

  return (
    <nav
      aria-label="Brief sections"
      className="print:hidden sticky top-0 z-10 border border-slate-200 rounded-lg bg-white/95 backdrop-blur-sm px-5 py-4 shadow-sm"
    >
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">
        In This Brief
      </p>
      <ol className="flex flex-wrap gap-x-6 gap-y-2">
        {sections.map(({ id, label }, i) => {
          const isActive = activeId === id;
          return (
            <li key={id} className="flex items-center gap-2">
              <span
                className={`text-[10px] font-semibold tabular-nums transition-colors ${
                  isActive ? "text-teal-500" : "text-slate-300"
                }`}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <a
                href={`#${id}`}
                className={`text-xs font-medium transition-colors ${
                  isActive
                    ? "text-teal-600 font-semibold"
                    : "text-slate-500 hover:text-teal-600"
                }`}
              >
                {label}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
