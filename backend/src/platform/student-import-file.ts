import { BadRequestException } from '@nestjs/common';
import { memoryStorage } from 'multer';

export const STUDENT_IMPORT_MAX_BYTES = 2 * 1024 * 1024;

export const studentImportMulterOptions = {
  storage: memoryStorage(),
  limits: { fileSize: STUDENT_IMPORT_MAX_BYTES, files: 1 },
  fileFilter: (
    _request: Express.Request,
    file: Express.Multer.File,
    callback: (error: Error | null, accept: boolean) => void,
  ) => {
    const extensionOk = file.originalname.toLowerCase().endsWith('.xlsx');
    const mimeOk = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/octet-stream',
    ].includes(file.mimetype);
    if (!extensionOk || !mimeOk) {
      callback(new BadRequestException('仅支持 .xlsx 格式的学生导入文件'), false);
      return;
    }
    callback(null, true);
  },
};

export function assertStudentImportFile(file?: Express.Multer.File): asserts file is Express.Multer.File {
  if (!file?.buffer?.length) throw new BadRequestException('请选择要导入的 XLSX 文件');
  if (file.size > STUDENT_IMPORT_MAX_BYTES) throw new BadRequestException('导入文件不能超过 2MB');
  if (file.buffer[0] !== 0x50 || file.buffer[1] !== 0x4b) {
    throw new BadRequestException('文件内容不是有效的 XLSX 工作簿');
  }
}
