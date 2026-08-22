/**
 * PLCopen XML uses lowercase tags for STRING/WSTRING and uppercase tags
 * for all other IEC base types.
 */
export const baseTypeTag = (value: string): string => {
  const normalized = value.trim()
  const lower = normalized.toLowerCase()
  if (lower === 'string' || lower === 'wstring') return lower
  return normalized.toUpperCase()
}
