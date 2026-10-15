import { ref } from 'vue'
import { defineStore } from 'pinia'
import { http } from '@/api/http'
import type { ClassroomCommandOperation } from '@/services/classroomCommandBus'
import {
  synonymConflictReason,
  type TeacherCommandSynonym,
} from '@/classroom/command/TeacherVoiceCommandRouter'

export const useVoiceCommandPreferenceStore = defineStore('voiceCommandPreference', () => {
  const items = ref<TeacherCommandSynonym[]>([])
  const loading = ref(false)

  async function load() {
    loading.value = true
    try {
      const { data } = await http.get<TeacherCommandSynonym[]>('/ai/command-synonyms')
      items.value = data
    } finally {
      loading.value = false
    }
  }

  async function add(phrase: string, operation: ClassroomCommandOperation) {
    const conflict = synonymConflictReason(phrase, items.value)
    if (conflict) throw new Error(conflict)
    const { data } = await http.post<TeacherCommandSynonym>('/ai/command-synonyms', { phrase, operation })
    items.value.push(data)
    return data
  }

  async function remove(id: number) {
    await http.delete(`/ai/command-synonyms/${id}`)
    items.value = items.value.filter((item) => item.id !== id)
  }

  return { items, loading, load, add, remove }
})
