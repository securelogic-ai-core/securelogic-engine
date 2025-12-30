import type { RenderResult } from "./RenderResult";
import type { RenderError } from "./RenderError";

export type RenderResponse =
  | { status: "SUCCESS"; results: RenderResult[] }
  | { status: "FAILED"; error: RenderError };
