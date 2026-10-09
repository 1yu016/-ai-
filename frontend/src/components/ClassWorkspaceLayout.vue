<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { platformApi } from '@/api/platform'
import PageHeader from '@/components/PageHeader.vue'

// 统一班级工作区（Class Workspace）：承载 /classes/:classId/* 全部班级子页面。
// 顶部统一「← 我的班级」+ 班级上下文（名称 / 年级 / 幼儿数）+「开始上课」，
// 下方 tabs 在学生 / 成长奖励 / 儿童问题之间切换，保证班级上下文不丢失。
const route = useRoute()
const router = useRouter()
const classId = Number(route.params.classId)
const loading = ref(true)
const className = ref('')
const grade = ref('')
const studentCount = ref(0)

const tabs = computed(() => [
  { key: 'classroom-students', label: '学生', route: 'students' },
  { key: 'classroom-rewards', label: '🌟 成长奖励', route: 'class-rewards' },
  { key: 'classroom-questions', label: '💡 儿童问题', route: 'class-questions' },
])

const activeKey = computed(() => {
  if (route.name === 'class-rewards') return 'classroom-rewards'
  if (route.name === 'class-questions') return 'classroom-questions'
  return 'classroom-students'
})

async function load() {
  loading.value = true
  try {
    const classes = await platformApi.listClasses()
    const items = Array.isArray(classes.data.items) ? classes.data.items : []
    const found = items.find((c) => c.id === classId)
    if (found) {
      className.value = found.name
      grade.value = found.grade || ''
    }
    const students = await platformApi.students(classId)
    studentCount.value = Array.isArray(students.data.items) ? students.data.items.length : 0
  } catch {
    // 班级信息获取失败时顶部仍可用（名称回退「本班」，count 为 0），不阻塞子页面。
  } finally {
    loading.value = false
  }
}

function goToMyClasses() {
  void router.push({ name: 'my-classes' })
}
function startLesson() {
  // 先到备课中心选择/确认教案，再进入课堂准备（通过 classId 携带班级上下文）。
  void router.push({ name: 'lesson-plans', query: { classId: String(classId) } })
}
function goTab(routeName: string) {
  void router.push({ name: routeName, params: { classId } })
}

onMounted(load)
</script>

<template>
  <div class="classroom-workspace">
    <PageHeader
      eyebrow="班级管理"
      :title="className || '本班'"
      :subtitle="`${grade ? grade + ' · ' : ''}${studentCount} 名幼儿`"
    >
      <template #actions>
        <button class="btn-start" data-test="workspace-start" @click="startLesson">开始上课</button>
        <button class="btn-back" data-test="workspace-back" @click="goToMyClasses">← 我的班级</button>
      </template>
    </PageHeader>

    <nav class="ws-tabs" data-test="workspace-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="ws-tab"
        :class="{ active: activeKey === tab.key }"
        :data-test="`ws-tab-${tab.key}`"
        @click="goTab(tab.route)"
      >
        {{ tab.label }}
      </button>
    </nav>

    <div v-if="loading" class="ws-loading">加载班级信息中…</div>
    <div class="ws-body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.classroom-workspace{max-width:1280px;margin:0 auto;padding:32px 40px;box-sizing:border-box;width:100%}
.ws-tabs{display:flex;gap:8px;margin:26px 0 22px;border-bottom:2px solid #f1decf;padding-bottom:0}
.ws-tab{border:0;background:none;color:#a38270;font-weight:700;font-size:15px;padding:10px 16px;cursor:pointer;border-radius:10px 10px 0 0}
.ws-tab:hover{color:#c96e45;background:#fff2e4}
.ws-tab.active{color:#c96e45;background:#fff4e8;box-shadow:inset 0 -2px 0 #eb956b}
.ws-loading{color:#a38270;padding:30px 0}
.btn-back{border:0;background:#eb956b;color:#fff;border-radius:14px;padding:11px 18px;cursor:pointer;font-weight:700}
.btn-start{border:0;background:#fff3e8;color:#c96e45;border:1px solid #f1d8c4;border-radius:14px;padding:11px 18px;cursor:pointer;font-weight:700}
@media(max-width:700px){.classroom-workspace{padding:22px 16px}.ws-tabs{overflow-x:auto}}
</style>