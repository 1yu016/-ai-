import { jest } from '@jest/globals';
import { ClassroomBusinessReceiptService, type BusinessReceipt } from './classroom-business-receipt.service';
import { ClassroomEventResult, ClassroomEventType } from './classroom-run.types';

describe('immutable business receipts', () => {
  const service = new ClassroomBusinessReceiptService();
  const actor = { sub: 1, userType: 'teacher' } as any;
  const make = (): BusinessReceipt => ({ kind: 'classroom_business_receipt', contractVersion: 1,
    normalizationVersion: 1, originalRequestId: 'request', operation: 'reward.create', runId: 2,
    payloadDigest: service.digest(2, 'reward.create', { stars: 1 }), businessRecordIds: [3],
    committedRunVersion: 4, result: { record: { id: 3 }, studentTotal: 1 } });
  const event = (payload: unknown) => ({ classroomRunId: 2, eventType: ClassroomEventType.Command,
    result: ClassroomEventResult.Success, payload: JSON.stringify(payload) }) as any;

  it('recognises exact kind/version only, never an ordinary command event', () => {
    expect(service.parse(event({ operation: 'reward.create', result: {} }))).toBeNull();
    for (const patch of [{ kind: 'command' }, { contractVersion: 2 }, { businessRecordIds: [0] },
      { payloadDigest: 'fake' }, { operation: 'unknown' }, { extra: true }, { result: [] }])
      expect(service.parse(event({ ...make(), ...patch }))).toBeNull();
    expect(service.parse(event(make()))).toEqual(make());
  });
  it('normalises object keys and binds operation/run, but not transport version', () => {
    expect(service.digest(2, 'reward.create', { stars: 1, reason: null }))
      .toBe(service.digest(2, 'reward.create', { reason: null, stars: 1 }));
    expect(service.digest(2, 'reward.create', { stars: 1 })).not.toBe(service.digest(2, 'reward.create', { stars: 2 }));
    expect(service.key(actor, 2, 'request')).not.toBe(service.key(actor, 3, 'request'));
  });
  it('roll-call receipts require RollCall event type and never accept ordinary roll-call events', async () => {
    const receipt: BusinessReceipt = { ...make(), operation: 'roll_call.random' };
    expect(service.parse(event(receipt))).toBeNull();
    expect(service.parse({ ...event(receipt), eventType: ClassroomEventType.RollCall })).toEqual(receipt);
    expect(service.parse({ ...event(make()), eventType: ClassroomEventType.RollCall })).toBeNull();
    expect(service.parse({ ...event({ studentId: 3, recordId: 1 }), eventType: ClassroomEventType.RollCall })).toBeNull();
    const save = jest.fn<any>().mockImplementation(async (x: any) => x);
    const manager = { queryRunner: { isTransactionActive: true }, getRepository: () => ({
      existsBy: async () => false, create: (x: any) => x, save,
    }) } as any;
    await service.write(manager, actor, 1, receipt);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ eventType: ClassroomEventType.RollCall }));
  });
  it('attendance receipts require Attendance event type; reward recognition remains unchanged', async () => {
    const receipt: BusinessReceipt = { ...make(), operation: 'attendance.batch' };
    expect(service.parse(event(receipt))).toBeNull();
    expect(service.parse({ ...event(receipt), eventType: ClassroomEventType.Attendance })).toEqual(receipt);
    expect(service.parse({ ...event(make()), eventType: ClassroomEventType.Attendance })).toBeNull();
    expect(service.parse({ ...event({ updates: [] }), eventType: ClassroomEventType.Attendance })).toBeNull();
    const save = jest.fn<any>().mockImplementation(async (x: any) => x);
    const manager = { queryRunner: { isTransactionActive: true }, getRepository: () => ({
      existsBy: async () => false, create: (x: any) => x, save,
    }) } as any;
    await service.write(manager, actor, 1, receipt);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ eventType: ClassroomEventType.Attendance }));
  });
  it('replays durable stored result and rejects mismatched or non-business rows', async () => {
    const receipt = make();
    const repo = { findOneBy: jest.fn<any>().mockResolvedValue(event(receipt)) };
    const manager = { getRepository: () => repo } as any;
    expect(await service.read(manager, actor, 2, 'request', 'reward.create', receipt.payloadDigest)).toEqual(receipt);
    await expect(service.read(manager, actor, 2, 'request', 'reward.revoke', receipt.payloadDigest)).rejects.toMatchObject({ status: 409 });
    repo.findOneBy.mockResolvedValue(event({ operation: 'reward.create' }));
    await expect(service.read(manager, actor, 2, 'request', 'reward.create', receipt.payloadDigest)).rejects.toMatchObject({ status: 409 });
  });
  it('only inserts; a committed result/digest/record list cannot be overwritten', async () => {
    let stored: any;
    const repo = { existsBy: async () => !!stored, create: (x: any) => x,
      save: jest.fn<any>().mockImplementation(async (x: any) => { stored = x; return x; }) };
    const manager = { queryRunner: { isTransactionActive: true }, getRepository: () => repo } as any;
    await service.write(manager, actor, 1, make());
    const before = JSON.stringify(stored);
    await expect(service.write(manager, actor, 1, { ...make(), result: { studentTotal: 99 }, businessRecordIds: [99] }))
      .rejects.toMatchObject({ status: 409 });
    expect(JSON.stringify(stored)).toBe(before); expect(repo.save).toHaveBeenCalledTimes(1);
  });
});
