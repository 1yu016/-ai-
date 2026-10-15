import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { unlink } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { ARTWORK_UPLOAD_DIRECTORY } from './artwork-file';

@Catch()
export class ArtworkUploadExceptionFilter implements ExceptionFilter {
  async catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<Request & { file?: Express.Multer.File }>();
    const response = context.getResponse<Response>();
    const filePath = request.file?.path;
    if (filePath) {
      const absolute = resolve(filePath);
      const relation = relative(ARTWORK_UPLOAD_DIRECTORY, absolute);
      if (relation && !relation.startsWith('..') && !isAbsolute(relation)) await unlink(absolute).catch(() => undefined);
    }
    const original = exception instanceof HttpException ? exception.getStatus() : 500;
    const status = original === HttpStatus.PAYLOAD_TOO_LARGE ? HttpStatus.BAD_REQUEST : original;
    const body = exception instanceof HttpException ? exception.getResponse() : null;
    const message = typeof body === 'string' ? body : body && typeof body === 'object' && 'message' in body ? (body as { message: unknown }).message : '作品上传失败，请稍后重试';
    response.status(status).json({ statusCode: status, message, error: status >= 500 ? 'Internal Server Error' : 'Bad Request' });
  }
}
