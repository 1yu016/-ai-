import { rejectLegacyWrite, withRecordIdentity } from './legacy-write-boundary';

describe('legacy boundary identity', () => {
  it('same numeric ID remains distinct by source/type; audit source is not overwritten', () => {
    const old = withRecordIdentity({ id: 7, source: 'manual' }, 'legacy_participation', 'attendance_change');
    const current = withRecordIdentity({ id: 7 }, 'canonical', 'attendance');
    expect(old.source).toBe('manual');
    expect(old.recordIdentity).toEqual({ source: 'legacy_participation', recordType: 'attendance_change', recordId: 7 });
    expect(old.identity).not.toBe(current.identity);
    expect(withRecordIdentity({ id: 7 }, 'canonical', 'reward').identity).not.toBe(current.identity);
  });
  it('reject has a stable machine-readable code', () => {
    try { rejectLegacyWrite('voice.reward'); } catch (e) {
      expect((e as any).getResponse()).toMatchObject({ code: 'LEGACY_SEMANTICS_UNSUPPORTED' });
      expect((e as any).getStatus()).toBe(409);
    }
  });
});
