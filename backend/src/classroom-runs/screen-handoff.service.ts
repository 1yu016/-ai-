import { ForbiddenException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { JwtTeacherPayload } from '../auth/auth.types';

type Handoff = {
  id: string;
  teacherId: number;
  runId: number;
  deviceId: number;
  bindingId: number;
  expiresAt: number;
  day: string;
};
const day = (time: number) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(time));

/** Single-process short lease. Restart drops eligibility rather than inferring history. */
@Injectable()
export class ScreenHandoffService {
  private readonly leases = new Map<string, Handoff>();
  issueActive(
    actor: JwtTeacherPayload,
    runId: number,
    deviceId: number,
    bindingId: number,
  ) {
    this.prune();
    const existing = [...this.leases.values()].find(
      (x) =>
        x.teacherId === actor.sub &&
        x.runId === runId &&
        x.deviceId === deviceId &&
        x.bindingId === bindingId,
    );
    const lease = existing ?? {
      id: randomUUID(),
      teacherId: actor.sub,
      runId,
      deviceId,
      bindingId,
      expiresAt: 0,
      day: day(Date.now()),
    };
    // Renewal is only called after a verified ACTIVE run; SUMMARY reads never renew.
    lease.expiresAt = Date.now() + 30 * 60_000;
    this.leases.set(lease.id, lease);
    return { id: lease.id };
  }
  resolve(
    actor: JwtTeacherPayload,
    id: string,
    deviceId: number,
    bindingId: number,
  ): Handoff | null {
    this.prune();
    const lease = this.leases.get(id);
    if (!lease) return null;
    if (lease.teacherId !== actor.sub || lease.deviceId !== deviceId)
      throw new ForbiddenException('课堂交接凭证不属于当前教师或设备');
    if (lease.bindingId !== bindingId) {
      this.leases.delete(id);
      return null;
    }
    return lease;
  }
  revokeDevice(deviceId: number) {
    for (const [id, lease] of this.leases)
      if (lease.deviceId === deviceId) this.leases.delete(id);
  }
  revokeRun(runId: number) {
    for (const [id, lease] of this.leases)
      if (lease.runId === runId) this.leases.delete(id);
  }
  private prune() {
    for (const [id, lease] of this.leases)
      if (lease.expiresAt <= Date.now() || lease.day !== day(Date.now()))
        this.leases.delete(id);
  }
}
