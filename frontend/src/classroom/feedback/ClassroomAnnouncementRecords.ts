import { classroomAnnouncementCandidates, type AnnouncementSource, type ClassroomAnnouncement } from './ClassroomVoiceFeedback'

type Get = (path: string) => Promise<{ data: unknown }>
type Row = Record<string, unknown>
const row = (value: unknown): Row => value && typeof value === 'object' ? value as Row : {}
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(row) : []

/** Existing authenticated, read-only APIs supply timestamps and intermediate formal
 * records absent from the latest-only Snapshot. Never parse commands or AI text.
 * Callers must discard the response if the screen generation has changed.
 */
export async function loadAnnouncementRecords(source: AnnouncementSource, classId: number, get: Get): Promise<ClassroomAnnouncement[]> {
  const result = classroomAnnouncementCandidates(source)
  const append = (extra: Partial<AnnouncementSource>) => result.push(...classroomAnnouncementCandidates({ runId: source.runId, serverNow: source.serverNow, ...extra }))
  const tasks: Promise<void>[] = []
  const lastRoll = Number(source.rollCall?.lastRecordId)
  if (lastRoll > 0) tasks.push((async () => {
    const data = row((await get(`/classroom-runs/${source.runId}/timeline`)).data)
    if (row(data.run).id !== source.runId) return
    for (const item of rows(data.items)) {
      if (item.type !== 'roll_call' || item.source !== 'roll_call') continue
      const id = Number(String(item.key).match(/^roll-call:(\d+)$/)?.[1])
      const mode = String(row(item.details).mode)
      const operations: Record<string, string> = { random: 'random_roll_call', specified: 'specified_roll_call', group_random: 'group_roll_call' }
      const suffix = `（${mode}）`, description = String(item.description ?? '')
      if (!(id > 0 && id <= lastRoll) || !operations[mode] || !description.endsWith(suffix)) continue
      append({ rollCall: { lastRecordId: id, lastOperation: operations[mode], lastStudentDisplayName: description.slice(0, -suffix.length), updatedAt: item.occurredAt } })
    }
  })())
  const lastReward = Number(source.reward?.recordId)
  if (lastReward > 0) tasks.push((async () => {
    const data = row((await get(`/classroom-runs/${source.runId}/rewards`)).data)
    for (const record of rows(data.items)) {
      if (record.source !== 'canonical' || record.recordType !== 'reward' || record.classroomRunId !== source.runId || record.classId !== classId || record.revokedAt || !(Number(record.id) > 0 && Number(record.id) <= lastReward)) continue
      append({ reward: { recordId: record.id, displayName: record.studentName, stars: record.stars, points: record.points, createdAt: record.createdAt } })
    }
  })())
  const collectiveIds = new Set(Array.isArray(source.collectiveState?.recordIds) ? source.collectiveState.recordIds.map(Number) : [])
  if (collectiveIds.size) tasks.push((async () => {
    const data = row((await get(`/classroom-runs/${source.runId}/reward-dashboard`)).data)
    for (const record of rows(data.collectiveRewards)) {
      if (record.source !== 'canonical' || record.recordType !== 'collective_reward' || record.classroomRunId !== source.runId || record.classId !== classId || record.revokedAt || !collectiveIds.has(Number(record.id))) continue
      append({ collectiveReward: { recordId: record.id, points: record.points, createdAt: record.createdAt } })
    }
  })())
  // Read failures are fail-closed for missing records. No retries or business POST.
  await Promise.allSettled(tasks)
  return [...new Map(result.map(item => [item.key, item])).values()]
}

/** Establish first-state history before awaiting any resource/HTTP work. */
export function announcementBaseline(source: AnnouncementSource): string[] {
  const keys = classroomAnnouncementCandidates(source).map(item => item.key)
  const add = (kind: string, value: unknown) => { if (Number.isSafeInteger(value) && Number(value) > 0) keys.push(`${source.runId}:${kind}:${value}`) }
  add('student_reward', source.reward?.recordId)
  add(String(source.rollCall?.lastOperation), source.rollCall?.lastRecordId)
  for (const id of Array.isArray(source.collectiveState?.recordIds) ? source.collectiveState.recordIds : []) add('collective_reward', id)
  return keys
}
