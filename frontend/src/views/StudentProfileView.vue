<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ManagementLayout from '@/components/ManagementLayout.vue'
import { platformApi, type Consent, type Student } from '@/api/platform'
const route = useRoute(); const router = useRouter(); const student = ref<Student|null>(null); const consents = ref<Consent[]>([]); const name = ref(''); const nickname = ref(''); const message = ref('')
async function load(){ const id = Number(route.params.studentId); const result = await platformApi.students(Number(route.query.classId)); student.value = result.data.items.find(item => item.id === id) ?? null; if (student.value) { name.value = student.value.name; nickname.value = student.value.nickname ?? ''; consents.value = (await platformApi.consents(id)).data } }
onMounted(load)
async function save(){ if (!student.value) return; await platformApi.updateStudent(student.value.id,{name:name.value,nickname:nickname.value}); message.value='已保存'; await load() }
</script>
<template><ManagementLayout><h1>学生资料</h1><div class="toolbar"><button class="button" @click="router.back()">返回</button></div><div v-if="!student" class="panel">正在加载或未找到学生。</div><div v-else class="panel form"><label>姓名<input v-model="name" /></label><label>昵称<input v-model="nickname" /></label><label>头像<div class="avatar">🧒<small>未授权幼儿使用默认卡通头像</small></div></label><label>授权状态<div><span v-for="consent in consents" :key="consent.id" class="badge" :class="consent.status==='granted'?'ok':'warn'">{{ consent.consentType }}：{{ consent.status }}</span><span v-if="!consents.length" class="muted">暂无授权记录</span></div></label><button class="button" @click="save">保存资料</button><span class="ok">{{ message }}</span></div></ManagementLayout></template>
<style scoped>.form{display:grid;gap:18px;max-width:600px}.form label{display:grid;gap:7px;font-weight:700}.form input{height:40px;border:1px solid #efd9c8;background:#fffdf9;border-radius:10px;padding:0 10px}.avatar{display:flex;align-items:center;gap:12px;font-size:42px}.avatar small{font-size:12px;color:#a38270;font-weight:400}</style>
