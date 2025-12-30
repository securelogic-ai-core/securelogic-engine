import { registerRenderer } from "./pipeline/RenderRegistry";
import { PdfRenderer } from "./pdf/PdfRenderer";

export function registerDefaultRenderers() {
  registerRenderer(new PdfRenderer());
}
