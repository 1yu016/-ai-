import { ConflictException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { EntityManager } from 'typeorm';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { ClassroomEvent } from './entities/classroom-event.entity';
import { ClassroomEventResult, ClassroomEventType } from './classroom-run.types';

export type RewardOperation = 'reward.create' | 'reward.revoke' | 'collective_reward.create' | 'collective_reward.revoke';
const operations: RewardOperation[] = ['reward.create', 'reward.revoke', 'collective_reward.create', 'collective_reward.revoke'];
export type RollCallOperation = 'roll_call.random' | 'roll_call.specified' | 'roll_call.group_random';
export type BusinessOperation = RewardOperation | 'attendance.single' | 'attendance.batch' | RollCallOperation;
const attendanceOperations: BusinessOperation[] = ['attendance.single', 'attendance.batch'];
const rollCallOperations: BusinessOperation[] = ['roll_call.random', 'roll_call.specified', 'roll_call.group_random'];
function receiptEventType(operation: BusinessOperation) {
  return attendanceOperations.includes(operation) ? ClassroomEventType.Attendance
    : rollCallOperations.includes(operation) ? ClassroomEventType.RollCall : ClassroomEventType.Command;
}
export type BusinessReceipt = {
  kind: 'classroom_business_receipt'; contractVersion: 1;
  originalRequestId: string; operation: BusinessOperation; runId: number;
  payloadDigest: string; normalizationVersion: 1; businessRecordIds: number[];
  committedRunVersion: number; result: Record<string, unknown>;
};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .map(key => [key, stable((value as Record<string, unknown>)[key])]));
  if (value === undefined || (typeof value === 'number' && !Number.isFinite(value)))
    throw new ConflictException('业务摘要包含非法值');
  return value;
}

@Injectable()
export class ClassroomBusinessReceiptService {
  key(actor: JwtTeacherPayload, runId: number, requestId: string) {
    return `fact-v1:${hash(JSON.stringify([actor.userType, actor.sub, runId, requestId]))}`;
  }
  digest(runId: number, operation: BusinessOperation, payload: unknown) {
    return hash(JSON.stringify(stable({ normalizationVersion: 1, runId, operation, payload })));
  }
  /** Strictly recognise our versioned envelope, never an ordinary command event. */
  parse(event: ClassroomEvent): BusinessReceipt | null {
    try {
      const p = JSON.parse(event.payload ?? 'null');
      const keys = ['kind', 'contractVersion', 'originalRequestId', 'operation', 'runId', 'payloadDigest',
        'normalizationVersion', 'businessRecordIds', 'committedRunVersion', 'result'];
      if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).length !== keys.length ||
          Object.keys(p).some(k => !keys.includes(k)) || p.kind !== 'classroom_business_receipt' ||
          p.contractVersion !== 1 || p.normalizationVersion !== 1 ||
          (![...operations, ...attendanceOperations, ...rollCallOperations].includes(p.operation)) ||
          typeof p.originalRequestId !== 'string' || !p.originalRequestId.length ||
          p.originalRequestId.length > 100 ||
          !Number.isSafeInteger(p.runId) || p.runId < 1 || p.runId !== event.classroomRunId ||
          typeof p.payloadDigest !== 'string' || !/^[a-f0-9]{64}$/.test(p.payloadDigest) ||
          !Array.isArray(p.businessRecordIds) || !p.businessRecordIds.length ||
          p.businessRecordIds.some((id: unknown) => !Number.isSafeInteger(id) || Number(id) < 1) ||
          new Set(p.businessRecordIds).size !== p.businessRecordIds.length ||
          !Number.isSafeInteger(p.committedRunVersion) || p.committedRunVersion < 1 ||
          !p.result || typeof p.result !== 'object' || Array.isArray(p.result) ||
          event.eventType !== receiptEventType(p.operation) || event.result !== ClassroomEventResult.Success)
        return null;
      return p;
    } catch { return null; }
  }
  async read(manager: EntityManager, actor: JwtTeacherPayload, runId: number, requestId: string,
    operation: BusinessOperation, payloadDigest: string): Promise<BusinessReceipt | null> {
    const receipt = await this.findCommitted(manager, actor, runId, requestId, operation);
    if (receipt && receipt.payloadDigest !== payloadDigest)
      throw new ConflictException('业务 requestId 冲突或持久回执不可验证');
    return receipt;
  }

  /** Internal read only. Callers must authorize and verify the canonical digest. */
  async findCommitted(manager: EntityManager, actor: JwtTeacherPayload, runId: number, requestId: string,
    operation: BusinessOperation): Promise<BusinessReceipt | null> {
    const event = await manager.getRepository(ClassroomEvent).findOneBy({ operatorType: actor.userType,
      operatorId: actor.sub, requestId: this.key(actor, runId, requestId) });
    if (!event) return null;
    const receipt = this.parse(event);
    if (!receipt || receipt.originalRequestId !== requestId || receipt.runId !== runId ||
        receipt.operation !== operation)
      throw new ConflictException('业务 requestId 冲突或持久回执不可验证');
    return receipt;
  }
  /** Insert only: no API exists to update a committed receipt. */
  async write(manager: EntityManager, actor: JwtTeacherPayload, deviceId: number, receipt: BusinessReceipt) {
    if (!manager.queryRunner?.isTransactionActive) throw new Error('Business receipt requires active caller transaction');
    const repo = manager.getRepository(ClassroomEvent);
    const requestId = this.key(actor, receipt.runId, receipt.originalRequestId);
    if (await repo.existsBy({ operatorType: actor.userType, operatorId: actor.sub, requestId }))
      throw new ConflictException('已提交业务回执不可修改');
    const event = repo.create({ classroomRunId: receipt.runId, requestId, operatorType: actor.userType,
      operatorId: actor.sub, deviceId, eventType: receiptEventType(receipt.operation),
      result: ClassroomEventResult.Success, payload: JSON.stringify(receipt) });
    if (!this.parse(event)) throw new ConflictException('业务回执格式非法');
    return repo.save(event);
  }
}
