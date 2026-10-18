/** Case-insensitive edit distance, used only to rank "did you mean" candidates. */
function editDistance(a: string, b: string): number {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row++) {
    const current = [row];
    for (let col = 1; col <= right.length; col++) {
      const substitution = (previous[col - 1] ?? 0) + (left[row - 1] === right[col - 1] ? 0 : 1);
      current.push(Math.min(substitution, (previous[col] ?? 0) + 1, (current[col - 1] ?? 0) + 1));
    }
    previous = current;
  }
  return previous[right.length] ?? 0;
}

/** Closest candidates within a small distance, best first. */
function closestMatches(input: string, candidates: readonly string[], limit = 3): string[] {
  const maxDistance = Math.max(2, Math.floor(input.length / 3));
  return candidates
    .map((candidate) => ({ candidate, distance: editDistance(input, candidate) }))
    .filter(({ candidate, distance }) => {
      const isPrefix = candidate.toLowerCase().startsWith(input.toLowerCase());
      return isPrefix || distance <= maxDistance;
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}

export function didYouMean(input: string, candidates: readonly string[]): string {
  const matches = closestMatches(input, candidates);
  return matches.length > 0 ? ` Did you mean ${matches.map((m) => `"${m}"`).join(' or ')}?` : '';
}
