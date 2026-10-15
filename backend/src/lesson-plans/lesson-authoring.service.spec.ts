import { jest } from '@jest/globals';
import { LessonPlanService } from './lesson-plan.service';
import { LessonPlanStatus, LessonAgeGroup } from './lesson-plan.types';

describe('complete lesson authoring transaction', () => {
  const actor = { sub: 7, schoolId: 'school' } as any;
  const dto = { title: '数字1', theme: '数字', ageGroup: '4-5' as LessonAgeGroup,
    objectives: '认识数字', estimatedMinutes: 20, status: LessonPlanStatus.Draft,
    steps: [], changeSummary: '第一次备课', requestId: '' };
  function setup() {
    const repo = { create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 12, ...value })),
      update: jest.fn(async () => ({ affected: 1 })),
      findOneByOrFail: jest.fn(async () => ({ id: 12, version: 2 })) };
    const manager = { getRepository: jest.fn(() => repo) };
    const ds = { transaction: jest.fn(async (callback) => callback(manager)) };
    const service = new LessonPlanService(null as any, null as any, null as any,
      null as any, null as any, null as any, null as any, ds as any, null as any, null as any);
    jest.spyOn(service as any, 'validateStepResources').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'ownedPlan').mockResolvedValue({ id: 12 });
    jest.spyOn(service as any, 'loadSteps').mockResolvedValue([]);
    const steps = jest.spyOn(service, 'saveSteps').mockResolvedValue({ version: 2, steps: [] });
    return { service, ds, repo, manager, steps };
  }
  it('passes the same transaction manager to step/reference/version saving', async () => {
    const { service, ds, manager, steps } = setup();
    await service.saveAuthoring(actor, dto);
    expect(ds.transaction).toHaveBeenCalledTimes(1);
    expect(steps).toHaveBeenCalledWith(actor, 12, expect.objectContaining({ version: 0,
      changeSummary: '第一次备课' }), manager);
  });
  it('rejects stale updates before saving steps', async () => {
    const { service, repo, steps } = setup();
    repo.update.mockResolvedValue({ affected: 0 });
    await expect(service.saveAuthoring(actor, { ...dto, version: 1 }, 12)).rejects.toThrow();
    expect(steps).not.toHaveBeenCalled();
  });
  it('propagates step failure out of the transaction rather than reporting success', async () => {
    const { service, steps } = setup();
    steps.mockRejectedValue(new Error('write failed'));
    await expect(service.saveAuthoring(actor, dto)).rejects.toThrow('write failed');
  });
  it('requires a version on update', async () => {
    const { service, ds } = setup();
    await expect(service.saveAuthoring(actor, dto, 12)).rejects.toThrow();
    expect(ds.transaction).not.toHaveBeenCalled();
  });
});
