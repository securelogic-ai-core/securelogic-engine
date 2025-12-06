import { z } from "zod";

export const ControlSchema = z.object({
  id: z.string(),
  impact: z.number().min(1).max(5).default(1),
  likelihood: z.number().min(1).max(5).default(1),
  domain: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional()
});

export const ControlsArraySchema = z.array(ControlSchema);
