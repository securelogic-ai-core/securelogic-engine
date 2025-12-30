import "./registry.assert";

import "./registry.assert";
import "./registry.assert";
import { RENDER_TARGETS } from "../contracts/RenderTarget";
import type { RenderTarget } from "../contracts/RenderTarget";
import type { Renderer } from "./Renderer";

import { PdfRenderer } from "../pdf/PdfRenderer";
import { DashboardRenderer } from "../dashboard/DashboardRenderer";
import { JsonRenderer } from "../json/JsonRenderer";

export const RENDERER_REGISTRY: Record<RenderTarget, Renderer> = {
  PDF: new PdfRenderer(),
  DASHBOARD: new DashboardRenderer(),
  JSON: new JsonRenderer()
} as const;
