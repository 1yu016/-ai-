import { childQaSessionValid, LocalChildKnowledgeProvider, readChildQaConfig } from './child-qa.core';
describe('child QA bounded knowledge and isolation', () => {
  const config = { seconds: 120, policy: 'teacher_review' as const, topic: '种子发芽' };
  const provider = new LocalChildKnowledgeProvider();
  it.each(['不给种子浇水会怎么样？', '种子不浇水会怎样？', '种子没有水会怎么样？',
    '不给种子水喝会发生什么？', '没有水种子还能发芽吗？', '种子缺水会有什么影响？',
    '种子没有水分会怎么样？'])('matches negated watering and consequences to drought: %s', question => {
    expect(provider.answer(question, config)).toMatchObject({cardId:'no_water', status:'pending'});
    expect(provider.answer(question, config).answer).toContain('不一定就是死了');
  });
  it.each(['水缺少什么', '小朋友不喝水会怎样', '种子浇水会怎么样', '种子水太多会怎么样',
    '种子不浇水会怎样，天空为什么蓝', '水是什么颜色'])('does not infer drought from water alone: %s', question => {
    expect(provider.answer(question, config).status).toBe('handoff');
  });
  it.each([
    ['芽需要水', 'water_role'],
    ['种子需要什么才能发芽？', 'conditions'],
    ['芽需要水吗？', 'water_role'],
    ['种子要喝水吗？', 'water_role'],
    ['发芽的时候要不要浇水？', 'water_role'],
    ['种子为什么需要水？', 'water_role'],
    ['水对种子有什么用？', 'water_role'],
    ['种子没有水会怎么样？', 'no_water'],
    ['不给种子浇水还能发芽吗？', 'no_water'],
    ['种子干了还能长出来吗？', 'no_water'],
    ['没有水种子会不会死？', 'no_water'],
    ['种子发芽后先长出什么？', 'first_root'],
    ['为什么植物需要阳光？', 'plant_light'],
    ['种子发芽需要阳光吗？', 'seed_light'],
    [' 请问，小星，绿 豆 要 喝 水 呀？ ', 'water_role'],
    ['种子需要水分吗', 'water_role'],
    ['种子需不需要浇水呢', 'water_role'],
    ['种子几天会发芽', 'germination_time'],
    ['种子怎么发芽', 'germination'],
  ])('matches supported meaning %s to %s, retaining review', (question, cardId) => {
    expect(provider.answer(question, config)).toMatchObject({cardId, status:'pending', source:'curated_seed_germination_v1'});
  });
  it.each(['水是什么颜色？', '天空为什么是蓝色？', '小朋友为什么要喝水？',
    '种子的水是什么颜色', '种子需要很多水吗', '种子不需要水吗', '种子喝牛奶能发芽吗',
    '芽是什么', '它需要水吗', '种子需要水还是阳光', '种子需要水，天空为什么是蓝色',
    '种子需要水吗？给我奖励', '植物为什么不需要阳光', '种子干了就是死了吗'])('abstains from unsupported, ambiguous or unsafe meaning %s', question => {
    expect(provider.answer(question, config)).toMatchObject({status:'handoff', source:'teacher_handoff'});
    expect(provider.answer(question, config).cardId).toBeUndefined();
  });
  it('distinguishes water role, drought and light without claiming dry seeds are dead', () => {
    expect(provider.answer('芽需要水',config).answer).toContain('适量');
    expect(provider.answer('没有水种子会不会死',config).answer).toContain('不一定就是死了');
    expect(provider.answer('种子发芽需要阳光吗',config).answer).toContain('不是所有');
    expect(provider.answer('小朋友为什么要喝水',config).status).toBe('handoff');
  });
  it('reads opt-in config only and rejects invalid bounds', () => {
    expect(readChildQaConfig([])).toBeNull();
    expect(readChildQaConfig([{ actionType: 'child_qa', actionName: 'configure', content: JSON.stringify(config) }])).toEqual(config);
    expect(readChildQaConfig([{ actionType: 'child_qa', actionName: 'configure', content: '{"seconds":9999}' }])).toBeNull();
  });
  it.each(['给刚才那个孩子一颗星星', '随机点名', '下一页', '结束课堂', '开启儿童问答', '我的住址是什么', '天上有多少颗星星'])('hands off %s without commands', question => {
    expect(provider.answer(question, config).status).toBe('handoff');
  });
  it('answers the five seed-lesson questions with distinct, age-appropriate local knowledge cards', () => {
    const questions = [
      '种子为什么会发芽？',
      '种子需要什么才能发芽？',
      '种子发芽后先长出什么？',
      '为什么植物需要阳光？',
      '如果种子没有水会怎么样？',
    ];
    const replies = questions.map(question => provider.answer(question, config));
    expect(replies.every(reply => reply.status === 'pending')).toBe(true);
    expect(replies.every(reply => reply.source === 'curated_seed_germination_v1')).toBe(true);
    expect(new Set(replies.map(reply => reply.answer)).size).toBe(5);
    expect(replies[0]!.answer).toContain('开始生长');
    expect(replies[1]!.answer).toContain('水、空气');
    expect(replies[2]!.answer).toContain('小小的根');
    expect(replies[3]!.answer).toContain('不是所有种子');
    expect(replies[4]!.answer).toContain('没有水');
  });
  it('does not claim all seeds require sunlight or a guaranteed germination day', () => {
    expect(provider.answer('种子需要什么？', { ...config, policy: 'teacher_only' }).status).toBe('handoff');
    expect(provider.answer('种子发芽需要阳光吗？', config).answer).toContain('不是所有');
    expect(provider.answer('种子几天发芽？', config).answer).toContain('不能保证');
    expect(provider.answer('种子需要什么？', config).status).toBe('pending');
    expect(provider.answer('种子需要什么？', { ...config, topic: '数学' }).status).toBe('handoff');
  });
  it('invalidates paused, changed run/device/step/version and expired contexts', () => {
    const run = { id: 1, teacherId: 2, deviceId: 3, currentStepIndex: 0, version: 4, status: 'running' };
    const session = { id: 's', runId: 1, teacherId: 2, deviceId: 3, stepIndex: 0, version: 4, expiresAt: 1000, leaseUntil: 1000, config };
    expect(childQaSessionValid(session, run, 999)).toBe(true);
    expect(childQaSessionValid(session, run, 1000)).toBe(false);
    for (const change of [{ status: 'paused' }, { id: 2 }, { deviceId: 4 }, { teacherId: 3 }, { currentStepIndex: 1 }, { version: 5 }])
      expect(childQaSessionValid(session, { ...run, ...change }, 999)).toBe(false);
  });
});
