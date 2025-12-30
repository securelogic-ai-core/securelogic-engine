export type RenderErrorCode =
  | "INVALID_MANIFEST"
  | "UNAUTHORIZED_RENDER"
  | "SOURCE_VERIFICATION_FAILED"
  | "RENDER_FAILED";

export interface RenderError {
  code: RenderErrorCode;
  message: string;
}
