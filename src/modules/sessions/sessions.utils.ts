export function isRelativePath(value: string): boolean {
  return /^\/(?!\/)/.test(value);
}
