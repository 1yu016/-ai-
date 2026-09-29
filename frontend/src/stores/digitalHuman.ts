import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { listAvatarCharacters, resolveAvatar } from '@/api/avatar'
import type { ResolveAvatarContext, ResolveAvatarResponse } from '@/api/avatar'
import type { AvatarModelFormat, AvatarRuntimeConfig } from '@/avatar/types'

export const DIGITAL_HUMAN_ACTIONS = ['idle', 'listen', 'thinking', 'talk', 'happy', 'question', 'encourage', 'praise', 'wave', 'goodbye'] as const
export type DigitalHumanAction = (typeof DIGITAL_HUMAN_ACTIONS)[number]
export const DIGITAL_HUMAN_MODEL_STATES = ['idle', 'loading', 'loaded', 'error'] as const
export type DigitalHumanModelState = (typeof DIGITAL_HUMAN_MODEL_STATES)[number]

// 角色项保留后端完整可用字段，不再只存名字。
export type AvatarRole = { id: string; name: string; category?: string | null; description?: string | null; status?: string | null }

// 阶段五先使用前端角色配置，后续接入后端角色库时仅替换此配置来源。
// 后端有已审核角色时以列表接口返回为准（见 loadRoles）。
export const DIGITAL_HUMAN_ROLES: AvatarRole[] = [
  { id: 'flower', name: '课堂小助手', category: 'local', description: '本地默认角色' },
  { id: 'bear', name: '小熊老师', category: 'local', description: '本地默认角色' },
  { id: 'garden', name: '园所专属角色', category: 'local', description: '本地默认角色' },
]

export const useDigitalHumanStore = defineStore('digitalHuman', () => {
  const action = ref<DigitalHumanAction>('idle')
  const visible = ref(true)
  const compact = ref(false)
  const fallback = ref(true)
  const roleName = ref('课堂小助手')
  const roleId = ref('flower')
  const roles = ref<AvatarRole[]>(DIGITAL_HUMAN_ROLES.map((role) => ({ ...role })))
  const loading = ref(false)
  const error = ref('')
  // 3D 模型渲染状态；未启用或加载失败时使用 2D 备用形象
  const webglSupported = ref(false)
  const modelState = ref<DigitalHumanModelState>('idle')
  const isSpeaking = computed(() => action.value === 'talk')
  // 当前课堂数字人运行时配置（resolve 结果）
  const runtime = ref<AvatarRuntimeConfig | null>(null)

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

  // 将 resolve 响应映射为前端运行时配置（缺失字段用安全默认值）。
  function toRuntimeConfig(data: ResolveAvatarResponse): AvatarRuntimeConfig {
    const format: AvatarModelFormat | null =
      data.version?.modelFormat === 'gltf' ? 'gltf' : data.version?.modelFormat === 'glb' ? 'glb' : null
    return {
      characterId: data.character?.id ?? null,
      characterName: data.character?.name ?? '',
      modelUrl: data.renderAsset?.contentUrl ?? null,
      modelFormat: format,
      engineVersion: data.version?.engineVersion ?? null,
      versionId: data.version?.id ?? null,
      sourceScope: data.sourceScope,
      voice: data.voice,
      personality: data.personality,
      fallbackLevel: data.fallbackLevel,
      reason: data.reason,
    }
  }

  async function loadRoles() {
    try {
      const result = await listAvatarCharacters()
      const remoteRoles = result.items.map((role) => ({ id: String(role.id), name: role.name, category: role.category ?? null, description: role.description ?? null, status: role.status ?? null }))
      if (remoteRoles.length) {
        roles.value = remoteRoles
        if (!roles.value.some((role) => role.id === roleId.value)) selectRole(remoteRoles[0]!.id)
      }
    } catch {
      // 角色库不可用时保留本地角色，不能阻塞课堂进入。
    }
  }

  // 课堂运行时解析：获取当前课堂应使用的角色与模型配置。
  // 后端按 System < 班级 < 教案 < 课堂 作用域解析，失败时保持 fallback=true（2D 或内置占位模型）。
  async function loadRuntime(context: ResolveAvatarContext) {
    try {
      const data = await resolveAvatar(context)
      runtime.value = toRuntimeConfig(data)
    } catch {
      // resolve 失败不能阻塞课堂：保留现有默认/占位形象。
      runtime.value = null
    }
  }

  function setFallback(message = '') { fallback.value = true; loading.value = false; error.value = message; action.value = 'idle' }
  function reset() { action.value = 'idle'; visible.value = true; compact.value = false; loading.value = false; error.value = ''; modelState.value = 'idle'; runtime.value = null; selectRole('flower') }

  return { action, visible, compact, fallback, roleName, roleId, roles, loading, error, webglSupported, modelState, isSpeaking, runtime, setAction, setWebglSupported, setModelState, show, hide, setCompact, selectRole, loadRoles, loadRuntime, setFallback, reset }
})