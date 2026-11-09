/** The name itself if free, otherwise the name with the first free number from 2 up. */
export function uniqueName(base: string, taken: string[]): string {
  const used = new Set(taken)
  if (!used.has(base)) return base
  let n = 2
  while (used.has(`${base} (${n})`)) n++
  return `${base} (${n})`
}
