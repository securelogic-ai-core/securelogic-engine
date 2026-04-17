"use client";

import { useState, useRef, useEffect } from "react";
import { createControlMapping } from "../../controls/[id]/framework-map/actions";

interface ControlOption {
  id: string;
  name: string;
}

interface MapControlButtonProps {
  requirementId: string;
  frameworkId: string;
  controls: ControlOption[];
  alreadyMappedControlIds: string[];
}

export function MapControlButton({
  requirementId,
  frameworkId,
  controls,
  alreadyMappedControlIds,
}: MapControlButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingControlId, setPendingControlId] = useState<string | null>(null);
  const [justMappedIds, setJustMappedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const mappedSet = new Set([...alreadyMappedControlIds, ...justMappedIds]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const filtered = controls.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  async function handleMap(controlId: string) {
    if (pendingControlId !== null) return;
    setPendingControlId(controlId);
    setError(null);
    const result = await createControlMapping(controlId, requirementId, frameworkId);
    if (result && "error" in result) {
      setError(result.error);
      setPendingControlId(null);
    } else {
      setJustMappedIds((prev) => [...prev, controlId]);
      setPendingControlId(null);
    }
  }

  function toggleOpen() {
    setIsOpen((o) => !o);
    setSearchQuery("");
    setError(null);
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        onClick={toggleOpen}
        style={{
          border: "1px solid rgba(0,196,180,0.4)",
          color: "#00c4b4",
          background: isOpen ? "rgba(0,196,180,0.08)" : "transparent",
          fontSize: "11px",
          padding: "3px 8px",
          borderRadius: "4px",
          cursor: "pointer",
          lineHeight: "1.5",
        }}
      >
        ＋ Map Control
      </button>

      {isOpen && (
        <div
          className="absolute left-0 z-50"
          style={{
            top: "calc(100% + 6px)",
            background: "#0d1626",
            border: "1px solid #1e293b",
            borderRadius: "8px",
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
            width: "min(320px, calc(100vw - 2rem))",
            maxHeight: "260px",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Search */}
          <div className="p-2 flex-shrink-0">
            <input
              type="text"
              placeholder="Search controls..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
              style={{
                width: "100%",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid #1e293b",
                color: "#f1f5f9",
                padding: "6px 10px",
                borderRadius: "6px",
                fontSize: "12px",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Control list */}
          <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
            {controls.length === 0 ? (
              <p className="px-3 py-4 text-xs text-center" style={{ color: "#475569" }}>
                No controls found. Add controls in the Controls section.
              </p>
            ) : filtered.length === 0 ? (
              <p className="px-3 py-4 text-xs text-center" style={{ color: "#475569" }}>
                No controls match
              </p>
            ) : (
              filtered.map((c) => {
                const isMapped = mappedSet.has(c.id);
                const isPending = pendingControlId === c.id;
                return (
                  <ControlRow
                    key={c.id}
                    name={c.name}
                    isMapped={isMapped}
                    isPending={isPending}
                    onClick={() => handleMap(c.id)}
                  />
                );
              })
            )}
          </div>

          {error && (
            <div className="px-3 py-2 flex-shrink-0" style={{ borderTop: "1px solid #1e293b" }}>
              <p className="text-xs" style={{ color: "#fca5a5" }}>{error}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ControlRow({
  name,
  isMapped,
  isPending,
  onClick,
}: {
  name: string;
  isMapped: boolean;
  isPending: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const disabled = isMapped || isPending;
  return (
    <button
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        padding: "7px 12px",
        background: hovered && !disabled ? "rgba(255,255,255,0.04)" : "transparent",
        border: "none",
        cursor: disabled ? (isPending ? "wait" : "default") : "pointer",
        color: isMapped ? "#475569" : "#f1f5f9",
        opacity: isPending ? 0.5 : 1,
        fontSize: "12px",
        textAlign: "left",
      }}
    >
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flex: 1,
        }}
      >
        {name}
      </span>
      {isMapped && (
        <span className="flex-shrink-0 ml-2" style={{ color: "#00c4b4", fontSize: "11px" }}>
          ✓
        </span>
      )}
      {isPending && (
        <span className="flex-shrink-0 ml-2" style={{ color: "#475569", fontSize: "11px" }}>
          …
        </span>
      )}
    </button>
  );
}
