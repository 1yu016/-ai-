import type { AssistantTool } from '@/stores/classroomAssistant'

export const localTeachingMode = import.meta.env.VITE_LOCAL_TEACHING_MODE === 'true'

export function localTeachingDraft(
  topic: string,
  tool: AssistantTool,
  teacherTip?: string | null,
  childReplied = false,
) {
  const subject = topic.trim().slice(0, 80)
  const replies: Partial<Record<AssistantTool, string>> = {
    guided_question: `小朋友们，我们一起观察“${subject}”。你发现了什么？能指给大家看吗？`,
    give_hint: `先看“${subject}”里你最熟悉的一部分。你看到了什么？可以先说一个词。`,
    follow_up: childReplied
      ? '谢谢你分享。你是怎么看出来的？能用手指一指，或者举一个例子吗？'
      : `关于“${subject}”，谁愿意先说一个发现？其他小朋友有什么不同的发现？`,
    encourage: '愿意试着说就是进步。可以先指一指你看到的东西，再慢慢说出自己的想法。',
    summarize: `我们来回顾“${subject}”。谁愿意说一个今天的发现，再给大家做个示范？`,
  }
  return {
    reply: replies[tool] ?? replies.guided_question!,
    teacherTip: teacherTip?.trim() || '请结合本环节实际内容调整后，再向孩子提问。',
  }
}

export function localDirectorSuggestion(topic: string, goal: string, teacherTip?: string | null) {
  const tool = /总结|回顾|复习/.test(goal) ? 'summarize' : /提示|困难/.test(goal) ? 'give_hint' : 'guided_question'
  const draft = localTeachingDraft(topic, tool, teacherTip)
  return `${draft.reply}
${draft.teacherTip}${/节奏|时间|转场/.test(goal) ? ' 给孩子留几秒思考，听完一两位分享后再由教师判断是否进入下一环节。' : ''}`
}
