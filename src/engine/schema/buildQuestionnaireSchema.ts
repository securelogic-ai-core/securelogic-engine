import { z } from "zod";
import { ControlRegistry } from "../registry/ControlRegistry.js";

type AnyObject = Record<string, unknown>;

function buildControlsSchema() {
  const shape: AnyObject = {};

  for (const path of Object.keys(ControlRegistry.controls)) {
    const parts = path.split(".");
    let current: AnyObject = shape;

    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      if (!key) continue;

      const existing = current[key];

      if (typeof existing !== "object" || existing === null) {
        const next: AnyObject = {};
        current[key] = next;
        current = next;
      } else {
        current = existing as AnyObject;
      }
    }

    const lastKey = parts[parts.length - 1];
    if (!lastKey) continue;

    current[lastKey] = z.boolean();
  }

  return z.object(shape as Record<string, z.ZodTypeAny>);
}

export const QuestionnaireSchema = z.object({
  orgProfile: z.object({
    industry: z.string(),
    size: z.enum(["SMB", "Mid-Market", "Enterprise"]),
    aiUsage: z.array(z.string()),
    modelTypes: z.array(z.string())
  }),
  controls: buildControlsSchema()
});

export type QuestionnaireInput = z.infer<typeof QuestionnaireSchema>;
