// Explicitly synthetic, no database imports/connections, no model calls. Never production bootstrap.
import http from 'node:http'
const port = 3187
const run = { id: 93001, deviceId: 93001, classId: 93001, lessonPlanId: 93001, version: 1, status: 'running', currentStepIndex: 0,
  title: 'I-2-3B 合成语音课堂', objectives: '观察圆形', startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), latestSnapshotVersion: null,
  steps: [0, 1].map(i => ({ stepIndex: i, type: 'introduction', title: `合成环节${i + 1}`, content: '观察图形并说出发现', teacherTip: '教师合成提示', durationSeconds: 120, resourceId: null })),
  interactionState: { screenLifecycle: { schemaVersion: 1, phase: 'teaching', runId: 93001, deviceId: 93001, bindingId: 1, revision: 1, expiresAt: null } }, playerRecoverySuggestion: {} }
let holdTts = false
const pending = []
const actions = () => run.status === 'paused' ? ['query', 'resume', 'complete', 'cancel', 'safe_stop', 'attendance_correction', 'reward_revoke'] : ['query', 'pause', 'complete', 'cancel', 'change_step', 'tts', 'resource_start', 'safe_stop', 'roll_call', 'reward', 'queue_edit']
const wav = Buffer.alloc(44 + 8000 * 60 * 2)
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40)
for (let i = 0; i < 8000 * 60; i++) wav.writeInt16LE(Math.round(1500 * Math.sin(i * Math.PI * 2 * 220 / 8000)), 44 + i * 2)
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5187'); res.setHeader('Access-Control-Allow-Headers', '*'); res.setHeader('Access-Control-Allow-Methods', '*')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  const url = new URL(req.url, 'http://127.0.0.1'); let text = ''; for await (const chunk of req) text += chunk
  const body = text ? JSON.parse(text) : {}
  const send = (data, status = 200) => { if (res.destroyed) return; res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)) }
  console.log(JSON.stringify({ at: new Date().toISOString(), method: req.method, path: url.pathname, body }))
  if (url.pathname === '/__acceptance/health') return send({ fixture: 'i2-3b', cwd: process.cwd(), database: null, persistence: 'synthetic-memory', realAI: false, runId: run.id })
  if (url.pathname === '/__acceptance/control') {
    if (body.reset) { run.status = 'running'; run.currentStepIndex = 0; run.version++; holdTts = false; pending.splice(0).forEach(f => f()) }
    if ('holdTts' in body) holdTts = body.holdTts
    if (body.releaseTts) { holdTts = false; pending.splice(0).forEach(f => f()) }
    return send({ holdTts, pending: pending.length })
  }
  if (url.pathname === '/synthetic.wav') { res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length }); return res.end(wav) }
  if (url.pathname === '/ai/tts') {
    const reply = () => send({ audioUrl: `http://127.0.0.1:${port}/synthetic.wav` })
    if (holdTts) pending.push(reply); else reply()
    return
  }
  if (url.pathname === '/ai/classroom-assistant') return send({ mode: 'guided_dialogue', ability: 'guided_question', reply: '合成教学文本：请观察圆形，说说你的发现。', teacherTip: '合成夹具，不调用真实模型', suggestedAction: null, requiresTeacherConfirmation: false })
  if (url.pathname === '/classroom-commands') {
    if (body.operation === 'pause_class') run.status = 'paused'
    if (body.operation === 'resume_class') run.status = 'running'
    if (body.operation === 'next_step') run.currentStepIndex = 1
    run.version++; run.updatedAt = new Date().toISOString()
    return send({ requestId: body.requestId, runId: run.id, status: 'success', result: {}, classroomState: run })
  }
  if (url.pathname.endsWith('/cockpit')) return send({ schemaVersion: 1, run: { id: run.id, deviceId: run.deviceId }, versions: { runVersion: run.version, snapshotVersion: null }, capabilities: { allowedActions: actions() } })
  if (url.pathname === `/classroom-runs/${run.id}`) return send(run)
  if (url.pathname.endsWith('/rewards')) return send({ items: [], total: 0, runTitle: run.title })
  if (url.pathname === '/auth/profile') return send({ teacherId: 93001, userId: 93001, userType: 'teacher', account: 'i23b_synthetic', name: '合成验收教师' })
  if (url.pathname === '/classes/93001') return send({ id: 93001, name: '合成验收班' })
  if (url.pathname.endsWith('/leaderboard')) return send({ items: [] })
  if (url.pathname.includes('voice') || url.pathname.includes('preference')) return send({ synonyms: [], items: [] })
  if (url.pathname.includes('avatar')) return send({ items: [], binding: null })
  return send({ items: [], total: 0 })
})
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ listening: port, pid: process.pid, cwd: process.cwd(), database: null, fixture: 'i2-3b' })))
