/**
 * Codenames like "เสือดาวสายบุก #27" (STORY.md): animal + title + two-digit number. Word lists are
 * hand-picked in content/story.th.yaml so no combination reads badly.
 */
export function codename(
  words: { animals: readonly string[]; titles: readonly string[] },
  random: () => number = Math.random,
  avoid: ReadonlySet<string> = new Set(),
): string {
  const pick = <T>(list: readonly T[]): T => {
    const item = list[Math.floor(random() * list.length)];
    if (item === undefined) throw new Error('empty word list');
    return item;
  };
  // ~12 × 10 × 99 names; a few tries is plenty to dodge today's earlier players.
  let name = '';
  for (let i = 0; i < 20; i++) {
    const number = String(1 + Math.floor(random() * 99)).padStart(2, '0');
    name = `${pick(words.animals)}${pick(words.titles)} #${number}`;
    if (!avoid.has(name)) break;
  }
  return name;
}
