import { BadRequestException } from '@nestjs/common';
import { validateSafeFileName } from '../resources/resource-file.validation';
import {
  modelFormatForExtension,
  parseSafeJsonObject,
} from './avatar-file.validation';
import { AvatarModelFormat } from './avatar.types';

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

  describe('AvatarModelFormat vrm support', () => {
    it('accepts .vrm as a safe file extension (glTF binary container)', () => {
      expect(validateSafeFileName('AliciaSolid.vrm')).toBe('.vrm');
    });

    it('rejects vrm paths with traversal or double extension', () => {
      expect(() => validateSafeFileName('../model.vrm')).toThrow(
        BadRequestException,
      );
      expect(() => validateSafeFileName('model.run.vrm')).toThrow(
        BadRequestException,
      );
    });

    it('maps .vrm extension to the vrm model format', () => {
      expect(modelFormatForExtension('.vrm')).toBe(AvatarModelFormat.Vrm);
    });

    it('keeps existing glb/gltf formats unchanged', () => {
      expect(modelFormatForExtension('.glb')).toBe(AvatarModelFormat.Glb);
      expect(modelFormatForExtension('.gltf')).toBe(AvatarModelFormat.Gltf);
      expect(() => modelFormatForExtension('.fbx')).toThrow(
        BadRequestException,
      );
      expect(validateSafeFileName('RobotExpressive.glb')).toBe('.glb');
    });
  });
});
