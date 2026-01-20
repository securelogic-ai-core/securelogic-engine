export interface TransparencyStore<T = any> {
  append(entry: T): Promise<void>;
  getLatest(): Promise<T | null>;
}
