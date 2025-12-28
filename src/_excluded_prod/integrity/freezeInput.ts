export function freezeInput<T>(input: T): Readonly<T> {
  return Object.freeze(input);
}
