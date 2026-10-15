import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { diskStorage } from 'multer';
import { detectContentType } from '../resources/resource-file.validation';

export const ARTWORK_MAX_BYTES = 10 * 1024 * 1024;
export const ARTWORK_UPLOAD_DIRECTORY = resolve(
  process.env.ARTWORK_UPLOAD_PATH || resolve(process.cwd(), 'uploads', 'artworks'),
);
mkdirSync(ARTWORK_UPLOAD_DIRECTORY, { recursive: true });

function declared(file: Pick<Express.Multer.File, 'originalname' | 'mimetype'>) {
  if (!file.originalname || basename(file.originalname) !== file.originalname || /[\\/\0]/.test(file.originalname))
    throw new BadRequestException('文件名不安全');
  const extension = extname(file.originalname).toLowerCase();
  const expected = extension === '.jpg' || extension === '.jpeg'
    ? 'image/jpeg'
    : extension === '.png'
      ? 'image/png'
      : null;
  if (!expected) throw new BadRequestException('仅支持 JPG、PNG 图片');
  if (file.mimetype !== expected) throw new BadRequestException('文件扩展名与声明 MIME 不匹配');
  return { extension, expected };
}

export const artworkMulterOptions = {
  storage: diskStorage({
    destination: ARTWORK_UPLOAD_DIRECTORY,
    filename: (_req: Express.Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
      try { cb(null, `${randomUUID()}${declared(file).extension}`); }
      catch (error) { cb(error as Error, ''); }
    },
  }),
  limits: { fileSize: ARTWORK_MAX_BYTES, files: 1 },
  fileFilter: (_req: Express.Request, file: Express.Multer.File, cb: (error: Error | null, accept: boolean) => void) => {
    try { declared(file); cb(null, true); }
    catch (error) { cb(error as Error, false); }
  },
};

export async function validateArtworkFile(file?: Express.Multer.File) {
  if (!file) throw new BadRequestException('请使用 multipart/form-data 上传 file 字段');
  const info = declared(file);
  if (file.size <= 0 || file.size > ARTWORK_MAX_BYTES) throw new BadRequestException('图片不能超过10MB');
  const actual = await detectContentType(file.path);
  if (actual !== info.expected) throw new BadRequestException('文件真实内容与扩展名或 MIME 不匹配');
  return actual;
}
