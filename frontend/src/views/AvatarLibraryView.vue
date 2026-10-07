<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import ManagementLayout from '@/components/ManagementLayout.vue'
import DigitalHumanStage from '@/components/DigitalHumanStage.vue'
import { apiErrorMessage } from '@/api/http'
import {
  createAvatarCharacter,
  createAvatarVersion,
  disableAvatarVersion,
  fetchAvatarAsset,
  getAvatarCharacter,
  listAvatarCharacters,
  publishAvatarVersion,
  reviewAvatar,
  saveAvatarPersonality,
  saveAvatarVoice,
  setClassAvatar,
  setClassroomAvatar,
  setLessonAvatar,
  submitAvatarReview,
  updateAvatarCharacter,
  uploadAvatarAsset,
  type AvatarAsset,
  type AvatarCharacterDetail,
  type AvatarCharacterListItem,
  type AvatarVersion,
} from '@/api/avatar'
import { platformApi, type SchoolClass } from '@/api/platform'
import { useDigitalHumanStore, DIGITAL_HUMAN_ACTIONS, type DigitalHumanAction } from '@/stores/digitalHuman'
import { useLessonPlanStore, type LessonPlan } from '@/stores/lessonPlan'
import { useLessonRunStore } from '@/stores/lessonRun'
import { useUserStore } from '@/stores/user'

const user = useUserStore()
const digitalHuman = useDigitalHumanStore()
const lessonPlans = useLessonPlanStore()
const runStore = useLessonRunStore()
const isAdmin = computed(() => user.isAdmin)
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const message = ref('')
const category = ref('')
const status = ref('')
const characters = ref<AvatarCharacterListItem[]>([])
const selected = ref<AvatarCharacterDetail | null>(null)
const classes = ref<SchoolClass[]>([])
const plans = ref<LessonPlan[]>([])
const previewUrls = reactive<Record<number, string>>({})

const characterForm = reactive({ name: '', category: 'teacher_assistant', description: '' })
const voiceForm = reactive({ provider: 'system', voiceId: 'default-child-safe', language: 'zh-CN', speed: 1, volume: 1, pitch: 0, status: 'active' as 'active' | 'disabled' | 'unavailable' })
const personalityForm = reactive({ style: '温暖启发式', catchphrases: '', greeting: '小朋友们好，我们一起开始今天的活动吧！', encouragementStyle: '先肯定努力，再给一个小提示。', goodbyeText: '今天表现得很棒，我们下次再见！' })
const bindingForm = reactive({ classId: 0, lessonPlanId: 0 })
const versionForm = reactive({ engineVersion: 'avatar-engine-1', modelFormat: 'glb', file: null as File | null })
const assetForm = reactive({ versionId: 0, assetType: 'preview', actionName: 'idle', file: null as File | null })

const categoryLabels: Record<string, string> = {
  teacher_assistant: '教师助手',
  cartoon_animal: '卡通动物',
  kindergarten_custom: '园所角色',
}
const statusLabels: Record<string, string> = { draft: '草稿', pending: '待审核', approved: '已发布', rejected: '已驳回', disabled: '已停用' }
const assetLabels: Record<string, string> = { model: '主模型', texture: '贴图', animation: '动作', expression: '表情', lip_sync: '口型', preview: '预览图', fallback_2d: '2D备用图' }
const selectedReadyVersion = computed(() => selected.value?.versions.find((item) => item.status === 'ready') ?? null)
const selectedCanUse = computed(() => selected.value?.status === 'approved' && Boolean(selectedReadyVersion.value))
const currentRun = computed(() => runStore.run)

function requestId(prefix: string) {
  return `${prefix}-${Date.now()}-${crypto.randomUUID?.() ?? Math.random().toString(16).slice(2)}`
}

function clearNotice() { error.value = ''; message.value = '' }
function report(cause: unknown, fallback: string) { console.error(fallback, cause); error.value = apiErrorMessage(cause, fallback) }

function revokePreviews() {
  Object.values(previewUrls).forEach((url) => URL.revokeObjectURL(url))
  Object.keys(previewUrls).forEach((key) => delete previewUrls[Number(key)])
}

async function loadProtectedPreviews(detail: AvatarCharacterDetail) {
  revokePreviews()
  const imageAssets = detail.versions.flatMap((version) => version.assets).filter((asset) => asset.assetType === 'preview' || asset.assetType === 'fallback_2d')
  await Promise.all(imageAssets.map(async (asset) => {
    try { previewUrls[asset.id] = URL.createObjectURL(await fetchAvatarAsset(asset.id)) }
    catch (cause) { console.error('数字人预览图加载失败：', cause) }
  }))
}

function applyDetail(detail: AvatarCharacterDetail) {
  selected.value = detail
  characterForm.name = detail.name
  characterForm.category = detail.category || 'teacher_assistant'
  characterForm.description = detail.description || ''
  Object.assign(voiceForm, detail.voiceProfile ?? { provider: 'system', voiceId: 'default-child-safe', language: 'zh-CN', speed: 1, volume: 1, pitch: 0, status: 'active' })
  Object.assign(personalityForm, detail.personality ? { ...detail.personality, catchphrases: detail.personality.catchphrases.join('\n') } : { style: '温暖启发式', catchphrases: '', greeting: '小朋友们好，我们一起开始今天的活动吧！', encouragementStyle: '先肯定努力，再给一个小提示。', goodbyeText: '今天表现得很棒，我们下次再见！' })
  assetForm.versionId = detail.versions[0]?.id ?? 0
  void loadProtectedPreviews(detail)
}

async function selectCharacter(id: number) {
  clearNotice(); loading.value = true
  try {
    const detail = await getAvatarCharacter(id)
    applyDetail(detail)
    const ready = detail.versions.find((item) => item.status === 'ready')
    if (ready) {
      const model = ready.assets.find((item) => item.assetType === 'model')
      digitalHuman.previewRuntime({
        character: { id: detail.id, name: detail.name, category: detail.category },
        model: { versionId: ready.id, engineVersion: ready.engineVersion, modelFormat: ready.modelFormat, modelUrl: model?.contentUrl ?? null },
        voice: detail.voiceProfile,
        personality: detail.personality,
        fallbackLevel: model ? 'none' : 'model_2d',
        reason: model ? null : '主模型不可用，使用2D或程序化备用角色',
        sourceScope: 'preview',
      })
    }
  } catch (cause) { report(cause, '角色详情加载失败，请稍后重试。') }
  finally { loading.value = false }
}

async function loadCharacters() {
  clearNotice(); loading.value = true
  try {
    const result = await listAvatarCharacters({ category: category.value || undefined, status: isAdmin.value ? status.value || undefined : 'approved' })
    characters.value = result.items
    if (characters.value.length && !characters.value.some((item) => item.id === selected.value?.id)) await selectCharacter(characters.value[0]!.id)
    if (!characters.value.length) { selected.value = null; revokePreviews() }
  } catch (cause) { report(cause, '数字人角色加载失败，请稍后重试。') }
  finally { loading.value = false }
}

async function refreshSelected(text = '') {
  if (!selected.value) return
  applyDetail(await getAvatarCharacter(selected.value.id))
  await loadCharacters()
  if (text) message.value = text
}

async function createCharacter() {
  clearNotice()
  if (!characterForm.name.trim()) { error.value = '请输入角色名称。'; return }
  saving.value = true
  try {
    const created = await createAvatarCharacter({ name: characterForm.name.trim(), category: characterForm.category, description: characterForm.description.trim() })
    await loadCharacters(); await selectCharacter(created.id); message.value = '角色草稿已创建。'
  } catch (cause) { report(cause, '角色创建失败。') }
  finally { saving.value = false }
}

async function saveMetadata() {
  if (!selected.value) return
  clearNotice(); saving.value = true
  try { await updateAvatarCharacter(selected.value.id, { name: characterForm.name.trim(), category: characterForm.category, description: characterForm.description.trim() }); await refreshSelected('角色资料已保存，修改后需重新审核。') }
  catch (cause) { report(cause, '角色资料保存失败。') }
  finally { saving.value = false }
}

async function saveConfiguration() {
  if (!selected.value) return
  clearNotice(); saving.value = true
  try {
    await saveAvatarVoice(selected.value.id, { ...voiceForm, reason: '角色管理页面更新音色' })
    await saveAvatarPersonality(selected.value.id, { style: personalityForm.style.trim(), catchphrases: personalityForm.catchphrases.split('\n').map((item) => item.trim()).filter(Boolean), greeting: personalityForm.greeting.trim(), encouragementStyle: personalityForm.encouragementStyle.trim(), goodbyeText: personalityForm.goodbyeText.trim(), reason: '角色管理页面更新性格' })
    await refreshSelected('声音和性格配置已保存。')
  } catch (cause) { report(cause, '角色配置保存失败。') }
  finally { saving.value = false }
}

function previewVoice() {
  clearNotice()
  const text = personalityForm.greeting.trim() || '小朋友们好，我们一起开始上课吧！'
  if (!('speechSynthesis' in window)) {
    message.value = '当前浏览器不支持声音试听，课堂将使用系统默认音色。'
    return
  }
  try {
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = voiceForm.language
    utterance.rate = voiceForm.speed
    utterance.volume = voiceForm.volume
    utterance.pitch = Math.max(0, Math.min(2, 1 + voiceForm.pitch / 12))
    utterance.onerror = () => { message.value = '指定声音不可用，已使用浏览器默认音色。' }
    window.speechSynthesis.speak(utterance)
  } catch (cause) { report(cause, '声音试听失败，课堂将使用默认音色。') }
}

function playAction(action: DigitalHumanAction) { digitalHuman.playAction(action) }

async function bind(scope: 'class' | 'lesson' | 'run') {
  if (!selected.value || !selectedReadyVersion.value || !selectedCanUse.value) { error.value = '只有已发布且存在可用版本的角色可以绑定。'; return }
  clearNotice(); saving.value = true
  const input = { characterId: selected.value.id, versionId: selectedReadyVersion.value.id, reason: '教师在角色管理页面配置' }
  try {
    if (scope === 'class') {
      if (!bindingForm.classId) throw new Error('请选择班级')
      await setClassAvatar(bindingForm.classId, input)
    } else if (scope === 'lesson') {
      if (!bindingForm.lessonPlanId) throw new Error('请选择教案')
      await setLessonAvatar(bindingForm.lessonPlanId, input)
    } else {
      if (!currentRun.value) throw new Error('当前没有进行中的课堂')
      const updated = await setClassroomAvatar(currentRun.value.id, { ...input, deviceId: currentRun.value.deviceId, version: currentRun.value.version, requestId: requestId('avatar-switch') })
      runStore.adoptRun(updated as Parameters<typeof runStore.adoptRun>[0])
      await digitalHuman.loadRuntime({ classroomRunId: currentRun.value.id, deviceId: currentRun.value.deviceId })
    }
    message.value = scope === 'class' ? '班级默认角色已设置。' : scope === 'lesson' ? '教案角色已设置。' : '当前课堂临时角色已切换。'
  } catch (cause) { report(cause, cause instanceof Error ? cause.message : '角色绑定失败。') }
  finally { saving.value = false }
}

async function uploadVersion() {
  if (!selected.value || !versionForm.file) { error.value = '请选择GLB、GLTF或VRM模型文件。'; return }
  clearNotice(); saving.value = true
  try { await createAvatarVersion(selected.value.id, { file: versionForm.file, modelFormat: versionForm.modelFormat, engineVersion: versionForm.engineVersion }); versionForm.file = null; await refreshSelected('新模型版本已创建。') }
  catch (cause) { report(cause, '模型版本创建失败。') }
  finally { saving.value = false }
}

async function uploadAsset() {
  if (!assetForm.versionId || !assetForm.file) { error.value = '请选择版本和资源文件。'; return }
  clearNotice(); saving.value = true
  try {
    await uploadAvatarAsset(assetForm.versionId, { file: assetForm.file, assetType: assetForm.assetType, actionName: assetForm.assetType === 'animation' ? (assetForm.actionName === 'talk' ? 'talk' : assetForm.actionName) : undefined })
    assetForm.file = null; await refreshSelected('角色资源已上传。')
  } catch (cause) { report(cause, '角色资源上传失败。') }
  finally { saving.value = false }
}

async function runAdminAction(action: 'publish' | 'submit' | 'approve' | 'reject' | 'disableCharacter' | 'disableVersion', version?: AvatarVersion) {
  if (!selected.value) return
  clearNotice(); saving.value = true
  try {
    if (action === 'publish' && version) await publishAvatarVersion(version.id)
    else if (action === 'submit') await submitAvatarReview(selected.value.id)
    else if (action === 'approve') await reviewAvatar(selected.value.id, 'approved', '管理员审核通过')
    else if (action === 'reject') await reviewAvatar(selected.value.id, 'rejected', '管理员审核驳回')
    else if (action === 'disableCharacter') await reviewAvatar(selected.value.id, 'disabled', '管理员停用角色')
    else if (action === 'disableVersion' && version) await disableAvatarVersion(version.id, '管理员停用版本')
    await refreshSelected('角色状态已更新并写入审计日志。')
  } catch (cause) { report(cause, '角色状态更新失败。') }
  finally { saving.value = false }
}

function fileChanged(event: Event, target: 'version' | 'asset') {
  const file = (event.target as HTMLInputElement).files?.[0] ?? null
  if (target === 'version') versionForm.file = file
  else assetForm.file = file
}

function firstImageAsset(type: 'preview' | 'fallback_2d'): AvatarAsset | null {
  return selected.value?.versions.flatMap((item) => item.assets).find((item) => item.assetType === type) ?? null
}

onMounted(async () => {
  await Promise.allSettled([
    loadCharacters(),
    platformApi.classes().then(({ data }) => { classes.value = data.items }),
    lessonPlans.fetchList().then(() => { plans.value = [...lessonPlans.items] }),
  ])
})
onBeforeUnmount(() => { revokePreviews(); window.speechSynthesis?.cancel(); digitalHuman.setAction('idle') })
</script>

<template>
  <ManagementLayout>
    <div class="page-head">
      <div><h1>数字人角色库</h1><p class="muted">管理课堂角色、声音、性格和使用范围。课堂故障时会自动安全降级。</p></div>
      <button v-if="isAdmin" class="button" :disabled="saving" @click="createCharacter">新建角色草稿</button>
    </div>

    <div class="toolbar">
      <select v-model="category" @change="loadCharacters"><option value="">全部分类</option><option v-for="(label, key) in categoryLabels" :key="key" :value="key">{{ label }}</option></select>
      <select v-if="isAdmin" v-model="status" @change="loadCharacters"><option value="">全部状态</option><option v-for="(label, key) in statusLabels" :key="key" :value="key">{{ label }}</option></select>
      <button class="secondary" @click="loadCharacters">刷新</button>
      <span v-if="loading" class="muted">正在加载…</span>
    </div>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <p v-if="message" class="notice success">{{ message }}</p>

    <div class="workspace">
      <aside class="role-list panel">
        <button v-for="item in characters" :key="item.id" class="role-card" :class="{active: selected?.id === item.id}" @click="selectCharacter(item.id)">
          <span class="role-icon">{{ item.category === 'cartoon_animal' ? '🐻' : item.category === 'kindergarten_custom' ? '🏫' : '👩‍🏫' }}</span>
          <span><strong>{{ item.name }}</strong><small>{{ categoryLabels[item.category || ''] || item.category }} · {{ statusLabels[item.status || ''] || item.status }}</small></span>
        </button>
        <div v-if="!characters.length && !loading" class="empty">暂无可用角色</div>
      </aside>

      <section v-if="selected" class="detail">
        <div class="preview-grid">
          <div class="panel stage"><DigitalHumanStage /><div class="action-row"><button v-for="action in DIGITAL_HUMAN_ACTIONS" :key="action" @click="playAction(action)">{{ action }}</button></div></div>
          <div class="panel images">
            <h2>安全预览</h2>
            <div class="image-pair">
              <figure><img v-if="firstImageAsset('preview') && previewUrls[firstImageAsset('preview')!.id]" :src="previewUrls[firstImageAsset('preview')!.id]" alt="角色预览图"><div v-else class="placeholder">暂无预览图</div><figcaption>角色预览</figcaption></figure>
              <figure><img v-if="firstImageAsset('fallback_2d') && previewUrls[firstImageAsset('fallback_2d')!.id]" :src="previewUrls[firstImageAsset('fallback_2d')!.id]" alt="2D备用角色"><div v-else class="placeholder">程序化角色兜底</div><figcaption>2D备用图</figcaption></figure>
            </div>
            <p class="muted">加载顺序：VRM → GLB → 2D备用图 / 程序化角色。</p>
          </div>
        </div>

        <div class="panel form-grid">
          <h2>角色资料</h2>
          <label>角色名称<input v-model="characterForm.name" :disabled="!isAdmin"></label>
          <label>角色分类<select v-model="characterForm.category" :disabled="!isAdmin"><option v-for="(label, key) in categoryLabels" :key="key" :value="key">{{ label }}</option></select></label>
          <label class="wide">角色说明<textarea v-model="characterForm.description" :disabled="!isAdmin"></textarea></label>
          <button v-if="isAdmin" class="button" :disabled="saving" @click="saveMetadata">保存角色资料</button>
        </div>

        <div class="panel form-grid">
          <h2>声音与性格</h2>
          <p v-if="!isAdmin" class="muted wide">角色声音与性格由管理员维护，教师可以试听并选择课堂使用范围。</p>
          <label>声音提供方<input v-model="voiceForm.provider" :disabled="!isAdmin"></label><label>音色ID<input v-model="voiceForm.voiceId" :disabled="!isAdmin"></label>
          <label>语速 {{ voiceForm.speed.toFixed(1) }}<input v-model.number="voiceForm.speed" type="range" min="0.5" max="2" step="0.1" :disabled="!isAdmin"></label>
          <label>音量 {{ voiceForm.volume.toFixed(1) }}<input v-model.number="voiceForm.volume" type="range" min="0" max="1" step="0.1" :disabled="!isAdmin"></label>
          <label>性格<input v-model="personalityForm.style" :disabled="!isAdmin"></label><label>口头禅（每行一条）<textarea v-model="personalityForm.catchphrases" :disabled="!isAdmin"></textarea></label>
          <label class="wide">问候语<textarea v-model="personalityForm.greeting" :disabled="!isAdmin"></textarea></label>
          <label class="wide">鼓励语<textarea v-model="personalityForm.encouragementStyle" :disabled="!isAdmin"></textarea></label>
          <label class="wide">告别语<textarea v-model="personalityForm.goodbyeText" :disabled="!isAdmin"></textarea></label>
          <div class="button-row"><button class="secondary" @click="previewVoice">试听声音</button><button v-if="isAdmin" class="button" :disabled="saving" @click="saveConfiguration">保存配置</button></div>
        </div>

        <div class="panel bindings">
          <h2>课堂使用范围</h2><p v-if="!selectedCanUse" class="notice warning">该角色尚未发布或缺少可用版本，不能绑定课堂。</p>
          <div class="binding-row"><select v-model.number="bindingForm.classId"><option :value="0">选择班级</option><option v-for="item in classes" :key="item.id" :value="item.id">{{ item.name }}</option></select><button class="button" :disabled="!selectedCanUse || saving" @click="bind('class')">设为班级默认角色</button></div>
          <div class="binding-row"><select v-model.number="bindingForm.lessonPlanId"><option :value="0">选择教案</option><option v-for="item in plans" :key="item.id" :value="item.id">{{ item.title }}</option></select><button class="button" :disabled="!selectedCanUse || saving" @click="bind('lesson')">设为教案角色</button></div>
          <div class="binding-row"><span>{{ currentRun ? `当前课堂：${currentRun.lessonTitle}` : '当前没有进行中的课堂' }}</span><button class="button" :disabled="!selectedCanUse || !currentRun || saving" @click="bind('run')">临时用于当前课堂</button></div>
        </div>

        <div v-if="isAdmin" class="panel admin-tools">
          <h2>管理员发布与审核</h2>
          <div class="upload-row"><input v-model="versionForm.engineVersion" aria-label="引擎版本"><select v-model="versionForm.modelFormat"><option value="glb">GLB</option><option value="gltf">GLTF</option><option value="vrm">VRM</option></select><input type="file" accept=".glb,.gltf,.vrm" @change="fileChanged($event, 'version')"><button class="button" :disabled="saving" @click="uploadVersion">创建模型版本</button></div>
          <div class="upload-row"><select v-model.number="assetForm.versionId"><option :value="0">选择版本</option><option v-for="item in selected.versions" :key="item.id" :value="item.id">v{{ item.version }} · {{ item.status }}</option></select><select v-model="assetForm.assetType"><option v-for="(label, key) in assetLabels" :key="key" :value="key" :disabled="key === 'model'">{{ label }}</option></select><select v-if="assetForm.assetType === 'animation'" v-model="assetForm.actionName"><option v-for="action in DIGITAL_HUMAN_ACTIONS" :key="action" :value="action">{{ action }}</option></select><input type="file" @change="fileChanged($event, 'asset')"><button class="button" :disabled="saving" @click="uploadAsset">上传版本资源</button></div>
          <div v-for="item in selected.versions" :key="item.id" class="version-row"><span>v{{ item.version }} · {{ item.modelFormat }} · {{ item.status }}</span><span>{{ item.assets.length }}项资源</span><button v-if="item.status === 'draft'" @click="runAdminAction('publish', item)">完整性检查并发布版本</button><button v-if="item.status !== 'disabled'" @click="runAdminAction('disableVersion', item)">停用版本</button></div>
          <div class="button-row"><button v-if="selected.status === 'draft' || selected.status === 'rejected'" @click="runAdminAction('submit')">提交审核</button><button v-if="selected.status === 'pending'" class="button" @click="runAdminAction('approve')">审核通过</button><button v-if="selected.status === 'pending'" @click="runAdminAction('reject')">驳回</button><button v-if="selected.status !== 'disabled'" class="danger" @click="runAdminAction('disableCharacter')">停用角色</button></div>
        </div>
      </section>
      <section v-else class="panel empty-main">选择左侧角色查看配置</section>
    </div>
  </ManagementLayout>
</template>

<style scoped>
.page-head{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}.page-head h1{margin:0 0 7px}.toolbar{display:flex;gap:10px;align-items:center;margin:22px 0}.toolbar select,.form-grid input,.form-grid select,.form-grid textarea,.binding-row select,.admin-tools input,.admin-tools select{border:1px solid #ead7c8;border-radius:11px;background:#fff;color:#60483e;padding:9px 11px}.secondary,.action-row button,.version-row button,.button-row button{border:1px solid #e8cbb8;background:#fff;color:#9a6248;border-radius:10px;padding:8px 12px;cursor:pointer}.workspace{display:grid;grid-template-columns:260px minmax(0,1fr);gap:18px;align-items:start}.role-list{display:grid;gap:8px;position:sticky;top:20px;max-height:calc(100dvh - 150px);overflow:auto}.role-card{border:0;background:#fff8f0;border-radius:13px;padding:11px;display:flex;gap:10px;text-align:left;color:#634c41;cursor:pointer}.role-card.active{background:#ffe3d0;box-shadow:inset 0 0 0 2px #e9976e}.role-card small{display:block;margin-top:4px;color:#a17f6d}.role-icon{font-size:28px}.detail{display:grid;gap:16px}.preview-grid{display:grid;grid-template-columns:minmax(300px,1fr) minmax(280px,1fr);gap:16px}.stage{min-height:350px}.stage :deep(.digital-human){height:280px;max-width:320px}.action-row{display:flex;gap:5px;flex-wrap:wrap;justify-content:center;margin-top:8px}.action-row button{font-size:11px;padding:5px 8px}.images h2,.form-grid h2,.bindings h2,.admin-tools h2{grid-column:1/-1;margin:0 0 8px}.image-pair{display:grid;grid-template-columns:1fr 1fr;gap:10px}.image-pair figure{margin:0}.image-pair img,.placeholder{width:100%;aspect-ratio:1;object-fit:contain;border-radius:12px;background:#fff6eb}.placeholder{display:grid;place-items:center;color:#af8e7c}.image-pair figcaption{text-align:center;margin-top:6px;color:#8b6e5f}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:13px}.form-grid label{display:grid;gap:6px;font-size:13px}.form-grid textarea{min-height:74px;resize:vertical}.form-grid .wide,.form-grid .button-row{grid-column:1/-1}.button-row{display:flex;gap:9px;flex-wrap:wrap}.bindings{display:grid;gap:10px}.binding-row,.upload-row,.version-row{display:flex;gap:9px;align-items:center;flex-wrap:wrap}.binding-row select{min-width:240px}.version-row{padding:10px 0;border-top:1px solid #f0e2d8}.version-row span:first-child{font-weight:700}.notice{padding:10px 13px;border-radius:11px}.notice.error{background:#ffebeb;color:#a83e3e}.notice.success{background:#e9f7ec;color:#397c50}.notice.warning{background:#fff3dc;color:#93651e}.danger{color:#bd4f4f!important;border-color:#e9b2b2!important}.empty,.empty-main{padding:40px;text-align:center;color:#a38270}.button:disabled,button:disabled{opacity:.5;cursor:not-allowed}@media(max-width:900px){.workspace,.preview-grid{grid-template-columns:1fr}.role-list{position:static;max-height:none}.form-grid{grid-template-columns:1fr}.form-grid .wide{grid-column:auto}}
</style>
