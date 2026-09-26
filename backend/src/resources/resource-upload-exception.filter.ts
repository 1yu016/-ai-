import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { unlink } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { RESOURCE_UPLOAD_DIRECTORY } from './resource-file.validation';

type UploadRequest = Request & { file?: Express.Multer.File };

@Catch()
export class ResourceUploadExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ResourceUploadExceptionFilter.name);

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const context = host.switchToHttp();
    const request = context.getRequest<UploadRequest>();
    const response = context.getResponse<Response>();
    await this.removeResidualFile(request.file?.path);

    const originalStatus =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const status =
      originalStatus === HttpStatus.PAYLOAD_TOO_LARGE
        ? HttpStatus.BAD_REQUEST
        : originalStatus;
    const message = this.exceptionMessage(exception, status);
    if (status >= 500) {
      this.logger.error(
        'resource.upload.unhandled',
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    response.status(status).json({
      statusCode: status,
      message,
      error:
        status >= 500
          ? 'Internal Server Error'
          : status === HttpStatus.UNAUTHORIZED
            ? 'Unauthorized'
            : 'Bad Request',
    });
  }

  private exceptionMessage(
    exception: unknown,
    status: number,
  ): string | string[] {
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === 'string') return body;
      if (body && typeof body === 'object' && 'message' in body) {
        const message = (body as { message?: unknown }).message;
        if (typeof message === 'string' || Array.isArray(message)) {
          return message as string | string[];
        }
      }
    }
    return status >= 500 ? '资源上传失败，请稍后重试' : '上传请求无效';
  }

  private async removeResidualFile(filePath?: string): Promise<void> {
    if (!filePath) return;
    const resolvedPath = resolve(filePath);
    const relation = relative(RESOURCE_UPLOAD_DIRECTORY, resolvedPath);
    if (!relation || relation.startsWith('..') || isAbsolute(relation)) return;
    try {
      await unlink(resolvedPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.error(
          `resource.upload.cleanup.failed path=${resolvedPath}`,
        );
      }
    }
  }
}
