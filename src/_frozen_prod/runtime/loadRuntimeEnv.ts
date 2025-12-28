import type { RuntimeEnv } from "./RuntimeEnv";

export function loadRuntimeEnv(): RuntimeEnv {
  const env = process.env as Partial<RuntimeEnv>;

  if (
    !env.NODE_ENV ||
    !env.SERVICE_NAME ||
    !env.SERVICE_VERSION ||
    env.STRICT_MODE !== "true"
  ) {
    throw new Error("INVALID_RUNTIME_ENV");
  }

  return env as RuntimeEnv;
}
