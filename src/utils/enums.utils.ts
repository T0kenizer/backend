export function parseEnum<T extends string>(
  values: readonly T[],
  value: unknown,
): Optional<T> {
  return values.find((known) => known === value);
}
