import { z } from "zod";

export const ScoreRequestSchema = z.object({
  controls: z.array(z.any()),
  intake: z.record(z.string(), z.any())
});
