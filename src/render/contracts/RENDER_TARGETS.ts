import type { RenderTarget } from "./RenderTarget";

export const RENDER_TARGETS = ["PDF", "DASHBOARD", "JSON"] as const satisfies readonly RenderTarget[];
