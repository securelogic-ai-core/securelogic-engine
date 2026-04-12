export interface EngineLogger {
  info(fields: Record<string, unknown>, msg: string): void;
  error(fields: Record<string, unknown>, msg: string): void;
  warn(fields: Record<string, unknown>, msg: string): void;
}

export const noopLogger: EngineLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
};
