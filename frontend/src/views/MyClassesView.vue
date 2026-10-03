<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { platformApi, type SchoolClass } from '@/api/platform'

const router = useRouter()
const user = useUserStore()
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

function goScan() {
  void router.push({ name: 'classroom-scan' })
}

onMounted(load)
</script>

<template>
  <div class="workbench">
    <header class="topbar">
      <div class="brand">🌼 幼教教师工作台</div>
      <div class="user">
        <span>{{ user.teacherInfo?.name || '当前账号' }} · 教师</span>
        <button class="button ghost" @click="goScan">课堂设备准备</button>
      </div>
    </header>
    <main class="content">
      <h1>我的班级</h1>
      <p class="muted">仅展示您负责的班级，点击进入查看学生。</p>

      <p v-if="loading">加载中…</p>
      <p v-else-if="error" class="bad">{{ error }}</p>
      <p v-else-if="!classes.length" class="muted">当前没有负责的班级，请联系管理员为您绑定班级。</p>
      <div v-else class="class-grid">
        <div v-for="c in classes" :key="c.id" class="class-card" @click="viewStudents(c.id)">
          <div class="class-name">{{ c.name }}</div>
          <div class="class-meta" v-if="c.grade">{{ c.grade }}</div>
          <div class="enter">查看学生 →</div>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.workbench{min-height:100dvh;background:#fff8ee;color:#60483e}
.topbar{height:64px;background:#fffaf4;border-bottom:1px solid #f2dfcf;display:flex;align-items:center;justify-content:space-between;padding:0 24px}
.brand{font-size:17px;font-weight:800;color:#734d3c}
.user{display:flex;align-items:center;gap:14px;color:#8a6d5f}
.content{max-width:1000px;margin:auto;padding:32px}
.content h1{margin:0 0 8px;font-size:28px}
.muted{color:#a38270}
.bad{color:#c64e4e}
.class-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;margin-top:22px}
.class-card{background:#fffdf9;border:1px solid #f0ddce;border-radius:16px;padding:20px;cursor:pointer;box-shadow:0 8px 24px #c88d6012;transition:transform .1s,box-shadow .1s}
.class-card:hover{transform:translateY(-2px);box-shadow:0 12px 28px #c88d6030}
.class-name{font-size:18px;font-weight:700;color:#60483e}
.class-meta{color:#a38270;font-size:13px;margin-top:4px}
.enter{color:#df8b62;font-size:13px;margin-top:12px}
.button{border:0;background:#eb956b;color:#fff;border-radius:12px;padding:9px 16px;cursor:pointer}
.button.ghost{background:#fffdf9;color:#c96e45;border:1px solid #efd9c8}
</style>