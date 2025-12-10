import { z } from "zod";

export const ControlSchema = z.object({
  id: z.string(),
  category: z.string(),
  severity: z.number().min(0).max(10),
  implemented: z.boolean()
});

export const IntakeSchema = z.object({
  organizationSize: z.number().int().positive().optional(),
  industry: z.string().optional(),
  dataSensitivity: z.string().optional()
}).strict();

export const ScoreRequestSchema = z.object({
  controls: z.array(ControlSchema),
  intake: IntakeSchema
}).strict();
