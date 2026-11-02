export const STAGE8_QUESTION_DOMAINS = [
  '动物', '自然', '数学', '语言', '艺术', '科学', '情绪', '生活', '安全',
] as const;

const KNOWN_DOMAINS = new Set<string>(STAGE8_QUESTION_DOMAINS);

/** Only recognizes explicit canonical values; free text is retained as unclassified instead of guessed. */
export function canonicalQuestionDomain(value: string | null | undefined): string {
  const normalized = value?.trim();
  return normalized && KNOWN_DOMAINS.has(normalized) ? normalized : '未分类';
}

export function countQuestionDomains(values: Array<string | null | undefined>) {
  const counts = new Map<string, number>(STAGE8_QUESTION_DOMAINS.map((domain) => [domain, 0]));
  counts.set('未分类', 0);
  for (const value of values) {
    const domain = canonicalQuestionDomain(value);
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count }));
}
