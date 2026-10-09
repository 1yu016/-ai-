import { apiUrl } from '@/api/classroomMobile'

export function connectScreenRealtime<T>(options: {
  deviceId: number
  accessToken: string
  onState: (state: T) => void | Promise<void>
  onDisconnect?: (message: string) => void
}): AbortController {
  const abort = new AbortController()
  void (async () => {
    try {
      const url = new URL(apiUrl('/classroom-mobile/screen-events'))
      url.searchParams.set('deviceId', String(options.deviceId))
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${options.accessToken}`,
          Accept: 'text/event-stream',
        },
        cache: 'no-store',
        signal: abort.signal,
      })
      if (!response.ok || !response.body) throw new Error(`大屏实时通道连接失败（${response.status}）`)
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (!abort.signal.aborted) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split(/\r?\n\r?\n/)
        buffer = blocks.pop() || ''
        for (const block of blocks) {
          let type = ''
          let data = ''
          for (const line of block.split(/\r?\n/)) {
            if (line.startsWith('event:')) type = line.slice(6).trim()
            if (line.startsWith('data:')) data += line.slice(5).trim()
          }
          if (!data) continue
          const parsed = JSON.parse(data) as T | { message?: string }
          if (type === 'screen_state') await options.onState(parsed as T)
          if (type === 'screen_error') throw new Error(String((parsed as { message?: string }).message || '大屏实时状态读取失败'))
        }
      }
      if (!abort.signal.aborted) options.onDisconnect?.('大屏实时通道已断开，已切换定时同步')
    } catch (error) {
      if (!abort.signal.aborted) options.onDisconnect?.(error instanceof Error ? error.message : '大屏实时通道连接失败')
    }
  })()
  return abort
}
