import type { SchemaVersionV1 } from "./SchemaVersionV1";

export function assertSchemaVersion(
  expected: SchemaVersionV1,
  actual: SchemaVersionV1
): void {
  if (expected.checksum !== actual.checksum) {
    throw new Error("SCHEMA_VERSION_MISMATCH");
  }
}
