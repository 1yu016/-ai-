import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, relative, resolve } from 'node:path';
import { diskStorage } from 'multer';
import { ResourceType } from '../data/entities/teaching-resource.entity';

export type ValidatedFile = {
  extension: string;
  mimeType: string;
  maxSize: number;
  resourceType: ResourceType;
};
type FileRule = {
  mime: string;
  defaultType: ResourceType;
  allowedTypes: readonly ResourceType[];
};
const MB = 1024 * 1024;

export const RESOURCE_SIZE_LIMITS: Readonly<Record<ResourceType, number>> = {
  [ResourceType.Image]: 15 * MB,
  [ResourceType.Audio]: 100 * MB,
  [ResourceType.Video]: 500 * MB,
  [ResourceType.Pdf]: 80 * MB,
  [ResourceType.Ppt]: 150 * MB,
  [ResourceType.PictureBook]: 80 * MB,
  [ResourceType.Animation]: 300 * MB,
  [ResourceType.QuestionBank]: 20 * MB,
  [ResourceType.Experiment]: 80 * MB,
  [ResourceType.Model3d]: 300 * MB,
  [ResourceType.Document]: 80 * MB,
};

const RULES: Readonly<Record<string, FileRule>> = {
  '.jpg': {
    mime: 'image/jpeg',
    defaultType: ResourceType.Image,
    allowedTypes: [ResourceType.Image],
  },
  '.jpeg': {
    mime: 'image/jpeg',
    defaultType: ResourceType.Image,
    allowedTypes: [ResourceType.Image],
  },
  '.png': {
    mime: 'image/png',
    defaultType: ResourceType.Image,
    allowedTypes: [ResourceType.Image],
  },
  '.gif': {
    mime: 'image/gif',
    defaultType: ResourceType.Animation,
    allowedTypes: [ResourceType.Animation, ResourceType.Image],
  },
  '.mp3': {
    mime: 'audio/mpeg',
    defaultType: ResourceType.Audio,
    allowedTypes: [ResourceType.Audio],
  },
  '.wav': {
    mime: 'audio/wav',
    defaultType: ResourceType.Audio,
    allowedTypes: [ResourceType.Audio],
  },
  '.mp4': {
    mime: 'video/mp4',
    defaultType: ResourceType.Video,
    allowedTypes: [ResourceType.Video, ResourceType.Animation],
  },
  '.pdf': {
    mime: 'application/pdf',
    defaultType: ResourceType.Pdf,
    allowedTypes: [
      ResourceType.Pdf,
      ResourceType.PictureBook,
      ResourceType.Experiment,
      ResourceType.Document,
    ],
  },
  '.ppt': {
    mime: 'application/vnd.ms-powerpoint',
    defaultType: ResourceType.Ppt,
    allowedTypes: [ResourceType.Ppt, ResourceType.Document],
  },
  '.pptx': {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    defaultType: ResourceType.Ppt,
    allowedTypes: [ResourceType.Ppt, ResourceType.Document],
  },
  '.json': {
    mime: 'application/json',
    defaultType: ResourceType.QuestionBank,
    allowedTypes: [ResourceType.QuestionBank, ResourceType.Model3d],
  },
  '.gltf': {
    mime: 'model/gltf+json',
    defaultType: ResourceType.Model3d,
    allowedTypes: [ResourceType.Model3d],
  },
  '.glb': {
    mime: 'model/gltf-binary',
    defaultType: ResourceType.Model3d,
    allowedTypes: [ResourceType.Model3d],
  },
  '.vrm': {
    // VRM 是 glTF 2.0 Binary 容器（扩展名 .vrm），与 .glb 同一容器规则。
    mime: 'model/gltf-binary',
    defaultType: ResourceType.Model3d,
    allowedTypes: [ResourceType.Model3d],
  },
};
const EXECUTABLE_EXTENSIONS =
  /\.(?:exe|dll|com|bat|cmd|ps1|sh|js|mjs|cjs|html?|php|py|jar|msi|scr|vbs)$/i;

export const RESOURCE_UPLOAD_DIRECTORY = resolve(
  process.env.RESOURCE_UPLOAD_PATH ||
    resolve(process.cwd(), 'uploads', 'resources'),
);
export const RESOURCE_CHUNK_DIRECTORY = resolve(
  process.env.RESOURCE_CHUNK_PATH ||
    resolve(process.cwd(), 'uploads', '.chunks'),
);
mkdirSync(RESOURCE_UPLOAD_DIRECTORY, { recursive: true });
mkdirSync(RESOURCE_CHUNK_DIRECTORY, { recursive: true });

export const resourceMulterOptions = {
  storage: diskStorage({
    destination: RESOURCE_UPLOAD_DIRECTORY,
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
  limits: { fileSize: 500 * MB, files: 1 },
  fileFilter: (
    _request: Express.Request,
    file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    try {
      validateDeclaredFile(file);
      callback(null, true);
    } catch (error) {
      callback(error as Error, false);
    }
  },
};
export const chunkMulterOptions = {
  storage: diskStorage({
    destination: RESOURCE_CHUNK_DIRECTORY,
    filename: (
      _request: Express.Request,
      _file: Express.Multer.File,
      callback: (error: Error | null, filename: string) => void,
    ) => callback(null, `${randomUUID()}.part`),
  }),
  limits: { fileSize: 20 * MB, files: 1 },
};

export function validateSafeFileName(originalName: string): string {
  if (
    !originalName ||
    basename(originalName) !== originalName ||
    originalName.includes('/') ||
    originalName.includes('\\') ||
    originalName.includes('\0')
  )
    throw new BadRequestException('文件名不安全');
  const extension = extname(originalName).toLowerCase();
  const stem = originalName.slice(0, -extension.length);
  if (
    !extension ||
    !RULES[extension] ||
    stem.includes('.') ||
    EXECUTABLE_EXTENSIONS.test(originalName)
  )
    throw new BadRequestException('文件扩展名不允许或包含双扩展名');
  return extension;
}

export function validateDeclaredFile(
  file: Pick<Express.Multer.File, 'mimetype' | 'originalname'>,
  requestedType?: ResourceType,
): ValidatedFile {
  const extension = validateSafeFileName(file.originalname);
  const rule = RULES[extension];
  const accepted =
    extension === '.wav'
      ? ['audio/wav', 'audio/x-wav', 'audio/wave']
      : extension === '.json'
        ? ['application/json', 'model/gltf+json']
        : [rule.mime];
  if (!accepted.includes(file.mimetype))
    throw new BadRequestException('文件扩展名与声明 MIME 不匹配');
  const resourceType = requestedType ?? rule.defaultType;
  if (!rule.allowedTypes.includes(resourceType))
    throw new BadRequestException('资源类型与文件格式不匹配');
  return {
    extension,
    mimeType: rule.mime,
    maxSize: RESOURCE_SIZE_LIMITS[resourceType],
    resourceType,
  };
}

export async function validateUploadedFile(
  file: Express.Multer.File | undefined,
  requestedType?: ResourceType,
): Promise<ValidatedFile> {
  if (!file)
    throw new BadRequestException('请使用 multipart/form-data 上传 file 字段');
  const rule = validateDeclaredFile(file, requestedType);
  if (file.size <= 0 || file.size > rule.maxSize)
    throw new BadRequestException('文件大小超出该类型允许的上限');
  const detected = await detectContentType(file.path);
  if (!contentMatches(rule.extension, detected))
    throw new BadRequestException('文件真实内容与扩展名或 MIME 不匹配');
  if (rule.extension === '.pptx' && !(await containsPptxStructure(file.path)))
    throw new BadRequestException('PPTX 文件结构不完整');
  if (rule.extension === '.json' || rule.extension === '.gltf') {
    try {
      JSON.parse(await readFile(file.path, 'utf8'));
    } catch {
      throw new BadRequestException('JSON 文件内容无效');
    }
  }
  return { ...rule, mimeType: detected };
}

export async function detectContentType(path: string): Promise<string> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const head = buffer.subarray(0, bytesRead);
    if (
      head.length >= 3 &&
      head[0] === 0xff &&
      head[1] === 0xd8 &&
      head[2] === 0xff
    )
      return 'image/jpeg';
    if (
      head
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    )
      return 'image/png';
    if (['GIF87a', 'GIF89a'].includes(head.subarray(0, 6).toString('ascii')))
      return 'image/gif';
    if (
      head.subarray(0, 3).toString('ascii') === 'ID3' ||
      (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)
    )
      return 'audio/mpeg';
    if (
      head.subarray(0, 4).toString('ascii') === 'RIFF' &&
      head.subarray(8, 12).toString('ascii') === 'WAVE'
    )
      return 'audio/wav';
    if (head.subarray(4, 8).toString('ascii') === 'ftyp') return 'video/mp4';
    if (head.subarray(0, 5).toString('ascii') === '%PDF-')
      return 'application/pdf';
    if (
      head
        .subarray(0, 8)
        .equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
    )
      return 'application/vnd.ms-powerpoint';
    if (head.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])))
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    if (head.subarray(0, 4).toString('ascii') === 'glTF')
      return 'model/gltf-binary';
    const text = head.toString('utf8').trimStart();
    // Only identify the container here. Full JSON validation happens after the
    // complete file is read so valid JSON larger than this header is accepted.
    if (text.startsWith('{') || text.startsWith('[')) return 'application/json';
    throw new BadRequestException('无法识别文件真实类型');
  } finally {
    await handle.close();
  }
}

function contentMatches(extension: string, detected: string): boolean {
  if (extension === '.json' || extension === '.gltf')
    return detected === 'application/json';
  return RULES[extension]?.mime === detected;
}

async function containsPptxStructure(path: string): Promise<boolean> {
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    const size = Math.min(info.size, 256 * 1024);
    const first = Buffer.alloc(size);
    const last = Buffer.alloc(size);
    await handle.read(first, 0, size, 0);
    await handle.read(last, 0, size, Math.max(0, info.size - size));
    const searchable = Buffer.concat([first, last]).toString('latin1');
    return (
      searchable.includes('[Content_Types].xml') && searchable.includes('ppt/')
    );
  } finally {
    await handle.close();
  }
}

export function resolveInside(root: string, candidate: string): string {
  const absolute = resolve(root, candidate);
  const relation = relative(root, absolute);
  if (!relation || relation.startsWith('..') || isAbsolute(relation))
    throw new BadRequestException('文件路径不安全');
  return absolute;
}
