/**
 * Converts a kebab-case filename to Title Case
 * Example: "code-maintainability" -> "Code Maintainability"
 * Special rules:
 * - "ai" becomes "AI" (anywhere in the title)
 * - Articles and prepositions (the, and, to, of, in) stay lowercase (except at position 0)
 */
export function filenameToTitle(filename: string): string {
  const lowercaseWords = new Set(['a', 'the', 'and', 'to', 'of', 'in']);

  return filename
    .split('-')
    .map((word, index) => {
      // Special case for "ai" - always uppercase
      if (word === 'ai') {
        return 'AI';
      }

      // First word is always capitalized (even if it's an article/preposition)
      if (index === 0) {
        return word.charAt(0).toUpperCase() + word.slice(1);
      }

      // Lowercase words stay lowercase
      if (lowercaseWords.has(word)) {
        return word;
      }

      // Regular title case
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}
