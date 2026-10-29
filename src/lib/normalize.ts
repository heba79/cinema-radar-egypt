// Title normalization for matching across TMDB and Egyptian providers,
// in English, Arabic, and common Arabic->Latin transliterations.

const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;

export function normalizeTitle(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // latin accents
    .replace(ARABIC_DIACRITICS, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/^ال/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Very loose phonetic key for Egyptian transliterations (e.g. "Matloub Aaeleyan" vs "Matlub Aelian"). */
export function translitKey(input: string): string {
  return normalizeTitle(input)
    .replace(/\b(el|al)\s+/g, "el")
    .replace(/aa+|ee+|oo+|ou|uu/g, (m) => m[0])
    .replace(/[aeiouy]/g, "")
    .replace(/(.)\1+/g, "$1")
    .replace(/\s+/g, "");
}

export function hasArabic(s: string): boolean {
  return /[؀-ۿ]/.test(s);
}

/** Dice coefficient over bigrams, 0..1. */
export function similarity(a: string, b: string): number {
  const x = normalizeTitle(a).replace(/\s/g, "");
  const y = normalizeTitle(b).replace(/\s/g, "");
  if (!x || !y) return 0;
  if (x === y) return 1;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const gx = grams(x);
  const gy = grams(y);
  let overlap = 0;
  for (const [g, n] of gx) overlap += Math.min(n, gy.get(g) ?? 0);
  return (2 * overlap) / (x.length - 1 + (y.length - 1));
}
