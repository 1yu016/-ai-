<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { platformApi } from '@/api/platform'
import LoadingState from '@/components/LoadingState.vue'
import ManagementLayout from '@/components/ManagementLayout.vue'
import PageHeader from '@/components/PageHeader.vue'
import PageShell from '@/components/PageShell.vue'
import BackButton from '@/components/BackButton.vue'

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
    const [schoolClass, students] = await Promise.all([
      platformApi.classDetail(classId),
      platformApi.students({ classId, page: 1, pageSize: 1 }),
    ])
    className.value = schoolClass.data.name
    grade.value = schoolClass.data.grade || ''
    studentCount.value = students.data.total
  } catch {
    // 班级信息获取失败时顶部仍可用（名称回退「本班」，count 为 0），不阻塞子页面。
  } finally {
    loading.value = false
  }
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
  <ManagementLayout>
    <PageShell variant="wide">
      <div class="classroom-workspace">
        <PageHeader
          eyebrow="班级管理"
          :title="className || '本班'"
          :subtitle="`${grade ? grade + ' · ' : ''}${studentCount} 名幼儿`"
      >
          <template #actions>
            <button class="btn-start" data-test="workspace-start" @click="startLesson">开始上课</button>
            <BackButton label="返回班级详情" data-test="workspace-back" />
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

        <LoadingState v-if="loading" compact title="正在加载班级" description="正在获取班级基本信息和幼儿人数。" />
        <div v-else class="ws-body"><slot /></div>
      </div>
    </PageShell>
  </ManagementLayout>
</template>

<style scoped>
.classroom-workspace{box-sizing:border-box;width:100%;min-width:0}
.ws-tabs{display:flex;gap:8px;margin:26px 0 22px;border-bottom:2px solid #f1decf;padding-bottom:0}
.ws-tab{border:0;background:none;color:#a38270;font-weight:700;font-size:15px;padding:10px 16px;cursor:pointer;border-radius:10px 10px 0 0}
.ws-tab:hover{color:#c96e45;background:#fff2e4}
.ws-tab.active{color:#c96e45;background:#fff4e8;box-shadow:inset 0 -2px 0 #eb956b}
.btn-start{border:0;background:#fff3e8;color:#c96e45;border:1px solid #f1d8c4;border-radius:14px;padding:11px 18px;cursor:pointer;font-weight:700}
@media(max-width:700px){.ws-tabs{overflow-x:auto}}
</style>
