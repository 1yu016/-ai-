import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import { LessonPlanAiService } from './lesson-plan-ai.service';
import { LessonAgeGroup } from './lesson-plan.types';

describe('experience candidate boundary', () => {
  function fixture() {
    const pack = { digest: 'digest', ruleVersion: 'classroom-evidence-v1', warnings: ['不代表效果'],
      safeFacts: { runs: [{ runId: 66, lessonPlanVersion: 1,
        facts: [{ evidenceId: 'event:253', type: 'complete', occurredAt: '2026-10-15' }] }] },
      teacherReview: { secret: 'CHILD_PRIVATE' }, sourceManifest: [{ runId: 66,
        lessonPlanVersion: 1, historicalVersionId: 39, historicalVersionDigest: 'history' }] };
    const plan = { id: 8, teacherId: 1, version: 2, currentVersionId: 40 };
    const plans = { findOneBy: jest.fn().mockImplementation(async () => ({ ...plan })) };
    const versions = { findOneBy: jest.fn<any>().mockResolvedValue({ id: 40, snapshotJson: JSON.stringify({
      title: '数字', contentBoundary: 1, steps: [{ id: 123, instruction: '老师提示', content: '看一看' }],
    }) }) };
    const saved: any[] = [];
    const drafts = { create: (x: any) => x, save: jest.fn(async (x: any) => { saved.push(x); return { id: 9, ...x }; }) };
    const evidence = { build: jest.fn().mockImplementation(async () => structuredClone(pack)) };
    const audit = { writeAi: jest.fn<any>().mockResolvedValue(undefined) };
    const service = new LessonPlanAiService({ get: (key: string) => ({ ARK_API_KEY: 'test', ARK_ENDPOINT_ID: 'model' })[key] } as ConfigService,
      audit as any, plans as any, versions as any, drafts as any, { getUsable: jest.fn() } as any, evidence as any);
    const candidate = { title: '观察', teacherInstructionSuggestion: '可以尝试观察', studentContentCandidate: '',
      durationSecondsSuggestion: 60, rationale: '执行事实仅作参考', evidenceIds: ['event:253'] };
    const create = jest.fn<any>().mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ candidates: [candidate], warnings: [] }) } }] });
    (service as any).openai.chat.completions.create = create;
    const input = { schemaVersion: 2, taskType: 'experience_optimization' as const, baseLessonPlanId: 8,
      baseVersion: 2, targetStepId: 123, referenceRunIds: [66], theme: '数字', ageGroup: LessonAgeGroup.FourToFive,
      domain: '科学', durationMinutes: 20, teachingObjectives: '观察数字', resourceIds: [] };
    return { service, input, create, saved, evidence, plan, plans, candidate, pack };
  }
  it('stores candidates and frozen minimal provenance without teacherReview or formal writes', async () => {
    const f = fixture();
    const result = await f.service.generateCandidateDraft({ sub: 1 } as any, f.input);
    expect(f.saved).toHaveLength(1);
    expect(result.provenanceSources[0]).toEqual(expect.objectContaining({ draftId: 9,
      evidenceDigest: 'digest', referenceRunIds: [66], sourceLessonVersions: [expect.objectContaining({ versionId: 39 })] }));
    expect(JSON.stringify(f.create.mock.calls)).not.toContain('CHILD_PRIVATE');
    expect(result.output.candidates[0].studentContentCandidate).toBe('');
    expect(f.evidence.build).toHaveBeenCalledTimes(2);
  });
  it('rejects fake evidence and unsupported effectiveness claims', async () => {
    for (const patch of [{ evidenceIds: ['event:999'] }, { rationale: '证明有效' }]) {
      const f = fixture();
      f.create.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ candidates: [{ ...f.candidate, ...patch }], warnings: [] }) } }] });
      await expect(f.service.generateCandidateDraft({ sub: 1 } as any, f.input)).rejects.toThrow('人工备课仍可继续');
      expect(f.saved.every(d => !d.outputJson)).toBe(true);
    }
  });
  it('returns conflict when a new current version appears during generation; no usable Draft', async () => {
    const f = fixture();
    f.create.mockImplementation(async () => { f.plan.version = 3; return { choices: [{ message: {
      content: JSON.stringify({ candidates: [f.candidate], warnings: [] }),
    } }] }; });
    await expect(f.service.generateCandidateDraft({ sub: 1 } as any, f.input)).rejects.toMatchObject({ status: 409 });
    expect(f.saved).toHaveLength(0);
  });
  it('rechecks permissions before AI and preserves deterministic evidence mapping', async () => {
    const f = fixture();
    f.evidence.build.mockRejectedValue(new Error('无权限'));
    await expect(f.service.generateCandidateDraft({ sub: 1 } as any, f.input)).rejects.toThrow('无权限');
    expect(f.create).not.toHaveBeenCalled();
    const g = fixture();
    const a = await g.service.generateCandidateDraft({ sub: 1 } as any, g.input);
    const b = await g.service.generateCandidateDraft({ sub: 1 } as any, g.input);
    expect(a.output.sourceReferences).toEqual(b.output.sourceReferences);
    expect(a.output.evidenceDigest).toBe(b.output.evidenceDigest);
  });
  it('timeout only creates failed Draft, never a formal plan', async () => {
    const f = fixture(); f.create.mockRejectedValue(new Error('timeout'));
    await expect(f.service.generateCandidateDraft({ sub: 1 } as any, f.input)).rejects.toThrow('人工备课仍可继续');
    expect(f.saved).toHaveLength(1); expect(f.saved[0].outputJson).toBeNull();
  });
  it('rejects a missing current target step and duplicate reference runs before calling AI', async () => {
    for (const patch of [{ targetStepId: 999 }, { referenceRunIds: [66, 66] }]) {
      const f = fixture();
      await expect(f.service.generateCandidateDraft({ sub: 1 } as any, { ...f.input, ...patch })).rejects.toThrow();
      expect(f.create).not.toHaveBeenCalled(); expect(f.saved).toHaveLength(0);
    }
  });
  it('rejects an evidence change or current-version pointer change after the model returns', async () => {
    for (const pointerChange of [true, false]) {
      const f = fixture();
      f.create.mockImplementation(async () => {
        if (pointerChange) f.plan.currentVersionId = 41;
        else f.pack.digest = 'changed';
        return { choices: [{ message: { content: JSON.stringify({ candidates: [f.candidate], warnings: [] }) } }] };
      });
      await expect(f.service.generateCandidateDraft({ sub: 1 } as any, f.input)).rejects.toMatchObject({ status: 409 });
      expect(f.saved).toHaveLength(0);
    }
  });
});
