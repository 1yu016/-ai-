<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ManagementLayout from '@/components/ManagementLayout.vue'
import { platformApi, type Student } from '@/api/platform'
const route = useRoute(); const router = useRouter(); const classId = Number(route.params.classId); const items = ref<Student[]>([]); const loading = ref(true); const error = ref('')
async function load(){ loading.value = true; try { items.value = (await platformApi.students(classId)).data.items } catch { error.value = '学生加载失败，请重试。' } finally { loading.value = false } }
onMounted(load)
</script>
<template><ManagementLayout><h1>学生列表</h1><p class="muted">班级 ID：{{ classId }} · {{ items.length }} 名学生</p><div class="toolbar"><button class="button" @click="router.push({name:'classes'})">返回班级</button><button class="button" @click="load">刷新</button></div><div class="panel"><p v-if="loading">加载中…</p><p v-else-if="error" class="bad">{{ error }}</p><p v-else-if="!items.length">暂无学生</p><table v-else class="table"><thead><tr><th>头像</th><th>姓名</th><th>学号</th><th>状态</th><th></th></tr></thead><tbody><tr v-for="item in items" :key="item.id"><td>🧒</td><td>{{ item.name }}<small v-if="item.nickname">（{{ item.nickname }}）</small></td><td>{{ item.studentNo }}</td><td><span class="badge ok">{{ item.status }}</span></td><td><button class="button" @click="router.push({name:'student-profile',params:{studentId:item.id},query:{classId}})">资料</button></td></tr></tbody></table></div></ManagementLayout></template>
