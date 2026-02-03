import pinoHttp from "pino-http";
import { logger } from "./logger.js";

export const httpLogger = pinoHttp({
  logger,
  autoLogging: true,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers['x-api-key']"
    ],
    remove: true
  }
});
