export const RECORDING_MIME_TYPE = 'audio/webm'

export function isRecordingSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined' &&
    MediaRecorder.isTypeSupported(RECORDING_MIME_TYPE)
  )
}

function writeWavString(
  view: DataView,
  offset: number,
  value: string,
) {
  for (let index = 0; index < value.length; index++) {
    view.setUint8(offset + index, value.charCodeAt(index))
  }
}

function audioBufferToWav(audioBuffer: AudioBuffer): ArrayBuffer {
  const channelCount = audioBuffer.numberOfChannels
  const sampleRate = audioBuffer.sampleRate
  const frameCount = audioBuffer.length
  const bytesPerSample = 2
  const blockAlign = channelCount * bytesPerSample
  const wavBuffer = new ArrayBuffer(44 + frameCount * blockAlign)
  const view = new DataView(wavBuffer)
  const channels = Array.from({ length: channelCount }, (_, channel) =>
    audioBuffer.getChannelData(channel),
  )

  writeWavString(view, 0, 'RIFF')
  view.setUint32(4, wavBuffer.byteLength - 8, true)
  writeWavString(view, 8, 'WAVE')
  writeWavString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channelCount, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeWavString(view, 36, 'data')
  view.setUint32(40, frameCount * blockAlign, true)

  let offset = 44
  for (let frame = 0; frame < frameCount; frame++) {
    for (let channel = 0; channel < channelCount; channel++) {
      const sample = Math.max(-1, Math.min(1, channels[channel]?.[frame] ?? 0))
      const pcmValue = sample < 0 ? sample * 0x8000 : sample * 0x7fff
      view.setInt16(offset, Math.round(pcmValue), true)
      offset += bytesPerSample
    }
  }
  return wavBuffer
}

export async function webmToWav(webmBlob: Blob): Promise<Blob> {
  const audioContext = new AudioContext()
  try {
    const decodedAudio = await audioContext.decodeAudioData(
      await webmBlob.arrayBuffer(),
    )
    return new Blob([audioBufferToWav(decodedAudio)], { type: 'audio/wav' })
  } finally {
    await audioContext.close()
  }
}
