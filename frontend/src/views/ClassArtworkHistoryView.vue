<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ClassWorkspaceLayout from '@/components/ClassWorkspaceLayout.vue'
import { platformApi, type Student } from '@/api/platform'
import { apiErrorMessage, apiErrorStatus } from '@/api/http'
import {
  artworkReviewState,
  fetchArtworkImage,
  listClassArtworks,
  type StudentArtwork,
} from '@/services/studentArtwork'

// Stage 8 班级作品回顾：只读地复用 student_artwork_record 与原有班级权限。
// 课堂内仍负责「上传 → AI 草稿 → 教师确认 → 投递大屏」，本页不复制上传链路。
const route = useRoute()
const router = useRouter()
const classId = Number(route.params.classId)

const pageSize = 12
const page = ref(1)
const studentId = ref<number | null>(null)
const activeStudentId = ref<number | null>(null)
const loading = ref(true)
const error = ref('')
const forbidden = ref(false)
const items = ref<StudentArtwork[]>([])
const total = ref(0)
const students = ref<Student[]>([])
const imageUrls = reactive<Record<number, string>>({})
const imageFailures = reactive<Record<number, boolean>>({})
const preview = ref<StudentArtwork | null>(null)

const studentNames = computed(() => new Map(students.value.map((item) => [item.id, item.nickname || item.name])))
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))
const confirmedCount = computed(() => items.value.filter((item) => artworkReviewState(item) === 'confirmed').length)

function studentLabel(artwork: StudentArtwork): string {
  if (artwork.studentId == null) return '未指定幼儿'
  return studentNames.value.get(artwork.studentId) ?? `幼儿 ${artwork.studentId}`
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function releaseImages(): void {
  for (const key of Object.keys(imageUrls)) {
    URL.revokeObjectURL(imageUrls[Number(key)]!)
    delete imageUrls[Number(key)]
  }
  for (const key of Object.keys(imageFailures)) delete imageFailures[Number(key)]
}

async function loadImages(list: StudentArtwork[]): Promise<void> {
  releaseImages()
  await Promise.all(list.map(async (artwork) => {
    try {
      const image = await fetchArtworkImage(artwork.id)
      imageUrls[artwork.id] = image.url
    } catch {
      imageFailures[artwork.id] = true
    }
  }))
}

async function loadStudents(): Promise<void> {
  try {
    const { data } = await platformApi.students(classId)
    students.value = data.items
  } catch {
    // 幼儿姓名仅用于展示；读取失败不影响作品列表本身。
    students.value = []
  }
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  forbidden.value = false
  activeStudentId.value = studentId.value
  try {
    const result = await listClassArtworks(classId, {
      page: page.value,
      pageSize,
      studentId: studentId.value ?? undefined,
    })
    items.value = result.items
    total.value = result.total
    void loadImages(result.items)
  } catch (cause) {
    items.value = []
    total.value = 0
    if (apiErrorStatus(cause) === 403) forbidden.value = true
    else error.value = apiErrorMessage(cause, '班级作品记录加载失败，请重试。')
  } finally {
    loading.value = false
  }
}

function applyFilter(): void {
  page.value = 1
  void load()
}

function goPage(target: number): void {
  if (target < 1 || target > totalPages.value) return
  page.value = target
  void load()
}

function openPreview(artwork: StudentArtwork): void {
  preview.value = artwork
}

function closePreview(): void {
  preview.value = null
}

function openRecord(runId: number): void {
  void router.push({ name: 'classroom-record', params: { runId } })
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && preview.value) closePreview()
}

onMounted(() => {
  const fromQuery = Number(route.query.studentId)
  if (Number.isInteger(fromQuery) && fromQuery > 0) studentId.value = fromQuery
  window.addEventListener('keydown', onKeydown)
  void loadStudents()
  void load()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  releaseImages()
})
</script>

<template>
  <ClassWorkspaceLayout>
    <div class="page">
      <header class="page-head">
        <div>
          <p class="eyebrow">🎨 儿童作品</p>
          <p class="muted">本班课堂中提交的幼儿作品与教师确认评价，按时间倒序展示。</p>
        </div>
        <div class="toolbar">
          <select v-model.number="studentId" aria-label="按幼儿筛选作品" @change="applyFilter">
            <option :value="null">全部幼儿</option>
            <option v-for="student in students" :key="student.id" :value="student.id">
              {{ student.nickname || student.name }}
            </option>
          </select>
          <button class="button" type="button" @click="load">刷新</button>
        </div>
      </header>

      <section class="panel">
        <p v-if="activeStudentId && !loading && !forbidden && !error" class="ledger" data-test="artwork-filter-note">
          仅显示所选幼儿的作品<template v-if="items.length"> · 共 {{ total }} 件作品 · 本页已确认 {{ confirmedCount }} 件</template>
          <button class="link" type="button" @click="studentId = null; applyFilter()">查看全部幼儿</button>
        </p>
        <p v-if="!activeStudentId && !loading && !forbidden && !error && items.length" class="ledger">
          共 {{ total }} 件作品 · 本页已确认 {{ confirmedCount }} 件
        </p>
        <p v-if="loading" class="state">加载中…</p>
        <p v-else-if="forbidden" class="state bad">当前账号没有访问这个班级作品的权限。</p>
        <p v-else-if="error" class="state bad">
          {{ error }}
          <button class="ghost" type="button" @click="load">重试</button>
        </p>
        <p v-else-if="!items.length" class="state muted">
          {{ activeStudentId ? '该幼儿还没有作品记录。' : '本班还没有作品记录。课堂中上传并经教师确认的作品会出现在这里。' }}
        </p>
        <template v-else>
          <ul class="artwork-grid" data-test="artwork-grid">
            <li v-for="artwork in items" :key="artwork.id" class="artwork-card" data-test="artwork-card">
              <button class="thumb" type="button" :aria-label="`查看 ${studentLabel(artwork)} 的作品`" @click="openPreview(artwork)">
                <img v-if="imageUrls[artwork.id]" :src="imageUrls[artwork.id]" alt="幼儿绘画作品">
                <span v-else-if="imageFailures[artwork.id]" class="thumb-fallback">图片加载失败</span>
                <span v-else class="thumb-fallback">加载中…</span>
              </button>
              <div class="artwork-body">
                <div class="artwork-head">
                  <strong>{{ studentLabel(artwork) }}</strong>
                  <span
                    class="status"
                    :class="artworkReviewState(artwork) === 'confirmed' ? 'confirmed' : 'pending'"
                    data-test="artwork-status"
                  >
                    {{ artworkReviewState(artwork) === 'confirmed' ? '教师已确认' : '待教师确认' }}
                  </span>
                </div>
                <p class="meta">
                  <span>{{ formatDate(artwork.createdAt) }}</span>
                  <span v-if="artwork.lessonStepIndex != null">环节 {{ artwork.lessonStepIndex + 1 }}</span>
                  <span>课堂 #{{ artwork.classroomRunId }}</span>
                </p>
                <p v-if="artworkReviewState(artwork) === 'confirmed'" class="comment">{{ artwork.teacherComment }}</p>
                <p v-else class="comment pending-comment">尚未由教师确认，不会向儿童展示或朗读。</p>
                <p v-if="artwork.aiDraft" class="draft" data-test="artwork-ai-draft">
                  <span>AI 草稿（未确认）</span>{{ artwork.aiDraft }}
                </p>
                <button class="link" type="button" @click="openRecord(artwork.classroomRunId)">查看本课课堂记录</button>
              </div>
            </li>
          </ul>
          <div v-if="total > pageSize" class="pager">
            <button class="ghost" type="button" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
            <span>第 {{ page }} / {{ totalPages }} 页 · 共 {{ total }} 件</span>
            <button class="ghost" type="button" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</button>
          </div>
        </template>
      </section>

      <p class="safety-note">
        仅供本班负责教师回顾，不做评分、排名或能力标签；未确认的 AI 草稿不会展示或朗读给儿童。
        作品的确认与投递大屏仍在课堂流程内完成，需要当前课堂大屏与版本上下文。
      </p>
    </div>

    <div v-if="preview" class="preview-mask" role="dialog" aria-modal="true" :aria-label="`${studentLabel(preview)} 的作品`" @click.self="closePreview">
      <div class="preview-box">
        <header>
          <strong>{{ studentLabel(preview) }}</strong>
          <button class="ghost" type="button" @click="closePreview">关闭</button>
        </header>
        <img v-if="imageUrls[preview.id]" :src="imageUrls[preview.id]" :alt="`${studentLabel(preview)} 的作品`">
        <p v-else class="state bad">图片暂时无法加载。</p>
        <p v-if="preview.teacherComment" class="comment">{{ preview.teacherComment }}</p>
        <p v-else class="comment pending-comment">这件作品还没有教师确认评价。</p>
      </div>
    </div>
  </ClassWorkspaceLayout>
</template>

<style scoped>
.page { max-width: 1180px; margin: auto; }
.page-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 18px; }
.eyebrow { margin: 0 0 6px; color: #d67b59; font-weight: 800; letter-spacing: 0.08em; }
.muted { color: #9a7e6e; }
.toolbar { display: flex; gap: 10px; flex-wrap: wrap; }
.toolbar select { height: 42px; border: 1px solid #efd9c8; border-radius: 12px; padding: 0 12px; background: #fffdf9; color: #60483e; }
.button, .ghost, .link { border: 0; border-radius: 12px; cursor: pointer; }
.button { min-height: 42px; padding: 0 18px; background: #e99168; color: #fff; }
.button:disabled, .ghost:disabled { opacity: 0.55; cursor: not-allowed; }
.ghost { min-height: 42px; padding: 0 16px; border: 1px solid #efd9c8; background: #fffdf9; color: #876b5d; }
.panel { margin-top: 20px; padding: 20px; border: 1px solid #f0ddce; border-radius: 18px; background: #fffdf9; box-shadow: 0 10px 28px #b9795114; }
.state { padding: 26px; text-align: center; line-height: 1.8; display: grid; justify-items: center; gap: 12px; }
.bad { color: #c64e4e; }
.ledger { margin: 0 0 16px; color: #9a7e6e; font-size: 13px; }
.artwork-grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.artwork-card { display: grid; gap: 12px; padding: 14px; border: 1px solid #f0ddce; border-radius: 16px; background: #fff; }
.thumb { display: block; width: 100%; aspect-ratio: 4 / 3; padding: 0; border: 1px solid #f2e3d7; border-radius: 12px; background: #fff8f1; overflow: hidden; cursor: zoom-in; }
.thumb img { width: 100%; height: 100%; object-fit: contain; display: block; }
.thumb-fallback { display: grid; place-items: center; width: 100%; height: 100%; color: #a38270; font-size: 13px; }
.artwork-body { display: grid; gap: 8px; }
.artwork-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.artwork-head strong { color: #60483e; }
.status { padding: 4px 10px; border-radius: 999px; font-size: 12px; white-space: nowrap; }
.status.confirmed { background: #e8f7ed; color: #4d9a69; }
.status.pending { background: #fff3dc; color: #b77d20; }
.meta { display: flex; flex-wrap: wrap; gap: 10px; margin: 0; color: #9a7e6e; font-size: 12px; }
.comment { margin: 0; color: #6b584c; line-height: 1.7; }
.pending-comment { color: #b77d20; }
.draft { margin: 0; padding: 10px 12px; border-radius: 10px; background: #f6f1ff; color: #6b5a86; line-height: 1.7; font-size: 13px; }
.draft span { display: block; margin-bottom: 4px; color: #8d78b3; font-weight: 700; }
.link { justify-self: start; padding: 0; background: none; color: #bd674b; font-weight: 700; }
.pager { display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 18px; color: #9a7e6e; font-size: 13px; }
.safety-note { margin: 18px 2px 0; color: #9a7e6e; font-size: 13px; line-height: 1.8; }
.preview-mask { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 24px; background: #3b2f2a99; }
.preview-box { display: grid; gap: 14px; width: min(860px, 100%); max-height: calc(100dvh - 48px); overflow: auto; padding: 18px; border-radius: 18px; background: #fffdf9; }
.preview-box header { display: flex; align-items: center; justify-content: space-between; gap: 16px; color: #60483e; }
.preview-box img { max-width: 100%; max-height: 62dvh; object-fit: contain; margin: auto; border-radius: 12px; background: #fff; }
@media (max-width: 900px) {
  .page-head { align-items: flex-start; flex-direction: column; }
  .artwork-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 620px) {
  .artwork-grid { grid-template-columns: 1fr; }
}
</style>
