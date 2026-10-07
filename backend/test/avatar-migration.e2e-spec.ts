import { DataSource } from 'typeorm';
import { ClassroomRunStateMachine2026092700006 } from '../src/migrations/202609270006-ClassroomRunStateMachine';
import { ClassroomSnapshotRecovery2026092700007 } from '../src/migrations/202609270007-ClassroomSnapshotRecovery';
import { AvatarCharacterAssets2026092700008 } from '../src/migrations/202609270008-AvatarCharacterAssets';
import { AvatarConfigurationBindings2026092700009 } from '../src/migrations/202609270009-AvatarConfigurationBindings';
import { ClassroomDirectorSuggestions2026092700010 } from '../src/migrations/202609270010-ClassroomDirectorSuggestions';
import { HeuristicAssistantDrafts2026092700011 } from '../src/migrations/202609270011-HeuristicAssistantDrafts';
import { ClassroomCommands2026092800012 } from '../src/migrations/202609280012-ClassroomCommands';
import { ClassroomParticipation2026092800013 } from '../src/migrations/202609280013-ClassroomParticipation';
import { ClassroomEngagement2026093000014 } from '../src/migrations/202609300014-ClassroomEngagement';

describe('avatar character and asset migration (e2e)', () => {
  it('adds avatar tables and nullable classroom references without losing runs', async () => {
    const dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
    });
    await dataSource.initialize();
    await dataSource.query('PRAGMA foreign_keys = OFF');
    const runner = dataSource.createQueryRunner();
    await new ClassroomRunStateMachine2026092700006().up(runner);
    await new ClassroomSnapshotRecovery2026092700007().up(runner);
    await dataSource.query(
      `INSERT INTO "classroom_run"(
        "lesson_plan_id","lesson_plan_version","teacher_id","class_id",
        "classroom_id","device_id","title","status","current_step_index",
        "elapsed_seconds","version"
      ) VALUES (1,1,1,1,1,1,'迁移前课堂','paused',0,45,2)`,
    );
    await new AvatarCharacterAssets2026092700008().up(runner);
    await new AvatarConfigurationBindings2026092700009().up(runner);
    await new ClassroomDirectorSuggestions2026092700010().up(runner);
    await new HeuristicAssistantDrafts2026092700011().up(runner);
    await new ClassroomCommands2026092800012().up(runner);
    await new ClassroomParticipation2026092800013().up(runner);
    await new ClassroomEngagement2026093000014().up(runner);

    for (const table of [
      'avatar_character',
      'avatar_version',
      'avatar_asset',
      'avatar_voice_profile',
      'avatar_personality',
      'avatar_binding',
      'avatar_config_history',
      'avatar_usage_log',
      'classroom_director_suggestion',
      'heuristic_assistant_draft',
      'classroom_command_record',
      'classroom_command_rule',
      'classroom_command_offline_log',
      'attendance_record',
      'attendance_change_log',
      'student_group',
      'student_group_member',
      'roll_call_record',
      'roll_call_candidate_snapshot',
      'reward_rule',
      'reward_record',
      'reward_reversal',
      'badge_definition',
      'student_badge',
      'class_growth_record',
      'honor_record',
      'collective_goal',
      'break_config',
      'break_run',
    ])
      await expect(runner.hasTable(table)).resolves.toBe(true);
    await expect(
      runner.hasColumn('classroom_run', 'avatar_version_id'),
    ).resolves.toBe(true);
    await expect(
      runner.hasColumn('classroom_snapshot', 'avatar_version_id'),
    ).resolves.toBe(true);
    await expect(
      runner.hasColumn('classroom_run', 'avatar_character_id'),
    ).resolves.toBe(true);
    await expect(
      runner.hasColumn('classroom_snapshot', 'avatar_character_id'),
    ).resolves.toBe(true);
    const runs = (await dataSource.query(
      `SELECT "title","status","elapsed_seconds","avatar_version_id","avatar_character_id" FROM "classroom_run"`,
    )) as Array<Record<string, unknown>>;
    expect(runs).toEqual([
      {
        title: '迁移前课堂',
        status: 'paused',
        elapsed_seconds: 45,
        avatar_version_id: null,
        avatar_character_id: null,
      },
    ]);
    await dataSource.query(
      `INSERT INTO "avatar_character"("name","category","owner_type","owner_id") VALUES ('测试角色','cartoon_animal','teacher',1)`,
    );
    await dataSource.query(
      `INSERT INTO "avatar_version"("character_id","version","engine_version","model_format") VALUES (1,1,'avatar-engine-1','glb')`,
    );
    await expect(
      dataSource.query(
        `INSERT INTO "avatar_version"("character_id","version","engine_version","model_format") VALUES (1,1,'avatar-engine-1','glb')`,
      ),
    ).rejects.toThrow();
    await dataSource.query(
      `INSERT INTO "classroom_command_record"(
        "classroom_run_id","teacher_id","request_id","text_hash","locale",
        "source","intent","confidence","status","message"
      ) VALUES (1,1,'command-request-1','hash','zh-cn','local','pause',0.99,'recognized','ok')`,
    );
    await expect(
      dataSource.query(
        `INSERT INTO "classroom_command_record"(
          "classroom_run_id","teacher_id","request_id","text_hash","locale",
          "source","intent","confidence","status","message"
        ) VALUES (1,1,'command-request-1','hash','zh-cn','local','pause',0.99,'recognized','ok')`,
      ),
    ).rejects.toThrow();
    await dataSource.query(
      `INSERT INTO "heuristic_assistant_draft"(
        "classroom_run_id","teacher_id","request_id","run_version",
        "current_step_index","attempt_count","input_summary"
      ) VALUES (1,1,'heuristic-request-1',2,0,0,'{}')`,
    );
    await expect(
      dataSource.query(
        `INSERT INTO "heuristic_assistant_draft"(
          "classroom_run_id","teacher_id","request_id","run_version",
          "current_step_index","attempt_count","input_summary"
        ) VALUES (1,1,'heuristic-request-1',2,0,0,'{}')`,
      ),
    ).rejects.toThrow();
    await dataSource.query(
      `INSERT INTO "avatar_binding"("scope_type","scope_id","character_id","version_id","created_by") VALUES ('system',0,1,1,1)`,
    );
    await expect(
      dataSource.query(
        `INSERT INTO "avatar_binding"("scope_type","scope_id","character_id","version_id","created_by") VALUES ('system',0,1,1,1)`,
      ),
    ).rejects.toThrow();
    await dataSource.query(
      `INSERT INTO "classroom_director_suggestion"(
        "classroom_run_id","teacher_id","request_id","run_version",
        "current_step_index","input_summary"
      ) VALUES (1,1,'director-request-1',2,0,'{}')`,
    );
    await expect(
      dataSource.query(
        `INSERT INTO "classroom_director_suggestion"(
          "classroom_run_id","teacher_id","request_id","run_version",
          "current_step_index","input_summary"
        ) VALUES (1,1,'director-request-1',2,0,'{}')`,
      ),
    ).rejects.toThrow();
    await runner.release();
    await dataSource.destroy();
  });
});
