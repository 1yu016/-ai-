import { LocalWakeSpeech } from './localWakeSpeech'
import type { LocalRecognition } from './classroomListening'
/** Reuse the installed local Vosk engine, with no wake/command/audio-buffer path. */
export async function createChildLocalRecognition(): Promise<LocalRecognition> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
    throw new Error('当前地址不能安全使用麦克风，请用电脑localhost或已部署的HTTPS；可先用文字模拟。未上传录音。')
  const recognition: LocalRecognition = { processLocally:true,lang:'zh-CN',continuous:false,interimResults:false,
    onresult:null,onerror:null,onend:null,onstart:null,
    start:()=>{void engine.start()},abort:()=>{void engine.stop()} }
  const engine=new LocalWakeSpeech({publicTranscription:true,maxUtteranceMs:30000,
    onPublicUtterance:text=>recognition.onresult?.({resultIndex:0,results:[{isFinal:true,0:{transcript:text}}]}),
    onState:(state,message)=>{if(state==='waiting')recognition.onstart?.();if(state==='error')recognition.onerror?.({error:message});if(state==='off')recognition.onend?.()},
  })
  return recognition
}
