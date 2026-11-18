import { createPinia, setActivePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { http } from '@/api/http'
import { useLessonPlanStore } from '@/stores/lessonPlan'
afterEach(() => vi.restoreAllMocks())
it('较早的教案筛选响应与错误不得覆盖新筛选结果', async () => {
  setActivePinia(createPinia())
  let rejectOld!: (reason: Error) => void
  vi.spyOn(http, 'get').mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject })).mockResolvedValueOnce({ data: { items: [{ id: 8, title: '新筛选' }], total: 1 } } as never)
  const store = useLessonPlanStore()
  const old = store.fetchList()
  store.keyword = '新筛选'
  await store.fetchList()
  rejectOld(Error('old network failure')); await old
  expect(store.items.map(x => x.id)).toEqual([8])
  expect(store.total).toBe(1)
  expect(store.error).toBe('')
  expect(store.loading).toBe(false)
})
