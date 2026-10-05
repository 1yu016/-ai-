// 生成 Phase4A.1 最小合法 Avatar 测试资产（自制、可复现、无外部来源）。
// 产物写入 frontend/tests/fixtures/avatar/ 供 E2E 上传使用。
// 运行：node scripts/gen-avatar-e2e-assets.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/tests/fixtures/avatar')
mkdirSync(OUT_DIR, { recursive: true })

// ---- 1. 最小合法 GLB（含单个命名 animation clip），用于 animation idle / speak ----
function buildMinimalGlb(name) {
  const json = {
    asset: { version: '2.0', generator: 'avatar-e2e-asset-tool' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Root' }],
    animations: [
      {
        name,
        samplers: [{ input: 0, output: 1, interpolation: 'LINEAR' }],
        channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }],
      },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 1, type: 'SCALAR', min: [0], max: [0] },
      { bufferView: 1, componentType: 5126, count: 1, type: 'VEC4' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 4 },
      { buffer: 0, byteOffset: 4, byteLength: 16 },
    ],
    buffers: [{ byteLength: 20 }],
  }
  const bin = Buffer.alloc(20)
  bin.writeFloatLE(0, 0) // time 0
  // 单位四元数（identity rotation）
  bin.writeFloatLE(0, 4)
  bin.writeFloatLE(0, 8)
  bin.writeFloatLE(0, 12)
  bin.writeFloatLE(1, 16)

  const jsonBuf = Buffer.from(JSON.stringify(json))
  const pad = (n) => Math.ceil(n / 4) * 4
  const jsonPad = pad(jsonBuf.length)
  const binPad = pad(bin.length)
  const total = 12 + 8 + jsonPad + 8 + binPad
  const buf = Buffer.alloc(total)
  buf.write('glTF', 0)
  buf.writeUInt32LE(2, 4)
  buf.writeUInt32LE(total, 8)
  buf.writeUInt32LE(jsonPad, 12)
  buf.write('JSON', 16)
  jsonBuf.copy(buf, 20)
  buf.writeUInt32LE(binPad, 20 + jsonPad)
  buf.write('BIN\u0000', 24 + jsonPad)
  bin.copy(buf, 28 + jsonPad)
  return buf
}

// ---- 2. 1x1 PNG（合法 image/png，色值任意），用于 texture / preview / fallback_2d ----
const ONE_PX_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const assets = {
  'animation-idle.glb': buildMinimalGlb('Idle_Stand'),
  'animation-speak.glb': buildMinimalGlb('Talk_Wave'),
  'texture.png': ONE_PX_PNG,
  'preview.png': ONE_PX_PNG,
  'fallback-2d.png': ONE_PX_PNG,
  'lipsync.json': Buffer.from(JSON.stringify({ method: 'volume' }, null, 2)),
}

for (const [file, buf] of Object.entries(assets)) {
  writeFileSync(resolve(OUT_DIR, file), buf)
  console.log('WROTE', file, buf.length, 'bytes')
}
console.log('OUT', OUT_DIR)