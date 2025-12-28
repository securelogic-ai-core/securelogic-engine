export interface RuntimeEnv {
  NODE_ENV: "development" | "staging" | "production";
  SERVICE_NAME: string;
  SERVICE_VERSION: string;
  STRICT_MODE: "true";
}
