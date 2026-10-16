/**
 * Canonical slug used as the uniqueness key for categories. Unicode-aware so non-Latin names
 * (e.g. Arabic) keep meaningful slugs:
 *   "  Home & Garden " -> "home-garden", "Électronique" -> "electronique", "كتب عربية" -> "كتب-عربية"
 */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
    .replace(/-+$/g, '');
}
