> **DEPRECATED — non-governing**
>
> This document is legacy. It does not govern current build work.
>
> The governing source of truth is (read in this order):
> 1. PRODUCT_VISION.md
> 2. CURRENT_STATE_ARCHITECTURE.md
> 3. CANONICAL_DOMAIN_MODEL.md
> 4. BUILD_SEQUENCE.md
> 5. FINAL_PRODUCT_STANDARD.md
> 6. CLAUDE.md
>
> Content below is preserved for historical reference only and may conflict with the governing docs above. This file was a placeholder ("Status: Pending") and was never formally written. Do not use it for product, architecture, or UI decisions.

---

# SECURELOGIC_UI_BRIEF.md — UI Design and Build Reference

> **Status: Pending**
> This document is referenced by `CLAUDE.md` and `EXECUTION_PLAN.md` but has not yet been formally written.
> Until it exists, use the authoritative guidance in `CLAUDE.md` under the following sections:
> - **UI Build Order**
> - **Module Shell Rules**
> - **Screen State Requirements**
> - **TypeScript Interface Contracts**
> - **Information Architecture**
> - **Visual Design Direction**
> - **Brand Source of Truth**

When this document is written, it should cover:

- Full design system specification (tokens, spacing, type scale, component inventory)
- Authenticated app shell layout in detail (sidebar, header, org switcher, user menu)
- Screen-by-screen wireframe descriptions for all Phase 2 surfaces
- State machine definitions per screen (loading, empty, error, success, locked, unavailable)
- TypeScript interface contracts for all UI-consumed data shapes
- Component-level interaction patterns
- Accessibility requirements
- Responsive breakpoint strategy

Until then, do not invent UI direction that contradicts `CLAUDE.md`.
