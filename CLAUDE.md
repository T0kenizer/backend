# Backend guidelines

## TypeScript conventions

- Use the global utility types `Optional<T>`, `Nullable<T>` and `Nullish<T>`, declared in `src/types/global.d.ts`, instead of writing `T | undefined`, `T | null` or `T | null | undefined` inline.
  - `foo: Optional<string>` ✅ — `foo: string | undefined` ❌
  - `bar: Nullable<Date>` ✅ — `bar: Date | null` ❌
  - `baz: Nullish<number>` ✅ — `baz: number | null | undefined` ❌
