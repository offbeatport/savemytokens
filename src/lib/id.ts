/** Short, URL-friendly id. Works in both node and browser. */
export function genId(prefix = ''): string {
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}${Math.floor(Math.random() * 1e9).toString(16)}`
  return prefix + uuid.replace(/-/g, '').slice(0, 14)
}
