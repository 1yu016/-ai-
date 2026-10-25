import { jest } from '@jest/globals';
import type { Repository } from 'typeorm';
import {
  ClassroomSnapshotService,
  type ValidClassroomSnapshot,
} from './classroom-snapshot.service';
import {
  ClassroomRunStatus,
  ClassroomSnapshotReason,
} from './classroom-run.types';
import { ClassroomRun } from './entities/classroom-run.entity';
import { ClassroomSnapshot } from './entities/classroom-snapshot.entity';
import { ClassroomEvent } from './entities/classroom-event.entity';

describe('snapshot server-owned screenLifecycle protection', () => {
  const lifecycle = { schemaVersion: 1, phase: 'fixture', revision: 7 };
  function setup(interactionState: Record<string, unknown> = {}) {
    let saved: ClassroomSnapshot | undefined;
    const runs = {
      manager: {
        transaction: async (work: (manager: undefined) => unknown) =>
          work(undefined),
      },
      findOne: jest.fn(async () => ({
        id: 1,
        version: 1,
        status: ClassroomRunStatus.Paused,
        currentStepIndex: 0,
        elapsedSeconds: 12,
        deviceId: 3,
        avatarVersionId: null,
        avatarCharacterId: null,
      })),
    };
    const snapshots = {
      maximum: jest.fn(async () => 1),
      create: (value: object) => value,
      save: jest.fn(async (value: object) => {
        saved = { ...value, id: 2, createdAt: new Date() } as ClassroomSnapshot;
        return saved;
      }),
      find: jest.fn(async () => (saved ? [saved] : [])),
    };
    const service = new ClassroomSnapshotService(
      runs as unknown as Repository<ClassroomRun>,
      snapshots as unknown as Repository<ClassroomSnapshot>,
      {} as Repository<ClassroomEvent>,
    );
    const previous = {
      entity: {},
      playedResourceIds: [4],
      attendanceState: { present: [1] },
      rollCallState: { lastStudentId: 1 },
      rewardState: { stars: 2 },
      interactionState,
      playerState: { positionSeconds: 10 },
    } as ValidClassroomSnapshot;
    const spy = jest
      .spyOn(service, 'loadLatestValid')
      .mockResolvedValue(previous);
    return { service, spy, snapshots, previous };
  }

  it.each([
    { screenLifecycle: { phase: 'forged' } },
    { screenLifecycle: null },
    {},
  ])(
    'ordinary replacement cannot overwrite or remove lifecycle: %j',
    async (incoming) => {
      const { service, previous } = setup({
        screenLifecycle: lifecycle,
        oldInteraction: true,
      });
      const patch = { ...incoming, question: 'new' };
      const result = await service.capture(
        1,
        ClassroomSnapshotReason.Timed,
        false,
        { interactionState: patch },
      );
      expect(result?.interactionState).toEqual({
        question: 'new',
        screenLifecycle: lifecycle,
      });
      expect(result?.attendanceState).toEqual(previous.attendanceState);
      expect(result?.rollCallState).toEqual(previous.rollCallState);
      expect(result?.rewardState).toEqual(previous.rewardState);
      expect(patch).toEqual({ ...incoming, question: 'new' });
    },
  );

  it('does not create the namespace from client data on historical snapshots', async () => {
    const { service } = setup({ legacy: true });
    const result = await service.capture(
      1,
      ClassroomSnapshotReason.Timed,
      false,
      {
        interactionState: { screenLifecycle: lifecycle, question: 'allowed' },
      },
    );
    expect(result?.interactionState).toEqual({ question: 'allowed' });
  });

  it('periodic capture retains lifecycle and remains checksum-valid for ordinary restoration', async () => {
    const { service, spy } = setup({
      screenLifecycle: lifecycle,
      question: 'existing',
    });
    await service.capture(1, ClassroomSnapshotReason.Timed, false);
    spy.mockRestore();
    const restored = await service.loadLatestValid(1);
    expect(restored?.interactionState).toEqual({
      screenLifecycle: lifecycle,
      question: 'existing',
    });
    expect(restored?.playerState).toEqual({ positionSeconds: 10 });
  });

  it('keeps legacy snapshots free of new metadata and preserves ordinary replacement semantics', async () => {
    const { service, spy } = setup({ old: true });
    await service.capture(1, ClassroomSnapshotReason.Timed, false, {
      interactionState: {},
      attendanceState: { absent: [2] },
      rollCallState: {},
      rewardState: { stars: 5 },
    });
    spy.mockRestore();
    const restored = await service.loadLatestValid(1);
    expect(restored?.interactionState).toEqual({});
    expect(restored?.attendanceState).toEqual({ absent: [2] });
    expect(restored?.rollCallState).toEqual({});
    expect(restored?.rewardState).toEqual({ stars: 5 });
  });
});
