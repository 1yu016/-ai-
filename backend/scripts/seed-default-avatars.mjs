import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';

const backendRoot = resolve(import.meta.dirname, '..');
const repositoryRoot = resolve(backendRoot, '..');
const databasePath = resolve(backendRoot, process.env.DATABASE_PATH || './data/app.sqlite');
const uploadDirectory = resolve(backendRoot, process.env.AVATAR_UPLOAD_PATH || './uploads/avatars');
const sourceModel = resolve(repositoryRoot, 'frontend/public/avatar/RobotExpressive.glb');

if (!existsSync(databasePath)) throw new Error(`数据库不存在：${databasePath}`);
if (!existsSync(sourceModel)) throw new Error(`默认数字人模型不存在：${sourceModel}`);

mkdirSync(uploadDirectory, { recursive: true });

const modelFileName = 'system-default-avatar.glb';
const imageFileName = 'system-default-avatar.png';
const lipSyncFileName = 'system-default-lip-sync.json';
const modelPath = resolve(uploadDirectory, modelFileName);
const imagePath = resolve(uploadDirectory, imageFileName);
const lipSyncPath = resolve(uploadDirectory, lipSyncFileName);

copyFileSync(sourceModel, modelPath);
// 一像素安全备用图。正式角色仍优先加载 GLB，备用图只用于资源完整性和极端降级。
writeFileSync(
  imagePath,
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
    'base64',
  ),
);
writeFileSync(lipSyncPath, JSON.stringify({ mode: 'viseme', version: 1 }));

const fileInfo = (path) => {
  const content = readFileSync(path);
  return { size: content.length, checksum: createHash('sha256').update(content).digest('hex') };
};
const modelInfo = fileInfo(modelPath);
const imageInfo = fileInfo(imagePath);
const lipSyncInfo = fileInfo(lipSyncPath);

const db = new Database(databasePath);
db.pragma('foreign_keys = ON');

const requiredTables = [
  'avatar_character',
  'avatar_version',
  'avatar_asset',
  'avatar_voice_profile',
  'avatar_personality',
  'avatar_binding',
];
for (const table of requiredTables) {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  if (!exists) throw new Error(`缺少数据表 ${table}，请先启动后端完成迁移`);
}

const teacher = db
  .prepare('SELECT id, school_id FROM teachers WHERE account = ? LIMIT 1')
  .get(process.env.TEST_TEACHER_ACCOUNT || 'teacher_demo')
  ?? db.prepare('SELECT id, school_id FROM teachers ORDER BY id LIMIT 1').get();
if (!teacher) throw new Error('没有可作为默认角色所有者的教师账号');

const administrator = db.prepare('SELECT school_id FROM administrator ORDER BY id LIMIT 1').get();
const schoolId = teacher.school_id || administrator?.school_id || 'default-kindergarten';

const characters = [
  {
    name: '课堂小助手',
    category: 'teacher_assistant',
    description: '温暖、清晰的课堂数字人助手，适合讲解、提问和鼓励。',
    style: '温暖启发式',
    greeting: '小朋友们好，我们一起开始今天的活动吧！',
    encouragement: '先肯定幼儿的尝试，再给出一个清晰的小提示。',
    goodbye: '今天表现得很棒，我们下次再见！',
  },
  {
    name: '小熊老师',
    category: 'cartoon_animal',
    description: '亲切活泼的卡通动物角色，适合故事、游戏和互动环节。',
    style: '亲切活泼',
    greeting: '小朋友们好，我是小熊老师，准备好一起探索了吗？',
    encouragement: '用简短、积极的语言鼓励幼儿继续观察和表达。',
    goodbye: '谢谢大家陪我一起学习，我们下次见！',
  },
  {
    name: '园所专属角色',
    category: 'kindergarten_custom',
    description: '供园所继续配置名称、形象、声音和课堂话术的专属角色。',
    style: '稳重友好',
    greeting: '小朋友们好，欢迎来到今天的数字课堂！',
    encouragement: '肯定参与过程，引导幼儿说出自己的发现。',
    goodbye: '今天的活动结束啦，期待下次再见！',
  },
];

const insertCharacter = db.prepare(`
  INSERT INTO avatar_character
    (name, category, description, owner_type, owner_id, school_id, status, current_version_id)
  VALUES (?, ?, ?, 'teacher', ?, ?, 'approved', NULL)
`);
const insertVersion = db.prepare(`
  INSERT INTO avatar_version
    (character_id, version, engine_version, model_format, checksum, status, compatibility)
  VALUES (?, 1, 'avatar-engine-1', 'glb', ?, 'ready', ?)
`);
const insertAsset = db.prepare(`
  INSERT INTO avatar_asset
    (version_id, asset_type, action_name, original_name, file_path, mime_type, file_size, checksum, metadata)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertVoice = db.prepare(`
  INSERT INTO avatar_voice_profile
    (character_id, provider, voice_id, language, speed, volume, pitch, status)
  VALUES (?, 'system', 'default-child-safe', 'zh-CN', ?, 1, 0, 'active')
`);
const insertPersonality = db.prepare(`
  INSERT INTO avatar_personality
    (character_id, style, catchphrases, greeting, encouragement_style, goodbye_text)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const seed = db.transaction(() => {
  const seeded = [];
  for (const [index, role] of characters.entries()) {
    let character = db
      .prepare("SELECT id, current_version_id FROM avatar_character WHERE name = ? AND owner_type = 'teacher' AND owner_id = ? LIMIT 1")
      .get(role.name, teacher.id);
    if (!character) {
      character = { id: Number(insertCharacter.run(role.name, role.category, role.description, teacher.id, schoolId).lastInsertRowid) };
    }

    let version = db
      .prepare('SELECT id FROM avatar_version WHERE character_id = ? AND version = 1 LIMIT 1')
      .get(character.id);
    if (!version) {
      version = {
        id: Number(
          insertVersion.run(
            character.id,
            modelInfo.checksum,
            JSON.stringify({ seeded: true, renderProfile: index === 1 ? 'bear' : index === 2 ? 'garden' : 'flower' }),
          ).lastInsertRowid,
        ),
      };
    }

    const assetCount = db.prepare('SELECT COUNT(*) AS count FROM avatar_asset WHERE version_id = ?').get(version.id).count;
    if (!assetCount) {
      const modelMetadata = JSON.stringify({ seeded: true, renderProfile: index === 1 ? 'bear' : index === 2 ? 'garden' : 'flower' });
      insertAsset.run(version.id, 'model', null, 'RobotExpressive.glb', modelFileName, 'model/gltf-binary', modelInfo.size, modelInfo.checksum, modelMetadata);
      insertAsset.run(version.id, 'texture', null, 'default-texture.png', imageFileName, 'image/png', imageInfo.size, imageInfo.checksum, '{}');
      insertAsset.run(version.id, 'animation', 'idle', 'idle.glb', modelFileName, 'model/gltf-binary', modelInfo.size, modelInfo.checksum, '{}');
      insertAsset.run(version.id, 'animation', 'speak', 'speak.glb', modelFileName, 'model/gltf-binary', modelInfo.size, modelInfo.checksum, '{}');
      insertAsset.run(version.id, 'lip_sync', null, 'lip-sync.json', lipSyncFileName, 'application/json', lipSyncInfo.size, lipSyncInfo.checksum, '{}');
      insertAsset.run(version.id, 'preview', null, 'preview.png', imageFileName, 'image/png', imageInfo.size, imageInfo.checksum, '{}');
      insertAsset.run(version.id, 'fallback_2d', null, 'fallback.png', imageFileName, 'image/png', imageInfo.size, imageInfo.checksum, '{}');
    }

    db.prepare(`
      UPDATE avatar_character
      SET category = ?, description = ?, school_id = ?, status = 'approved', current_version_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(role.category, role.description, schoolId, version.id, character.id);

    if (!db.prepare('SELECT 1 FROM avatar_voice_profile WHERE character_id = ?').get(character.id)) {
      insertVoice.run(character.id, index === 1 ? 1.05 : 1);
    }
    if (!db.prepare('SELECT 1 FROM avatar_personality WHERE character_id = ?').get(character.id)) {
      insertPersonality.run(
        character.id,
        role.style,
        JSON.stringify(index === 1 ? ['我们一起想一想', '你发现了什么'] : ['我们一起试试看']),
        role.greeting,
        role.encouragement,
        role.goodbye,
      );
    }
    seeded.push({ characterId: character.id, versionId: version.id, name: role.name });
  }

  const activeSystem = db.prepare("SELECT id FROM avatar_binding WHERE scope_type = 'system' AND scope_id = 0 AND status = 'active'").get();
  if (!activeSystem) {
    db.prepare(`
      INSERT INTO avatar_binding (scope_type, scope_id, character_id, version_id, created_by, status)
      VALUES ('system', 0, ?, ?, ?, 'active')
    `).run(seeded[0].characterId, seeded[0].versionId, teacher.id);
  }
  return seeded;
});

try {
  const result = seed();
  console.log(`已初始化 ${result.length} 个数字人角色：${result.map((item) => item.name).join('、')}`);
  console.log(`数据库：${databasePath}`);
  console.log(`角色资源：${uploadDirectory}`);
} finally {
  db.close();
}
