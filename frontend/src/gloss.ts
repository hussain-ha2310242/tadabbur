/**
 * Turn a raw gloss into one readable English meaning.
 * CAMeL's morphology glosses look like "oust;remove;emit+it;they;she_<verb>_it"
 * - we keep the first sense, drop tags and bracketed codes, and join the
 * "+" pieces with spaces. Clean glosses pass through unchanged.
 */
export function cleanGloss(raw: string | null | undefined): string {
  if (!raw || !raw.trim()) return "-";
  let s = raw
    .replace(/_<[^>]*>_/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/_/g, " ");
  s = s.split(";")[0];
  s = s
    .split("+")
    .map((x) => x.trim())
    .filter(Boolean)
    .join(" ");
  s = s.replace(/\s+/g, " ").trim();
  return s || raw.trim();
}
