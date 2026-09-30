import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { diskStorage } from 'multer';
import {
  detectContentType,
  validateSafeFileName,
} from '../resources/resource-file.validation';
import { AvatarAssetType, AvatarModelFormat } from './avatar.types';

const MB = 1024 * 1024;
const DANGEROUS_CONFIGURATION =
  /(?:javascript\s*:|https?:\/\/|file\s*:|<script|\b(?:cmd\.exe|powershell|\/bin\/sh|system\s*\(|exec\s*\())/i;

const ASSET_SIZE_LIMITS: Readonly<Record<AvatarAssetType, number>> = {
  [AvatarAssetType.Model]: 300 * MB,
  [AvatarAssetType.Texture]: 30 * MB,
  [AvatarAssetType.Animation]: 100 * MB,
  [AvatarAssetType.Expression]: 5 * MB,
  [AvatarAssetType.LipSync]: 5 * MB,
  [AvatarAssetType.Preview]: 15 * MB,
  [AvatarAssetType.Fallback2d]: 15 * MB,
};

const ALLOWED_EXTENSIONS: Readonly<Record<AvatarAssetType, readonly string[]>> =
  {
    [AvatarAssetType.Model]: ['.glb', '.gltf', '.vrm'],
    [AvatarAssetType.Texture]: ['.png', '.jpg', '.jpeg'],
    [AvatarAssetType.Animation]: ['.glb', '.gltf'],
    [AvatarAssetType.Expression]: ['.json'],
    [AvatarAssetType.LipSync]: ['.json'],
    [AvatarAssetType.Preview]: ['.png', '.jpg', '.jpeg'],
    [AvatarAssetType.Fallback2d]: ['.png', '.jpg', '.jpeg'],
  };

const DECLARED_MIME: Readonly<Record<string, readonly string[]>> = {
  '.glb': ['model/gltf-binary'],
  '.vrm': ['model/gltf-binary'],
  '.gltf': ['model/gltf+json', 'application/json'],
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.json': ['application/json'],
};

export const AVATAR_UPLOAD_DIRECTORY = resolve(
  process.env.AVATAR_UPLOAD_PATH ||
    resolve(process.cwd(), 'uploads', 'avatars'),
);
mkdirSync(AVATAR_UPLOAD_DIRECTORY, { recursive: true });

export const avatarMulterOptions = {
  storage: diskStorage({
    destination: AVATAR_UPLOAD_DIRECTORY,
    filename: (
      _request: Express.Request,
      file: Express.Multer.File,
      callback: (error: Error | null, filename: string) => void,
    ) => {
      try {
        callback(
          null,
          `${randomUUID()}${validateSafeFileName(file.originalname)}`,
        );
      } catch (error) {
        callback(error as Error, '');
      }
    },
  }),
  limits: { fileSize: 300 * MB, files: 1 },
  fileFilter: (
    _request: Express.Request,
    file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    try {
      const extension = validateSafeFileName(file.originalname);
      if (!DECLARED_MIME[extension]?.includes(file.mimetype))
        throw new BadRequestException('文件扩展名与声明 MIME 不匹配');
      callback(null, true);
    } catch (error) {
      callback(error as Error, false);
    }
  },
};

export type ValidatedAvatarFile = {
  extension: string;
  mimeType: string;
};

export async function validateAvatarFile(
  file: Express.Multer.File | undefined,
  assetType: AvatarAssetType,
  modelFormat?: AvatarModelFormat,
): Promise<ValidatedAvatarFile> {
  if (!file)
    throw new BadRequestException('请使用 multipart/form-data 上传 file 字段');
  const extension = validateSafeFileName(file.originalname);
  if (!ALLOWED_EXTENSIONS[assetType].includes(extension))
    throw new BadRequestException('资源类型与文件格式不匹配');
  if (!DECLARED_MIME[extension]?.includes(file.mimetype))
    throw new BadRequestException('文件扩展名与声明 MIME 不匹配');
  if (file.size <= 0 || file.size > ASSET_SIZE_LIMITS[assetType])
    throw new BadRequestException('文件大小超出该数字人资源允许的上限');
  if (
    assetType === AvatarAssetType.Model &&
    modelFormat &&
    extension !== `.${modelFormat}`
  )
    throw new BadRequestException('模型格式与文件扩展名不匹配');

  const detected = await detectContentType(file.path);
  const expected =
    extension === '.gltf' || extension === '.json'
      ? 'application/json'
      : extension === '.glb' || extension === '.vrm'
        ? 'model/gltf-binary'
        : extension === '.png'
          ? 'image/png'
          : 'image/jpeg';
  if (detected !== expected)
    throw new BadRequestException('文件真实内容与扩展名或 MIME 不匹配');
  if (extension === '.glb' || extension === '.vrm')
    await validateGlbStructure(file.path);
  if (['.gltf', '.json'].includes(extension)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(file.path, 'utf8')) as unknown;
    } catch {
      throw new BadRequestException('JSON 文件内容无效');
    }
    if (
      extension === '.gltf' &&
      (!parsed ||
        typeof parsed !== 'object' ||
        !('asset' in parsed) ||
        typeof (parsed as { asset?: unknown }).asset !== 'object' ||
        !String(
          (parsed as { asset: { version?: unknown } }).asset.version ?? '',
        ).startsWith('2'))
    )
      throw new BadRequestException('glTF模型结构或版本不兼容');
    rejectDangerousConfiguration(parsed);
  }
  return { extension, mimeType: expected };
}

async function validateGlbStructure(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    if (info.size < 20) throw new BadRequestException('GLB模型结构不完整');
    const header = Buffer.alloc(20);
    await handle.read(header, 0, header.length, 0);
    const version = header.readUInt32LE(4);
    const declaredLength = header.readUInt32LE(8);
    const firstChunkLength = header.readUInt32LE(12);
    const firstChunkType = header.readUInt32LE(16);
    if (
      version !== 2 ||
      declaredLength !== info.size ||
      firstChunkType !== 0x4e4f534a ||
      firstChunkLength <= 0 ||
      20 + firstChunkLength > info.size
    )
      throw new BadRequestException('GLB模型结构或版本不兼容');
  } finally {
    await handle.close();
  }
}

export function parseSafeJsonObject(
  value: string | undefined,
  fieldName: string,
): Record<string, unknown> {
  if (!value?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new BadRequestException(`${fieldName}必须是有效JSON对象`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new BadRequestException(`${fieldName}必须是JSON对象`);
  rejectDangerousConfiguration(parsed);
  return parsed as Record<string, unknown>;
}

function rejectDangerousConfiguration(value: unknown): void {
  if (typeof value === 'string') {
    if (DANGEROUS_CONFIGURATION.test(value))
      throw new BadRequestException('资源配置包含URL、脚本或系统命令');
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) rejectDangerousConfiguration(item);
    return;
  }
  if (value && typeof value === 'object')
    for (const [key, item] of Object.entries(value)) {
      if (DANGEROUS_CONFIGURATION.test(key))
        throw new BadRequestException('资源配置包含URL、脚本或系统命令');
      rejectDangerousConfiguration(item);
    }
}

export function modelFormatForExtension(extension: string): AvatarModelFormat {
  if (extension === '.glb') return AvatarModelFormat.Glb;
  if (extension === '.gltf') return AvatarModelFormat.Gltf;
  if (extension === '.vrm') return AvatarModelFormat.Vrm;
  throw new BadRequestException('不支持的模型格式');
}
