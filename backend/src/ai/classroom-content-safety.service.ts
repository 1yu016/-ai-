import { Injectable } from '@nestjs/common';
import { AiService } from './ai.service';
import { CLASSROOM_CHILD_SAFETY_PATTERNS } from './heuristic-assistant.service';

export const CHILD_SAFE_REDIRECT = '这件事先不要自己尝试。请让身边的老师陪我们一起了解。';
export const CHILD_SAFETY_UNAVAILABLE = '现在暂时不能安全回答这个问题，请老师陪我们一起看看。';
export const CHILD_APPROVAL = { contractVersion: 1, status: 'approved', scope: 'whole_reply' } as const;
const explicitRisk = /(?:用|拿).{0,8}(?:刀|剪刀).{0,8}(?:割|刺|砍)|(?:喝|吃|吞).{0,6}(?:消毒液|清洁剂|洗衣液|药片)|已(?:奖励|点名|翻页|执行)|告诉我.{0,8}(?:名字|地址|电话)|(?:名字|地址|电话号码|手机号).{0,8}告诉我|<|https?:/i;
export const normaliseChildContent = (value: string) => value.normalize('NFKC').replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '');
export const hasChildContentRisk = (value: string) => {
  const normalized = normaliseChildContent(value);
  return [...CLASSROOM_CHILD_SAFETY_PATTERNS, explicitRisk].some(pattern => pattern.test(normalized) || pattern.test(normalized.replace(/\s/g, '')));
};

/** One admission coordinator for classroom dialogue. No writes, tools, audio storage or prompt logs.
 * Rules are shared with the existing heuristic assistant; semantic review reuses the configured SDK.
 * This is layered risk reduction, not a guarantee of exhaustive moderation/anonymisation.
 */
@Injectable()
export class ClassroomContentSafetyService {
  constructor(private readonly ai: AiService) {}
  async check(stage: 'input' | 'output', context: Record<string, unknown>, content: string, history: Array<{ role: 'user' | 'assistant'; content: string }>, parent: AbortSignal): Promise<boolean> {
    if (parent.aborted || !content.trim() || hasChildContentRisk(content) || history.some(turn => hasChildContentRisk(turn.content)) || hasChildContentRisk(JSON.stringify(context))) return false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort!: () => void;
    try {
      const interrupted = new Promise<never>((_resolve, reject) => {
        abort = () => { controller.abort(); reject(new Error('CONTENT_REVIEW_INTERRUPTED')); };
        parent.addEventListener('abort', abort, { once: true });
        timer = setTimeout(abort, 5000);
      });
      const result: unknown = await Promise.race([this.ai.reviewClassroomContent({ stage, context, content, history }, controller.signal), interrupted]);
      if (!result || typeof result !== 'object' || Array.isArray(result) || parent.aborted) return false;
      const value = result as Record<string, unknown>;
      const keys = ['decision', 'ageAppropriate', 'privacySafe', 'noClassroomAction', 'contextAppropriate'];
      return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)) && value.decision === 'allow' && keys.slice(1).every(key => value[key] === true);
    } catch { return false; }
    finally { clearTimeout(timer); parent.removeEventListener('abort', abort); controller.abort(); }
  }
}
