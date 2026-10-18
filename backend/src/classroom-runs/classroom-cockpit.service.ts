import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import { PlatformAccessService } from '../platform/platform-access.service';
import { Device } from '../platform/entities/device.entity';
import { DeviceBinding } from '../platform/entities/device-binding.entity';
import { BindingStatus, DeviceStatus } from '../platform/platform.types';
import {
  deviceHeartbeatTimeoutMs,
  deviceOnlineStatus,
} from '../platform/device-online-policy';
import { LessonPlanVersion } from '../lesson-plans/entities/lesson-plan-version.entity';
import { ClassroomRun } from './entities/classroom-run.entity';
import { ClassroomRunStepSnapshot } from './entities/classroom-run-step-snapshot.entity';
import { ClassroomSnapshotService } from './classroom-snapshot.service';
import { readOperationContext } from './classroom-operation-context';
import {
  CLASSROOM_OPERATIONS,
  decideOperation,
  operationPhase,
  policyAllowedActions,
} from './classroom-operation-policy';
import { mergePresentationObservation } from './presentation-ownership';

/** Teacher-only projection. No lifecycle settlement, handoff, commands or captures. */
@Injectable()
export class ClassroomCockpitService {
  constructor(
    private readonly db: DataSource,
    private readonly access: PlatformAccessService,
    private readonly snapshots: ClassroomSnapshotService,
    private readonly config: ConfigService,
  ) {}

  async get(actor: JwtTeacherPayload, id: number) {
    if (actor.userType !== AuthUserType.Teacher)
      throw new ForbiddenException('课堂运行只能由教师操作');
    for (let attempt = 0; attempt < 2; attempt++) {
      const run = await this.db.getRepository(ClassroomRun).findOneBy({ id });
      if (!run) throw new NotFoundException('课堂运行不存在');
      if (run.teacherId !== actor.sub)
        throw new ForbiddenException('无权操作其他教师的课堂');
      const cls = await this.access.requireClassAccess(
        actor,
        run.classId,
        this.db.manager,
        { readOnly: true },
      );
      const latest = await this.snapshots.loadLatestValid(id);
      const context = await readOperationContext(
        run,
        this.db.manager,
        this.snapshots,
      );
      const steps = await this.db
        .getRepository(ClassroomRunStepSnapshot)
        .find({ where: { classroomRunId: id }, order: { stepIndex: 'ASC' } });
      const version = await this.db
        .getRepository(LessonPlanVersion)
        .findOneBy({
          lessonPlanId: run.lessonPlanId,
          versionNo: run.lessonPlanVersion,
        });
      const device = await this.db
        .getRepository(Device)
        .findOneBy({ id: run.deviceId });
      const binding = await this.db
        .getRepository(DeviceBinding)
        .findOne({
          where: { deviceId: run.deviceId, status: BindingStatus.Active },
          order: { boundAt: 'DESC', id: 'DESC' },
        });
      const finalRun = await this.db
        .getRepository(ClassroomRun)
        .findOneBy({ id });
      const finalSnapshot = await this.snapshots.loadLatestValid(id);
      const finalBinding = await this.db
        .getRepository(DeviceBinding)
        .findOne({
          where: { deviceId: run.deviceId, status: BindingStatus.Active },
          order: { boundAt: 'DESC', id: 'DESC' },
        });
      await this.access.requireClassAccess(
        actor,
        run.classId,
        this.db.manager,
        { readOnly: true },
      );
      if (
        JSON.stringify(finalRun) !== JSON.stringify(run) ||
        latest?.entity.id !== finalSnapshot?.entity.id ||
        JSON.stringify(binding) !== JSON.stringify(finalBinding)
      )
        continue;
      const warnings: string[] = [];
      const consistent =
        !!latest &&
        latest.entity.runVersion === run.version &&
        latest.entity.deviceId === run.deviceId &&
        latest.entity.currentStepIndex === run.currentStepIndex &&
        latest.entity.runStatus === run.status;
      if (!consistent) warnings.push('SNAPSHOT_MISSING_OR_NOT_CURRENT');
      if (!consistent && ['running', 'paused'].includes(run.status))
        context.recovery = true;
      const player = consistent ? latest.playerState : {};
      const identityValid =
        typeof player.presentationCommandId === 'string' &&
        !!player.presentationCommandId &&
        Number.isSafeInteger(player.presentationRevision);
      const pick = (value: Record<string, unknown>, keys: string[]) =>
        Object.fromEntries(
          keys
            .filter(
              (k) =>
                value[k] !== undefined &&
                ['string', 'number', 'boolean'].includes(typeof value[k]),
            )
            .map((k) => [k, value[k]]),
        );
      const report = player.observation as Record<string, unknown> | undefined;
      const observation =
        identityValid &&
        report &&
        report.presentationCommandId === player.presentationCommandId &&
        report.presentationRevision === player.presentationRevision
          ? (mergePresentationObservation(
              {
                presentationCommandId: player.presentationCommandId,
                presentationRevision: player.presentationRevision,
              },
              report,
            ).observation ?? null)
          : null;
      let frozen: { title: string | null; objectives: string | null } | null =
        null;
      if (version) {
        try {
          const data = JSON.parse(version.snapshotJson);
          frozen = {
            title: typeof data.title === 'string' ? data.title : null,
            objectives:
              typeof data.objectives === 'string' ? data.objectives : null,
          };
        } catch {
          /* Invalid history is unavailable, never replaced by live plan. */
        }
      }
      if (!frozen) warnings.push('FROZEN_LESSON_UNAVAILABLE');
      if (!device) warnings.push('DEVICE_UNAVAILABLE');
      if (
        !binding ||
        binding.classId !== run.classId ||
        binding.classroomId !== run.classroomId
      )
        warnings.push('DEVICE_BINDING_MISMATCH');
      const projectStep = (step: ClassroomRunStepSnapshot | undefined) =>
        step
          ? {
              id: step.id,
              originalStepId: step.originalStepId,
              stepIndex: step.stepIndex,
              title: step.title,
              type: step.type,
              teacherInstruction: step.teacherTip,
              studentContent: step.content,
              resourceId: step.resourceId,
              durationSeconds: step.durationSeconds,
            }
          : null;
      const index = steps.findIndex(
        (s) => s.stepIndex === run.currentStepIndex,
      );
      if (index < 0) warnings.push('CURRENT_STEP_UNAVAILABLE');
      const evaluatedAt = new Date().toISOString();
      const status = device
        ? deviceOnlineStatus(
            device,
            deviceHeartbeatTimeoutMs(
              this.config.get('DEVICE_HEARTBEAT_TIMEOUT_SECONDS'),
            ),
          )
        : null;
      return {
        schemaVersion: 1 as const,
        serverNow: evaluatedAt,
        run: {
          id: run.id,
          status: run.status,
          version: run.version,
          classId: run.classId,
          deviceId: run.deviceId,
          lessonPlanId: run.lessonPlanId,
          lessonPlanVersion: run.lessonPlanVersion,
        },
        class: { id: cls.id, name: cls.name },
        phase: operationPhase(context),
        break: { active: !!context.breakActive, endsAt: run.breakEndsAt },
        lesson: {
          frozenVersionAvailable: !!frozen,
          frozen,
          currentStep: projectStep(steps[index]),
          nextStep: projectStep(index >= 0 ? steps[index + 1] : undefined),
          totalSteps: steps.length,
        },
        presentation: {
          control: pick(player, [
            'presentationMode',
            'presentationCommandId',
            'presentationRevision',
            'presentationItemId',
            'resourceId',
            'operation',
          ]),
          observation,
          delivery: 'unknown' as const,
          snapshotSavedAt: latest?.entity.createdAt ?? null,
          observationOccurredAt: null,
        },
        device: {
          id: run.deviceId,
          status,
          online: status === DeviceStatus.Online,
          lastOnlineAt: device?.lastOnlineAt ?? null,
          evaluatedAt,
          bindingMatches:
            !!binding &&
            binding.classId === run.classId &&
            binding.classroomId === run.classroomId,
        },
        capabilities: {
          allowedActions: policyAllowedActions(context),
          restrictions: CLASSROOM_OPERATIONS.map((operation) => ({
            operation,
            ...decideOperation(context, operation),
          })).filter((d) => !d.allowed),
          executionChecksRequired: true as const,
        },
        versions: {
          runVersion: run.version,
          snapshotVersion: latest?.entity.snapshotVersion ?? null,
          snapshotRunVersion: latest?.entity.runVersion ?? null,
          presentationRevision: identityValid
            ? Number(player.presentationRevision)
            : null,
        },
        recovery: { manualInterventionRequired: !!context.recovery, warnings },
      };
    }
    throw new ConflictException({
      code: 'COCKPIT_STATE_CHANGED',
      message: '课堂状态已变化，请重新读取',
    });
  }
}
