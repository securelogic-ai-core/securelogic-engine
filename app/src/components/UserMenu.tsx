"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

interface Props {
  name: string;
  email: string;
  role: string;
  organizationName?: string;
  isPlatformUser?: boolean;
  /** Show SSO settings link for professional+ orgs */
  isSsoEligible?: boolean;
}

function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, { bg: string; color: string }> = {
    admin:   { bg: "rgba(139,92,246,0.15)",  color: "#c4b5fd" },
    analyst: { bg: "rgba(59,130,246,0.15)",  color: "#93c5fd" },
    viewer:  { bg: "rgba(148,163,184,0.15)", color: "#94a3b8" },
  };
  const s = styles[role] ?? styles.viewer!;
  return (
    <span
      style={{
        display: "inline-block",
        background: s.bg,
        color: s.color,
        fontSize: "11px",
        fontWeight: 600,
        padding: "2px 7px",
        borderRadius: "20px",
      }}
    >
      {role.charAt(0).toUpperCase() + role.slice(1)}
    </span>
  );
}

export default function UserMenu({ name, email, role, organizationName, isPlatformUser, isSsoEligible }: Props) {
  const [open, setOpen]   = useState(false);
  const menuRef           = useRef<HTMLDivElement>(null);
  const initial           = (name || email || "?").charAt(0).toUpperCase();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={menuRef} style={{ position: "relative" }}>
      {/* Avatar button */}
      <button
        onClick={() => setOpen((v) => !v)}
        title={name || email}
        style={{
          width: "32px",
          height: "32px",
          borderRadius: "50%",
          background: "rgba(0,196,180,0.2)",
          color: "#00c4b4",
          fontWeight: 600,
          fontSize: "13px",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "background 0.15s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0,196,180,0.35)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0,196,180,0.2)"; }}
      >
        {initial}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 8px)",
            minWidth: "220px",
            background: "#0d1b2e",
            border: "1px solid #1e2d45",
            borderRadius: "10px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            zIndex: 100,
            overflow: "hidden",
          }}
        >
          {/* User info */}
          <div style={{ padding: "14px 16px", borderBottom: "1px solid #1e2d45" }}>
            <p style={{ margin: "0 0 2px", fontSize: "13px", fontWeight: 600, color: "#f1f5f9" }}>
              {name}
            </p>
            <p style={{ margin: "0 0 6px", fontSize: "12px", color: "#64748b", wordBreak: "break-all" }}>
              {email}
            </p>
            <RoleBadge role={role} />
          </div>

          {/* Nav links */}
          <div style={{ padding: "6px 0" }}>
            <MenuLink href="/account" onClick={() => setOpen(false)}>
              Account
            </MenuLink>
            {isPlatformUser && (
              <MenuLink href="/account/team" onClick={() => setOpen(false)}>
                Team
              </MenuLink>
            )}
            {isPlatformUser && (
              <MenuLink href="/account/api-keys" onClick={() => setOpen(false)}>
                API Keys
              </MenuLink>
            )}
            <MenuLink href="/settings/risk-scale" onClick={() => setOpen(false)} icon={<GearIcon />}>
              Settings
            </MenuLink>
            {isSsoEligible && role === "admin" && (
              <MenuLink href="/settings/sso" onClick={() => setOpen(false)}>
                SSO Configuration
              </MenuLink>
            )}
          </div>

          {/* Sign out */}
          <div style={{ borderTop: "1px solid #1e2d45", padding: "6px 0" }}>
            <form action="/api/logout" method="POST">
              <button
                type="submit"
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 16px",
                  fontSize: "13px",
                  color: "#94a3b8",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "#f1f5f9"; e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "#94a3b8"; e.currentTarget.style.background = "transparent"; }}
              >
                Sign Out
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function GearIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function MenuLink({ href, onClick, icon, children }: { href: string; onClick: () => void; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "8px 16px",
        fontSize: "13px",
        color: "#cbd5e1",
        textDecoration: "none",
        transition: "background 0.1s, color 0.1s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLAnchorElement).style.background = "rgba(255,255,255,0.04)";
        (e.currentTarget as HTMLAnchorElement).style.color = "#f1f5f9";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLAnchorElement).style.background = "transparent";
        (e.currentTarget as HTMLAnchorElement).style.color = "#cbd5e1";
      }}
    >
      {icon}
      {children}
    </Link>
  );
}
