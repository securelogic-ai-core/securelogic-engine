import { REQUIRED_ENV_VARS } from "./EnvSchema";

export function validateEnv(): void {
  for (const k of REQUIRED_ENV_VARS) {
    if (!process.env[k]) {
      throw new Error(`Missing required env var: ${k}`);
    }
  }
}
