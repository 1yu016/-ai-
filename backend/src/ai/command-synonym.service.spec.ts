import { ConflictException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { ClassroomCommandOperation } from '../classroom-runs/classroom-command.types';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import { CommandSynonymService } from './command-synonym.service';

describe('CommandSynonymService', () => {
  const actor = { sub: 7, userType: AuthUserType.Teacher } as never;
  const findOne = jest.fn();
  const find = jest.fn();
  const save = jest.fn(async (value) => ({ id: 1, ...value }));
  const create = jest.fn((value) => value);
  const remove = jest.fn();
  const service = new CommandSynonymService({ findOne, find, save, create, remove } as never);

  beforeEach(() => jest.clearAllMocks());

  it('保存教师自定义白名单口令', async () => {
    findOne.mockResolvedValue(null);
    const result = await service.create(actor, {
      phrase: ' 往前走 ',
      operation: ClassroomCommandOperation.NextStep,
    });
    expect(result).toEqual(expect.objectContaining({
      teacherId: 7,
      phrase: '往前走',
      normalizedPhrase: '往前走',
      operation: ClassroomCommandOperation.NextStep,
    }));
  });

  it('拒绝与系统口令冲突的同义词', async () => {
    await expect(service.create(actor, {
      phrase: '下一步',
      operation: ClassroomCommandOperation.NextStep,
    })).rejects.toBeInstanceOf(ConflictException);
    expect(save).not.toHaveBeenCalled();
  });

  it('拒绝同一教师的重复口令', async () => {
    findOne.mockResolvedValue({ id: 9 });
    await expect(service.create(actor, {
      phrase: '往前走',
      operation: ClassroomCommandOperation.NextStep,
    })).rejects.toBeInstanceOf(ConflictException);
  });
});
