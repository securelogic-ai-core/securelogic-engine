export function assertImmutableConfig<T extends object>(config: T): Readonly<T> {
  return Object.freeze(config);
}
