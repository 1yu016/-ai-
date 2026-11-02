export type ChildQaConfig = { seconds: number; policy: 'teacher_review' | 'teacher_only'; topic: string };
export function readChildQaConfig(actions: unknown): ChildQaConfig | null {
  try {
    const list = typeof actions === 'string' ? JSON.parse(actions) : actions;
    if (!Array.isArray(list)) return null;
    const item = list.find(a => a?.actionType === 'child_qa' && a.actionName === 'configure');
    if (!item) return null;
    const config = JSON.parse(item.content);
    if (!Number.isInteger(config.seconds) || config.seconds < 30 || config.seconds > 300 ||
      !['teacher_review', 'teacher_only'].includes(config.policy) || typeof config.topic !== 'string' ||
      !config.topic.trim() || config.topic.length > 100) return null;
    return { seconds: config.seconds, policy: config.policy, topic: config.topic.trim() };
  } catch { return null; }
}

export type ChildKnowledgeReply = { answer: string; source: string; status: 'pending' | 'handoff' };
export interface ChildKnowledgeProvider { answer(question: string, config: ChildQaConfig): ChildKnowledgeReply | Promise<ChildKnowledgeReply> }
export const CHILD_KNOWLEDGE_PROVIDER = 'CHILD_KNOWLEDGE_PROVIDER';
/** Card ids explain deterministic matches; no model confidence or database field is implied. */
export type SeedCardId = 'germination' | 'conditions' | 'water_role' | 'no_water' | 'first_root' | 'plant_light' | 'seed_light' | 'germination_time';
export function normalizeChildQuestion(text: string): string {
  return text.normalize('NFKC').trim().replace(/[\s，。！？、,.!?：:；;“”"‘’]/gu, '')
    .replace(/^(?:(?:请问|我想知道|小助手|数字人|小星)[呀啊呢]?)+/u, '')
    .replace(/(?:吗|呢|呀|啊|嘛|啦|了呀|的呀)+$/u, '')
    .replace(/绿豆|黄豆|豆子|玉米种子/gu, '种子')
    .replace(/水分/gu, '水').replace(/要不要|需不需要/gu, '需要')
    .replace(/(?:需要|要)?(?:喝水|浇水)/gu, '需要水')
    .replace(/(?:需要|要)(?:晒太阳|阳光|光照)/gu, '需要阳光');
}
const SEED_CARDS: Record<SeedCardId, string> = {
  germination: '种子里面藏着小小的新生命。遇到合适的水分、空气和温度，它就会开始生长，慢慢变成一棵小植物。',
  conditions: '种子发芽通常需要适量的水、空气和合适的温度。不同种子也有自己的小习惯，我们可以一起观察。',
  water_role: '种子吸到适量的水后会慢慢膨胀，开始生长。小芽长大也需要水。我们让纸巾保持湿润，不要让种子一直泡在很多水里。',
  no_water: '没有水，种子就很难吸水、开始发芽。干了不一定就是死了，也不能保证还能发芽；请和老师一起适量加水，连续观察它的变化。',
  first_root: '种子发芽时，通常先从种皮里伸出小小的根，再慢慢长出芽和叶子。我们可以每天观察它的变化。',
  plant_light: '植物的叶子能利用阳光制造自己需要的养分，帮助植物长大。不过，不是所有种子发芽时都必须晒太阳。',
  seed_light: '不同种子的光照要求不一样，不是所有种子发芽都必须晒太阳。我们先看看种的是哪一种，再和老师一起观察。',
  germination_time: '不同种子和环境需要的时间不一样，我不能保证几天发芽。可以每天看一看、画一画，把真的变化记下来。',
};
/** Anchored semantic grammars require both an explicit subject and a supported relation.
 * No bag-of-keywords fallback: unrelated clauses, mixed questions and uncertain objects abstain.
 * Negation is recognized before the positive synonym normalization so it cannot be erased.
 */
export function matchSeedKnowledgeCard(question: string): SeedCardId | null {
  const raw = question.normalize('NFKC').replace(/[\s，。！？、,.!?：:；;]/gu, '')
    .replace(/^(?:(?:请问|我想知道|小助手|数字人|小星)[呀啊呢]?)+/u, '')
    .replace(/(?:吗|呢|呀|啊|嘛)+$/u, '').replace(/绿豆|黄豆|豆子|玉米种子/gu, '种子').replace(/水分/gu, '水');
  const subject = '(?:种子|芽|小芽|发芽(?:的时候|时)?)';
  const outcome = '(?:会怎么样|会怎样|会发生什么|会有什么影响|有什么影响|怎么办|还能发芽|能发芽|还能长出来|能长出来|会不会死|会死|会不会发芽|会发芽|长得出来)';
  // Keep negated watering separate from positive water-role normalization; all branches share consequences.
  const drought = new RegExp('^(?:(?:如果)?' + subject + '(?:没有水|没水|缺水|干了|不浇水|不加水|不喝水)(?:' + outcome + ')?|(?:不|不给种子|不给芽|不给小芽)(?:浇水|加水|水喝|水)' + outcome + '|(?:没有水|没水)(?:种子|芽|小芽)' + outcome + ')$');
  if (drought.test(raw)) return 'no_water';
  const q = normalizeChildQuestion(question);
  const rules: Array<[SeedCardId, RegExp]> = [
    ['seed_light', /^(?:种子|发芽|种子发芽)(?:一定要|必须要|需要)(?:晒太阳|阳光|光照)$/u],
    ['plant_light', /^(?:为什么植物需要阳光|植物为什么需要阳光|植物需要阳光)$/u],
    ['first_root', /^(?:种子|芽|小芽)发芽后(?:先长出什么|先长什么|会先长什么)$/u],
    ['first_root', /^种子(?:为什么|怎么)(?:先长根|会长根)$/u],
    ['germination_time', /^种子(?:多久|几天)(?:会|能|才会)?发芽$/u],
    ['water_role', new RegExp('^(?:' + subject + '(?:为什么)?(?:需要水|要水)|为什么' + subject + '需要水|水对(?:种子|芽|小芽)(?:有什么用|有什么作用|有什么帮助))$')],
    ['conditions', /^种子(?:发芽)?(?:需要什么(?:才能发芽)?(?:条件)?|需要哪些条件|要什么条件|怎样才能发芽)$/u],
    ['germination', /^(?:种子(?:为什么|怎么|怎样)(?:会)?发芽|(?:为什么|怎么|怎样)种子(?:会)?发芽)$/u],
  ];
  const matches = rules.filter(([, rule]) => rule.test(q));
  return matches.length === 1 ? matches[0]![0] : null;
}
/** Finite local intent matching; all answers remain drafts requiring teacher review. */
export class LocalChildKnowledgeProvider implements ChildKnowledgeProvider {
  answer(question: string, config: ChildQaConfig): ChildKnowledgeReply & { cardId?: SeedCardId } {
    const handoff: ChildKnowledgeReply = { answer: '这个问题请老师和我们一起看看，我还不能确定答案。', source: 'teacher_handoff', status: 'handoff' };
    if (config.policy === 'teacher_only' || /奖励|点名|星星|翻页|结束|暂停|下课|切换|开启|关闭|给.*花|电话|地址|住址|药|受伤|死亡|秘密|脱衣|杀|打人|自杀/.test(question)) return handoff;
    if (!/种子|发芽|植物|绿豆/.test(config.topic)) return handoff;
    const cardId = matchSeedKnowledgeCard(question);
    return cardId ? { answer: SEED_CARDS[cardId], source: 'curated_seed_germination_v1', status: 'pending', cardId } : handoff;
  }
}

export type ChildQaSession = { id: string; runId: number; teacherId: number; deviceId: number; stepIndex: number; version: number; pendingVersion?: number; expiresAt: number; leaseUntil: number; config: ChildQaConfig };
export function childQaSessionValid(session: ChildQaSession, run: { id: number; teacherId: number; deviceId: number; currentStepIndex: number; version: number; status: string }, now = Date.now()) {
  return session.runId === run.id && session.teacherId === run.teacherId && session.deviceId === run.deviceId &&
    session.stepIndex === run.currentStepIndex && (session.version === run.version || session.pendingVersion === run.version) && run.status === 'running' && now < session.expiresAt && now < session.leaseUntil;
}
