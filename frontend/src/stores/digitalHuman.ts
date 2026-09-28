import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { http } from '@/api/http'

export const DIGITAL_HUMAN_ACTIONS = ['idle', 'listen', 'thinking', 'talk', 'happy', 'question', 'encourage', 'praise', 'wave', 'goodbye'] as const
export type DigitalHumanAction = (typeof DIGITAL_HUMAN_ACTIONS)[number]
export const DIGITAL_HUMAN_MODEL_STATES = ['idle', 'loading', 'loaded', 'error'] as const
export type DigitalHumanModelState = (typeof DIGITAL_HUMAN_MODEL_STATES)[number]
export type DigitalHumanRole = { id: string; name: string; modelUrl?: string }

// 阶段五先使用前端角色配置，后续接入后端角色库时仅替换此配置来源。
export const DIGITAL_HUMAN_ROLES: DigitalHumanRole[] = [
  { id: 'flower', name: '课堂小助手' },
  { id: 'bear', name: '小熊老师' },
  { id: 'garden', name: '园所专属角色' },
]

export const useDigitalHumanStore = defineStore('digitalHuman', () => {
  const action = ref<DigitalHumanAction>('idle')
  const visible = ref(true)
  const compact = ref(false)
  const fallback = ref(true)
  const roleName = ref('课堂小助手')
  const roleId = ref('flower')
  const roles = ref(DIGITAL_HUMAN_ROLES.map((role) => ({ ...role })))
  const loading = ref(false)
  const error = ref('')
  // 3D 模型渲染状态；未启用或加载失败时使用 2D 备用形象
  const webglSupported = ref(false)
  const modelState = ref<DigitalHumanModelState>('idle')
  const isSpeaking = computed(() => action.value === 'talk')

  // 动作状态只能由白名单动作驱动，不执行任意脚本/未知动作
  function setAction(next: DigitalHumanAction) {
    if (!DIGITAL_HUMAN_ACTIONS.includes(next)) return
    action.value = next
  }
  function setWebglSupported(value: boolean) { webglSupported.value = value }
  function setModelState(next: DigitalHumanModelState) {
    modelState.value = next
    if (next === 'loading') { loading.value = true; error.value = ''; fallback.value = false }
    else if (next === 'loaded') { loading.value = false; fallback.value = false }
    else if (next === 'error') { loading.value = false; fallback.value = true }
  }
  function show() { visible.value = true }
  function hide() { visible.value = false }
  function setCompact(value: boolean) { compact.value = value }
  function selectRole(id: string) {
    const role = roles.value.find((item) => item.id === id)
    if (!role) return
    roleId.value = role.id
    roleName.value = role.name
    modelState.value = 'idle'
    error.value = ''
  }
  async function loadRoles() {
    try {
      const { data } = await http.get<{ items?: Array<{ id: number; name: string; description?: string | null }>; total?: number }>('/avatars/characters', { params: { page: 1, pageSize: 50, status: 'approved' } })
      const remoteRoles = (data.items ?? []).map((role) => ({ id: String(role.id), name: role.name, modelUrl: undefined }))
      if (remoteRoles.length) {
        roles.value = remoteRoles
        if (!roles.value.some((role) => role.id === roleId.value)) selectRole(remoteRoles[0]!.id)
      }
    } catch {
      // 角色库不可用时保留本地角色，不能阻塞课堂进入。
    }
  }
  function setFallback(message = '') { fallback.value = true; loading.value = false; error.value = message; action.value = 'idle' }
  function reset() { action.value = 'idle'; visible.value = true; compact.value = false; loading.value = false; error.value = ''; modelState.value = 'idle'; selectRole('flower') }

  return { action, visible, compact, fallback, roleName, roleId, roles, loading, error, webglSupported, modelState, isSpeaking, setAction, setWebglSupported, setModelState, show, hide, setCompact, selectRole, loadRoles, setFallback, reset }
})
