import { z } from "zod";
import { ControlRegistry } from "../registry/ControlRegistry.js";

function buildControlsSchema() {
  const shape: any = {};

  for (const path of Object.keys(ControlRegistry.controls)) {
    const parts = path.split(".");
    let current: any = shape;
    for (let i = 0; i < parts.length - 1; i++) {
      current[parts[i]] ??= {};
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = z.boolean();
  }

  return z.object(shape);
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
