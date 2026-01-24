export function validateJsonObject(obj: any, file: string) {
  if (!obj || typeof obj !== "object") {
    throw new Error("Invalid JSON structure in " + file);
  }
  if (!Array.isArray(obj.controls)) {
    throw new Error("Catalog missing required 'controls' array in " + file);
  }
}
