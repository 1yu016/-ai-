import { BadRequestException } from '@nestjs/common';
import { validateSafeFileName } from '../resources/resource-file.validation';
import { parseSafeJsonObject } from './avatar-file.validation';

describe('avatar file validation', () => {
  it('rejects path traversal and double extensions', () => {
    expect(() => validateSafeFileName('../avatar.glb')).toThrow(
      BadRequestException,
    );
    expect(() => validateSafeFileName('avatar.exe.glb')).toThrow(
      BadRequestException,
    );
    expect(() => validateSafeFileName('folder\\avatar.glb')).toThrow(
      BadRequestException,
    );
  });

  it('rejects URLs, JavaScript and system commands in configuration', () => {
    expect(() =>
      parseSafeJsonObject('{"handler":"javascript:alert(1)"}', 'metadata'),
    ).toThrow(BadRequestException);
    expect(() =>
      parseSafeJsonObject('{"source":"https://evil.example"}', 'metadata'),
    ).toThrow(BadRequestException);
    expect(() =>
      parseSafeJsonObject('{"command":"powershell -enc x"}', 'metadata'),
    ).toThrow(BadRequestException);
  });
});
