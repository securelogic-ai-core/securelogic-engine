/**
 * Ambient declaration for the raw request body captured by the `express.json()`
 * / `bodyParser.raw()` verify hooks in src/api/app.ts.
 *
 * This lived INSIDE app.ts until 2026-08-16. That made the augmentation hostage
 * to app.ts being in the compilation: any tsconfig that compiled a consumer of
 * `req.rawBody` WITHOUT also compiling app.ts failed with TS2339. That is not
 * hypothetical — it broke the posture worker's build for 20 consecutive deploys
 * (the worker blanket-includes src/api/lib, whose ask/orchestrator.ts reaches
 * src/api/tools/registry.ts, which imports the whole routes/index.ts barrel and
 * with it src/api/routes/emailProviderWebhook.ts, the one consumer that reads
 * `req.rawBody` directly rather than casting). The worker kept running stale
 * code while every other service advanced.
 *
 * Declaring it here — the directory the other workers already include for
 * ambient shims — makes the type available to every build that compiles a
 * consumer, independent of whether app.ts is a root. app.ts remains the only
 * place that ASSIGNS these fields; this file only describes them.
 *
 * Both surfaces are declared because the express.json() verify callback
 * receives a raw http.IncomingMessage, not an Express.Request.
 */
export {};

declare global {
  namespace Express {
    interface Request {
      rawBody?: string | Buffer;
    }
  }
}

declare module "http" {
  interface IncomingMessage {
    rawBody?: string | Buffer;
  }
}
