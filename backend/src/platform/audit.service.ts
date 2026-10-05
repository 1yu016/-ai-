import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AiCallLog } from './entities/ai-call-log.entity';
import { AuditLog } from './entities/audit-log.entity';
import { AuditResult } from './platform.types';

type AuditInput = {
  action: string;
  targetType?: string;
  targetId?: string | number;
  result?: AuditResult;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
};

type AiLogInput = {
  actor?: JwtTeacherPayload;
  feature: string;
  provider?: string;
  model?: string;
  requestId?: string;
  status: string;
  latencyMs?: number;
  errorCode?: string;
  metadata?: Record<string, unknown>;
};

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogs: Repository<AuditLog>,
    @InjectRepository(AiCallLog)
    private readonly aiCallLogs: Repository<AiCallLog>,
  ) {}

  async write(actor: JwtTeacherPayload, input: AuditInput): Promise<void> {
    await this.auditLogs.save(
      this.auditLogs.create({
        actorType: actor.userType,
        actorId: actor.sub,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId == null ? null : String(input.targetId),
        result: input.result ?? AuditResult.Success,
        ipAddress: input.ipAddress ?? null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      }),
    );
  }

  async writeAi(input: AiLogInput): Promise<void> {
    await this.aiCallLogs.save(
      this.aiCallLogs.create({
        actorType: input.actor?.userType ?? null,
        actorId: input.actor?.sub ?? null,
        feature: input.feature,
        provider: input.provider ?? null,
        model: input.model ?? null,
        requestId: input.requestId ?? null,
        status: input.status,
        latencyMs: input.latencyMs ?? null,
        errorCode: input.errorCode ?? null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      }),
    );
  }
}
