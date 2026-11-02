import { countQuestionDomains } from './question-domain';

describe('stage 8 canonical question domains', () => {
  it('keeps all nine categories and sends unknown legacy text to unclassified without guessing', () => {
    const result = countQuestionDomains(['自然', '科学', '自然 ', '关于小动物', null]);
    expect(result).toEqual([
      { name: '动物', count: 0 },
      { name: '自然', count: 2 },
      { name: '数学', count: 0 },
      { name: '语言', count: 0 },
      { name: '艺术', count: 0 },
      { name: '科学', count: 1 },
      { name: '情绪', count: 0 },
      { name: '生活', count: 0 },
      { name: '安全', count: 0 },
      { name: '未分类', count: 2 },
    ]);
  });
});
