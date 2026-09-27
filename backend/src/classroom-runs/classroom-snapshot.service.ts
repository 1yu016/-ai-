import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { In, Repository } from 'typeorm';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import {
  ACTIVE_CLASSROOM_RUN_STATUSES,
  ClassroomEventResult,
  ClassroomEventType,
  ClassroomRunStatus,
  ClassroomSnapshotReason,
} from './classroom-run.types';
import { ClassroomEvent } from './entities/classroom-event.entity';
import { ClassroomRun } from './entities/classroom-run.entity';
import { ClassroomSnapshot } from './entities/classroom-snapshot.entity';

const RECENT_SNAPSHOT_LIMIT = 20;
const TOTAL_SNAPSHOT_LIMIT = 50;
const PERIODIC_SNAPSHOT_MS = 30_000;

type JsonMap = Record<string, unknown>;

export type ClassroomSnapshotPatch = {
  playedResourceId?: number;
  attendanceState?: JsonMap;
  rollCallState?: JsonMap;
  rewardState?: JsonMap;
  interactionState?: JsonMap;
  playerState?: JsonMap;
};

export type ValidClassroomSnapshot = {
  entity: ClassroomSnapshot;
  playedResourceIds: number[];
  attendanceState: JsonMap;
  rollCallState: JsonMap;
  rewardState: JsonMap;
  interactionState: JsonMap;
  playerState: JsonMap;
};

@Injectable()
export class ClassroomSnapshotService {
  private readonly logger = new Logger(ClassroomSnapshotService.name);

  constructor(
    @InjectRepository(ClassroomRun)
    private readonly runs: Repository<ClassroomRun>,
    @InjectRepository(ClassroomSnapshot)
    private readonly snapshots: Repository<ClassroomSnapshot>,
    @InjectRepository(ClassroomEvent)
    private readonly events: Repository<ClassroomEvent>,
  ) {}

  async capture(
    classroomRunId: number,
    reason: ClassroomSnapshotReason,
    isKey: boolean,
    patch: ClassroomSnapshotPatch = {},
  ): Promise<ValidClassroomSnapshot | null> {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const run = await this.runs.findOne({ where: { id: classroomRunId } });
        if (!run) return null;
        const previous = await this.loadLatestValid(classroomRunId);
        const latestVersion = await this.snapshots.maximum('snapshotVersion', {
          classroomRunId,
        });
        const playedResourceIds = Array.from(
          new Set([
            ...(previous?.playedResourceIds ?? []),
            ...(patch.playedResourceId ? [patch.playedResourceId] : []),
          ]),
        );
        const values = {
          classroomRunId,
          snapshotVersion: (latestVersion ?? 0) + 1,
          runVersion: run.version,
          runStatus: run.status,
          currentStepIndex: run.currentStepIndex,
          elapsedSeconds: this.currentElapsed(run),
          playedResourceIds,
          attendanceState:
            patch.attendanceState ?? previous?.attendanceState ?? {},
          rollCallState: patch.rollCallState ?? previous?.rollCallState ?? {},
          rewardState: patch.rewardState ?? previous?.rewardState ?? {},
          interactionState:
            patch.interactionState ?? previous?.interactionState ?? {},
          playerState: patch.playerState ?? previous?.playerState ?? {},
          deviceId: run.deviceId,
          reason,
          isKey,
        };
        const entity = await this.snapshots.save(
          this.snapshots.create({
            ...values,
            playedResourceIds: JSON.stringify(values.playedResourceIds),
            attendanceState: JSON.stringify(values.attendanceState),
            rollCallState: JSON.stringify(values.rollCallState),
            rewardState: JSON.stringify(values.rewardState),
            interactionState: JSON.stringify(values.interactionState),
            playerState: JSON.stringify(values.playerState),
            checksum: this.checksum(values),
          }),
        );
        await this.trim(classroomRunId);
        return { entity, ...this.stateFromValues(values) };
      } catch (error) {
        if (attempt === 1 && this.isUniqueViolation(error)) continue;
        await this.recordFailure(classroomRunId, reason, error);
        return null;
      }
    }
    return null;
  }

  async loadLatestValid(
    classroomRunId: number,
  ): Promise<ValidClassroomSnapshot | null> {
    const candidates = await this.snapshots.find({
      where: { classroomRunId },
      order: { snapshotVersion: 'DESC' },
      take: TOTAL_SNAPSHOT_LIMIT,
    });
    for (const candidate of candidates) {
      const decoded = this.decode(candidate);
      if (decoded) return decoded;
    }
    return null;
  }

  @Interval('classroom-snapshot', PERIODIC_SNAPSHOT_MS)
  async saveActiveClassrooms(): Promise<void> {
    const runs = await this.runs.find({
      where: { status: In([...ACTIVE_CLASSROOM_RUN_STATUSES]) },
    });
    for (const run of runs) {
      const latest = await this.snapshots.findOne({
        where: { classroomRunId: run.id },
        order: { snapshotVersion: 'DESC' },
      });
      if (
        latest &&
        Date.now() - latest.createdAt.getTime() < PERIODIC_SNAPSHOT_MS - 1000
      )
        continue;
      await this.capture(run.id, ClassroomSnapshotReason.Timed, false);
    }
  }

  currentElapsed(run: ClassroomRun): number {
    if (run.status !== ClassroomRunStatus.Running || !run.resumedAt)
      return run.elapsedSeconds;
    return (
      run.elapsedSeconds +
      Math.max(0, Math.floor((Date.now() - run.resumedAt.getTime()) / 1000))
    );
  }

  private decode(snapshot: ClassroomSnapshot): ValidClassroomSnapshot | null {
    try {
      const state = {
        classroomRunId: snapshot.classroomRunId,
        snapshotVersion: snapshot.snapshotVersion,
        runVersion: snapshot.runVersion,
        runStatus: snapshot.runStatus,
        currentStepIndex: snapshot.currentStepIndex,
        elapsedSeconds: snapshot.elapsedSeconds,
        playedResourceIds: this.numberArray(snapshot.playedResourceIds),
        attendanceState: this.jsonMap(snapshot.attendanceState),
        rollCallState: this.jsonMap(snapshot.rollCallState),
        rewardState: this.jsonMap(snapshot.rewardState),
        interactionState: this.jsonMap(snapshot.interactionState),
        playerState: this.jsonMap(snapshot.playerState),
        deviceId: snapshot.deviceId,
        reason: snapshot.reason,
        isKey: snapshot.isKey,
      };
      if (this.checksum(state) !== snapshot.checksum) return null;
      return { entity: snapshot, ...this.stateFromValues(state) };
    } catch {
      return null;
    }
  }

  private checksum(value: object): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private stateFromValues(value: {
    playedResourceIds: number[];
    attendanceState: JsonMap;
    rollCallState: JsonMap;
    rewardState: JsonMap;
    interactionState: JsonMap;
    playerState: JsonMap;
  }) {
    return {
      playedResourceIds: value.playedResourceIds,
      attendanceState: value.attendanceState,
      rollCallState: value.rollCallState,
      rewardState: value.rewardState,
      interactionState: value.interactionState,
      playerState: value.playerState,
    };
  }

  private numberArray(value: string): number[] {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.every(Number.isInteger))
      throw new Error('invalid number array');
    return parsed as number[];
  }

  private jsonMap(value: string): JsonMap {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('invalid json object');
    return parsed as JsonMap;
  }

  private async trim(classroomRunId: number) {
    const rows = await this.snapshots.find({
      where: { classroomRunId },
      order: { snapshotVersion: 'DESC' },
    });
    if (rows.length <= TOTAL_SNAPSHOT_LIMIT) return;
    const keep = new Set(
      rows.slice(0, RECENT_SNAPSHOT_LIMIT).map((row) => row.id),
    );
    for (const row of rows.slice(RECENT_SNAPSHOT_LIMIT)) {
      if (keep.size >= TOTAL_SNAPSHOT_LIMIT) break;
      if (row.isKey) keep.add(row.id);
    }
    const remove = rows.filter((row) => !keep.has(row.id)).map((row) => row.id);
    if (remove.length) await this.snapshots.delete({ id: In(remove) });
  }

  private async recordFailure(
    classroomRunId: number,
    reason: ClassroomSnapshotReason,
    error: unknown,
  ) {
    const run = await this.runs.findOne({ where: { id: classroomRunId } });
    const message =
      typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message?: unknown }).message ?? '')
        : String(error);
    this.logger.error(`课堂 ${classroomRunId} 快照保存失败：${message}`);
    if (!run) return;
    try {
      await this.events.save(
        this.events.create({
          classroomRunId,
          eventType: ClassroomEventType.SnapshotFailed,
          requestId: `snapshot-error-${Date.now()}-${randomUUID().slice(0, 8)}`,
          operatorType: AuthUserType.Teacher,
          operatorId: run.teacherId,
          deviceId: run.deviceId,
          payload: JSON.stringify({ reason, error: message.slice(0, 300) }),
          result: ClassroomEventResult.Failure,
        }),
      );
    } catch (logError) {
      this.logger.error(
        `课堂 ${classroomRunId} 快照错误记录失败：${String(logError)}`,
      );
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';
    return code.includes('CONSTRAINT') || code === '23505';
  }
}
