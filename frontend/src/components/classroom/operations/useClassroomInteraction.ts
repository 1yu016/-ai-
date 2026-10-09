import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { apiErrorMessage } from '@/api/http'
import type { Student } from '@/api/platform'
import type { LessonRun } from '@/stores/lessonRun'
import {
  postReward,
  QUICK_REWARD_REASONS,
  type RewardRecord,
} from '@/services/classroomCheckpoint'

/** 课堂快速互动（点名 + 快速奖励）唯一业务实现。
 *  普通面板与全屏操作台共用此 composable，禁止在组件内复制随机/奖励逻辑。
 *  数据只来自 props；选中学生/奖励结果通过 emit 上抛给 parent，保持单一 Homework 状态源。 */
export type ClassroomInteractionEmit = {
  (e: 'update:selectedStudentId', id: number | null): void
  (e: 'random-roll', student: Student): void
  (e: 'rewarded', record: RewardRecord): void
}

export interface ClassroomInteractionPropsLike {
  run: LessonRun | null
  students: Student[]
  selectedStudentId: number | null
  busy: boolean
  disabled: boolean
}

export function useClassroomInteraction(
  props: ClassroomInteractionPropsLike,
  emit: ClassroomInteractionEmit,
) {
  // 启用学生：排除已停用，保证点名/奖励都在当前班真实学生范围内。
  const displayStudents = computed(() =>
    props.students.filter((s) => s.status !== 'disabled'),
  )
  const selected = computed(() => {
    if (props.selectedStudentId == null) return null
    return (
      displayStudents.value.find((s) => s.id === props.selectedStudentId) ?? null
    )
  })

  const reason = ref<string>(QUICK_REWARD_REASONS[0])
  const submitting = ref(false)
  const message = ref('')
  const errorMsg = ref('')

  const nameOf = (s: Student) => s.nickname || s.name

  const interactionLocked = computed(
    () => props.disabled || !props.run || props.busy,
  )
  const canReward = computed(
    () =>
      !interactionLocked.value &&
      !submitting.value &&
      props.selectedStudentId != null,
  )

  function setSelected(id: number | null) {
    emit('update:selectedStudentId', id)
  }

  function randomRoll() {
    if (interactionLocked.value) return
    const pool = displayStudents.value
    if (!pool.length) return
    const picked = pool[Math.floor(Math.random() * pool.length)]
    if (!picked) return
    setSelected(picked.id)
    message.value = ''
    errorMsg.value = ''
    emit('random-roll', picked)
  }

  // 快速奖励：必须走正式 rewards API（postReward 内部含 requestId 幂等）。
  // 后端成功后才提示并 emit rewarded；失败不 +1、保留选中幼儿。
  async function reward() {
    if (!canReward.value) {
      ElMessage.warning('请先选中一位幼儿再发放奖励。')
      return
    }
    const run = props.run
    if (!run) return
    const studentId = props.selectedStudentId as number
    const student = selected.value
    submitting.value = true
    errorMsg.value = ''
    try {
      const result = await postReward(run, studentId, 1, reason.value)
      const stars = result.record.stars ?? 1
      message.value = `已奖励${student ? nameOf(student) : `幼儿 ${studentId}`} ${stars} 朵小红花`
      emit('rewarded', result.record)
    } catch (e) {
      // 失败不 +1、不丢选中，仅提示重试。
      errorMsg.value = apiErrorMessage(e, '奖励失败，请重试。')
      message.value = ''
    } finally {
      submitting.value = false
    }
  }

  return {
    // 常量：原因选项单一来源，供模板直接循环。
    QUICK_REWARD_REASONS,
    // 状态
    displayStudents,
    selected,
    reason,
    submitting,
    message,
    errorMsg,
    // 派生
    nameOf,
    interactionLocked,
    canReward,
    // 动作
    setSelected,
    randomRoll,
    reward,
  }
}