import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { diskStorage } from 'multer';
import { ResourceType } from '../data/entities/teaching-resource.entity';

type FileRule = {
  extensions: readonly string[];
  maxSize: number;
  resourceType: ResourceType;
};

const MB = 1024 * 1024;

export const RESOURCE_FILE_RULES: Readonly<Record<string, FileRule>> = {
  'image/jpeg': {
    extensions: ['.jpg', '.jpeg'],
    maxSize: 10 * MB,
    resourceType: ResourceType.Image,
  },
  'image/png': {
    extensions: ['.png'],
    maxSize: 10 * MB,
    resourceType: ResourceType.Image,
  },
  'audio/mpeg': {
    extensions: ['.mp3'],
    maxSize: 30 * MB,
    resourceType: ResourceType.Audio,
  },
  'audio/wav': {
    extensions: ['.wav'],
    maxSize: 30 * MB,
    resourceType: ResourceType.Audio,
  },
  'video/mp4': {
    extensions: ['.mp4'],
    maxSize: 200 * MB,
    resourceType: ResourceType.Video,
  },
  'application/pdf': {
    extensions: ['.pdf'],
    maxSize: 30 * MB,
    resourceType: ResourceType.Document,
  },
  'application/vnd.ms-powerpoint': {
    extensions: ['.ppt'],
    maxSize: 50 * MB,
    resourceType: ResourceType.Document,
  },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    extensions: ['.pptx'],
    maxSize: 50 * MB,
    resourceType: ResourceType.Document,
  },
};

export const RESOURCE_UPLOAD_DIRECTORY = resolve(
  process.env.RESOURCE_UPLOAD_PATH || resolve(process.cwd(), 'uploads', 'resources'),
);

mkdirSync(RESOURCE_UPLOAD_DIRECTORY, { recursive: true });

export const resourceMulterOptions = {
  storage: diskStorage({
    destination: RESOURCE_UPLOAD_DIRECTORY,
    filename: (
      _request: Express.Request,
      file: Express.Multer.File,
      callback: (error: Error | null, filename: string) => void,
    ) => {
      const extension = extname(file.originalname).toLowerCase();
      callback(null, `${randomUUID()}${extension}`);
    },
  }),
  limits: { fileSize: 200 * MB, files: 1 },
  fileFilter: (
    _request: Express.Request,
    file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    try {
      validateFileType(file);
      callback(null, true);
    } catch (error) {
      callback(error as Error, false);
    }
  },
};

export function validateFileType(
  file: Pick<Express.Multer.File, 'mimetype' | 'originalname'>,
): FileRule {
  const rule = RESOURCE_FILE_RULES[file.mimetype];
  const extension = extname(file.originalname).toLowerCase();
  if (!rule || !rule.extensions.includes(extension)) {
    throw new BadRequestException(
      '不支持的文件格式，仅支持 JPG、PNG、MP3、WAV、MP4、PDF、PPT 和 PPTX',
    );
  }
  return rule;
}

export function validateUploadedFile(file?: Express.Multer.File): FileRule {
  if (!file) {
    throw new BadRequestException('请使用 multipart/form-data 上传 file 字段');
  }
  const rule = validateFileType(file);
  if (file.size > rule.maxSize) {
    throw new BadRequestException('文件大小超过该类型允许的上限');
  }
  return rule;
}
