export const RENDER_TARGETS = ["PDF", "DASHBOARD", "JSON"] as const;

export type RenderTarget = typeof RENDER_TARGETS[number];
