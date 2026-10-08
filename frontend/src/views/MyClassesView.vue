<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { platformApi, type SchoolClass } from '@/api/platform'
import ManagementLayout from '@/components/ManagementLayout.vue'
import PageHeader from '@/components/PageHeader.vue'

const router = useRouter()
const loading = ref(true)
const error = ref('')
const classes = ref<SchoolClass[]>([])

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await platformApi.classes(1)
    classes.value = result.data.items
  } catch {
    error.value = '班级列表加载失败，请确认已绑定班级后重试。'
  } finally {
    loading.value = false
  }
}

function viewStudents(classId: number) {
  void router.push({ name: 'students', params: { classId } })
}

function startLesson(classId: number) {
  // 先到备课中心选择/确认教案，再进入课堂准备确认（教案不带班级，故通过 query 携带上下文）。
  void router.push({ name: 'lesson-plans', query: { classId: String(classId) } })
}

onMounted(load)
</script>

<template>
  <ManagementLayout>
    <PageHeader eyebrow="教师工作台" title="我的班级" subtitle="仅展示您负责的班级。点击「开始上课」可直接进入课堂准备。">
      <template #actions />
    </PageHeader>

    <p v-if="loading">加载中…</p>
    <p v-else-if="error" class="bad">{{ error }}</p>
    <p v-else-if="!classes.length" class="muted">当前没有负责的班级，请联系管理员为您绑定班级。</p>
    <div v-else class="class-grid">
      <div v-for="c in classes" :key="c.id" class="class-card">
        <div class="class-name">{{ c.name }}</div>
        <div class="class-meta" v-if="c.grade">{{ c.grade }}</div>
        <div class="class-actions">
          <button class="card-btn ghost" @click="viewStudents(c.id)">进入班级</button>
          <button class="card-btn primary" @click="startLesson(c.id)">开始上课</button>
        </div>
      </div>
    </div>
  </ManagementLayout>
</template>

<style scoped>
.muted{color:#a38270}
.bad{color:#c64e4e}
.class-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px;margin-top:24px}
.class-card{background:#fffdf9;border:1px solid #f0ddce;border-radius:16px;padding:22px;box-shadow:0 8px 24px #c88d6012;transition:transform .1s,box-shadow .1s}
.class-card:hover{transform:translateY(-2px);box-shadow:0 12px 28px #c88d6030}
.class-name{font-size:18px;font-weight:700;color:#60483e}
.class-meta{color:#a38270;font-size:13px;margin-top:4px}
.class-actions{display:flex;gap:10px;margin-top:16px}
.card-btn{border:0;border-radius:11px;padding:9px 14px;font-weight:700;cursor:pointer;font-size:14px}
.card-btn.ghost{background:#fff3e8;color:#c96e45;border:1px solid #f1d8c4}
.card-btn.primary{background:#eb956b;color:#fff}
.card-btn.primary:hover{background:#df8052}
.button{border:0;background:#eb956b;color:#fff;border-radius:12px;padding:9px 16px;cursor:pointer}
.button.ghost{background:#fffdf9;color:#c96e45;border:1px solid #efd9c8}
</style>