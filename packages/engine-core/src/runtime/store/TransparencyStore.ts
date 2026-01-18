export interface TransparencyStore {
  append(entry: any): Promise<void>;
}
